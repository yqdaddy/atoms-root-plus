/**
 * server/llm.ts P0 M4 接线测试：三件套注入 + 确定性结构校验
 *
 * 场景：
 * 1. create html 项目 → done.files 注入 /README.md（含功能清单与运行声明）
 * 2. create react-cdn 项目 → 注入 DESIGN.md/package.json；组件缺注册约定时
 *    带错误清单自动重试一次后交付
 * 3. LLM 已生成同名非空 README.md → 注入不覆盖
 * 4. 校验重试耗尽仍失败 → 降级交付（无 error 事件，delta 输出人话提示）
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE 流，走真实
 * generateWithStages → continueAfterApproval 链路，断言完整事件序列。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithStages, continueAfterApproval, type LLMEvent } from './llm.js';

const FEATURES_JSON = JSON.stringify({
  appTitle: '科学计算器',
  appType: 'tool',
  summary: '支持常用科学计算的计数器应用',
  features: [{ id: 'F1', name: '科学计算', description: '支持三角函数与幂运算', priority: 'must' }],
  interactions: ['点击数字键输入'],
  assumptions: [],
});

const HTML_FILES_JSON = JSON.stringify({
  files: [
    {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<head><title>科学计算器</title></head>\n<body><h1>科学计算器</h1></body>\n</html>',
      language: 'html',
    },
  ],
});

/** react 组件文件：registered=false 时缺 window.__components 注册（应触发校验重试） */
function reactProjectJson(registered: boolean): string {
  const register = registered
    ? '\nwindow.__components = window.__components || {};\nwindow.__components.App = App;'
    : '';
  return JSON.stringify({
    files: [
      {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
        language: 'html',
      },
      {
        path: '/src/main.jsx',
        content: 'const App = window.__components.App;\nReactDOM.createRoot(document.getElementById("root")).render(null);',
        language: 'javascript',
      },
      {
        path: '/src/App.jsx',
        content: `function App() { return null; }${register}`,
        language: 'javascript',
      },
    ],
  });
}

function makeSSEResponse(fullContent: string): Response {
  const encoder = new TextEncoder();
  const sseLines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const line of sseLines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function makeSequentialFetch(responses: string[]): {
  fetchMock: ReturnType<typeof vi.fn>;
  requestBodies: string[];
} {
  const requestBodies: string[] = [];
  let callIndex = 0;
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requestBodies.push(typeof init?.body === 'string' ? init.body : '');
    const content = responses[callIndex] ?? '';
    callIndex += 1;
    return makeSSEResponse(content);
  });
  return { fetchMock, requestBodies };
}

function joinedDeltaText(events: LLMEvent[]): string {
  return events
    .filter((e) => e.type === 'delta')
    .map((e) => e.payload.text ?? '')
    .join('');
}

async function runCreateFlow(options: {
  responses: string[];
  framework?: 'html' | 'react-cdn';
}): Promise<{ stage2Events: LLMEvent[]; requestBodies: string[]; fetchMock: ReturnType<typeof vi.fn> }> {
  const { fetchMock, requestBodies } = makeSequentialFetch(options.responses);
  vi.stubGlobal('fetch', fetchMock);

  const stage1Events: LLMEvent[] = [];
  await generateWithStages({
    prompt: '做一个科学计算器',
    framework: options.framework ?? 'html',
    intentOverride: 'create',
    onEvent: (e) => stage1Events.push(e),
    abortSignal: new AbortController().signal,
  });
  const approval = stage1Events.find((e) => e.type === 'approval_required');
  expect(approval).toBeDefined();
  const sessionId = approval!.payload.sessionId;
  expect(sessionId).toBeTruthy();

  const stage2Events: LLMEvent[] = [];
  await continueAfterApproval(sessionId!, (e) => stage2Events.push(e), new AbortController().signal);
  return { stage2Events, requestBodies, fetchMock };
}

describe('P0 M4 接线：三件套注入', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('create html 项目：done.files 注入 README.md，含功能清单与运行声明', async () => {
    const { stage2Events } = await runCreateFlow({
      responses: [FEATURES_JSON, HTML_FILES_JSON, '审查通过'],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    const readme = done!.payload.files?.['/README.md'];
    expect(readme).toBeDefined();
    // 功能清单来自分析师输出（内容强一致）
    expect(readme!.content).toContain('科学计算');
    expect(readme!.content).toContain('Litpp 内置沙箱');
    expect(readme!.content).toContain('Node 18+');
  });

  it('create react-cdn 项目：注入 DESIGN.md/package.json；组件缺注册时带错误清单重试后交付', async () => {
    const { stage2Events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      // 分析师 → 工程师（组件缺注册，校验失败） → 工程师重试（含注册，通过） → 审查者
      responses: [FEATURES_JSON, reactProjectJson(false), reactProjectJson(true), '审查通过'],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/DESIGN.md']).toBeDefined();
    expect(done!.payload.files?.['/package.json']?.content).toContain('react');

    // 自动重试发生：分析师 + 工程师×2 + 审查者 = 4 次
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // 重试请求携带结构校验错误清单（含注册约定指引）
    expect(requestBodies[2]).toContain('window.__components');
    expect(requestBodies[2]).toContain('项目结构不完整');
    // 聊天区有重试进度
    expect(joinedDeltaText(stage2Events)).toContain('自动重试中');
  });

  it('LLM 已生成同名非空 README.md 时注入不覆盖', async () => {
    const llmReadme = '# 我自己的说明\n\n模型手写的文档内容';
    const filesJson = JSON.stringify({
      files: [
        {
          path: '/index.html',
          content: '<!DOCTYPE html><html><body>hi</body></html>',
          language: 'html',
        },
        { path: '/README.md', content: llmReadme, language: 'text' },
      ],
    });
    const { stage2Events } = await runCreateFlow({
      responses: [FEATURES_JSON, filesJson, '审查通过'],
    });

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/README.md']?.content).toBe(llmReadme);
  });

  it('校验重试耗尽仍失败：降级交付，无 error 事件，delta 输出人话提示', async () => {
    // 三次尝试的组件全部缺注册 → 结构校验持续失败 → 降级交付
    const { stage2Events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        reactProjectJson(false),
        reactProjectJson(false),
        reactProjectJson(false),
        '审查通过',
      ],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师×3 + 审查者 = 5 次
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    // 降级提示走 delta 通道（不新建前端 UI）
    const deltaText = joinedDeltaText(stage2Events);
    expect(deltaText).toContain('结构问题');
    expect(deltaText).toContain('按现状交付');
  });
});
