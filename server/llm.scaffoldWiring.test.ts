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

/** react 组件文件（P1 真实 import 形态）：brokenImport=true 时 App.jsx import
 *  不存在的本地文件（触发 E_IMPORT_MISSING 校验重试） */
function reactProjectJson(brokenImport: boolean): string {
  const brokenLine = brokenImport ? "import Badge from './components/Badge.jsx';\n" : '';
  return JSON.stringify({
    files: [
      {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
        language: 'html',
      },
      {
        path: '/src/main.jsx',
        content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById(\"root\")).render(null);",
        language: 'javascript',
      },
      {
        path: '/src/App.jsx',
        content: `${brokenLine}function App() { return null; }\nexport default App;`,
        language: 'javascript',
      },
    ],
  });
}

/** react 计算器项目（P1 真实 import 形态）：broken=true 时 Calculator.jsx 含悬空 const（语法错误，
 *  确定性校验器查不出，由审查者检出 → 触发 D-3 修复循环） */
function reactCalculatorProject(broken: boolean): string {
  const calcBody = broken
    ? 'function Calculator() { return null; }\nconst dangling = ;\nexport default Calculator;'
    : 'function Calculator() { return null; }\nexport default Calculator;';
  return JSON.stringify({
    files: [
      {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
        language: 'html',
      },
      {
        path: '/src/main.jsx',
        content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById(\"root\")).render(null);",
        language: 'javascript',
      },
      {
        path: '/src/App.jsx',
        content: "import Calculator from './components/Calculator.jsx';\nfunction App() { return null; }\nexport default App;",
        language: 'javascript',
      },
      {
        path: '/src/components/Calculator.jsx',
        content: calcBody,
        language: 'javascript',
      },
    ],
  });
}

/** 审查者裁决 JSON：pass=false 且带修复指令（触发修复循环） */
const REVIEW_FAIL_JSON = JSON.stringify({
  pass: false,
  checks: [{ item: '脚本可执行', pass: false, note: 'Calculator.jsx 存在悬空 const' }],
  repairInstructions: ['修复 /src/components/Calculator.jsx 中第 10 行的悬空 const 声明'],
  missingFiles: [],
});

/** 审查者裁决 JSON：通过（复审 pass → 正常交付） */
const REVIEW_PASS_JSON = JSON.stringify({
  pass: true,
  checks: [{ item: '结构完整', pass: true, note: '全部通过' }],
  repairInstructions: [],
  missingFiles: [],
});

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

  it('create react-cdn 项目：注入 DESIGN.md/package.json；import 断链时带错误清单重试后交付', async () => {
    const { stage2Events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      // 分析师 → 工程师（import 断链，校验失败） → 工程师重试（修正，通过） → 审查者
      responses: [FEATURES_JSON, reactProjectJson(true), reactProjectJson(false), '审查通过'],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/DESIGN.md']).toBeDefined();
    expect(done!.payload.files?.['/package.json']?.content).toContain('react');

    // 自动重试发生：分析师 + 工程师×2 + 审查者 = 4 次
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // 重试请求携带结构校验错误清单（含断链说明符与拼写指引）
    expect(requestBodies[2]).toContain('./components/Badge.jsx');
    expect(requestBodies[2]).toContain('项目结构不完整');
    // 聊天区有重试进度（新的多维度策略通知格式）
    expect(joinedDeltaText(stage2Events)).toContain('重试');
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

  it('校验重试耗尽仍失败（import 断链五轮不修正）：降级交付，无 error 事件，delta 输出人话提示', async () => {
    // 五次尝试的 App.jsx 均含断链 import → 结构校验持续失败 → 降级交付
    const { stage2Events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        reactProjectJson(true),
        reactProjectJson(true),
        reactProjectJson(true),
        reactProjectJson(true),
        reactProjectJson(true),
      ],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师×5（MAX_PARSE_ATTEMPTS=5） + 可能的传输层重试 >= 6 次
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(6);

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    // 降级提示走 delta 通道（不新建前端 UI）
    const deltaText = joinedDeltaText(stage2Events);
    expect(deltaText).toContain('结构');
    // 降级交付会有提示
    expect(deltaText.length).toBeGreaterThan(0);
  });
});

describe('D-3 审查修复循环', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('审查 fail → 修复请求含修复指令 → 复审 pass → 正常交付', async () => {
    // 调用序：分析师 → 工程师（含悬空 const，结构校验通过）→ 审查者 fail
    //        → 工程师修复 → 审查者复审 pass → 交付
    const { stage2Events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        reactCalculatorProject(true),
        REVIEW_FAIL_JSON,
        reactCalculatorProject(false),
        REVIEW_PASS_JSON,
      ],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师 + 审查者 + 修复 + 复审 = 5 次（第 1 轮即收敛，预算内）
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 修复请求（第 4 次调用，index 3）携带审查者的修复指令
    expect(requestBodies[3]).toContain('悬空 const');
    expect(requestBodies[3]).toContain('修复指令');

    // 交付的是修复后的产物（悬空 const 已移除）
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/src/components/Calculator.jsx']?.content).not.toContain('dangling');

    // 无降级提示（修复成功走正常交付）
    const deltaText = joinedDeltaText(stage2Events);
    expect(deltaText).toContain('自动修复中');
    expect(deltaText).not.toContain('仍未全部解决');
  });

  it('复审仍 fail → 两轮修复耗尽后降级交付，无 error 事件，delta 输出人话提示', async () => {
    // 修复产物仍有缺陷（结构校验能过的语法缺陷）→ 两轮修复后复审仍 fail
    // → 轮数封顶（MAX_REPAIR_ROUNDS=2）→ 按现状交付
    const { stage2Events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        reactCalculatorProject(true),
        REVIEW_FAIL_JSON,
        reactCalculatorProject(true),
        REVIEW_FAIL_JSON,
        reactCalculatorProject(true),
        REVIEW_FAIL_JSON,
      ],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师 + 审查者 + 修复×2 + 复审×2 = 7 次（轮数封顶 2，不追加第 3 轮）
    expect(fetchMock).toHaveBeenCalledTimes(7);

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    const deltaText = joinedDeltaText(stage2Events);
    expect(deltaText).toContain('自动修复中');
    expect(deltaText).toContain('第 1/2 轮');
    expect(deltaText).toContain('第 2/2 轮');
    expect(deltaText).not.toContain('第 3');
    expect(deltaText).toContain('2 轮后仍未全部解决');
    expect(deltaText).toContain('按现状交付');
  });

  it('首审直接通过 → 无降级提示、无 warning 事件（D-7 虚假降级回归）', async () => {
    // 零修复轮：首审 pass 直接交付，不得出现"修复"字样降级文案
    const { stage2Events } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, reactCalculatorProject(false), REVIEW_PASS_JSON],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    const deltaText = joinedDeltaText(stage2Events);
    expect(deltaText).not.toContain('仍未全部解决');
    expect(deltaText).not.toContain('自动修复中');
    // 干净交付无任何 warning 事件
    expect(stage2Events.filter((e) => e.type === 'warning')).toHaveLength(0);
  });

  it('审查 fail 但修复指令为空 → 不触发修复，直接交付', async () => {
    const failNoInstructions = JSON.stringify({
      pass: false,
      checks: [{ item: 'UI 质量', pass: false, note: '按钮无禁用状态' }],
      repairInstructions: [],
      missingFiles: [],
    });
    const { stage2Events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, reactCalculatorProject(false), failNoInstructions],
    });

    // 分析师 + 工程师 + 审查者 = 3 次（无修复调用）
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(joinedDeltaText(stage2Events)).not.toContain('自动修复中');
    // D-7：零修复轮不得出现"仍未全部解决"（修复措辞）降级文案；
    // 如实提示允许存在，但不声称做过修复
    const deltaText = joinedDeltaText(stage2Events);
    expect(deltaText).not.toContain('仍未全部解决');
    expect(deltaText).toContain('未提供修复指令');
  });

  it('修复循环与结构校验重试不打架：校验失败走校验重试，审查 fail 走修复循环', async () => {
    // 第 1 次工程师输出 import 断链（校验失败 → 校验重试）；
    // 第 2 次输出 import 一致但含悬空 const（校验通过 → 审查）；
    // 审查 fail → 修复循环修复 → 复审 pass。两层闸门按序独立触发。
    const { stage2Events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        reactProjectJson(true),
        reactCalculatorProject(true),
        REVIEW_FAIL_JSON,
        reactCalculatorProject(false),
        REVIEW_PASS_JSON,
      ],
    });

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师×2（校验重试）+ 审查者 + 修复 + 复审 = 6 次
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // 校验重试请求（index 2）含结构错误清单；修复请求（index 4）含审查修复
    // 指令，且两通道互不串扰
    expect(requestBodies[2]).toContain('项目结构不完整');
    expect(requestBodies[4]).toContain('修复指令');
    expect(requestBodies[4]).not.toContain('项目结构不完整');

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/src/components/Calculator.jsx']?.content).not.toContain('dangling');
  });
});
