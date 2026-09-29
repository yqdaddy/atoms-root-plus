/**
 * 服务端生成任务（background runs）：generations 任务表 + 运行录制器。
 *
 * 架构（SSE 连接驱动 → 服务端任务驱动）：
 * - 生成任务以 run_id 为主键持久化在 generations 表，status/stage/events/result_files
 *   随生成推进更新。前端断连只影响"观察者"（SSE 流），任务在服务端自驱完成；
 *   前端回来后经 /api/llm/runs/active 与 /api/llm/runs/:runId/events 恢复进度与结果。
 * - RunRecorder 是 onEvent 双写中的"任务记录"侧：事件先进内存缓冲，节流批量落库
 *   （默认每 2s，避免每个 delta 一次写盘），终态时同步最终落库。
 * - 事件保留策略：关键事件（stage/approval_required/clarification_required/
 *   engineer_pause/done/error/warning/retry）逐条保留；delta 类细粒度文本不逐条
 *   入库，滚动保留最近 600 字符作为"最新进度摘要"，在每次落库时以新 seq 追加一条
 *   合并摘要事件（旧摘要不保留），保证 after 游标回放语义正确且 events 体积有界。
 * - done 事件的重载荷（files/html）不进 events（回放保持轻量），完整结果单独存
 *   result_files 列，由恢复端点在 succeeded 时随事件一并返回。
 * - 同一 project 同时只允许一个 running 任务：新任务启动时旧 running 任务被取消
 *   （cancelRun + cancelRunTask），与前端"新提交隐式取消旧任务"的既有语义一致。
 * - 终态结果领取：succeeded/failed 任务经 /runs/active 以 finishedUnclaimed 标记
 *   返回，前端消费结果后 POST /runs/:runId/ack 置 applied_at（幂等），避免用户
 *   离开期间的成果成为孤岛。
 * - 服务器重启：内存任务丢失，模块加载时把遗留 running 任务标记为 failed。
 *
 * 会话型等待点（approval_required/clarification_required/engineer_pause）：
 * 任务状态保持 running，stage 标注等待点；断连后回来仍走现有 pendingSessions
 * 语义（暂停点本来就在等用户，不受断连影响）。
 */
import { db } from './db.js';
import type { LLMEvent, LLMEventType } from './llm.js';

/** 任务状态：running 进行中 / succeeded 成功 / failed 失败 / cancelled 取消 */
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type TerminalRunStatus = Exclude<RunStatus, 'running'>;

/**
 * 任务阶段：正常阶段跟随 stage 事件的 phase（search/analysis/generate/review/
 * diagnose）；等待点在状态仍为 running 时标注暂停位置。
 */
export type RunStage =
  | 'queued'
  | 'search'
  | 'analysis'
  | 'generate'
  | 'review'
  | 'diagnose'
  | 'waiting_approval'
  | 'waiting_clarification'
  | 'engineer_paused'
  | 'done'
  | 'error'
  | 'cancelled';

/** 合并 delta 摘要的滚动窗口（字符）：进度摘要不需要全文，最近片段足够展示 */
const DELTA_TAIL_CAP = 600;

/** events 数组硬上限（防退化场景无限增长）：超限时先丢最旧的合并摘要 */
const MAX_EVENTS_HARD_CAP = 500;

/** 事件落库节流间隔（毫秒） */
const DEFAULT_FLUSH_INTERVAL_MS = 2000;

/** 合并 delta 摘要的载荷：在标准事件载荷上追加 summary 标记 */
export type RunEventPayload = LLMEvent['payload'] & {
  /** true 表示这是合并的进度摘要（非逐 token 原文） */
  summary?: boolean;
};

/** 任务事件记录（持久化形态） */
export interface RunEventRecord {
  /** 单调递增序号，游标回放的依据 */
  seq: number;
  type: LLMEventType;
  payload: RunEventPayload;
  /** 事件发生时间（ISO） */
  at: string;
}

/** 任务行（解析后的读取形态） */
export interface RunRow {
  runId: string;
  projectId: string | null;
  userId: string;
  status: RunStatus;
  stage: RunStage;
  events: RunEventRecord[];
  /** 原始 JSON 字符串（成功时的 files JSON）；读取端经 parseResultFiles 解析 */
  resultFilesRaw: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** /runs/active 返回的运行摘要（running 任务） */
export interface RunSummaryView {
  runId: string;
  projectId: string | null;
  status: RunStatus;
  stage: RunStage;
  startedAt: string;
  latestSeq: number;
  /** 最近几条事件的类型摘要（不含载荷，供前端提示进度） */
  recentEvents: Array<{ seq: number; type: LLMEventType }>;
}

/** /runs/active 返回的终态未领取任务（离开期间完成/失败的常见时序） */
export interface FinishedUnclaimedRunView {
  runId: string;
  projectId: string | null;
  status: RunStatus;
  stage: RunStage;
  startedAt: string;
  latestSeq: number;
  /** 最近几条事件的类型（仅类型，不含载荷；详情走 /runs/:runId/events） */
  recentEventTypes: LLMEventType[];
  /** 恒为 true：前端消费结果（应用文件/展示错误）后应 POST /runs/:runId/ack 领取 */
  finishedUnclaimed: true;
}

/** /runs/:runId/events 返回的回放视图 */
export interface RunReplayView {
  runId: string;
  status: RunStatus;
  stage: RunStage;
  events: RunEventRecord[];
  /** 成功时的完整结果文件（含 path/content/language/updatedAt） */
  resultFiles: Record<string, { path: string; content: string; language: string; updatedAt: string }> | null;
  error: string | null;
}

/** 任务归属校验失败（路由层映射为 403） */
export class RunAccessError extends Error {
  constructor(message = '无权访问该任务') {
    super(message);
    this.name = 'RunAccessError';
  }
}

// ============ 表结构（幂等建表，参考 share.ts 模式） ============

function ensureGenerationsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS generations (
      run_id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      result_files TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_project_status ON generations(project_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id)`);

  // 迁移：补 applied_at 列（终态结果领取标记；NULL 表示尚未被前端领取）。
  // 旧表无该列时 ALTER 补齐，新表由 CREATE TABLE 建出（IF NOT EXISTS 不改已存在表）
  const columns = db.prepare(`PRAGMA table_info(generations)`).all() as Array<{ name: string }>;
  if (!columns.some((col) => col.name === 'applied_at')) {
    db.exec(`ALTER TABLE generations ADD COLUMN applied_at INTEGER`);
  }
}

ensureGenerationsTable();

// 预编译语句
const stmtInsertRun = db.prepare(
  `INSERT INTO generations (run_id, project_id, user_id, status, stage, events, result_files, error, created_at, updated_at)
   VALUES (?, ?, ?, 'running', ?, '[]', NULL, NULL, ?, ?)`,
);
const stmtUpdateProgress = db.prepare(
  `UPDATE generations SET events = ?, stage = ?, updated_at = ? WHERE run_id = ? AND status = 'running'`,
);
const stmtFinishRun = db.prepare(
  `UPDATE generations SET status = ?, stage = ?, events = ?, result_files = ?, error = ?, updated_at = ? WHERE run_id = ?`,
);
const stmtCancelRunning = db.prepare(
  `UPDATE generations SET status = 'cancelled', error = COALESCE(error, ?), updated_at = ? WHERE run_id = ? AND status = 'running'`,
);
const stmtFailRunning = db.prepare(
  `UPDATE generations SET status = 'failed', error = ?, updated_at = ? WHERE status = 'running'`,
);
const stmtAckRun = db.prepare(
  `UPDATE generations SET applied_at = COALESCE(applied_at, ?) WHERE run_id = ? AND user_id = ?`,
);
const stmtFindUnclaimedTerminal = db.prepare(
  `SELECT run_id, project_id, user_id, status, stage, events, result_files, error, created_at, updated_at
   FROM generations WHERE project_id = ? AND user_id = ? AND status IN ('succeeded', 'failed') AND applied_at IS NULL
   ORDER BY updated_at DESC LIMIT 1`,
);

// ============ 行读取与解析 ============

function parseEvents(raw: string): RunEventRecord[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: RunEventRecord[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Partial<RunEventRecord>;
      if (typeof rec.seq !== 'number' || typeof rec.type !== 'string') continue;
      if (typeof rec.payload !== 'object' || rec.payload === null) continue;
      records.push({
        seq: rec.seq,
        type: rec.type as LLMEventType,
        payload: rec.payload as RunEventPayload,
        at: typeof rec.at === 'string' ? rec.at : '',
      });
    }
    return records;
  } catch {
    // 数据损坏：不静默丢弃原始行，仅在读取侧降级为空事件序列
    console.warn('[runs] events JSON 解析失败，按空事件序列返回');
    return [];
  }
}

interface GenerationsRawRow {
  run_id: string;
  project_id: string | null;
  user_id: string;
  status: string;
  stage: string;
  events: string;
  result_files: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const RUN_STATUS_VALUES: readonly RunStatus[] = ['running', 'succeeded', 'failed', 'cancelled'];

function toRunRow(raw: GenerationsRawRow): RunRow {
  const status = RUN_STATUS_VALUES.includes(raw.status as RunStatus) ? (raw.status as RunStatus) : 'failed';
  return {
    runId: raw.run_id,
    projectId: raw.project_id,
    userId: raw.user_id,
    status,
    stage: raw.stage as RunStage,
    events: parseEvents(raw.events),
    resultFilesRaw: raw.result_files,
    error: raw.error,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// ============ 任务行 CRUD ============

export function createRunRow(input: { runId: string; projectId: string | null; userId: string; stage?: RunStage }): void {
  const now = new Date().toISOString();
  stmtInsertRun.run(input.runId, input.projectId, input.userId, input.stage ?? 'queued', now, now);
}

export function getRunRow(runId: string): RunRow | null {
  const row = db
    .prepare(
      `SELECT run_id, project_id, user_id, status, stage, events, result_files, error, created_at, updated_at
       FROM generations WHERE run_id = ?`,
    )
    .get(runId) as GenerationsRawRow | undefined;
  return row ? toRunRow(row) : null;
}

/** 查找某用户在某项目下的 running 任务（同项目同时只允许一个） */
export function findRunningRun(projectId: string, userId: string): RunRow | null {
  const row = db
    .prepare(
      `SELECT run_id, project_id, user_id, status, stage, events, result_files, error, created_at, updated_at
       FROM generations WHERE project_id = ? AND user_id = ? AND status = 'running'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(projectId, userId) as GenerationsRawRow | undefined;
  return row ? toRunRow(row) : null;
}

/** 服务器重启后的孤儿清理：遗留 running 任务标记为 failed。返回受影响行数 */
export function markOrphanedRunsFailed(reason: string): number {
  const result = stmtFailRunning.run(reason, new Date().toISOString());
  return result.changes;
}

// ============ 运行录制器 ============

export interface RunRecorderSnapshot {
  runId: string;
  userId: string;
  projectId: string | null;
  status: RunStatus;
  stage: RunStage;
  latestSeq: number;
  events: readonly RunEventRecord[];
  resultFilesRaw: string | null;
  error: string | null;
}

export interface RunRecorder {
  readonly runId: string;
  /** 记录一个生成事件（缓冲 + 节流落库）。终态后到达的事件被忽略（防止取消后
   *  abort 引发的 error 事件把 cancelled 状态改写为 failed）。永不抛出。 */
  record(event: LLMEvent): void;
  /** 进入终态并同步最终落库（幂等） */
  finish(status: TerminalRunStatus, opts?: { error?: string; resultFilesRaw?: string | null }): void;
  snapshot(): RunRecorderSnapshot;
}

export interface RunRecorderOptions {
  runId: string;
  userId: string;
  projectId: string | null;
  /** 从任务行恢复既有事件（批准/反馈后续阶段复用同一任务时使用） */
  resume?: boolean;
  /** 落库节流间隔（毫秒），默认 2000 */
  flushIntervalMs?: number;
}

function deriveStage(event: LLMEvent, current: RunStage): RunStage {
  switch (event.type) {
    case 'stage':
      return event.payload.phase ?? current;
    case 'approval_required':
      return 'waiting_approval';
    case 'clarification_required':
      return 'waiting_clarification';
    case 'engineer_pause':
      return 'engineer_paused';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    default:
      return current;
  }
}

/** done 事件的回放拷贝：剥掉重载荷（files/html），完整结果走 result_files 列 */
function stripHeavyPayload(payload: LLMEvent['payload']): RunEventPayload {
  if (payload.files === undefined && payload.html === undefined) return payload;
  const copy: RunEventPayload = { ...payload };
  delete copy.files;
  delete copy.html;
  return copy;
}

/** 超硬上限时先丢最旧的合并摘要事件，再丢最旧事件（正常流量远达不到） */
function trimEvents(events: RunEventRecord[]): void {
  while (events.length > MAX_EVENTS_HARD_CAP) {
    const deltaIdx = events.findIndex((e) => e.type === 'delta');
    if (deltaIdx >= 0) events.splice(deltaIdx, 1);
    else events.shift();
  }
}

const activeRecorders = new Map<string, RunRecorder>();

/** 活跃录制器（仅运行中的任务存在；终态时自动注销） */
export function getRunRecorder(runId: string): RunRecorder | undefined {
  return activeRecorders.get(runId);
}

/**
 * 解析 result_files 列：损坏数据返回 null（不抛出）。
 */
export function parseResultFiles(
  raw: string | null,
): Record<string, { path: string; content: string; language: string; updatedAt: string }> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, { path: string; content: string; language: string; updatedAt: string }>;
  } catch {
    console.warn('[runs] result_files JSON 解析失败');
    return null;
  }
}

export function createRunRecorder(options: RunRecorderOptions): RunRecorder {
  const { runId, userId, projectId } = options;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

  // resume：从任务行恢复事件历史与序号（批准/反馈阶段续写同一任务）
  let events: RunEventRecord[] = [];
  let nextSeq = 1;
  let stage: RunStage = 'queued';
  if (options.resume) {
    const row = getRunRow(runId);
    if (!row) throw new Error(`任务不存在：${runId}`);
    if (row.userId !== userId) throw new RunAccessError();
    events = row.events;
    nextSeq = events.length > 0 ? (events[events.length - 1]?.seq ?? 0) + 1 : 1;
    stage = row.stage;
  }

  let status: RunStatus = 'running';
  let resultFilesRaw: string | null = null;
  let errorMessage: string | null = null;

  // delta 摘要：滚动窗口 + 落库去重（未变化的摘不重复落）
  let deltaTail = '';
  let persistedDeltaTail = '';

  let dirty = false;
  let terminal = false;

  const persist = (finalStatus: RunStatus | null): void => {
    const now = new Date().toISOString();
    if (deltaTail !== persistedDeltaTail && deltaTail !== '') {
      events.push({
        seq: nextSeq++,
        type: 'delta',
        payload: { text: deltaTail, summary: true },
        at: now,
      });
      persistedDeltaTail = deltaTail;
      trimEvents(events);
    }
    if (finalStatus !== null) {
      stmtFinishRun.run(finalStatus, stage, JSON.stringify(events), resultFilesRaw, errorMessage, now, runId);
    } else if (dirty) {
      stmtUpdateProgress.run(JSON.stringify(events), stage, now, runId);
    }
    dirty = false;
  };

  const flushTimer = setInterval(() => {
    if (terminal) return;
    try {
      persist(null);
    } catch (error) {
      // 落库失败不阻断生成：下次节流周期重试
      console.warn('[runs] 事件节流落库失败（将在下个周期重试）', error);
    }
  }, flushIntervalMs);
  // 不阻塞进程退出（否则挂起的运行会拖住 vitest/优雅关闭）
  flushTimer.unref?.();

  const recorder: RunRecorder = {
    runId,
    record(event: LLMEvent): void {
      if (terminal) return;
      try {
        stage = deriveStage(event, stage);
        if (event.type === 'delta') {
          const text = event.payload.text ?? '';
          if (text !== '') {
            deltaTail = (deltaTail + text).slice(-DELTA_TAIL_CAP);
            dirty = true;
          }
          return;
        }
        if (event.type === 'done') {
          events.push({ seq: nextSeq++, type: 'done', payload: stripHeavyPayload(event.payload), at: new Date().toISOString() });
          const files = event.payload.files;
          const html = event.payload.html;
          if (files && Object.keys(files).length > 0) {
            resultFilesRaw = JSON.stringify(files);
          } else if (typeof html === 'string' && html !== '') {
            // 单文件向后兼容：包装为标准 files 记录
            resultFilesRaw = JSON.stringify({
              '/index.html': { path: '/index.html', content: html, language: 'html', updatedAt: new Date().toISOString() },
            });
          }
          recorder.finish('succeeded');
          return;
        }
        if (event.type === 'error') {
          events.push({ seq: nextSeq++, type: 'error', payload: { ...event.payload }, at: new Date().toISOString() });
          recorder.finish('failed', { error: event.payload.message ?? '未知错误' });
          return;
        }
        events.push({ seq: nextSeq++, type: event.type, payload: { ...event.payload }, at: new Date().toISOString() });
        trimEvents(events);
        dirty = true;
      } catch (error) {
        // 录制失败绝不阻断生成链路
        console.warn('[runs] 事件记录失败（已忽略）', error);
      }
    },
    finish(finalStatus: TerminalRunStatus, opts?: { error?: string; resultFilesRaw?: string | null }): void {
      if (terminal) return;
      terminal = true;
      status = finalStatus;
      if (opts?.error !== undefined) errorMessage = opts.error;
      if (opts?.resultFilesRaw !== undefined) resultFilesRaw = opts.resultFilesRaw;
      if (finalStatus === 'cancelled' && stage !== 'done' && stage !== 'error') stage = 'cancelled';
      try {
        persist(finalStatus);
      } catch (error) {
        console.error('[runs] 终态落库失败', runId, error);
      }
      clearInterval(flushTimer);
      activeRecorders.delete(runId);
    },
    snapshot(): RunRecorderSnapshot {
      return {
        runId,
        userId,
        projectId,
        status,
        stage,
        latestSeq: nextSeq - 1,
        events,
        resultFilesRaw,
        error: errorMessage,
      };
    },
  };

  activeRecorders.set(runId, recorder);
  return recorder;
}

/**
 * 获取或恢复任务的录制器（批准/反馈后续阶段复用同一任务）。
 * 活跃录制器直接复用；否则从任务行恢复事件历史。
 * @throws RunAccessError 任务不存在或不属于该用户
 */
export function getOrCreateRecorder(params: { runId: string; userId: string }): RunRecorder {
  const existing = activeRecorders.get(params.runId);
  if (existing) {
    if (existing.snapshot().userId !== params.userId) throw new RunAccessError();
    return existing;
  }
  return createRunRecorder({ ...params, projectId: getRunRow(params.runId)?.projectId ?? null, resume: true });
}

// ============ 取消与视图 ============

/**
 * 取消任务并落库：活跃录制器存在时经其进入终态（内存事件一并持久化），
 * 否则直接把 running 行标记为 cancelled。
 */
export function cancelRunTask(runId: string, reason = '用户取消'): boolean {
  const recorder = activeRecorders.get(runId);
  if (recorder) {
    recorder.finish('cancelled', { error: reason });
    return true;
  }
  const result = stmtCancelRunning.run(reason, new Date().toISOString(), runId);
  return result.changes > 0;
}

/**
 * 领取终态任务（幂等）：置 applied_at，之后不再出现在 /runs/active 的
 * finishedUnclaimed 结果里。cancelled 任务同样可被 ack（前端用于清掉失败态）。
 * @returns 是否有任务行被标记（行不存在或非属主返回 false）
 */
export function ackRun(runId: string, userId: string): boolean {
  const result = stmtAckRun.run(Date.now(), runId, userId);
  return result.changes > 0;
}

/**
 * /runs/active：当前用户在项目下的活跃任务视图。
 * 优先级：
 * 1. running 任务（活跃录制器内存态优先，回落任务行）→ RunSummaryView
 * 2. 最近一个终态（succeeded/failed）且未领取（applied_at IS NULL）的任务
 *    → FinishedUnclaimedRunView（finishedUnclaimed: true）——覆盖"离开期间
 *    已完成/已失败"的恢复时序，结果经 /runs/:runId/events 取回后由前端 ack
 * 3. 都没有 → null
 */
export function getActiveRunView(
  projectId: string,
  userId: string,
): RunSummaryView | FinishedUnclaimedRunView | null {
  for (const recorder of activeRecorders.values()) {
    const snap = recorder.snapshot();
    if (snap.status === 'running' && snap.projectId === projectId && snap.userId === userId) {
      const recent = snap.events.slice(-5).map((e) => ({ seq: e.seq, type: e.type }));
      return {
        runId: snap.runId,
        projectId: snap.projectId,
        status: snap.status,
        stage: snap.stage,
        startedAt: getRunRow(snap.runId)?.createdAt ?? new Date().toISOString(),
        latestSeq: snap.latestSeq,
        recentEvents: recent,
      };
    }
  }
  const runningRow = findRunningRun(projectId, userId);
  if (runningRow) {
    return {
      runId: runningRow.runId,
      projectId: runningRow.projectId,
      status: runningRow.status,
      stage: runningRow.stage,
      startedAt: runningRow.createdAt,
      latestSeq: runningRow.events.length > 0 ? (runningRow.events[runningRow.events.length - 1]?.seq ?? 0) : 0,
      recentEvents: runningRow.events.slice(-5).map((e) => ({ seq: e.seq, type: e.type })),
    };
  }

  const unclaimedRow = stmtFindUnclaimedTerminal.get(projectId, userId) as GenerationsRawRow | undefined;
  if (unclaimedRow) {
    const row = toRunRow(unclaimedRow);
    return {
      runId: row.runId,
      projectId: row.projectId,
      status: row.status,
      stage: row.stage,
      startedAt: row.createdAt,
      latestSeq: row.events.length > 0 ? (row.events[row.events.length - 1]?.seq ?? 0) : 0,
      recentEventTypes: row.events.slice(-5).map((e) => e.type),
      finishedUnclaimed: true,
    };
  }

  return null;
}

/**
 * /runs/:runId/events：任务回放视图（seq > after 的事件 + 当前状态）。
 * @returns 视图；任务不存在或不属于该用户时返回 null
 */
export function getRunReplayView(runId: string, userId: string, after: number): RunReplayView | null {
  const recorder = activeRecorders.get(runId);
  if (recorder) {
    const snap = recorder.snapshot();
    if (snap.userId !== userId) return null;
    return {
      runId: snap.runId,
      status: snap.status,
      stage: snap.stage,
      events: snap.events.filter((e) => e.seq > after),
      resultFiles: snap.status === 'succeeded' ? parseResultFiles(snap.resultFilesRaw) : null,
      error: snap.error,
    };
  }
  const row = getRunRow(runId);
  if (!row || row.userId !== userId) return null;
  return {
    runId: row.runId,
    status: row.status,
    stage: row.stage,
    events: row.events.filter((e) => e.seq > after),
    resultFiles: row.status === 'succeeded' ? parseResultFiles(row.resultFilesRaw) : null,
    error: row.error,
  };
}
