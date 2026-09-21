/**
 * AI 服务层共享契约：生成状态机、流式事件协议、生成结果与引擎接口。
 * 协议规范：docs/tech-ai-pipeline.md 第 1 节（状态机）与第 3 节（流式事件协议）。
 * 本文件是 Live / Demo 双引擎与前端 store 之间的唯一协议真源，双方只依赖此处导出的类型。
 */

/** 意图类型：创建 / 修改 / 分析 / 诊断 */
export type IntentType = 'create' | 'modify' | 'analyze' | 'diagnose';

/** 意图识别结果 */
export interface IntentResult {
  type: IntentType;
  confidence: number;
  reasoning: string;
}

/** 单行编辑操作（diff 模式） */
export interface FileEdit {
  /** 行号（1-indexed） */
  line: number;
  /** 原行内容（必须精确匹配，包括缩进） */
  old: string;
  /** 新行内容 */
  new: string;
  /** 操作类型 */
  type: 'replace' | 'insert' | 'delete';
}

/** 单个文件的变更集合（diff 模式） */
export interface FileChange {
  /** 文件路径 */
  file: string;
  /** 编辑操作列表 */
  edits: FileEdit[];
}

/** 变更清单（工程师 diff 输出格式） */
export interface ChangeList {
  /** 变更列表 */
  changes: FileChange[];
  /** 变更摘要 */
  summary: string;
}

/** 流水线执行阶段，由 stage 事件携带 */
export type PipelineStage = 'analyzing' | 'generating' | 'reviewing';

/** 生成状态机全量状态：idle → analyzing → generating → reviewing → done / error */
export type GenerationStatus = 'idle' | PipelineStage | 'done' | 'error';

/** delta 流的渲染位置：analyze / diagnose 进聊天思考区，generate / repair 进代码面板 */
export type DeltaPhase = 'analyze' | 'generate' | 'repair' | 'diagnose';

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
  /** 意图识别结果（仅首个 stage 事件携带） */
  intent?: IntentResult;
}

/** delta 事件负载：增量文本与可选的文件操作信息（工具参数流式渲染） */
export interface DeltaEventPayload {
  runId: string;
  phase: DeltaPhase;
  text: string;
  /** 正在操作的文件路径（可选；缺省时前端从累积文本推断） */
  fileName?: string;
  /** 操作类型：create 新建 / modify 修改（可选） */
  operation?: 'create' | 'modify';
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
  /**
   * 分析/诊断结果文本（可选）。
   * 意图为 analyze 或 diagnose 时，done 不携带代码，只携带本字段；
   * 消费方应将其作为 assistant 消息展示，而不是视为空产物报错。
   */
  analysis?: string;
  /**
   * 变更清单（diff 模式 done 事件携带）。
   * 存在时前端应显示 DiffViewer 供用户确认后再应用 files。
   */
  changes?: ChangeList;
  /** 变更摘要（diff 模式 done 事件携带，与 changes.summary 一致） */
  changeSummary?: string;
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

/** 对话轮次（用于多轮上下文传递） */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 迭代生成的可选上下文，由调用方从当前项目状态提取后传入 */
export interface GenerateOptions {
  /** 此前应用的一句话摘要（遗留字段，后端未使用） */
  recentContext?: string;
  /**
   * 当前最新完整 HTML。提供时工程师阶段改用修复模板（{{CURRENT_HTML}} 全量重生成，
   * 抑制无谓改动），对应 docs/tech-ai-pipeline.md 4.2 的迭代策略。
   */
  currentHtml?: string;
  /**
   * 当前项目文件（多文件模式）。提供时服务端按迭代模式处理，保留未变更文件。
   */
  currentFiles?: Record<string, { path: string; content: string; language: string }>;
  /**
   * 多轮对话上下文：最近的对话轮次（用户 + 助手交替）。
   * 服务端从中选取最近 N 条用户指令构建上下文块。
   */
  chatTurns?: readonly ChatTurn[];
  /**
   * 原始需求（首次用户输入），用于在上下文中标注"用户最初需求"。
   */
  originalRequest?: string;
  /**
   * 强制指定意图（可选）。缺省时服务端自动识别（关键词 + 项目状态）。
   * 前端可在识别结果提示中提供"改为此意图"的纠正入口，透传该字段。
   * 白名单：'create' | 'modify' | 'analyze' | 'diagnose'，非法值被服务端丢弃。
   */
  intentOverride?: 'create' | 'modify' | 'analyze' | 'diagnose';
  /**
   * 项目偏好记忆（可选）。从 localStorage 读取后传入，服务端注入工程师 prompt。
   */
  preferences?: Array<{
    type: string;
    key: string;
    value: string;
    reason?: string;
  }>;
  /**
   * 全局偏好记忆（可选，跨项目生效）。从 localStorage['atoms:global-preferences'] 读取后传入，
   * 服务端注入分析师和工程师 prompt。
   */
  globalPreferences?: {
    defaultFramework?: 'html' | 'react-cdn' | 'vue-cdn';
    preferredLanguage?: 'zh' | 'en';
    namingStyle?: 'camelCase' | 'snake_case' | 'PascalCase';
    globalStyles?: string[];
    globalCorrections?: string[];
  };
  /**
   * 目标框架（可选）。缺省时服务端使用 html。
   * - html：纯 HTML + Tailwind CDN
   * - react-cdn：React 组件（JSX），浏览器内编译
   * - vue-cdn：Vue 单文件组件，浏览器内编译
   */
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
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
