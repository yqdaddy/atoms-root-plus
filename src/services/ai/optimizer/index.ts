/**
 * 提示词优化器模块入口。
 * 将模糊的用户需求转化为结构化需求文档，供用户确认后进入三阶段流水线。
 * 设计文档：docs/tech-prompt-optimizer.md
 */

/* ---------------- 类型导出 ---------------- */
export type {
  AppType,
  OptimizerInput,
  OptimizedRequirement,
  ConfirmedRequirement,
  OptimizerConfig,
  CoreFeature,
  AuxFeature,
  DataField,
  DataEntity,
  DataModel,
  ThemeConfig,
  Assumption,
  OptimizerEventType,
  OptimizerStage,
  OptimizerStagePayload,
  OptimizerDeltaPayload,
  OptimizerDonePayload,
  OptimizerErrorPayload,
  OptimizerEvent,
  OptimizerEventHandler,
} from './types';
export { DEFAULT_OPTIMIZER_CONFIG } from './types';

/* ---------------- 核心逻辑导出 ---------------- */
export { PromptOptimizer, optimizeRequirement, cancelActiveOptimizer, hasActiveOptimizer } from './optimizer';

/* ---------------- Prompt 模板导出 ---------------- */
export {
  OPTIMIZER_SYSTEM_PROMPT,
  OPTIMIZER_USER_PROMPT_TEMPLATE,
  OPTIMIZER_ITERATION_CONTEXT_TEMPLATE,
  renderOptimizerUserPrompt,
  getTemplateHintText,
} from './prompt';

/* ---------------- 校验器导出 ---------------- */
export { validateOptimizerOutput, repairOptimizerOutput, OptimizerError } from './validator';