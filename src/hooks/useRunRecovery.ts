/**
 * useRunRecovery：后台生成任务恢复接入（PRD：docs/prd-background-runs.md F-003/F-004）。
 *
 * 挂载时（当前项目存在且已登录）查询活跃任务；存在则进入恢复流程：
 * 1. 复用现有"生成中"UI：chatStore.beginRecovery + 调用方的 isGenerating 开关；
 *    服务端 stage 经 STAGE_MAP 映射到现有进度条文案，时钟以服务端 startedAt 为准。
 * 2. 全量回放事件（after=0）：stage/delta 驱动进度与流式文本；
 *    done 交给调用方现有应用链路（updateFiles/saveVersion/addMessage）；
 *    clarification_required/engineer_pause 直接复用对应面板交互。
 * 3. 回放后任务仍在进行（状态非终态）：按 3s 轮询 events?after=<seq> 消费增量，直到终态。
 *
 * 轮询选型说明：/api/llm/runs/:runId/events 契约自带 after 游标，
 * 相比为恢复路径重建一条 SSE 连接，轮询实现更简单、对网络抖动天然自愈、
 * 与并行开发中的后端契约耦合面最小；3s 的展示延迟对流式文本累积可接受。
 *
 * 防护约定：
 * - 回放完成前调用方处于"生成中"状态，输入被禁用，天然禁止重复发起生成；
 * - 用户通过澄清面板、工程师继续、意图纠正等入口接管生成（实时通道自建 SSE）前，
 *   必须先调用 suspend() 暂停轮询，避免 done 被轮询与实时两条通道各应用一次；
 * - 已在本机应用过结果的 runId 记录在 localStorage，重复进入项目不重复回放；
 * - 终态未领取任务（finishedUnclaimed，BLOCKER-001）：回放应用（成功落盘或失败展示）
 *   后调用 ack 领取，与 localStorage 去重构成双保险，防止清缓存或换设备后重复弹出恢复；
 * - 恢复终态兜底：done 应用后对话区仍无本 run 的 AI 消息时按回放摘要或固定文案补一条
 *   （MAJOR-002）；项目状态仍卡在 generating 时按入口文件校验语义收口为 ready/draft
 *   （MINOR-003）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ackRun,
  cancelRun,
  fetchActiveRun,
  fetchRunEvents,
  type ActiveRunInfo,
  type RunEventRecord,
  type RunEventsResult,
} from '../services/ai/runRecovery';
import { processSSEEvent, STAGE_MAP, type RunIdRef } from '../services/ai/liveEngine';
import { validateGeneratedHtml } from '../services/ai';
import type { PipelineStage, StreamEvent } from '../services/ai/types';
import { ApiError } from '../services/apiClient';
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import { ENTRY_FILE_PATH } from '../types/project';
import { toast } from '../components/Toast';

/** 增量轮询间隔 */
const POLL_INTERVAL_MS = 3000;
/** 连续轮询失败上限：超过后放弃接续（服务端任务不受影响，重进项目可再次恢复） */
const MAX_POLL_FAILURES = 10;

/**
 * 终态判定：仅命中已知终态词才停止轮询，未知状态一律视为进行中继续轮询。
 * 后端实际值（server/runs.ts）：running / succeeded / failed / cancelled；
 * 其余别名用于容错后端演进。
 */
const SUCCESS_STATUS = new Set(['succeeded', 'done', 'completed', 'success', 'finished']);
const FAILURE_STATUS = new Set(['failed', 'error', 'cancelled', 'canceled', 'terminated']);

function isSuccessStatus(status: string): boolean {
  return SUCCESS_STATUS.has(status);
}

function isFailureStatus(status: string): boolean {
  return FAILURE_STATUS.has(status);
}

/**
 * 客户端占位 runId 前缀：demo 引擎（d_ 前缀）与 liveEngine/页面在本地的占位（run- 前缀）。
 * 这些 id 不存在于服务端任务表，不用于按 runId 的服务端取消与上报。
 */
const CLIENT_RUN_ID_PATTERNS: ReadonlyArray<RegExp> = [/^d_/, /^run-/];

function isServerRunId(runId: string): boolean {
  return !CLIENT_RUN_ID_PATTERNS.some((pattern) => pattern.test(runId));
}

/** 服务端 stage 原始值映射到前端流水线阶段（未知值回退 analyzing） */
function mapBackendStage(backendStage: string): PipelineStage {
  return STAGE_MAP[backendStage] ?? 'analyzing';
}

/**
 * active run stage 到恢复提示文案映射。
 * 等待点（状态保持 running 的暂停位置）单独给出准确文案；
 * 正常阶段回退到通用"正在恢复"由后续回放事件接管。
 */
function mapStageMessage(backendStage: string): string {
  switch (backendStage) {
    case 'waiting_approval':
      return '分析完成，等待批准后继续';
    case 'waiting_clarification':
      return '等待补充需求信息';
    case 'engineer_paused':
      return '生成已暂停，等待你的反馈';
    default:
      return '正在恢复生成进度...';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 已应用结果的 run 去重标记（localStorage 键） */
function appliedRunKey(projectId: string): string {
  return `litpp:applied-run:${projectId}`;
}

function readAppliedRunId(projectId: string): string | null {
  try {
    return localStorage.getItem(appliedRunKey(projectId));
  } catch {
    return null;
  }
}

function markRunApplied(projectId: string, runId: string): void {
  try {
    localStorage.setItem(appliedRunKey(projectId), runId);
  } catch {
    // localStorage 不可用（隐私模式）：跳过去重标记，仅可能重复回放一次
  }
}

/** 供取消使用的服务端 runId 持久化（sessionStorage，页面会话内有效） */
function persistServerRunId(projectId: string | null, runId: string | null): void {
  if (!projectId) return;
  try {
    if (runId) {
      sessionStorage.setItem(`litpp:server-run:${projectId}`, runId);
    } else {
      sessionStorage.removeItem(`litpp:server-run:${projectId}`);
    }
  } catch {
    // sessionStorage 不可用时跳过：取消退化为仅内存 runId
  }
}

function loadPersistedServerRunId(projectId: string | null): string | null {
  if (!projectId) return null;
  try {
    return sessionStorage.getItem(`litpp:server-run:${projectId}`);
  } catch {
    return null;
  }
}

/** 终态事件类别 */
type TerminalDispatch = 'done' | 'error';

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从 error 事件负载中提取失败原因（防御性解析，取不到时返回 null） */
function extractErrorMessage(payload: unknown): string | null {
  if (isRecordValue(payload)) {
    const message = payload.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return null;
}

/**
 * 恢复终态后的项目状态收口（MINOR-003）：
 * 上一会话把项目置为 generating 后页面中断，若恢复路径未能走到 done/error 的
 * 应用链路（放弃接续、任务消失等），状态会永远停留在生成中。
 * 这里按入口文件校验语义映射 ready/draft；仅处理卡在 generating 的项目，
 * 不触碰 ready/draft 等其他状态。
 */
function settleProjectStatusAfterTerminal(): void {
  const { currentProject, updateProjectStatus } = useProjectStore.getState();
  if (!currentProject || currentProject.status !== 'generating') return;
  const entryContent = currentProject.files[ENTRY_FILE_PATH]?.content ?? '';
  updateProjectStatus(validateGeneratedHtml(entryContent).ok ? 'ready' : 'draft');
}

/**
 * 应用完成后向服务端领取终态任务（BLOCKER-001）：
 * 服务端 finishedUnclaimed 标记依赖 ack 清除，与 litpp:applied-run 去重双保险。
 * 静默执行：领取失败仅导致下次进入项目时重复恢复一次，不阻塞当前流程。
 */
function ackRunQuietly(runId: string): void {
  if (!isServerRunId(runId)) return;
  void ackRun(runId);
}

/**
 * 恢复完成的消息兜底（MAJOR-002）：
 * done 的应用链路（调用方 handleStreamEvent）正常会写入 AI 消息，但恢复通道的
 * delta 是裁剪后的滚动摘要，存在拿不到任何文本的边界。done 应用后若对话区
 * 仍无本 run 的助手消息，按回放摘要或「离线期间生成已完成，共 N 个文件」补一条。
 */
function ensureRecoveredDoneMessage(runId: string): void {
  const { currentProject, addMessage } = useProjectStore.getState();
  if (!currentProject) return;
  const hasAssistantMessage = currentProject.chat.some(
    (message) => message.role === 'assistant' && message.runId === runId,
  );
  if (hasAssistantMessage) return;
  const buffer = useChatStore.getState().streamBuffer;
  const summaryText = [buffer.analyzeText, buffer.generateText]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');
  const fileCount = Object.keys(currentProject.files).length;
  addMessage({
    role: 'assistant',
    content: summaryText || `离线期间生成已完成，共 ${fileCount} 个文件。`,
    runId,
  });
}

/* ---------------- 对外类型 ---------------- */

/** 恢复流程阶段：idle 未恢复 / recovering 回放中 / attached 已接续轮询 / finished 终态收尾 */
export type RecoveryPhase = 'idle' | 'recovering' | 'attached' | 'finished';

export interface RecoveryState {
  phase: RecoveryPhase;
  /** 正在恢复/接续的任务 runId（null 表示无恢复任务） */
  runId: string | null;
  /** 任务以失败/终止告终：展示错误与重试入口 */
  failed: boolean;
  /** 失败原因（来自 error 事件或状态推断） */
  errorMessage: string | null;
}

/** 恢复回放事件的标记：消费方可据此区分提示文案（如「生成已完成」） */
export interface RecoveryEventMeta {
  recovered: boolean;
}

export interface UseRunRecoveryOptions {
  /** 当前项目 ID（null 时不启用恢复） */
  projectId: string | null;
  /** 总开关（登录态） */
  enabled: boolean;
  /**
   * 事件消费方：复用调用方的 handleStreamEvent（done/error/澄清/暂停链路）。
   * meta.recovered 为 true 表示事件来自恢复回放而非实时 SSE。
   */
  onEvent: (event: StreamEvent, meta?: RecoveryEventMeta) => void;
  /** 生成中 UI 开关（调用方的 isGenerating state） */
  onGeneratingChange: (generating: boolean) => void;
}

export interface UseRunRecoveryResult {
  state: RecoveryState;
  /** 是否接续着某个后台任务（恢复条/停止通道判断依据） */
  isRecoveryRunActive: boolean;
  /** 实时生成时上报服务端 runId（供停止时按 runId 取消；同时持久化到 sessionStorage） */
  reportRunId: (runId: string) => void;
  /** 停止恢复会话；cancelOnServer 为 true 时按 runId 调用服务端取消 */
  stop: (options?: { cancelOnServer?: boolean }) => Promise<void>;
  /**
   * 实时通道 done 收尾：以当前服务端 runId 写入本机去重标记（litpp:applied-run）
   * 并向服务端 ack 领取。实时路径原本不做任何去重标记，用户离开再回来时恢复通道
   * 按服务端 runId 查不到标记，会重复回放应用并补写逐字重复的 AI 消息（MAJOR-004）；
   * 写入后实时与恢复两条通道共用同一去重键。未拿到服务端 runId（事件未携带）时
   * 静默跳过，退回原有行为。
   */
  notifyRunFinished: () => void;
  /** 用户接管生成前调用：暂停轮询，避免与实时通道重复消费事件 */
  suspend: () => void;
  /** 关闭失败提示条 */
  dismissFailure: () => void;
}

const IDLE_STATE: RecoveryState = { phase: 'idle', runId: null, failed: false, errorMessage: null };

export function useRunRecovery(options: UseRunRecoveryOptions): UseRunRecoveryResult {
  const { projectId, enabled } = options;
  const [state, setState] = useState<RecoveryState>(IDLE_STATE);

  // 回调用 ref 持有：避免回调身份变化触发恢复会话重跑
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  });

  /** 会话代次：项目切换/卸载/suspend 时递增，使进行中的异步轮询失效 */
  const epochRef = useRef(0);
  const suspendedRef = useRef(false);
  /** 终态事件只应用一次（done 与 error 互斥且必为末事件；防御重复回放） */
  const terminalSeenRef = useRef(false);
  /** 服务端 runId（恢复任务或实时生成上报），供取消使用 */
  const serverRunIdRef = useRef<string | null>(null);

  /**
   * 单条回放记录转换为前端 StreamEvent。
   * resultFiles：本批次响应携带的完整结果（done 回放剥离了 files/html 重载荷，
   * 完整结果以响应顶层 resultFiles 为准，见 server/runs.ts stripHeavyPayload）。
   * 返回值：终态事件类别（done/error），非终态返回 null。
   */
  const dispatchRecord = useCallback((record: RunEventRecord, runId: string, resultFiles: RunEventsResult['resultFiles']): TerminalDispatch | null => {
    const { onEvent } = optionsRef.current;

    // approval_required：批准流程的断连语义不在本次改造范围（PRD 非目标），
    // 恢复时不触发 /approve 自动续跑（避免与轮询通道双通道消费 done），
    // 仅转为阶段提示保持 UI 活跃，任务推进以后续回放事件为准。
    if (record.type === 'approval_required') {
      if (terminalSeenRef.current) return null;
      onEvent(
        {
          type: 'stage',
          payload: { runId, stage: 'analyzing', attempt: 1, message: '分析完成，生成接续中...' },
        },
        { recovered: true },
      );
      return null;
    }

    // warning：软性警告不影响状态机（done.warnings 已含同等语义），记录日志后跳过
    if (record.type === 'warning') {
      console.info('[useRunRecovery] warning 事件', record.payload);
      return null;
    }

    // 其余类型复用 liveEngine 的 SSE 转换规则（stage/delta/done/error/retry/澄清/暂停一致）
    const runIdRef: RunIdRef = { current: runId };
    const converted = processSSEEvent(record.type, JSON.stringify(record.payload ?? {}), runIdRef);
    if (!converted) return null;

    // done 回放无重载荷：注入响应顶层 resultFiles，使现有 done 应用链路拿到完整结果
    let event = converted;
    if (event.type === 'done' && resultFiles) {
      const existingFiles = event.payload.files;
      event = {
        type: 'done',
        payload: existingFiles && Object.keys(existingFiles).length > 0
          ? event.payload
          : { ...event.payload, files: resultFiles },
      };
    }

    if (event.type === 'done' || event.type === 'error') {
      if (terminalSeenRef.current) return event.type;
      terminalSeenRef.current = true;
      if (event.type === 'done') {
        // 标记已应用：重复进入项目不重复回放（防止消息/版本重复入库）
        const pid = projectIdRef.current;
        if (pid) markRunApplied(pid, runId);
      }
    }
    onEvent(event, { recovered: true });
    return event.type === 'done' || event.type === 'error' ? event.type : null;
  }, []);

  /** 本地收尾：退出生成中 UI（不改变服务端任务） */
  const finishLocal = useCallback((toastMessage: string | null, failed: boolean, errorMessage: string | null) => {
    if (toastMessage) {
      if (failed) toast.error(toastMessage);
      else toast.info(toastMessage);
    }
    useChatStore.getState().finishGeneration();
    // 项目状态收口：不把 generating 带到下一次进入（MINOR-003）
    settleProjectStatusAfterTerminal();
    optionsRef.current.onGeneratingChange(false);
    setState({ phase: 'finished', runId: null, failed, errorMessage });
  }, []);

  /**
   * 恢复终态收尾：done 补 AI 消息兜底、向服务端领取、项目状态收口、退出恢复 UI。
   * done/error 的应用本身已由调用方现有链路（handleStreamEvent）完成，
   * 这里只负责跨缺陷修复的三件收尾事项。
   */
  const settleRecoveredTerminal = useCallback((runId: string, terminalType: TerminalDispatch, errorMessage: string | null): void => {
    const failed = terminalType === 'error';
    if (!failed) {
      // done：应用链路未产生助手消息时按回放摘要或固定文案补一条（MAJOR-002）
      ensureRecoveredDoneMessage(runId);
    }
    // 应用/展示完成后领取，防止下次进入重复弹出恢复（BLOCKER-001）
    ackRunQuietly(runId);
    // done/error 链路通常已更新项目状态，这里兜底收口仍卡在 generating 的项目（MINOR-003）
    settleProjectStatusAfterTerminal();
    // 完成即显式落盘：恢复通道与实时通道共用同一条持久化保障（RC3-BUG-001）
    useProjectStore.getState().flushProjectDetail();
    setState({
      phase: 'finished',
      runId: null,
      failed,
      errorMessage: failed ? (errorMessage ?? '后台生成任务失败') : null,
    });
  }, []);

  /** 恢复会话主体：全量回放 + 增量轮询直到终态 */
  const runRecoverySession = useCallback(async (token: number, run: ActiveRunInfo): Promise<void> => {
    const runId = run.runId;
    serverRunIdRef.current = runId;
    persistServerRunId(projectIdRef.current, runId);

    // 终态未领取任务（finishedUnclaimed）：离线期间已结束，回放只为应用结果，
    // 不展示"进行中"措辞，UI 引导语改为"应用结果"
    const isTerminalRun = isSuccessStatus(run.status) || isFailureStatus(run.status);

    // 1) 进入生成中 UI：stage 映射现有进度条文案，时钟以服务端 startedAt 为准；
    //    等待点 stage（waiting_approval 等）给出对应的暂停提示
    const startedAtMs = Date.parse(run.startedAt);
    useChatStore.getState().beginRecovery(
      runId,
      mapBackendStage(run.stage),
      Number.isNaN(startedAtMs) ? Date.now() : startedAtMs,
    );
    useChatStore.getState().updateStage(
      mapBackendStage(run.stage),
      1,
      isTerminalRun ? '正在应用离线期间完成的结果...' : mapStageMessage(run.stage),
    );
    optionsRef.current.onGeneratingChange(true);
    if (!isTerminalRun) {
      toast.info('检测到进行中的生成，已恢复进度');
    }
    setState({ phase: 'recovering', runId, failed: false, errorMessage: null });

    // 2) 全量回放（after=0），随后按需进入增量轮询
    let after = 0;
    let consecutiveFailures = 0;
    let attached = false;

    try {
      for (;;) {
        if (suspendedRef.current || epochRef.current !== token) return;

        let result: RunEventsResult;
        try {
          result = await fetchRunEvents(runId, after);
          consecutiveFailures = 0;
        } catch (fetchError) {
          // 任务不存在或无权访问（404/403）：任务已消失，立即放弃而非重试
          if (fetchError instanceof ApiError && (fetchError.status === 404 || fetchError.status === 403)) {
            console.warn('[useRunRecovery] 任务不存在或无权访问，放弃恢复');
            finishLocal(null, false, null);
            return;
          }
          // 网络抖动不终止恢复：等待后重试，连续失败达上限才放弃
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_POLL_FAILURES) {
            console.warn('[useRunRecovery] 连续拉取事件失败，放弃接续');
            finishLocal('生成进度连接中断，重新进入项目可再次恢复', false, null);
            return;
          }
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        if (suspendedRef.current || epochRef.current !== token) return;

        let terminalType: TerminalDispatch | null = null;
        let terminalErrorMessage: string | null = null;
        for (const record of result.events) {
          if (record.seq > after) after = record.seq;
          const dispatched = dispatchRecord(record, runId, result.resultFiles);
          if (dispatched) {
            terminalType = dispatched;
            if (dispatched === 'error') {
              terminalErrorMessage = extractErrorMessage(record.payload);
            }
            break;
          }
        }

        if (suspendedRef.current || epochRef.current !== token) return;

        if (terminalType) {
          settleRecoveredTerminal(runId, terminalType, terminalErrorMessage);
          return;
        }

        // 防御：状态已是终态但回放中无对应事件（事件被裁剪等后端边界）
        if (isSuccessStatus(result.status)) {
          if (result.resultFiles && Object.keys(result.resultFiles).length > 0) {
            // 有完整结果：合成 done 事件，走现有应用链路把文件落盘
            console.warn('[useRunRecovery] 任务已完成但未回放到 done 事件，按 resultFiles 合成');
            const dispatched = dispatchRecord(
              { seq: after, type: 'done', payload: {} },
              runId,
              result.resultFiles,
            );
            if (dispatched === 'done') {
              settleRecoveredTerminal(runId, 'done', null);
            } else {
              setState({ phase: 'finished', runId: null, failed: false, errorMessage: null });
            }
          } else {
            // 无可应用结果：仅提示完成，并领取任务避免下次重复弹出（结果已不可再得）
            finishLocal('生成已完成', false, null);
            ackRunQuietly(runId);
          }
          return;
        }
        if (isFailureStatus(result.status)) {
          const reason = result.error
            ?? (result.status === 'cancelled' || result.status === 'canceled'
              ? '后台生成任务已取消'
              : '后台生成任务失败');
          // 合成 error 事件，让现有错误链路展示消息（含重试入口）；
          // 终态标记由 dispatchRecord 内部维护
          dispatchRecord({ seq: after, type: 'error', payload: { message: reason } }, runId, null);
          settleRecoveredTerminal(runId, 'error', reason);
          return;
        }

        if (!attached) {
          attached = true;
          setState({ phase: 'attached', runId, failed: false, errorMessage: null });
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.warn('[useRunRecovery] 恢复流程异常', error);
      if (suspendedRef.current || epochRef.current !== token) return;
      finishLocal('恢复生成进度时出现异常，重新进入项目可再次恢复', false, null);
    }
  }, [dispatchRecord, finishLocal, settleRecoveredTerminal]);

  // 恢复入口：项目/登录态变化时重置会话；挂载时查询活跃任务
  useEffect(() => {
    // 作废上一轮会话并复位状态（项目切换、登录态变化、卸载）
    epochRef.current += 1;
    suspendedRef.current = false;
    terminalSeenRef.current = false;
    serverRunIdRef.current = null;
    setState(IDLE_STATE);

    if (!projectId || !enabled) return;
    // 本地已有生成在跑（用户刚发起）：不做恢复，避免双任务叠加
    if (useChatStore.getState().isGenerating) return;

    const token = epochRef.current;
    void (async () => {
      try {
        const run = await fetchActiveRun(projectId);
        if (epochRef.current !== token) return;
        if (!run) {
          // 无活跃任务：若项目状态仍卡在 generating（如后台任务已丢失），收口为 ready/draft
          settleProjectStatusAfterTerminal();
          return;
        }
        // 同一任务已在本机应用过结果（如刚完成时切换项目又切回）：跳过重复回放；
        // 若后端仍标记未领取（如上次 ack 失败），补发 ack 保证跨端或清缓存后不重复弹出
        if (readAppliedRunId(projectId) === run.runId) {
          if (run.finishedUnclaimed) ackRunQuietly(run.runId);
          // 防御性兜底（RC3-BUG-001）：标记已写但助手消息丢失的存量场景
          // （历史持久化部分失败），补写消息并显式落盘，否则去重会永久掩盖缺失
          const storeState = useProjectStore.getState();
          if (storeState.currentProject) {
            const hasAssistantMessage = storeState.currentProject.chat.some(
              (message) => message.role === 'assistant' && message.runId === run.runId,
            );
            if (!hasAssistantMessage) {
              ensureRecoveredDoneMessage(run.runId);
              storeState.flushProjectDetail();
            }
          }
          settleProjectStatusAfterTerminal();
          return;
        }
        await runRecoverySession(token, run);
      } catch (error) {
        console.warn('[useRunRecovery] 查询活跃任务失败', error);
      }
    })();

    return () => {
      // 卸载时作废会话，轮询停止
      epochRef.current += 1;
    };
  }, [projectId, enabled, runRecoverySession]);

  const reportRunId = useCallback((runId: string) => {
    if (!runId || !isServerRunId(runId) || serverRunIdRef.current === runId) return;
    serverRunIdRef.current = runId;
    persistServerRunId(projectIdRef.current, runId);
  }, []);

  const notifyRunFinished = useCallback(() => {
    const runId = serverRunIdRef.current;
    if (!runId || !isServerRunId(runId)) return;
    const pid = projectIdRef.current;
    if (pid) markRunApplied(pid, runId);
    ackRunQuietly(runId);
  }, []);

  const stop = useCallback(async (stopOptions?: { cancelOnServer?: boolean }): Promise<void> => {
    // 作废轮询并复位恢复状态
    epochRef.current += 1;
    suspendedRef.current = true;
    terminalSeenRef.current = false;
    setState(IDLE_STATE);

    // 取消通道：优先内存 runId（本页发起或恢复所得），回退 sessionStorage（刷新前记录）
    const runId = serverRunIdRef.current ?? loadPersistedServerRunId(projectIdRef.current);
    serverRunIdRef.current = null;
    persistServerRunId(projectIdRef.current, null);
    if (stopOptions?.cancelOnServer && runId) {
      const ok = await cancelRun(runId);
      if (!ok) {
        toast.error('停止请求未送达，生成可能仍在后台进行');
      }
    }
  }, []);

  const suspend = useCallback(() => {
    epochRef.current += 1;
    suspendedRef.current = true;
    terminalSeenRef.current = false;
    setState(IDLE_STATE);
  }, []);

  const dismissFailure = useCallback(() => {
    setState((prev) => (prev.phase === 'finished' ? IDLE_STATE : prev));
  }, []);

  return {
    state,
    isRecoveryRunActive:
      !state.failed && (state.phase === 'recovering' || state.phase === 'attached'),
    reportRunId,
    stop,
    notifyRunFinished,
    suspend,
    dismissFailure,
  };
}
