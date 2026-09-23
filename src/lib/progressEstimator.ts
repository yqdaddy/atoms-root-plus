/**
 * 智能进度估计系统（F-001）
 * 基于预估时间计算进度条，而非固定阶段百分比
 *
 * 核心原则：
 * - 进度条封顶 97%，永不达到 100%
 * - 显示运行时钟和预估时间范围
 * - 基于实际耗时和预估时间计算进度
 */

/** 默认预估时间常量（毫秒） */
export const RUN_ESTIMATE_MS = 10 * 60_000; // 默认 10 分钟
export const RUN_ESTIMATE_MIN_MS = 4 * 60_000; // 最小 4 分钟

/** 进度条封顶值 */
export const PROGRESS_CEILING = 0.97;

/** 意图类型预估值（前端 fallback，毫秒） */
export const INTENT_ESTIMATE_MS: Record<string, number> = {
  create: 60_000, // 创建：1 分钟
  modify: 30_000, // 修改：30 秒
  analyze: 20_000, // 分析：20 秒
  diagnose: 15_000, // 诊断：15 秒
  conversation: 10_000, // 对话：10 秒
};

/** 进度计算结果 */
export interface ProgressResult {
  /** 进度比例（0 - 0.97） */
  ratio: number;
  /** 进度百分比（0 - 97） */
  percent: number;
  /** 是否超时 */
  overrun: boolean;
  /** 预估时间范围（分钟） */
  estimateRange: {
    min: number;
    max: number;
  };
}

/**
 * 计算生成进度
 * @param elapsedMs 已用时间（毫秒）
 * @param estimateMs 预估时间（毫秒），可选，默认使用 RUN_ESTIMATE_MS
 * @returns 进度计算结果
 */
export function calculateProgress(
  elapsedMs: number,
  estimateMs?: number
): ProgressResult {
  const targetMs = estimateMs ?? RUN_ESTIMATE_MS;
  const minMs = RUN_ESTIMATE_MIN_MS;

  // 计算预估时间范围
  const estimateRange = {
    min: Math.round(minMs / 60_000), // 转换为分钟
    max: Math.round(targetMs / 60_000),
  };

  // 计算进度比例：elapsedMs / targetMs，但封顶在 97%
  const rawRatio = elapsedMs / targetMs;
  const ratio = Math.min(rawRatio, PROGRESS_CEILING);
  const percent = Math.round(ratio * 100);

  // 判断是否超时
  const overrun = elapsedMs > targetMs;

  return {
    ratio,
    percent,
    overrun,
    estimateRange,
  };
}

/**
 * 根据意图类型获取预估时间
 * @param intentType 意图类型
 * @returns 预估时间（毫秒）
 */
export function getEstimateByIntent(intentType?: string): number {
  if (!intentType) return RUN_ESTIMATE_MS;
  return INTENT_ESTIMATE_MS[intentType] ?? RUN_ESTIMATE_MS;
}

/**
 * 格式化已用时间
 * @param ms 毫秒数
 * @returns 格式化后的时间字符串（如 "1:30" 表示 1 分 30 秒）
 */
export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}秒`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 格式化预估时间范围
 * @param min 最小分钟数
 * @param max 最大分钟数
 * @returns 格式化后的时间范围字符串（如 "4-10分钟"）
 */
export function formatEstimateRange(min: number, max: number): string {
  if (min === max) {
    return `${min}分钟`;
  }
  return `${min}-${max}分钟`;
}

/**
 * 卡住检测配置（F-005）
 */
export const STUCK_AFTER_MS = 15 * 60_000; // 15 分钟
export const STUCK_MAX_STEPS = 2; // 最多 2 个步骤

/**
 * 检测生成是否卡住
 * @param elapsedMs 已用时间（毫秒）
 * @param stepCount 步骤数
 * @param isRunning 是否正在生成
 * @returns 是否卡住
 */
export function looksStuck(
  elapsedMs: number,
  stepCount: number,
  isRunning: boolean
): boolean {
  if (!isRunning) return false;
  if (elapsedMs < STUCK_AFTER_MS) return false;
  return stepCount <= STUCK_MAX_STEPS;
}