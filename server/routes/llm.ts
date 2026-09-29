/**
 * LLM 代理路由。
 * 服务端持有 API Key，代理调用 LLM API，SSE 流式返回。
 * 支持批准流程：分析完成后暂停等待用户批准。
 *
 * 安全：所有端点强制登录（requireAuth），防止匿名滥用 LLM API Key。
 */
import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { requireAuth } from '../auth.js';
import {
  generateWithStages,
  continueAfterApproval,
  cancelGeneration,
  cancelRun,
  streamChatCompletion,
  getPendingSession,
  pauseEngineerSession,
  continueWithFeedback,
  type LLMEvent,
} from '../llm.js';
import type { PendingSession } from '../llm.js';
import {
  createRunRow,
  createRunRecorder,
  getRunRow,
  getRunReplayView,
  getActiveRunView,
  getOrCreateRecorder,
  getRunRecorder,
  ackRun,
  cancelRunTask,
  RunAccessError,
  type RunRecorder,
} from '../runs.js';
import {
  OPTIMIZER_SYSTEM_PROMPT,
  renderOptimizerUserPrompt,
  getTemplateHintText,
  type OptimizerExistingContext,
} from '../prompts.js';
import { listProjectResources } from './resources.js';
import type { AppEnv } from '../types.js';

export const llmRouter = new Hono<AppEnv>();

// 全路由强制认证：所有 LLM 端点必须登录
llmRouter.use('*', requireAuth);

/**
 * SSE 事件泵（生成与连接解耦后的观察者）：
 * 轮询事件队列推送 SSE；终止事件（done/error 等）推送后关闭观察。
 * 写失败（客户端断连）向调用方抛出，调用方标记 closed 后退出循环——
 * 生成链路是服务端自驱任务，断连只影响观察，不影响执行。
 * isRunTerminal：任务终态探测（RC4-BUG-002）。取消路径不发终局事件
 * （error 事件会把任务行污染为 failed），管线静默返回后泵凭此退出，
 * 不依赖客户端断连兜底。
 */
async function pumpEventsToStream(
  stream: SSEStreamingApi,
  eventQueue: LLMEvent[],
  state: { closed: boolean },
  terminalTypes: readonly string[],
  isRunTerminal?: () => boolean,
): Promise<void> {
  while (!state.closed) {
    const event = eventQueue.shift();
    if (event) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event.payload),
      });
      if (terminalTypes.includes(event.type)) {
        state.closed = true;
        break;
      }
    } else {
      if (isRunTerminal?.()) {
        state.closed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/**
 * POST /api/llm/generate
 * 生成应用代码（三阶段流式，服务端任务驱动）
 *
 * Body: {
 *   prompt: string,
 *   requestId?: string,           // 兼容旧客户端：取消同 ID 的进行中请求
 *   options?: {
 *     currentHtml?: string,         // 向后兼容：单文件模式
 *     currentFiles?: Record<string, { path: string; content: string; language: string }>, // 多文件模式
 *     projectId?: string            // 项目知识库：携带时把该登录用户在此项目下的资料注入 prompt 尾部；
 *                                   // 同时作为任务归属键（同项目同时只允许一个 running 任务，
 *                                   // 新任务启动时旧 running 任务被取消）
 *   }
 * }
 *
 * 服务端任务：本端点创建 generations 任务行并服务端自驱执行，客户端断连只影响
 * SSE 观察，不影响生成；进度经 GET /api/llm/runs/* 恢复。
 *
 * SSE 事件流：
 * - stage: { phase: 'analysis' | 'generate' | 'review', runId, ... }（首个事件携带服务端任务 runId）
 * - delta: { text: string, phase?: string }
 * - approval_required: { sessionId, analysis, features, runId }
 * - done: { html, files?, runId, ... }
 * - error: { message, runId }
 */
llmRouter.post('/generate', async (c) => {
  // 解析请求体
  const body = await c.req.json().catch(() => ({}));

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return c.json({ error: 'prompt 为必填字段' }, 400);
  }

  const prompt = body.prompt.trim();

  // prompt 长度上限：防止超长请求进入 LLM 造成成本放大滥用
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return c.json({ error: `prompt 长度超过上限（最多 ${MAX_PROMPT_LENGTH} 字符）` }, 400);
  }

  const currentHtml = body.options?.currentHtml;
  const currentFiles = body.options?.currentFiles;

  // currentFiles 基本校验：结构、文件数量与单文件大小上限
  const currentFilesError = validateCurrentFiles(currentFiles);
  if (currentFilesError) {
    return c.json({ error: currentFilesError }, 400);
  }

  // currentHtml（单文件模式向后兼容）与多文件模式共用单文件大小上限
  if (typeof currentHtml === 'string' && currentHtml.length > MAX_CURRENT_FILE_SIZE) {
    return c.json({ error: `currentHtml 超过大小上限（最多 ${MAX_CURRENT_FILE_SIZE} 字符）` }, 400);
  }

  // 项目知识库注入（P2）：请求携带 options.projectId 且该登录用户在该项目下
  // 有资料时，把资料以【项目参考资料】块拼进 prompt 尾部。prompt 会原样进入
  // 工程师阶段的用户需求 / 修改需求字段，因此注入内容在工程师阶段可见。
  // 拼接发生在 prompt 长度校验之后：资料不占用用户 prompt 长度预算；
  // 资料块自身截断到 32KB，防止放大 LLM 请求体造成成本滥用。
  const projectId =
    typeof body.options?.projectId === 'string' && body.options.projectId
      ? body.options.projectId
      : undefined;
  // requireAuth 已强制登录，此处仅做类型收窄（任务归属需要非空 userId）
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const resourcesBlock =
    projectId && sessionUser
      ? buildProjectResourcesBlock(listProjectResources(projectId, sessionUser.id))
      : '';
  const enrichedPrompt = prompt + resourcesBlock;

  const chatTurns = parseChatTurns(body.options?.chatTurns);
  const originalRequest = typeof body.options?.originalRequest === 'string' ? body.options.originalRequest : undefined;
  const intentOverride = parseIntentOverride(body.options?.intentOverride);
  const preferences = Array.isArray(body.options?.preferences)
    ? body.options.preferences.filter(
        (p: unknown): p is { type: string; key: string; value: string; reason?: string } =>
          typeof p === 'object' && p !== null &&
          typeof (p as Record<string, unknown>).type === 'string' &&
          typeof (p as Record<string, unknown>).key === 'string' &&
          typeof (p as Record<string, unknown>).value === 'string',
      ).slice(0, 20)
    : undefined;
  const { framework: userFramework, isExplicitlySet: isFrameworkExplicitlySet } = parseFramework(body.options?.framework);
  const requestId = body.requestId;

  // 兼容旧客户端：携带 requestId 时取消同 ID 的进行中请求
  if (typeof requestId === 'string') {
    cancelGeneration(requestId);
  }

  // 项目级并发约束：同一项目同时只允许一个 running 任务。新任务启动时取消
  // 旧任务（中止其执行链路并把任务行标记为 cancelled），与前端"新提交隐式
  // 取消旧任务"的既有语义一致，避免旧任务结果覆盖新任务。
  if (projectId) {
    const previous = getActiveRunView(projectId, sessionUser.id);
    if (previous && previous.status === 'running') {
      cancelRun(previous.runId);
      cancelRunTask(previous.runId);
    }
  }

  // 服务端任务：任务行先于生成创建（/cancel 在首个事件产生前即可定位任务）
  const runId = crypto.randomUUID();
  createRunRow({ runId, projectId: projectId ?? null, userId: sessionUser.id });
  const recorder = createRunRecorder({ runId, userId: sessionUser.id, projectId: projectId ?? null });

  // 返回 SSE 流（观察者）。生成不接收客户端连接信号（c.req.raw.signal 不再
  // 直通生成链路）：断连只影响观察，任务在服务端继续执行，结果落任务表，
  // 前端经 /api/llm/runs/* 恢复进度与结果。
  return streamSSE(c, async (stream) => {
    const eventQueue: LLMEvent[] = [];
    const pumpState = { closed: false };

    // 事件双写：任务记录（内存缓冲 + 节流落库，done/error 自动终态落库）+
    // SSE 队列（在线时实时推送给观察者）
    const onEvent = (event: LLMEvent) => {
      // runId 注入（delta 高频事件除外）：前端从首个事件即可拿到服务端任务标识
      if (event.type !== 'delta' && event.payload.runId === undefined) {
        event.payload.runId = runId;
      }
      recorder.record(event);
      if (!pumpState.closed) {
        eventQueue.push(event);
      }
    };

    // 服务端自驱生成
    const generatePromise = generateWithStages({
      prompt: enrichedPrompt,
      currentHtml: typeof currentHtml === 'string' ? currentHtml : undefined,
      currentFiles: typeof currentFiles === 'object' && currentFiles !== null ? currentFiles : undefined,
      chatTurns,
      originalRequest,
      intentOverride,
      preferences,
      // 用户明确选择框架时，使用 explicitFramework（最高优先级）
      // 否则使用默认的 framework 参数，让意图识别决定
      explicitFramework: isFrameworkExplicitlySet ? userFramework : undefined,
      framework: userFramework,
      runId,
      onEvent,
    });
    // 生成链路内部已完整兜底（不 reject），此处防御未预期异常导致 unhandled rejection
    void generatePromise.catch(() => {});

    try {
      // done/error/approval_required/clarification_required 后关闭观察流；
      // 任务行进入终态（如取消）时凭录制器状态退出，不依赖终局事件
      await pumpEventsToStream(
        stream,
        eventQueue,
        pumpState,
        ['done', 'error', 'approval_required', 'clarification_required'],
        () => {
          const recorder = getRunRecorder(runId);
          return !recorder || recorder.snapshot().status !== 'running';
        },
      );
    } catch {
      // 客户端断连等写失败：仅停止观察，服务端生成继续
      pumpState.closed = true;
    }
  });
});

/**
 * POST /api/llm/approve
 * 批准分析结果并继续生成
 *
 * Body: { sessionId: string, supplementaryInfo?: string }
 * supplementaryInfo 为 Phase 2 澄清机制中用户的回答
 *
 * SSE 事件流：继续返回 generate、review、done 事件
 */
llmRouter.post('/approve', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId;
  const supplementaryInfo = typeof body.supplementaryInfo === 'string' ? body.supplementaryInfo : undefined;

  if (typeof sessionId !== 'string') {
    return c.json({ error: 'sessionId 为必填字段' }, 400);
  }

  // 任务归属：批准续跑复用 /generate 创建的任务（runId 存于待批准会话）；
  // 会话缺失 requestId（异常路径）时兜底新建任务行
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const pending = getPendingSession(sessionId);
  const runId = pending?.requestId ?? crypto.randomUUID();
  const existingRow = getRunRow(runId);
  if (existingRow) {
    if (existingRow.userId !== sessionUser.id) {
      return c.json({ error: '无权访问该任务' }, 403);
    }
  } else {
    createRunRow({ runId, projectId: null, userId: sessionUser.id });
  }

  // 续写同一任务的事件序列：优先复用活跃录制器，否则从任务行恢复
  let recorder: RunRecorder;
  try {
    recorder = getOrCreateRecorder({ runId, userId: sessionUser.id });
  } catch (error) {
    if (error instanceof RunAccessError) {
      return c.json({ error: '无权访问该任务' }, 403);
    }
    throw error;
  }

  // 返回 SSE 流（观察者）：断连只影响观察，续跑在服务端继续并落任务表
  return streamSSE(c, async (stream) => {
    const eventQueue: LLMEvent[] = [];
    const pumpState = { closed: false };

    // 事件双写：任务记录 + SSE 队列（与 /generate 一致）
    const onEvent = (event: LLMEvent) => {
      if (event.type !== 'delta' && event.payload.runId === undefined) {
        event.payload.runId = runId;
      }
      recorder.record(event);
      if (!pumpState.closed) {
        eventQueue.push(event);
      }
    };

    // 继续生成（Phase 2：支持补充信息）。不传客户端连接信号
    const continuePromise = continueAfterApproval(sessionId, onEvent, undefined, undefined, supplementaryInfo);
    // 续跑链路内部已完整兜底，此处防御未预期异常导致 unhandled rejection
    void continuePromise.catch(() => {});

    try {
      // done 或 error 后关闭观察流；任务行进入终态（如取消）时凭录制器状态退出
      await pumpEventsToStream(stream, eventQueue, pumpState, ['done', 'error'], () => {
        const active = getRunRecorder(runId);
        return !active || active.snapshot().status !== 'running';
      });
    } catch {
      // 客户端断连等写失败：仅停止观察，服务端续跑继续
      pumpState.closed = true;
    }
  });
});

/**
 * POST /api/llm/cancel
 * 取消进行中的生成任务
 *
 * Body: { runId?: string, requestId?: string }
 * - runId：服务端任务 ID（后台任务驱动模式，/generate 首个事件下发）
 * - requestId：兼容旧客户端的请求 ID
 *
 * 任务型取消会同步把任务行标记为 cancelled（执行链路 abort 后到达的
 * error 事件不会把状态改写为 failed）。
 */
llmRouter.post('/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const targetId =
    typeof body.runId === 'string' && body.runId
      ? body.runId
      : typeof body.requestId === 'string'
        ? body.requestId
        : undefined;

  if (typeof targetId !== 'string' || !targetId) {
    return c.json({ error: 'runId 或 requestId 为必填字段' }, 400);
  }

  // 归属校验：目标任务行存在且不属于当前用户时拒绝
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const row = getRunRow(targetId);
  if (row && row.userId !== sessionUser.id) {
    return c.json({ error: '无权访问该任务' }, 403);
  }

  // 1. 先落库取消终态（RC4-BUG-002）：cancelRunTask 同步把录制器置为 cancelled
  //    终态，此后 abort 传播引发的任何迟到事件都会被录制器的终态守卫忽略，
  //    杜绝"取消被竞态写成 failed"的窗口；
  // 2. 再中止执行链路（直通阶段以 runId 注册的控制器 + 批准后以 sessionId 注册的控制器）
  const taskCancelled = cancelRunTask(targetId);
  const aborted = cancelRun(targetId);

  const cancelled = aborted || taskCancelled;
  return c.json({ success: cancelled, message: cancelled ? '请求已取消' : '未找到进行中的请求' });
});

/**
 * POST /api/llm/interrupt
 * Phase 3：工程师阶段中断（结对编程）
 * 用户主动中断生成，抢救已完成的文件，保留会话供反馈后继续
 *
 * Body: { sessionId: string }
 *
 * Response: { success: boolean, rescuedFiles: Record<string, FileNode>, rescuedCount: number }
 */
llmRouter.post('/interrupt', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId;

  if (typeof sessionId !== 'string') {
    return c.json({ error: 'sessionId 为必填字段' }, 400);
  }

  // 暂停工程师生成：标记会话 + 取消生成 + 抢救已完成文件
  const rescuedFiles = pauseEngineerSession(sessionId);

  return c.json({
    success: true,
    message: '已暂停生成',
    rescuedFiles,
    rescuedCount: Object.keys(rescuedFiles).length,
  });
});

/**
 * POST /api/llm/continue
 * Phase 3：继续生成（结对编程）
 * 用户反馈后继续生成，将反馈作为新的修改需求（diff 模式增量修改）
 *
 * Body: { sessionId: string, userFeedback: string }
 *
 * SSE 事件流：继续返回 generate、review、done 事件
 */
llmRouter.post('/continue', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId;
  const userFeedback = body.userFeedback;

  if (typeof sessionId !== 'string') {
    return c.json({ error: 'sessionId 为必填字段' }, 400);
  }

  if (typeof userFeedback !== 'string' || !userFeedback.trim()) {
    return c.json({ error: 'userFeedback 为必填字段' }, 400);
  }

  // 任务归属：反馈续跑复用暂停前同一任务（与 /approve 同一解析逻辑）
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const pending = getPendingSession(sessionId);
  const runId = pending?.requestId ?? crypto.randomUUID();
  const existingRow = getRunRow(runId);
  if (existingRow) {
    if (existingRow.userId !== sessionUser.id) {
      return c.json({ error: '无权访问该任务' }, 403);
    }
  } else {
    createRunRow({ runId, projectId: null, userId: sessionUser.id });
  }

  let recorder: RunRecorder;
  try {
    recorder = getOrCreateRecorder({ runId, userId: sessionUser.id });
  } catch (error) {
    if (error instanceof RunAccessError) {
      return c.json({ error: '无权访问该任务' }, 403);
    }
    throw error;
  }

  // 返回 SSE 流（观察者）：断连只影响观察，续跑在服务端继续并落任务表
  return streamSSE(c, async (stream) => {
    const eventQueue: LLMEvent[] = [];
    const pumpState = { closed: false };

    // 事件双写：任务记录 + SSE 队列（与 /generate 一致）
    const onEvent = (event: LLMEvent) => {
      if (event.type !== 'delta' && event.payload.runId === undefined) {
        event.payload.runId = runId;
      }
      recorder.record(event);
      if (!pumpState.closed) {
        eventQueue.push(event);
      }
    };

    // 用户反馈后继续生成。不传客户端连接信号
    const continuePromise = continueWithFeedback(sessionId, userFeedback, onEvent, undefined);
    // 续跑链路内部已完整兜底，此处防御未预期异常导致 unhandled rejection
    void continuePromise.catch(() => {});

    try {
      // done 或 error 后关闭观察流；任务行进入终态（如取消）时凭录制器状态退出
      await pumpEventsToStream(stream, eventQueue, pumpState, ['done', 'error'], () => {
        const active = getRunRecorder(runId);
        return !active || active.snapshot().status !== 'running';
      });
    } catch {
      // 客户端断连等写失败：仅停止观察，服务端续跑继续
      pumpState.closed = true;
    }
  });
});

/* ---------------- 生成任务恢复端点（background runs） ---------------- */

/**
 * GET /api/llm/runs/active?projectId=<id>
 * 查询当前登录用户在某项目下的活跃任务（断连后回来恢复进度的入口）。
 *
 * 优先级：
 * 1. running 任务（含批准/澄清/暂停等待点）→ { run: { runId, projectId, status,
 *    stage, startedAt, latestSeq, recentEvents } }
 * 2. 无 running 但存在终态（succeeded/failed）未领取任务（applied_at IS NULL，
 *    覆盖"离开期间已完成/已失败"时序）→ { run: { ..., recentEventTypes, finishedUnclaimed: true } }
 *    结果经 GET /runs/:runId/events 取回，消费后 POST /runs/:runId/ack 领取
 * 3. 都没有 → { run: null }
 */
llmRouter.get('/runs/active', (c) => {
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId 为必填参数' }, 400);
  }
  const run = getActiveRunView(projectId, sessionUser.id);
  return c.json({ run });
});

/**
 * POST /api/llm/runs/:runId/ack
 * 领取终态任务（幂等）：置 applied_at，任务不再以 finishedUnclaimed 出现在
 * /runs/active。cancelled 任务也可被 ack（前端用于清掉失败态）。
 *
 * Response: { success: true }；任务不存在 → 404，非属主 → 403
 */
llmRouter.post('/runs/:runId/ack', (c) => {
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const runId = c.req.param('runId');
  const row = getRunRow(runId);
  if (!row) {
    return c.json({ error: '任务不存在' }, 404);
  }
  if (row.userId !== sessionUser.id) {
    return c.json({ error: '无权访问该任务' }, 403);
  }
  ackRun(runId, sessionUser.id);
  return c.json({ success: true });
});

/**
 * GET /api/llm/runs/:runId/events?after=<seq>
 * 回放任务的进度事件（seq 之后的部分）与当前状态；succeeded 时附带完整
 * resultFiles（events 中的 done 事件不携带重载荷 files，完整结果以此为准）。
 *
 * Response: { runId, status, stage, events: [{seq, type, payload, at}], resultFiles, error }
 * - 任务不存在或不属于当前用户 → 404
 */
llmRouter.get('/runs/:runId/events', (c) => {
  const sessionUser = c.get('user');
  if (!sessionUser) {
    return c.json({ error: '未登录' }, 401);
  }
  const runId = c.req.param('runId');
  const afterRaw = Number(c.req.query('after') ?? '0');
  const after = Number.isFinite(afterRaw) && afterRaw >= 0 ? Math.floor(afterRaw) : 0;

  const view = getRunReplayView(runId, sessionUser.id, after);
  if (!view) {
    return c.json({ error: '任务不存在' }, 404);
  }
  return c.json(view);
});

/* ---------------- 提示词优化器 ---------------- */

/**
 * /optimize 端点的 SSE 事件类型
 */
interface OptimizeSSEEvent {
  type: 'delta' | 'done' | 'error';
  payload: Record<string, unknown>;
}

/** locale 白名单，与前端 OptimizerInput['locale'] 对齐 */
const OPTIMIZER_LOCALES: readonly string[] = ['zh-CN', 'en'];

/**
 * 数值参数钳制：非有限数返回 undefined，否则收敛到 [min, max] 整数/原值。
 * 客户端数值属不可信输入，进 LLM 请求体前必须经过钳制。
 */
function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** intentOverride 白名单：与 server/intentClassifier.ts 的 IntentType 对齐 */
const INTENT_OVERRIDE_VALUES: readonly string[] = ['create', 'modify', 'analyze', 'diagnose'];

/**
 * 解析强制意图参数：白名单外的值整体丢弃（走服务端自动识别）。
 * 前端误判纠正入口传 create/modify/analyze/diagnose，非法值不报错、静默忽略。
 * @param value 前端传入的 options.intentOverride 字段
 */
function parseIntentOverride(value: unknown): 'create' | 'modify' | 'analyze' | 'diagnose' | undefined {
  if (typeof value !== 'string') return undefined;
  return INTENT_OVERRIDE_VALUES.includes(value)
    ? (value as 'create' | 'modify' | 'analyze' | 'diagnose')
    : undefined;
}

/** framework 白名单：与 ProjectFramework 对齐 */
const FRAMEWORK_VALUES: readonly string[] = ['html', 'react-cdn', 'vue-cdn'];

/**
 * 解析框架参数：白名单外的值回退到 'html'。
 * 返回值包含 isExplicitlySet 字段，用于判断是否为用户手动选择。
 * @param value 前端传入的 options.framework 字段
 */
function parseFramework(value: unknown): { framework: 'html' | 'react-cdn' | 'vue-cdn'; isExplicitlySet: boolean } {
  if (typeof value !== 'string') {
    return { framework: 'html', isExplicitlySet: false };
  }
  const isValid = FRAMEWORK_VALUES.includes(value);
  return {
    framework: isValid ? (value as 'html' | 'react-cdn' | 'vue-cdn') : 'html',
    isExplicitlySet: true,
  };
}

/**
 * 解析对话轮次输入：校验数组结构与每个条目的 role/content 类型。
 * 不合规格式整体丢弃，返回 undefined。
 * @param value 前端传入的 chatTurns 字段
 * @param maxItems 最大条目数（防止过大载荷），默认 20
 */
function parseChatTurns(value: unknown, maxItems = 20): Array<{ role: 'user' | 'assistant'; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return undefined;
  if (value.length > maxItems) return undefined;

  const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined;
    const obj = item as Record<string, unknown>;
    if (obj.role !== 'user' && obj.role !== 'assistant') return undefined;
    if (typeof obj.content !== 'string') return undefined;
    // 单条消息长度上限（防止极端 payload）
    if (obj.content.length > 5000) return undefined;
    result.push({ role: obj.role, content: obj.content });
  }
  return result;
}

/** prompt 长度上限：32KB 字符，足够正常需求描述，同时防止成本放大滥用 */
const MAX_PROMPT_LENGTH = 32_768;

/** currentFiles 文件数量上限 */
const MAX_CURRENT_FILES_COUNT = 50;

/** 单文件内容长度上限：1MB 字符（多文件 currentFiles 与单文件 currentHtml 共用） */
const MAX_CURRENT_FILE_SIZE = 1_048_576;

/**
 * 校验迭代上下文 currentFiles：结构、文件数量与单文件大小上限。
 * 防止过大载荷进入 LLM 请求体造成成本放大。
 * @param value 前端传入的 options.currentFiles 字段
 * @returns 错误消息；合法或未提供时返回 null
 */
function validateCurrentFiles(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'currentFiles 必须是文件对象映射';
  }
  const files = Object.values(value);
  if (files.length > MAX_CURRENT_FILES_COUNT) {
    return `currentFiles 文件数量超过上限（最多 ${MAX_CURRENT_FILES_COUNT} 个）`;
  }
  for (const file of files) {
    if (typeof file !== 'object' || file === null) {
      return 'currentFiles 条目格式错误';
    }
    const content = (file as Record<string, unknown>).content;
    if (typeof content !== 'string') {
      return 'currentFiles 条目缺少 content 字符串';
    }
    if (content.length > MAX_CURRENT_FILE_SIZE) {
      return `单个文件内容超过大小上限（最多 ${MAX_CURRENT_FILE_SIZE} 字符）`;
    }
  }
  return null;
}

/** 项目资料注入块总长上限（字符）：与知识库总量限额（32KB）对齐 */
const MAX_RESOURCES_BLOCK_LENGTH = 32_768;

/**
 * 组装【项目参考资料】注入块（追加到 prompt 尾部）。
 * 空资料返回空串；块首为分隔标记，块尾附使用约束；
 * 总长截断到 MAX_RESOURCES_BLOCK_LENGTH，防止放大 LLM 请求体。
 */
export function buildProjectResourcesBlock(
  resources: ReadonlyArray<{ name: string; content: string }>,
): string {
  if (resources.length === 0) return '';
  const parts = resources.map((r) => `### ${r.name}\n${r.content}`);
  let block = `\n\n【项目参考资料】\n${parts.join('\n\n')}\n\n（以上为用户上传的项目资料，仅在相关时参考；与本次需求冲突时以本次需求为准。）`;
  if (block.length > MAX_RESOURCES_BLOCK_LENGTH) {
    block = block.slice(0, MAX_RESOURCES_BLOCK_LENGTH);
  }
  return block;
}

/**
 * 解析迭代上下文：逐字段校验类型，不合规律段整体丢弃（不部分采用）。
 */
function parseExistingContext(value: unknown): OptimizerExistingContext | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.title !== 'string' ||
    typeof obj.summary !== 'string' ||
    !Array.isArray(obj.features)
  ) {
    return undefined;
  }
  return {
    title: obj.title,
    summary: obj.summary,
    features: obj.features.filter((f): f is string => typeof f === 'string'),
  };
}

/**
 * POST /api/llm/optimize
 * 提示词优化（需求澄清）：后端组装优化器 Prompt（模板镜像自前端
 * src/services/ai/optimizer/prompt.ts，见 server/prompts.ts）并调用 LLM，
 * SSE 流式返回。输出的 JSON 结构校验由前端 validator 完成，后端是纯代理。
 *
 * Body: {
 *   userPrompt: string            // 必填；兼容任务规格中的 prompt 字段名作为别名
 *   templateHint?: string         // 模板类型枚举值（dashboard/todo/...）
 *   locale?: string               // 'zh-CN' | 'en'，缺省或非法值回落 'zh-CN'
 *   existingContext?: { title: string, summary: string, features: string[] }
 *   maxTokens?: number            // 钳制到 [256, 8192]
 *   temperature?: number          // 钳制到 [0, 2]
 *   model?: string                // 忽略：模型名以服务端 LLM_MODEL 为准，
 *                                 // 避免前端传入上游不认识的模型名导致 4xx
 * }
 *
 * SSE 事件流：
 * - delta: { text: string }
 * - done:  {}
 * - error: { code: string, message: string, retryable: boolean }
 *   错误码：LLM_NOT_CONFIGURED（不可重试）/ UPSTREAM_ERROR（可重试）/
 *           CANCELLED（不可重试）/ INTERNAL_ERROR（可重试）
 */
llmRouter.post('/optimize', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  // userPrompt 必填（兼容 prompt 别名）
  const userPrompt =
    typeof body.userPrompt === 'string' && body.userPrompt.trim()
      ? body.userPrompt.trim()
      : typeof body.prompt === 'string'
        ? body.prompt.trim()
        : '';

  if (!userPrompt) {
    return c.json({ error: 'userPrompt 为必填字段' }, 400);
  }

  const templateHint = typeof body.templateHint === 'string' ? body.templateHint : '';
  const locale =
    typeof body.locale === 'string' && OPTIMIZER_LOCALES.includes(body.locale)
      ? body.locale
      : 'zh-CN';
  const existingContext = parseExistingContext(body.existingContext);
  const maxTokens = clampNumber(body.maxTokens, 256, 8192);
  const temperature = clampNumber(body.temperature, 0, 2);

  // 服务端组装 prompt。渲染抛错说明模板与取值不匹配（编程错误），以 500 JSON 答复
  const userContent = (() => {
    try {
      return renderOptimizerUserPrompt(
        userPrompt,
        getTemplateHintText(templateHint),
        locale,
        existingContext,
      );
    } catch (error) {
      console.error('[optimize] Prompt 模板渲染失败', error);
      return null;
    }
  })();

  if (userContent === null) {
    return c.json({ error: 'Prompt 模板渲染失败' }, 500);
  }

  // API Key 预检：未配置时以 error 事件答复（保持 SSE 协议一致），不可重试
  if (!process.env.LLM_API_KEY) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          code: 'LLM_NOT_CONFIGURED',
          message: 'LLM_API_KEY 环境变量未配置，请联系管理员',
          retryable: false,
        }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    const eventQueue: OptimizeSSEEvent[] = [];
    let closed = false;

    // 优化调用：单阶段，无批准流程。catch 已兜底，Promise 不会 reject
    const optimizePromise = (async () => {
      await streamChatCompletion(
        [
          { role: 'system', content: OPTIMIZER_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        (text) => {
          if (!closed) {
            eventQueue.push({ type: 'delta', payload: { text } });
          }
        },
        undefined, // abortSignal：优化器取消由前端断开连接完成
        { maxTokens, temperature },
      );
      if (!closed) {
        eventQueue.push({ type: 'done', payload: {} });
      }
    })().catch((error) => {
      if (closed) return;
      if (error instanceof Error && error.name === 'AbortError') {
        eventQueue.push({
          type: 'error',
          payload: { code: 'CANCELLED', message: '请求已取消', retryable: false },
        });
      } else {
        const message = error instanceof Error ? error.message : '未知错误';
        eventQueue.push({
          type: 'error',
          payload: { code: 'UPSTREAM_ERROR', message, retryable: true },
        });
      }
    });

    // 轮询事件队列并发送（与 generate/approve 端点同一模式）
    const sendEvents = async () => {
      while (!closed) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.payload),
          });

          // done 或 error 后关闭流
          if (event.type === 'done' || event.type === 'error') {
            closed = true;
            break;
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    };

    try {
      await Promise.all([optimizePromise, sendEvents()]);
    } catch (error) {
      // writeSSE 失败（客户端断开）等发送侧异常
      if (!closed) {
        const message = error instanceof Error ? error.message : '未知错误';
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ code: 'INTERNAL_ERROR', message, retryable: true }),
        });
      }
    }
  });
});