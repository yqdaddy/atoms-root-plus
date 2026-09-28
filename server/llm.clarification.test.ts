/**
 * server/llm.ts Phase 2 意图澄清机制测试
 *
 * 场景：
 * 1. 分析师输出带 clarificationNeeded（questions 非空）→ 发送 clarification_required
 *    事件并暂停（不发 approval_required，不进生成阶段）
 * 2. 用户回答后调用 continueAfterApproval（带 supplementaryInfo）→ 流程继续，
 *    回答内容进入工程师请求
 * 3. questions 为空数组 → 不触发澄清，正常走 approval 流程
 * 4. clarificationNeeded 字段缺失 → 正常走 approval 流程
 * 5. clarificationNeeded 畸形（questions 非数组）→ 容错，不崩溃走 approval 流程
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE 流，走真实 generateWithStages →
 * continueAfterApproval 链路，断言事件序列与请求内容。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithStages, continueAfterApproval, type LLMEvent } from './llm.js';

/** 带澄清请求的分析师输出：questions 非空 */
const FEATURES_WITH_QUESTIONS = JSON.stringify({
  appTitle: '待定应用',
  appType: 'tool',
  summary: '用户需求不明确，需要澄清',
  features: [],
  interactions: [],
  assumptions: [],
  clarificationNeeded: {
    reason: '目标平台与数据来源未明确',
    questions: [
      { id: 'q1', question: '应用是给谁用的？', options: ['个人', '团队'], required: true },
      { id: 'q2', question: '数据存哪里？', required: false },
    ],
  },
});

/** questions 为空数组的边界样例 */
const FEATURES_EMPTY_QUESTIONS = JSON.stringify({
  appTitle: '科学计算器',
  appType: 'tool',
  summary: '需求明确',
  features: [{ id: 'F1', name: '科学计算', description: '三角函数', priority: 'must' }],
  interactions: [],
  assumptions: [],
  clarificationNeeded: { reason: '无需澄清', questions: [] },
});

/** questions 为字符串的畸形样例（非数组） */
const FEATURES_MALFORMED_QUESTIONS = JSON.stringify({
  appTitle: '科学计算器',
  appType: 'tool',
  summary: '需求明确',
  features: [{ id: 'F1', name: '科学计算', description: '三角函数', priority: 'must' }],
  interactions: [],
  assumptions: [],
  clarificationNeeded: { reason: '畸形', questions: '不是数组' },
});

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

/** 仅跑分析师阶段（generateWithStages），捕获第一阶段事件 */
async function runAnalysisOnly(responses: string[]): Promise<{
  stage1Events: LLMEvent[];
  requestBodies: string[];
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const { fetchMock, requestBodies } = makeSequentialFetch(responses);
  vi.stubGlobal('fetch', fetchMock);

  const stage1Events: LLMEvent[] = [];
  await generateWithStages({
    prompt: '做一个记事本应用',
    framework: 'html',
    intentOverride: 'create',
    onEvent: (e) => stage1Events.push(e),
    abortSignal: new AbortController().signal,
  });
  return { stage1Events, requestBodies, fetchMock };
}

describe('Phase 2: 意图澄清机制', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('有 questions 时发送 clarification_required 事件并暂停，不发 approval_required', async () => {
    const { stage1Events, fetchMock } = await runAnalysisOnly([FEATURES_WITH_QUESTIONS]);

    const clarification = stage1Events.find((e) => (e.type as string) === 'clarification_required');
    expect(clarification).toBeDefined();

    // payload 结构符合 ClarificationPayload 协议
    const payload = clarification!.payload as Record<string, unknown>;
    expect(payload.sessionId).toBeTruthy();
    expect(payload.reason).toBe('目标平台与数据来源未明确');
    const questions = payload.questions as Array<{ id: string; question: string; required: boolean }>;
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ id: 'q1', required: true });

    // 暂停语义：不发批准事件，不进生成阶段（只有分析师 1 次调用）
    expect(stage1Events.find((e) => e.type === 'approval_required')).toBeUndefined();
    expect(stage1Events.find((e) => e.type === 'done')).toBeUndefined();
    expect(stage1Events.find((e) => e.type === 'error')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('用户回答后应继续生成，回答内容进入工程师请求', async () => {
    const { stage1Events } = await runAnalysisOnly([FEATURES_WITH_QUESTIONS]);
    const clarification = stage1Events.find((e) => (e.type as string) === 'clarification_required');
    expect(clarification).toBeDefined();
    const sessionId = (clarification!.payload as Record<string, unknown>).sessionId as string;

    // 用户回答澄清问题后继续（补充信息为用户回答的汇总）
    const stage2Mock = makeSequentialFetch([HTML_FILES_JSON, '审查通过']);
    vi.stubGlobal('fetch', stage2Mock.fetchMock);

    const stage2Events: LLMEvent[] = [];
    await continueAfterApproval(
      sessionId,
      (e) => stage2Events.push(e),
      new AbortController().signal,
      undefined,
      '给个人用户使用；数据存 localStorage',
    );

    expect(stage2Events.find((e) => e.type === 'error')).toBeUndefined();
    const done = stage2Events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']).toBeDefined();

    // 用户回答进入工程师请求（supplementaryInfo 附加到功能清单）
    const engineerRequest = stage2Mock.requestBodies[0] ?? '';
    expect(engineerRequest).toContain('给个人用户使用；数据存 localStorage');
  });

  it('questions 为空数组 → 不触发澄清，正常走 approval 流程', async () => {
    const { stage1Events } = await runAnalysisOnly([FEATURES_EMPTY_QUESTIONS]);

    expect(stage1Events.find((e) => e.type === 'clarification_required')).toBeUndefined();
    const approval = stage1Events.find((e) => e.type === 'approval_required');
    expect(approval).toBeDefined();
  });

  it('clarificationNeeded 字段缺失 → 正常走 approval 流程', async () => {
    const { stage1Events } = await runAnalysisOnly([FEATURES_JSON]);

    expect(stage1Events.find((e) => e.type === 'clarification_required')).toBeUndefined();
    const approval = stage1Events.find((e) => e.type === 'approval_required');
    expect(approval).toBeDefined();
  });

  it('clarificationNeeded 畸形（questions 非数组）→ 容错走 approval 流程，不崩溃', async () => {
    const { stage1Events } = await runAnalysisOnly([FEATURES_MALFORMED_QUESTIONS]);

    expect(stage1Events.find((e) => e.type === 'clarification_required')).toBeUndefined();
    expect(stage1Events.find((e) => e.type === 'error')).toBeUndefined();
    const approval = stage1Events.find((e) => e.type === 'approval_required');
    expect(approval).toBeDefined();
  });
});
