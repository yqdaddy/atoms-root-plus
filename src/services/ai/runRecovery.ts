/**
 * 后台生成任务恢复服务（PRD：docs/prd-background-runs.md F-002）。
 * 生成与页面连接解耦后，前端通过本模块完成三件事：
 * 1. 查询项目当前活跃任务（GET /api/llm/runs/active?projectId=）
 * 2. 回放/增量拉取任务事件（GET /api/llm/runs/:runId/events?after=seq）
 * 3. 按 runId 显式取消（POST /api/llm/cancel，显式取消是唯一终止途径）
 *
 * 事件负载与 SSE 事件共用同一 data JSON 结构，转换层复用 liveEngine.processSSEEvent。
 * 后端字段以 server/routes/llm.ts 实际实现为准，本模块对响应做防御性解析：
 * 形状不合法时降级为空值而不是抛错，保证"首次进入无任务"的正常路径永不被恢复逻辑破坏。
 */
import { apiFetchJson } from '../apiClient';

/** 活跃任务信息（GET /api/llm/runs/active 返回的 run 字段） */
export interface ActiveRunInfo {
  runId: string;
  /** 服务端阶段原始值（analysis/generate/review 等，经 STAGE_MAP 映射后展示） */
  stage: string;
  /** 任务开始时间（ISO 字符串；无法解析时由调用方回退本地时钟） */
  startedAt: string;
  /** 任务状态原始值（running/succeeded/failed/cancelled 等） */
  status: string;
  /**
   * 终态未领取标记：项目无进行中任务，但存在最近结束（succeeded/failed）
   * 且尚未被任何端确认展示的任务。调用方需回放并应用该任务，
   * 完成后调用 ackRun 标记领取，否则每次进入项目都会重复弹出恢复。
   */
  finishedUnclaimed: boolean;
}

/** 任务事件回放记录 */
export interface RunEventRecord {
  /** 事件序号（任务内单调递增，用作增量拉取游标） */
  seq: number;
  /** 事件类型（与 SSE 事件名一致：stage/delta/done/error/retry/warning/approval_required 等） */
  type: string;
  /** 事件负载（与对应 SSE 事件的 data JSON 一致） */
  payload: unknown;
}

/** 单个结果文件（与 done 事件 payload.files 条目一致） */
export interface RunResultFile {
  path: string;
  content: string;
  language: string;
  updatedAt: string;
}

/**
 * 任务事件回放/增量响应。
 * 后端约定（server/runs.ts）：done 事件的回放拷贝剥离了重载荷（files/html），
 * 完整结果在 status 为 succeeded 时以 resultFiles 字段单独返回；
 * 失败任务的 error 字段携带失败原因。
 */
export interface RunEventsResult {
  status: string;
  stage: string;
  events: RunEventRecord[];
  /** 成功时的完整结果文件；非 succeeded 时为 null */
  resultFiles: Record<string, RunResultFile> | null;
  /** 失败原因（failed 时由后端附带） */
  error: string | null;
}

/* ---------------- 防御性解析工具 ---------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 解析 active 接口的 run 字段；形状不合法时返回 null */
function parseActiveRun(value: unknown): ActiveRunInfo | null {
  if (!isRecord(value)) return null;
  const runId = asString(value.runId);
  if (!runId) return null;
  return {
    runId,
    stage: asString(value.stage),
    startedAt: asString(value.startedAt),
    status: asString(value.status) || 'running',
    finishedUnclaimed: value.finishedUnclaimed === true,
  };
}

/* ---------------- 接口封装 ---------------- */

/**
 * 查询项目当前活跃任务。
 * 无任务、端点暂不可用（后端未上线/404）或网络异常时一律返回 null，
 * 调用方按"无恢复任务"处理，不阻塞正常使用路径。
 */
export async function fetchActiveRun(projectId: string): Promise<ActiveRunInfo | null> {
  try {
    const data = await apiFetchJson<unknown>(
      `/api/llm/runs/active?projectId=${encodeURIComponent(projectId)}`,
    );
    if (!isRecord(data)) return null;
    return parseActiveRun(data.run);
  } catch {
    return null;
  }
}

/**
 * 拉取任务事件。after=0 为全量回放；after=上次最大 seq 为增量轮询。
 * 请求失败时抛出异常，由调用方决定重试策略（轮询场景下网络抖动不应终止恢复）。
 */
export async function fetchRunEvents(runId: string, after: number): Promise<RunEventsResult> {
  const cursor = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
  const data = await apiFetchJson<unknown>(
    `/api/llm/runs/${encodeURIComponent(runId)}/events?after=${cursor}`,
  );
  if (!isRecord(data)) {
    throw new Error('任务事件响应格式不合法');
  }
  const rawEvents = Array.isArray(data.events) ? data.events : [];
  const events: RunEventRecord[] = [];
  for (const item of rawEvents) {
    if (!isRecord(item)) continue;
    const type = asString(item.type);
    if (!type) continue;
    events.push({
      seq: asFiniteNumber(item.seq),
      type,
      payload: item.payload ?? {},
    });
  }
  return {
    status: asString(data.status) || 'running',
    stage: asString(data.stage),
    events,
    // done 回放剥离了重载荷，完整结果以 resultFiles 单独返回（仅 succeeded 携带）
    resultFiles: isRecord(data.resultFiles)
      ? (data.resultFiles as Record<string, RunResultFile>)
      : null,
    error: asString(data.error) || null,
  };
}

/**
 * 标记终态任务已领取（结果已应用或错误已展示）。
 * 与前端 litpp:applied-run 去重标记构成双保险：
 * localStorage 防同机重复回放，ack 防清缓存/换设备后重复弹出恢复。
 * 后端未上线（404）或网络异常时返回 false，不抛错，重进项目可再次领取。
 */
export async function ackRun(runId: string): Promise<boolean> {
  try {
    await apiFetchJson<unknown>(`/api/llm/runs/${encodeURIComponent(runId)}/ack`, {
      method: 'POST',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 按 runId 取消后台任务（显式取消是唯一终止途径，断连不触发取消）。
 * 请求体同时携带 runId 与 requestId：兼容仅认 requestId 的历史端点。
 * 取消失败（网络异常、任务已结束）返回 false，不抛错。
 */
export async function cancelRun(runId: string): Promise<boolean> {
  try {
    const data = await apiFetchJson<{ success?: unknown } | null>('/api/llm/cancel', {
      method: 'POST',
      body: JSON.stringify({ runId, requestId: runId }),
    });
    return data?.success === true;
  } catch {
    return false;
  }
}
