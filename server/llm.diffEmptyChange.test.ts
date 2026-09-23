/**
 * server/llm.ts diff 模式空变更处理单元测试
 *
 * 场景：工程师 diff 输出 { "changes": [], "summary": "..." } 时，
 * 不得走"应用变更 + 变更已应用"流程，summary 须经 done.analysis 走对话模式。
 * 参考 Claude Code FileEditTool 的诚实反馈原则：没做事就说没做，绝不虚报已应用。
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE 流，走真实
 * runDirectModifyPipeline → continueAfterApproval 链路，断言完整事件序列。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDirectModifyPipeline, generateWithStages, continueAfterApproval, type LLMEvent } from './llm.js';
import type { IntentResult } from './intentClassifier.js';

const MODIFY_INTENT: IntentResult = { type: 'modify', confidence: 1, reasoning: '测试固定意图' };

/** 测试项目文件（4 行，供行号编辑定位） */
const TEST_FILES = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>',
    language: 'html' as const,
  },
};

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

/** 事件收集器 */
function collectEvents(): { events: LLMEvent[]; onEvent: (e: LLMEvent) => void } {
  const events: LLMEvent[] = [];
  return { events, onEvent: (e) => events.push(e) };
}

/** 拼接全部 delta 文本（用于断言提示文案） */
function joinedDeltaText(events: LLMEvent[]): string {
  return events
    .filter((e) => e.type === 'delta')
    .map((e) => e.payload.text ?? '')
    .join('');
}

describe('diff 模式空变更（诚实反馈）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('空变更：不发"变更已应用"，summary 经 done.analysis 走对话模式', async () => {
    const output = JSON.stringify({ changes: [], summary: '需求不明确，请补充说明' });
    vi.stubGlobal('fetch', vi.fn(async () => makeSSEResponse(output)));

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '改一下',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    // summary 作为对话内容返回（前端将其展示为 assistant 消息）
    expect(done!.payload.analysis).toBe('需求不明确，请补充说明');
    // 不携带代码产物与变更清单
    expect(Object.keys(done!.payload.files ?? {})).toHaveLength(0);
    expect(done!.payload.html).toBe('');
    expect(done!.payload.changes).toBeUndefined();

    // 绝不发"变更已应用"提示，也不进入 review 阶段
    expect(joinedDeltaText(events)).not.toContain('变更已应用');
    const reviewStage = events.find((e) => e.type === 'stage' && e.payload.phase === 'review');
    expect(reviewStage).toBeUndefined();
  });

  it('空变更且 summary 缺失：使用兜底文案，不留空消息', async () => {
    const output = JSON.stringify({ changes: [] });
    vi.stubGlobal('fetch', vi.fn(async () => makeSSEResponse(output)));

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '随便改改',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.analysis).toContain('未对代码做任何修改');
    expect(done!.payload.analysis!.length).toBeGreaterThan(0);
  });

  it('非空变更：保持"变更已应用"流程，done 携带 changes 与合并后文件', async () => {
    const output = JSON.stringify({
      changes: [
        {
          file: '/index.html',
          edits: [
            {
              line: 3,
              old: '<body><h1 id="title">标题</h1></body>',
              new: '<body><h1 id="title">新标题</h1></body>',
              type: 'replace',
            },
          ],
        },
      ],
      summary: '修改标题文案',
    });
    vi.stubGlobal('fetch', vi.fn(async () => makeSSEResponse(output)));

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '把标题改成新标题',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    // 变更已应用提示保持（diff 模式跳过审查的轻量确认）
    expect(joinedDeltaText(events)).toContain('变更已应用');

    // done 携带变更清单与摘要，且编辑已应用到文件
    expect(done!.payload.changes?.changes).toHaveLength(1);
    expect(done!.payload.changeSummary).toBe('修改标题文案');
    expect(done!.payload.files?.['/index.html']?.content).toContain('新标题');

    // 有真实变更时不走对话模式
    expect(done!.payload.analysis).toBeUndefined();
  });
});

describe('非 diff 模式对话预检（a2d9eae 功能回归保护）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('create 流程：工程师输出纯文本对话时仍经 done.analysis 优雅返回', async () => {
    const featuresJson = JSON.stringify({
      appTitle: '计数器',
      appType: 'tool',
      summary: '简单计数器',
      features: [{ id: 'F1', name: '计数', description: '点击按钮计数', priority: 'must' }],
      interactions: ['点击'],
      assumptions: [],
    });
    const conversationText = '你好，请问这个应用需要支持减法吗？告诉我之后我再开始生成。';

    // 第一次调用：分析师输出功能清单；第二次调用：工程师输出纯对话
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(featuresJson))
      .mockResolvedValueOnce(makeSSEResponse(conversationText));
    vi.stubGlobal('fetch', fetchMock);

    // 阶段 1：分析师 → approval_required（拿 sessionId）
    const stage1Events: LLMEvent[] = [];
    await generateWithStages({
      prompt: '做一个计数器',
      intentOverride: 'create',
      onEvent: (e) => stage1Events.push(e),
      abortSignal: new AbortController().signal,
    });
    const approval = stage1Events.find((e) => e.type === 'approval_required');
    expect(approval).toBeDefined();
    const sessionId = approval!.payload.sessionId;
    expect(sessionId).toBeTruthy();

    // 阶段 2：批准后工程师返回对话 → done.analysis
    const stage2Events: LLMEvent[] = [];
    await continueAfterApproval(sessionId!, (e) => stage2Events.push(e), new AbortController().signal);

    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.analysis).toBe(conversationText);
    expect(Object.keys(done!.payload.files ?? {})).toHaveLength(0);
    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
  });
});
