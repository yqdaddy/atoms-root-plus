/**
 * RC4 服务端管线缺陷回归测试
 *
 * RC4-BUG-002：用户主动取消/暂停被落库为 failed。
 * 根因：取消 abort 经 withRetry 分类（无状态码保守 Retryable）后退避 sleep，
 * sleep 抛出的 Error('请求已取消')（name 是 'Error'，非 AbortError）进入管线
 * catch 的 else 分支，发终局 error 事件，任务录制器据此 finish('failed')。
 * 修复：catch 同时识别 message === '请求已取消'；暂停场景改发非终局
 * engineer_pause 事件（任务行保持 running 供 /continue 续跑），取消场景静默
 * （终态归属 /cancel 路由同步落库的 cancelled）。
 *
 * RC4-BUG-001：modify 意图升级场景 run 产物静默丢失。
 * 根因：格式重试循环中模型以对话式输出规避格式契约（"建议生成完整文件"却不
 * 产出文件），旧逻辑照单全收发无产物 done 提前终局 run（DB 实证 run
 * 4f48d86f：succeeded/done，result_files=NULL，重试预算作废，产物丢失）。
 * 修复：预算内（retryCount > 0 且未到最后一轮）的对话式输出转为格式失败重试，
 * 仅首轮（澄清语义，a2d9eae 保护）与预算耗尽轮（诚实兜底）保留对话交付。
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE / 可中止挂起流，走真实
 * generateWithStages / continueAfterApproval / pauseEngineerSession 链路，
 * 断言完整事件序列。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateWithStages,
  continueAfterApproval,
  pauseEngineerSession,
  cancelGeneration,
  type LLMEvent,
} from './llm.js';

/** 测试用功能清单（分析师阶段输出，进入 approval_required） */
const FEATURES_JSON = JSON.stringify({
  appTitle: '计数器',
  appType: 'tool',
  summary: '简单计数器',
  features: [{ id: 'F1', name: '计数', description: '点击按钮计数', priority: 'must' }],
  interactions: ['点击'],
  assumptions: [],
});

/** 对话式输出（意图升级语义：建议重构但不产出文件，即 run 4f48d86f 的形态） */
const CONVERSATION_TEXT = '这个需求建议整体重构，我建议生成完整文件后再交付，请确认。';

/** 必定解析失败的输出（完整 JSON 花括号但 files 字段非法，不误判为对话） */
const BROKEN_OUTPUT = '{"files": "not-an-array"}';

/** 最终 attempt 的合法全量文件输出（意图升级后的正确产物） */
const FINAL_FILES_JSON = JSON.stringify({
  files: [
    {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<head><title>计数器</title></head>\n<body><h1>计数器</h1><button id="btn">+1</button><script>let n=0;document.getElementById("btn").onclick=()=>{n++;document.querySelector("h1").textContent=n;};</script></body>\n</html>',
      language: 'html',
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
 * 可中止挂起流：永不返回响应，仅当 init.signal 中止时以 AbortError 拒绝
 * （模拟真实 fetch 的 abort 行为）。用于把 continueAfterApproval 固定在
 * 工程师生成进行中的状态。
 */
function hangUntilAbort(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abortError = () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal?.aborted) {
      abortError();
      return;
    }
    signal?.addEventListener('abort', abortError, { once: true });
  });
}

/** 事件收集器 */
function collectEvents(): { events: LLMEvent[]; onEvent: (e: LLMEvent) => void } {
  const events: LLMEvent[] = [];
  return { events, onEvent: (e) => events.push(e) };
}

/** 阶段 1：跑分析师拿到 approval_required 的 sessionId */
async function startToApproval(fetchMock: ReturnType<typeof vi.fn>): Promise<string> {
  const stage1Events: LLMEvent[] = [];
  await generateWithStages({
    prompt: '做一个计数器',
    intentOverride: 'create',
    onEvent: (e) => stage1Events.push(e),
    abortSignal: new AbortController().signal,
  });
  const approval = stage1Events.find((e) => e.type === 'approval_required');
  expect(approval).toBeDefined();
  void fetchMock;
  return approval!.payload.sessionId;
}

describe('RC4-BUG-002：用户取消/暂停不落 failed 终态', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('暂停：AbortError 走 withRetry 后以"请求已取消"到达 catch，发 engineer_pause 不发 error', async () => {
    // 第 1 次调用 = 分析师；第 2 次起挂起直到 abort
    let call = 0;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      call++;
      if (call === 1) return Promise.resolve(makeSSEResponse(FEATURES_JSON));
      return hangUntilAbort(init?.signal);
    });
    vi.stubGlobal('fetch', fetchMock);

    const sessionId = await startToApproval(fetchMock);

    const { events, onEvent } = collectEvents();
    const running = continueAfterApproval(sessionId, onEvent, new AbortController().signal);
    // 等工程师生成的 fetch 真正挂起，再触发暂停链路
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    pauseEngineerSession(sessionId);
    await running;

    // 无终局事件：不发 error（会把任务行落库为 failed），不发 done
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(events.find((e) => e.type === 'done')).toBeUndefined();

    // 发非终局 engineer_pause，标注等待点（恢复链路给出中性文案）
    const pause = events.find((e) => e.type === 'engineer_pause');
    expect(pause).toBeDefined();
    expect(pause!.payload.pauseReason).toBe('user_interrupt');
    expect(pause!.payload.sessionId).toBe(sessionId);
  });

  it('取消：无 engineerPaused 标记时静默返回，不发任何终局事件', async () => {
    let call = 0;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      call++;
      if (call === 1) return Promise.resolve(makeSSEResponse(FEATURES_JSON));
      return hangUntilAbort(init?.signal);
    });
    vi.stubGlobal('fetch', fetchMock);

    const sessionId = await startToApproval(fetchMock);

    const { events, onEvent } = collectEvents();
    const running = continueAfterApproval(sessionId, onEvent, new AbortController().signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // 直接取消（/cancel 链路的控制器中止部分；终态由 cancelRunTask 同步落库）
    cancelGeneration(sessionId);
    await running;

    // 取消语义下管线零事件：不污染任务行，终态归属 cancelRunTask
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(events.find((e) => e.type === 'done')).toBeUndefined();
    expect(events.find((e) => e.type === 'engineer_pause')).toBeUndefined();
  });
});

describe('RC4-BUG-001：意图升级的对话式输出不再提前终局 run', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('重试轮对话输出转格式重试，最终全量产物经 done 交付（run 4f48d86f 场景修复）', async () => {
    // 调用序列：分析师 → attempt0 坏格式 → attempt1-3 对话（意图升级）→ attempt4 全量文件
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(FEATURES_JSON))
      .mockResolvedValueOnce(makeSSEResponse(BROKEN_OUTPUT))
      .mockResolvedValueOnce(makeSSEResponse(CONVERSATION_TEXT))
      .mockResolvedValueOnce(makeSSEResponse(CONVERSATION_TEXT))
      .mockResolvedValueOnce(makeSSEResponse(CONVERSATION_TEXT))
      .mockImplementation(async () => makeSSEResponse(FINAL_FILES_JSON));
    vi.stubGlobal('fetch', fetchMock);

    const sessionId = await startToApproval(fetchMock);

    const { events, onEvent } = collectEvents();
    await continueAfterApproval(sessionId, onEvent, new AbortController().signal);

    // 关键断言：重试轮的对话输出没有产生提前终局的 done
    const dones = events.filter((e) => e.type === 'done');
    expect(dones).toHaveLength(1);
    const done = dones[0]!;

    // 唯一的 done 携带真实产物（对照 DB 实证的 result_files=NULL）
    expect(done.payload.files?.['/index.html']?.content).toContain('<!DOCTYPE html>');
    expect(done.payload.html).toContain('<!DOCTYPE');

    // 对话轮触发了格式重试（attempt1-3 各一轮 + attempt0 失败后一轮 = 4 次协议 retry）
    const retryEvents = events.filter((e) => e.type === 'retry');
    expect(retryEvents).toHaveLength(4);

    // 调用数：1 分析师 + 5 工程师（attempt0-4，对话轮没有吞掉预算）+ 1 审查者
    expect(fetchMock).toHaveBeenCalledTimes(7);

    // 对话文本透传思考区（delta），而非作为 analysis 交付
    const deltaText = events
      .filter((e) => e.type === 'delta')
      .map((e) => e.payload.text ?? '')
      .join('');
    expect(deltaText).toContain('建议生成完整文件');
    expect(done.payload.analysis).toBeUndefined();
  });

  it('预算耗尽轮的对话输出按诚实兜底交付（不发 error，分析文本完整）', async () => {
    // attempt0 坏格式 → attempt1-4 全部对话：最后一轮（retryCount=4）保留对话交付
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(FEATURES_JSON))
      .mockResolvedValueOnce(makeSSEResponse(BROKEN_OUTPUT))
      .mockImplementation(async () => makeSSEResponse(CONVERSATION_TEXT));
    vi.stubGlobal('fetch', fetchMock);

    const sessionId = await startToApproval(fetchMock);

    const { events, onEvent } = collectEvents();
    await continueAfterApproval(sessionId, onEvent, new AbortController().signal);

    // 预算耗尽：对话是诚实的最终兜底，而非格式报错
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.analysis).toContain('建议生成完整文件');

    // 工程师生成 5 次（attempt0 + 重试 4 次打满预算）
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(4);
  });
});
