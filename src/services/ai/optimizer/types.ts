/**
 * 提示词优化器类型定义。
 * 来源：docs/tech-prompt-optimizer.md 第 3 节。
 */

/** 应用类型枚举 */
export type AppType = 'dashboard' | 'landing' | 'todo' | 'chart' | 'tool' | 'game' | 'other';

/** 优化器输入 */
export interface OptimizerInput {
  /** 用户原始需求 */
  userPrompt: string;
  /** 用户选择的模板类型（可选） */
  templateHint?: AppType;
  /** 界面文案语言 */
  locale: 'zh-CN' | 'en';
  /** 迭代上下文（可选）：如果有现有应用，提供其信息 */
  existingContext?: {
    /** 现有应用的标题 */
    title: string;
    /** 现有应用的摘要 */
    summary: string;
    /** 现有应用的功能列表 */
    features: string[];
  };
}

/** 核心功能 */
export interface CoreFeature {
  id: string;
  name: string;
  description: string;
  ui: string;
  interactions: string[];
}

/** 辅助功能 */
export interface AuxFeature {
  id: string;
  name: string;
  description: string;
}

/** 数据字段 */
export interface DataField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
}

/** 数据实体 */
export interface DataEntity {
  name: string;
  fields: DataField[];
}

/** 数据模型 */
export interface DataModel {
  entities: DataEntity[];
  storageKey: string;
}

/** 主题配置 */
export interface ThemeConfig {
  primary: string;
  tone: 'light' | 'dark' | 'auto';
}

/** 假设 */
export interface Assumption {
  assumption: string;
  reason: string;
}

/** 提示词优化器输出 */
export interface OptimizedRequirement {
  /** 应用标题 */
  appTitle: string;
  /** 应用类型 */
  appType: AppType;
  /** 一句话概述 */
  summary: string;
  /** 核心功能列表 */
  coreFeatures: CoreFeature[];
  /** 辅助功能列表 */
  auxFeatures: AuxFeature[];
  /** 数据结构定义 */
  dataModel: DataModel;
  /** 布局描述 */
  uiLayout: string;
  /** 主题配置 */
  theme: ThemeConfig;
  /** 假设列表 */
  assumptions: Assumption[];
  /** 需要确认的问题 */
  questions: string[];
}

/** 用户确认后的需求文档（传递给三阶段流水线） */
export interface ConfirmedRequirement {
  /** 原始用户输入 */
  originalPrompt: string;
  /** 优化后的需求文档 */
  optimized: OptimizedRequirement;
  /** 用户是否进行了手动编辑 */
  userEdited: boolean;
  /** 用户编辑的内容（如果有） */
  editNotes?: string;
}

/** 优化器配置 */
export interface OptimizerConfig {
  /** 使用的模型（小型模型节省成本） */
  model: string;
  /** 最大输出 token */
  maxTokens: number;
  /** 温度 */
  temperature: number;
  /** 超时时间（毫秒） */
  timeout: number;
}

/** 优化器默认配置 */
export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  model: 'gpt-4o-mini',
  maxTokens: 2048,
  temperature: 0.3,
  timeout: 30000,
};

/** 优化器事件类型 */
export type OptimizerEventType = 'optimizer_stage' | 'optimizer_delta' | 'optimizer_done' | 'optimizer_error';

/** 优化器阶段 */
export type OptimizerStage = 'optimizing' | 'confirming';

/** 优化器 stage 事件负载 */
export interface OptimizerStagePayload {
  runId: string;
  stage: OptimizerStage;
  message: string;
}

/** 优化器 delta 事件负载 */
export interface OptimizerDeltaPayload {
  runId: string;
  text: string;
}

/** 优化器完成事件负载 */
export interface OptimizerDonePayload {
  runId: string;
  result: OptimizedRequirement;
}

/** 优化器错误事件负载 */
export interface OptimizerErrorPayload {
  runId: string;
  code: 'PARSE_FAILED' | 'INVALID_STRUCTURE' | 'INVALID_TITLE' | 'INVALID_TYPE' | 'INVALID_FEATURES' | 'EMPTY_OUTPUT' | 'NETWORK_ERROR' | 'TIMEOUT' | 'CANCELLED';
  message: string;
  retryable: boolean;
}

/** 优化器事件 */
export type OptimizerEvent =
  | { type: 'optimizer_stage'; payload: OptimizerStagePayload }
  | { type: 'optimizer_delta'; payload: OptimizerDeltaPayload }
  | { type: 'optimizer_done'; payload: OptimizerDonePayload }
  | { type: 'optimizer_error'; payload: OptimizerErrorPayload };

/** 优化器事件处理器 */
export type OptimizerEventHandler = (event: OptimizerEvent) => void;