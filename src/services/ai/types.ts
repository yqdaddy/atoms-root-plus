/**
 * AI 服务层共享契约：生成状态机、流式事件协议、生成结果与引擎接口。
 * 协议规范：docs/tech-ai-pipeline.md 第 1 节（状态机）与第 3 节（流式事件协议）。
 * 本文件是 Live / Demo 双引擎与前端 store 之间的唯一协议真源，双方只依赖此处导出的类型。
 */

/** 流水线执行阶段，由 stage 事件携带 */
export type PipelineStage = 'analyzing' | 'generating' | 'reviewing';

/** 生成状态机全量状态：idle → analyzing → generating → reviewing → done / error */
export type GenerationStatus = 'idle' | PipelineStage | 'done' | 'error';

/** delta 流的渲染位置：analyze 进聊天思考区，generate / repair 进代码面板 */
export type DeltaPhase = 'analyze' | 'generate' | 'repair';

/** 错误码，语义与降级动作见 docs/tech-ai-pipeline.md 第 5 节降级矩阵 */
export type ErrorCode =
  | 'NETWORK_TIMEOUT'
  | 'RATE_LIMITED'
  | 'TRUNCATED'
  | 'PARSE_FAILED'
  | 'AUTH_FAILED'
  | 'CORS_BLOCKED'
  | 'CANCELLED';

/** 引擎模式：live 为真实 LLM（BYOK），demo 为本地模板演示 */
export type EngineMode = 'live' | 'demo';

/** 分析师产出的功能条目 */
export interface FeatureItem {
  id: string;
  name: string;
  description: string;
  priority: 'must' | 'nice';
}

/** 分析师产出的功能清单 JSON 契约（docs/tech-ai-pipeline.md 2.1） */
export interface FeatureList {
  appTitle: string;
  appType: string;
  summary: string;
  features: FeatureItem[];
  interactions: string[];
  assumptions: string[];
}

/** 审查者产出的单条检查结论 */
export interface ReviewCheck {
  item: string;
  pass: boolean;
  note: string;
}

/** 审查者产出的审查结论 JSON 契约（docs/tech-ai-pipeline.md 2.3） */
export interface ReviewVerdict {
  pass: boolean;
  checks: ReviewCheck[];
  repairInstructions: string[];
}

/* ---------------- 流式事件协议 ---------------- */

/** stage 事件负载：阶段迁移提示，message 可直接展示给用户 */
export interface StageEventPayload {
  runId: string;
  stage: PipelineStage;
  /** 第几轮，1 起始；修复轮为 2 */
  attempt: number;
  message: string;
  /** 附加信息，如 repairReason、matchedTemplate */
  meta?: Record<string, unknown>;
}

/** delta 事件负载：原始增量文本，消费方只做追加，不解析 */
export interface DeltaEventPayload {
  runId: string;
  phase: DeltaPhase;
  text: string;
}

/** 一次生成的统计信息 */
export interface GenerateStats {
  mode: EngineMode;
  /** provider 未回填 usage 时为本地估算值 */
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** 实际执行轮数（含修复轮） */
  rounds: number;
}

/** done 事件负载：最终交付结果 */
export interface GenerateResult {
  runId: string;
  /** 最终完整单文件 HTML（向后兼容） */
  html: string;
  /** 多文件结构（可选，多文件模式时存在） */
  files?: Record<string, { path: string; content: string; language: string; updatedAt: string }>;
  /** 软性问题警告，如「内容被截断，已按可用部分交付」 */
  warnings: string[];
  stats: GenerateStats;
}

/** error 事件负载。message 为面向用户的中文文案，禁止包含 API key */
export interface ErrorEventPayload {
  runId: string;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  /** true 时前端应展示「改用演示模式」入口 */
  fallbackToDemo: boolean;
  /** 原始错误信息，仅调试面板展示 */
  detail?: string;
}

/** approval_required 事件负载：分析完成，等待用户批准 */
export interface ApprovalRequiredPayload {
  runId: string;
  sessionId: string;
  /** 分析结果原始 JSON 字符串 */
  analysis: string;
  /** 解析后的功能清单 */
  features: FeatureList | { raw: string };
}

/**
 * 统一流式事件信封。
 * 时序约定：一个 run 内事件严格有序；done 与 error 互斥且必为末事件；
 * delta.phase 与当前 stage 对应（repair 阶段的 delta 属于 generating 态的 attempt=2）。
 * approval_required 表示分析完成，等待用户批准后继续。
 */
export type StreamEvent =
  | { type: 'stage'; payload: StageEventPayload }
  | { type: 'delta'; payload: DeltaEventPayload }
  | { type: 'approval_required'; payload: ApprovalRequiredPayload }
  | { type: 'done'; payload: GenerateResult }
  | { type: 'error'; payload: ErrorEventPayload };

export type StreamEventHandler = (event: StreamEvent) => void;

/* ---------------- 事件构造器（双引擎共用，保证信封形状单一真源） ---------------- */

export function makeStageEvent(
  runId: string,
  stage: PipelineStage,
  attempt: number,
  message: string,
  meta?: Record<string, unknown> | undefined,
): StreamEvent {
  const payload: StageEventPayload = { runId, stage, attempt, message };
  if (meta !== undefined) {
    payload.meta = meta;
  }
  return { type: 'stage', payload };
}

export function makeDeltaEvent(runId: string, phase: DeltaPhase, text: string): StreamEvent {
  return { type: 'delta', payload: { runId, phase, text } };
}

export function makeErrorEvent(
  runId: string,
  code: ErrorCode,
  message: string,
  retryable: boolean,
  fallbackToDemo: boolean,
  detail?: string | undefined,
): StreamEvent {
  const payload: ErrorEventPayload = { runId, code, message, retryable, fallbackToDemo };
  if (detail !== undefined) {
    payload.detail = detail;
  }
  return { type: 'error', payload };
}

/* ---------------- 状态机迁移 ---------------- */

/**
 * 合法迁移表（docs/tech-ai-pipeline.md 1.2 / 1.3）：
 * - generating → generating 为审查或硬校验失败触发的修复轮（attempt=2）
 * - done → analyzing 为用户对话迭代修改
 * - error → idle 由用户点击重试触发，不发事件
 */
const LEGAL_TRANSITIONS: Readonly<Record<GenerationStatus, readonly GenerationStatus[]>> = {
  idle: ['analyzing'],
  analyzing: ['generating', 'error'],
  generating: ['reviewing', 'generating', 'error'],
  reviewing: ['done', 'generating', 'error'],
  done: ['analyzing'],
  error: ['idle'],
};

export function canTransition(from: GenerationStatus, to: GenerationStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/* ---------------- 迭代选项与引擎接口 ---------------- */

/** 迭代生成的可选上下文，由调用方从当前项目状态提取后传入 */
export interface GenerateOptions {
  /** 此前应用的一句话摘要，填入分析师模板的 {{RECENT_CONTEXT}} */
  recentContext?: string;
  /**
   * 当前最新完整 HTML。提供时工程师阶段改用修复模板（{{CURRENT_HTML}} 全量重生成，
   * 抑制无谓改动），对应 docs/tech-ai-pipeline.md 4.2 的迭代策略。
   */
  currentHtml?: string;
}

/** 双引擎共同接口：同一事件协议，前端不感知引擎差异 */
export interface AIEngine {
  readonly mode: EngineMode;
  generateStream(prompt: string, onEvent: StreamEventHandler, options?: GenerateOptions): Promise<void>;
  cancelGeneration(): void;
}

/** 对 UI 层暴露的生成 API（frontend-developer 消费此契约） */
export interface AIGenerationAPI {
  generateStream(prompt: string, onEvent: StreamEventHandler, options?: GenerateOptions): Promise<void>;
  cancelGeneration(): void;
  isDemoMode(): boolean;
}
