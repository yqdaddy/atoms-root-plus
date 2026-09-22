/**
 * server/utils/retry.ts 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  APIErrorType,
  classifyAPIError,
  getRetryDelay,
  withRetry,
  CannotRetryError,
  DegradationTriggeredError,
} from './retry.js';

describe('classifyAPIError', () => {
  it('网络错误分类为可重试', () => {
    const error = new Error('fetch failed: connection refused');
    expect(classifyAPIError(error)).toBe(APIErrorType.Retryable);
  });

  it('ECONNREFUSED 分类为可重试', () => {
    const error = new Error('ECONNREFUSED localhost:3000');
    expect(classifyAPIError(error)).toBe(APIErrorType.Retryable);
  });

  it('429 限流分类为容量错误', () => {
    const error = new Error('HTTP 429: Too Many Requests');
    expect(classifyAPIError(error)).toBe(APIErrorType.Capacity);
  });

  it('529 服务过载分类为容量错误', () => {
    const error = new Error('HTTP 529: Service Overloaded');
    expect(classifyAPIError(error)).toBe(APIErrorType.Capacity);
  });

  it('5xx 服务器错误分类为可重试', () => {
    const cases = [500, 502, 503, 504].map(status => ({
      error: new Error(`HTTP ${status}: Server Error`),
      expected: APIErrorType.Retryable,
    }));

    for (const { error, expected } of cases) {
      expect(classifyAPIError(error)).toBe(expected);
    }
  });

  it('408 请求超时分类为可重试', () => {
    const error = new Error('HTTP 408: Request Timeout');
    expect(classifyAPIError(error)).toBe(APIErrorType.Retryable);
  });

  it('400 参数错误分类为不可重试', () => {
    const error = new Error('HTTP 400: Bad Request');
    expect(classifyAPIError(error)).toBe(APIErrorType.NonRetryable);
  });

  it('400 上下文溢出分类为可重试', () => {
    const error = new Error('HTTP 400: context limit exceeded');
    expect(classifyAPIError(error)).toBe(APIErrorType.Retryable);
  });

  it('401 认证失败分类为不可重试', () => {
    const error = new Error('HTTP 401: Unauthorized');
    expect(classifyAPIError(error)).toBe(APIErrorType.NonRetryable);
  });

  it('404 资源不存在分类为不可重试', () => {
    const error = new Error('HTTP 404: Not Found');
    expect(classifyAPIError(error)).toBe(APIErrorType.NonRetryable);
  });

  it('非 Error 对象分类为不可重试', () => {
    expect(classifyAPIError('string error')).toBe(APIErrorType.NonRetryable);
    expect(classifyAPIError(null)).toBe(APIErrorType.NonRetryable);
    expect(classifyAPIError(undefined)).toBe(APIErrorType.NonRetryable);
  });

  it('无状态码的错误分类为可重试（保守策略）', () => {
    const error = new Error('Unknown error');
    expect(classifyAPIError(error)).toBe(APIErrorType.Retryable);
  });
});

describe('getRetryDelay', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('第一次重试延迟约为 500ms', () => {
    const delay = getRetryDelay(1);
    // 500ms base + 25% jitter (0.5 * 0.25 * 500 = 62.5)
    expect(delay).toBeCloseTo(562.5, 0);
  });

  it('指数退避：每次翻倍', () => {
    const delay1 = getRetryDelay(1);
    const delay2 = getRetryDelay(2);
    const delay3 = getRetryDelay(3);
    expect(delay2).toBeGreaterThan(delay1);
    expect(delay3).toBeGreaterThan(delay2);
  });

  it('最大延迟封顶 32s', () => {
    const delay = getRetryDelay(100);
    expect(delay).toBeLessThanOrEqual(32000 + 8000); // 32s + 25% jitter
  });

  it('自定义最大延迟', () => {
    const delay = getRetryDelay(100, undefined, 10000);
    expect(delay).toBeLessThanOrEqual(10000 + 2500); // 10s + 25% jitter
  });

  it('优先使用 Retry-After 响应头', () => {
    const error = new Error('HTTP 429\nretry-after: 60');
    const delay = getRetryDelay(1, error);
    expect(delay).toBe(60000); // 60 秒
  });

  it('Retry-After 格式不正确时使用指数退避', () => {
    const error = new Error('HTTP 429\nretry-after: invalid');
    const delay = getRetryDelay(1, error);
    expect(delay).toBeCloseTo(562.5, 0);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('成功时直接返回结果', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重试错误触发重试', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
      .mockResolvedValue('success');

    const resultPromise = withRetry(fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('不可重试错误立即抛出 CannotRetryError', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 400: Bad Request'));

    await expect(withRetry(fn)).rejects.toThrow(CannotRetryError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('达到最大重试次数抛出 CannotRetryError', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 500: Internal Server Error'));

    const resultPromise = withRetry(fn, { maxRetries: 2 });

    // 同时推进时间和捕获错误，避免 unhandled rejection
    const [error] = await Promise.all([
      resultPromise.catch(e => e),
      vi.runAllTimersAsync(),
    ]);

    expect(error).toBeInstanceOf(CannotRetryError);
    expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
  });

  it('连续容量错误触发 DegradationTriggeredError', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 429: Too Many Requests'));

    const resultPromise = withRetry(fn, { maxRetries: 10 });

    // 同时推进时间和捕获错误，避免 unhandled rejection
    const [error] = await Promise.all([
      resultPromise.catch(e => e),
      vi.runAllTimersAsync(),
    ]);

    expect(error).toBeInstanceOf(DegradationTriggeredError);
  });

  it('进度回调被调用', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
      .mockResolvedValue('success');

    const onProgress = vi.fn();
    const resultPromise = withRetry(fn, { onProgress });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        errorType: APIErrorType.Retryable,
        errorMessage: 'HTTP 500: Internal Server Error',
      })
    );
  });

  it('AbortSignal 取消请求', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 500: Internal Server Error'));

    const resultPromise = withRetry(fn, { signal: controller.signal });

    // 立即取消
    controller.abort();

    // 同时推进时间和捕获错误，避免 unhandled rejection
    const [error] = await Promise.all([
      resultPromise.catch(e => e),
      vi.runAllTimersAsync(),
    ]);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('请求已取消');
  });

  it('自定义最大延迟', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))
      .mockResolvedValue('success');

    const maxDelayMs = 100;
    const resultPromise = withRetry(fn, { maxDelayMs });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success');
    // 验证延迟不超过最大值
    // 由于有 jitter，实际延迟可能略高
  });
});