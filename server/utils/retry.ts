/**
 * LLM API 调用重试框架。
 *
 * 设计思路参考 Claude Code withRetry：
 * - 错误分类：429/529/超时 → 自动重试；400 参数错 → 不重试
 * - 指数退避：500ms * 2^n 封顶 32s + 25% 随机抖动
 * - Retry-After 响应头优先
 * - 连续容量错误触发降级
 */

/** 基础退避时间（毫秒） */
const BASE_DELAY_MS = 500;

/** 最大退避时间（毫秒） */
const MAX_DELAY_MS = 32000;

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;

/** 连续容量错误上限（触发降级） */
const MAX_CAPACITY_ERRORS = 3;

/**
 * API 错误分类
 */
export enum APIErrorType {
  /** 可重试：服务器过载、限流、网络超时 */
  Retryable = 'retryable',
  /** 不可重试：参数错误、认证失败 */
  NonRetryable = 'non_retryable',
  /** 容量错误：需要降级 */
  Capacity = 'capacity',
}

/**
 * 分类 API 错误类型
 *
 * @param error - 错误对象
 * @returns 错误分类
 */
export function classifyAPIError(error: unknown): APIErrorType {
  if (!(error instanceof Error)) {
    return APIErrorType.NonRetryable;
  }

  // 网络错误（连接失败、超时）
  if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
    return APIErrorType.Retryable;
  }

  // 从错误信息提取状态码
  const statusMatch = error.message.match(/HTTP (\d+)/);
  if (!statusMatch) {
    // 无状态码：可能是网络错误或解析错误，保守重试
    return APIErrorType.Retryable;
  }

  const status = parseInt(statusMatch[1], 10);

  // 429 限流
  if (status === 429) {
    return APIErrorType.Capacity;
  }

  // 529 服务过载
  if (status === 529) {
    return APIErrorType.Capacity;
  }

  // 5xx 服务器错误
  if (status >= 500) {
    return APIErrorType.Retryable;
  }

  // 408 请求超时
  if (status === 408) {
    return APIErrorType.Retryable;
  }

  // 400 参数错误
  if (status === 400) {
    // 特例：max_tokens 上下文溢出可重试（降额后重试）
    if (error.message.includes('context limit') || error.message.includes('max_tokens')) {
      return APIErrorType.Retryable;
    }
    return APIErrorType.NonRetryable;
  }

  // 其他 4xx 错误不重试
  if (status >= 400 && status < 500) {
    return APIErrorType.NonRetryable;
  }

  return APIErrorType.NonRetryable;
}

/**
 * 从错误中提取 Retry-After 时间（毫秒）
 *
 * @param error - 错误对象
 * @returns Retry-After 毫秒数，无则返回 null
 */
function extractRetryAfter(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  // 尝试从错误信息中提取（假设响应头被包含在错误信息中）
  const retryAfterMatch = error.message.match(/retry-after[:\s]+(\d+)/i);
  if (retryAfterMatch) {
    const seconds = parseInt(retryAfterMatch[1], 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }

  return null;
}

/**
 * 计算重试延迟时间
 *
 * 策略：
 * 1. 优先使用 Retry-After 响应头
 * 2. 指数退避：500ms * 2^(attempt-1)，封顶 32s
 * 3. 加 25% 随机抖动避免惊群
 *
 * @param attempt - 当前尝试次数（从 1 开始）
 * @param error - 错误对象（可能包含 Retry-After）
 * @param maxDelayMs - 最大延迟（毫秒）
 * @returns 延迟毫秒数
 */
export function getRetryDelay(
  attempt: number,
  error?: unknown,
  maxDelayMs: number = MAX_DELAY_MS,
): number {
  // Retry-After 优先
  if (error) {
    const retryAfter = extractRetryAfter(error);
    if (retryAfter !== null) {
      return retryAfter;
    }
  }

  // 指数退避
  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  );

  // 25% 随机抖动
  const jitter = Math.random() * 0.25 * baseDelay;

  return baseDelay + jitter;
}

/**
 * 重试进度事件
 */
export interface RetryProgressEvent {
  /** 当前尝试次数 */
  attempt: number;
  /** 最大尝试次数 */
  maxRetries: number;
  /** 等待时间（毫秒） */
  delayMs: number;
  /** 错误消息 */
  errorMessage: string;
  /** 错误分类 */
  errorType: APIErrorType;
}

/**
 * 重试选项
 */
export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 最大延迟（毫秒，默认 32000） */
  maxDelayMs?: number;
  /** 进度回调 */
  onProgress?: (event: RetryProgressEvent) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 重试结果
 */
export interface RetryResult<T> {
  /** 最终结果 */
  result: T;
  /** 总尝试次数 */
  attempts: number;
  /** 是否触发降级 */
  degraded: boolean;
}

/**
 * 降级触发错误
 */
export class DegradationTriggeredError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly consecutiveErrors: number,
  ) {
    const message = originalError instanceof Error
      ? originalError.message
      : '连续容量错误，触发降级';
    super(message);
    this.name = 'DegradationTriggeredError';
  }
}

/**
 * 无法重试错误
 */
export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly errorType: APIErrorType,
  ) {
    const message = originalError instanceof Error
      ? originalError.message
      : '不可重试的错误';
    super(message);
    this.name = 'CannotRetryError';
  }
}

/**
 * 延迟函数
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('请求已取消'));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('请求已取消'));
    });
  });
}

/**
 * 带重试的异步操作包装器
 *
 * @param fn - 要执行的异步函数
 * @param options - 重试选项
 * @returns 异步结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    maxDelayMs = MAX_DELAY_MS,
    onProgress,
    signal,
  } = options;

  let lastError: unknown;
  let consecutiveCapacityErrors = 0;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // 检查取消
    if (signal?.aborted) {
      throw new Error('请求已取消');
    }

    try {
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;

      const errorType = classifyAPIError(error);

      // 不可重试：直接抛出
      if (errorType === APIErrorType.NonRetryable) {
        throw new CannotRetryError(error, errorType);
      }

      // 容量错误：累计并判断是否降级
      if (errorType === APIErrorType.Capacity) {
        consecutiveCapacityErrors++;

        if (consecutiveCapacityErrors >= MAX_CAPACITY_ERRORS) {
          throw new DegradationTriggeredError(error, consecutiveCapacityErrors);
        }
      }

      // 达到最大重试次数
      if (attempt > maxRetries) {
        throw new CannotRetryError(error, errorType);
      }

      // 计算延迟
      const delayMs = getRetryDelay(attempt, error, maxDelayMs);

      // 发送进度事件
      if (onProgress) {
        onProgress({
          attempt,
          maxRetries,
          delayMs,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorType,
        });
      }

      // 等待后重试
      await sleep(delayMs, signal);
    }
  }

  // 理论上不会到达这里
  throw new CannotRetryError(lastError, classifyAPIError(lastError));
}

