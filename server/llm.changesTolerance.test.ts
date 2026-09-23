/**
 * server/llm.ts 非 diff 模式 changes 格式容错单元测试
 *
 * 场景：迭代模式（有现有文件、无 useDiffMode 标记）下模型误输出 diff 模式的
 * { "changes": [...] } 变更清单，解析层 parseOutput 报"期望 files 数组"。
 * 容错逻辑（continueAfterApproval 非 diff catch）应：
 *   - 有现有文件 → parseChangeList + applyChanges 应用为全量文件，正常交付；
 *   - 无现有文件（全新生成）→ 跳过容错，formatErrorHint 走重试循环。
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE 流，走真实
 * generateWithStages → continueAfterApproval 链路，断言完整事件序列。
 * 注意：generateWithStages 创建的会话不带 useDiffMode，天然走非 diff 分支，
 * 恰好复现线上事故路径（create 意图 + 已有项目文件的迭代请求）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithStages, continueAfterApproval, type LLMEvent } from './llm.js';

/** 测试项目文件（4 行，供行号编辑定位） */
const TEST_FILES = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>',
    language: 'html' as const,
  },
};

/** 分析师阶段的功能清单输出（迭代与全新生成共用） */
const FEATURES_JSON = JSON.stringify({
  appTitle: '科学计算器',
  appType: 'tool',
  summary: '带科学计算功能的计算器',
  features: [{ id: 'F1', name: '科学计算', description: '支持常用科学计算', priority: 'must' }],
  interactions: ['输入表达式', '点击计算'],
  assumptions: [],
});

/** 模型误输出的 changes 变更清单（对 TEST_FILES 第 3 行做替换） */
const CHANGES_OUTPUT = JSON.stringify({
  changes: [
    {
      file: '/index.html',
      edits: [
        {
          line: 3,
          old: '<body><h1 id="title">标题</h1></body>',
          new: '<body><h1 id="title">科学计算器</h1></body>',
          type: 'replace',
        },
      ],
    },
  ],
  summary: '添加科学计算功能',
});

/** 合规的 files 全量输出（含入口文件，通过 multiFileParser 校验） */
const FILES_OUTPUT = JSON.stringify({
  files: [
    {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<head><title>科学计算器</title></head>\n<body><h1>科学计算器</h1><script src="/app.js"></script></body>\n</html>',
      language: 'html',
    },
    {
      path: '/app.js',
      content: 'const out = document.getElementById("out");\nif (out) out.textContent = "ready";',
      language: 'javascript',
    },
  ],
});

/** 构造伪造的 OpenAI 兼容 SSE 响应（单 chunk 输出 + usage） */
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

/**
 * 按序返回响应并捕获每次请求体的 fetch stub。
 * responses 下标即调用序：分析师 → 工程师（→ 工程师重试）→ 审查者。
 * 环境未设 SKIP_REVIEW，审查阶段会真实发起调用，序列必须预留审查者响应。
 */
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

/** 阶段 1：跑分析师拿到批准会话 */
async function runAnalysisStage(options: {
  prompt: string;
  currentFiles?: typeof TEST_FILES;
}): Promise<string> {
  const stage1Events: LLMEvent[] = [];
  await generateWithStages({
    prompt: options.prompt,
    currentFiles: options.currentFiles,
    intentOverride: 'create',
    onEvent: (e) => stage1Events.push(e),
    abortSignal: new AbortController().signal,
  });
  const approval = stage1Events.find((e) => e.type === 'approval_required');
  expect(approval).toBeDefined();
  const sessionId = approval!.payload.sessionId;
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

describe('非 diff 模式 changes 格式容错', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('场景 1 迭代模式 + changes 输出：容错应用为文件更新，done 携带合并文件与变更清单', async () => {
    // 调用序：分析师 → 工程师（changes，被容错） → 审查者。共 3 次，无重试
    const { fetchMock } = makeSequentialFetch([FEATURES_JSON, CHANGES_OUTPUT, '审查通过：变更已正确应用']);
    vi.stubGlobal('fetch', fetchMock);

    const sessionId = await runAnalysisStage({ prompt: '给应用添加科学计算', currentFiles: TEST_FILES });

    const stage2Events: LLMEvent[] = [];
    await continueAfterApproval(sessionId, (e) => stage2Events.push(e), new AbortController().signal);

    // 容错生效：全程无 error
    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    // applyChanges 已把编辑应用到现有文件（合并结果含新标题）
    expect(done!.payload.files?.['/index.html']?.content).toContain('科学计算器');

    // done 携带变更清单与摘要（前端渲染变更 UI）
    expect(done!.payload.changes?.changes).toHaveLength(1);
    expect(done!.payload.changeSummary).toBe('添加科学计算功能');

    // 容错命中即交付：分析师 + 工程师 + 审查者，恰好 3 次调用（未触发重试）
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('场景 2 全新生成 + changes 输出：跳过容错走重试，纠正提示后第二次交付', async () => {
    // 调用序：分析师 → 工程师第 1 次（changes，无现有文件不容错） → 工程师第 2 次（files，成功） → 审查者
    const { fetchMock, requestBodies } = makeSequentialFetch([
      FEATURES_JSON,
      CHANGES_OUTPUT,
      FILES_OUTPUT,
      '审查通过',
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const sessionId = await runAnalysisStage({ prompt: '做一个科学计算器' });

    const stage2Events: LLMEvent[] = [];
    await continueAfterApproval(sessionId, (e) => stage2Events.push(e), new AbortController().signal);

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();

    // 第二次输出 files 格式后正常交付
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']?.content).toContain('科学计算器');
    expect(done!.payload.files?.['/app.js']).toBeDefined();

    // 重试发生：分析师 + 工程师×2 + 审查者，共 4 次调用
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 第 3 次调用是带格式纠正提示的重试请求
    interface ChatCompletionRequest {
      messages: Array<{ role: string; content: string }>;
    }
    const retryRequest = JSON.parse(requestBodies[2]) as ChatCompletionRequest;
    const retryUserMsg = retryRequest.messages.find((m) => m.role === 'user');
    expect(retryUserMsg).toBeDefined();
    expect(retryUserMsg!.content).toContain('上次输出格式错误');
    expect(retryUserMsg!.content).toContain('禁止输出 { "changes"');
    expect(retryUserMsg!.content).toContain('做一个科学计算器');
  });
});
