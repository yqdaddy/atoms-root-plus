/**
 * 提示词优化器核心逻辑。
 * 调用后端 /api/llm/optimize 端点做需求澄清，解析 SSE 事件流，校验 JSON 输出。
 * 架构与 liveEngine 一致：后端代理模式，前端只负责请求、流解析与取消。
 */

import { apiFetch } from '../../apiClient';
import {
  type OptimizerInput,
  type OptimizedRequirement,
  type OptimizerConfig,
  type OptimizerEventHandler,
} from './types';
import { DEFAULT_OPTIMIZER_CONFIG } from './types';
import { validateOptimizerOutput, OptimizerError } from './validator';

/* ---------------- 模块级取消注册表（与 activeRun.ts 同一模式） ---------------- */

type CancelFn = () => void;

const optimizerRegistry: { current: CancelFn | null } = { current: null };

/**
 * 注册当前活动的优化器运行，返回注销函数。
 * 后注册的运行覆盖前一个；注销时只在「自己仍是当前运行」时清空。
 */
function registerActiveOptimizerRun(cancel: CancelFn): () => void {
  optimizerRegistry.current = cancel;
  let unregistered = false;
  return () => {
    if (unregistered) {
      return;
    }
    unregistered = true;
    if (optimizerRegistry.current === cancel) {
      optimizerRegistry.current = null;
    }
  };
}

/** 取消当前活动的优化器运行（若有）。重复调用安全 */
export function cancelActiveOptimizer(): void {
  const cancel = optimizerRegistry.current;
  optimizerRegistry.current = null;
  cancel?.();
}

/** 是否有正在进行的优化器运行 */
export function hasActiveOptimizer(): boolean {
  return optimizerRegistry.current !== null;
}

/* ---------------- SSE 解析 ---------------- */

/**
 * SSE 事件解析结果
 */
interface SSEEvent {
  eventType: string;
  data: string;
}

/**
 * 从 SSE 文本流中逐行提取事件。
 * 后端格式：`event: <type>\ndata: <json>\n\n`
 */
async function readSSEEvents(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  let currentEventType = '';
  let currentData = '';

  const flush = (): void => {
    if (currentEventType && currentData) {
      onEvent({ eventType: currentEventType, data: currentData });
    }
    currentEventType = '';
    currentData = '';
  };

  try {
    for (;;) {
      if (signal.aborted) {
        reader.cancel().catch(() => {});
        throw new OptimizerError('CANCELLED', '已取消优化');
      }

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) {
          throw new OptimizerError('CANCELLED', '已取消优化');
        }
        throw error;
      }

      if (chunk.done) {
        flush();
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData = line.slice(5).trim();
        } else if (line === '') {
          flush();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ---------------- 优化器 ---------------- */

/**
 * 提示词优化器（需求澄清师）。
 *
 * 用法：
 * ```ts
 * const optimizer = new PromptOptimizer();
 * const requirement = await optimizer.optimize(
 *   { userPrompt: '做一个番茄钟', locale: 'zh-CN' },
 *   (event) => { ... }, // 可选：流式事件回调
 * );
 * ```
 */
export class PromptOptimizer {
  private config: OptimizerConfig;

  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
  }

  /** 当前配置（只读副本） */
  getConfig(): Readonly<OptimizerConfig> {
    return { ...this.config };
  }

  /**
   * 优化用户需求，输出结构化文档。
   * @param input 用户输入
   * @param onEvent 流式事件回调（可选）
   * @returns 校验后的结构化需求文档
   * @throws OptimizerError 取消或校验失败时
   */
  async optimize(
    input: OptimizerInput,
    onEvent?: OptimizerEventHandler,
  ): Promise<OptimizedRequirement> {
    // 新优化请求隐式取消进行中的旧任务
    cancelActiveOptimizer();

    const controller = new AbortController();
    const unregister = registerActiveOptimizerRun(() => {
      controller.abort();
    });

    const runId = `opt-${Date.now()}`;

    try {
      onEvent?.({
        type: 'optimizer_stage',
        payload: {
          runId,
          stage: 'optimizing',
          message: '正在分析需求，补充细节…',
        },
      });

      console.log('[PromptOptimizer] 发起优化请求', {
        userPrompt: input.userPrompt.slice(0, 50),
        hasTemplateHint: Boolean(input.templateHint),
        hasExistingContext: Boolean(input.existingContext),
        locale: input.locale,
      });

      // 后端负责：组装 prompt（模板在后端有镜像副本）+ 调用 LLM + SSE 流式返回
      const response = await apiFetch('/api/llm/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userPrompt: input.userPrompt,
          templateHint: input.templateHint,
          locale: input.locale,
          existingContext: input.existingContext,
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
        signal: controller.signal,
      });

      console.log('[PromptOptimizer] 后端响应状态', response.status);

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        console.error('[PromptOptimizer] 后端错误', response.status, bodyText.slice(0, 200));

        const message = response.status >= 500
          ? '后端服务暂时不可用，请稍后重试'
          : `请求失败（HTTP ${response.status}）`;
        const retryable = response.status >= 500 || response.status === 429;

        onEvent?.({
          type: 'optimizer_error',
          payload: { runId, code: 'NETWORK_ERROR', message, retryable },
        });
        throw new OptimizerError('PARSE_FAILED', message);
      }

      if (!response.body) {
        console.error('[PromptOptimizer] 空响应体');
        onEvent?.({
          type: 'optimizer_error',
          payload: {
            runId,
            code: 'NETWORK_ERROR',
            message: '后端返回了空响应体',
            retryable: true,
          },
        });
        throw new OptimizerError('EMPTY_OUTPUT', '后端返回了空响应体');
      }

      // 流式解析：累积 delta 文本，结束后统一校验
      let rawOutput = '';

      await readSSEEvents(response, controller.signal, ({ eventType, data }) => {
        try {
          const payload = JSON.parse(data) as Record<string, unknown>;

          switch (eventType) {
            case 'delta': {
              const text = typeof payload.text === 'string' ? payload.text : '';
              rawOutput += text;
              onEvent?.({ type: 'optimizer_delta', payload: { runId, text } });
              break;
            }
            case 'error': {
              // 后端显式报错：立刻抛出，中断解析
              const message = typeof payload.message === 'string' && payload.message
                ? payload.message
                : '优化失败';
              throw new OptimizerError('PARSE_FAILED', message);
            }
            default:
              // stage / done 等事件由校验阶段统一收尾，此处忽略
              break;
          }
        } catch (error) {
          if (error instanceof OptimizerError) {
            throw error;
          }
          console.warn('[PromptOptimizer] 无法解析事件数据', data.slice(0, 200));
        }
      });

      // 输出校验
      try {
        const result = validateOptimizerOutput(rawOutput);

        onEvent?.({
          type: 'optimizer_stage',
          payload: {
            runId,
            stage: 'confirming',
            message: '需求分析完成，请确认',
          },
        });
        onEvent?.({
          type: 'optimizer_done',
          payload: { runId, result },
        });

        console.log('[PromptOptimizer] 优化完成', {
          appTitle: result.appTitle,
          appType: result.appType,
          coreFeatures: result.coreFeatures.length,
        });

        return result;
      } catch (error) {
        if (error instanceof OptimizerError) {
          // 区分取消与校验失败
          if (error.code === 'CANCELLED') {
            onEvent?.({
              type: 'optimizer_error',
              payload: { runId, code: 'CANCELLED', message: error.message, retryable: false },
            });
          } else {
            onEvent?.({
              type: 'optimizer_error',
              payload: { runId, code: error.code, message: error.message, retryable: true },
            });
          }
          throw error;
        }
        throw new OptimizerError('INVALID_STRUCTURE', '优化器输出校验失败');
      }
    } catch (error) {
      // 已发过事件的 OptimizerError 直接上抛
      if (error instanceof OptimizerError) {
        if (error.code === 'CANCELLED') {
          console.log('[PromptOptimizer] 用户取消');
        } else {
          console.error('[PromptOptimizer] 优化失败', error.message);
        }
        throw error;
      }

      // 网络层未预期异常
      console.error('[PromptOptimizer] 网络错误', error);
      const message = '无法连接后端服务，请检查网络或稍后重试';
      onEvent?.({
        type: 'optimizer_error',
        payload: { runId, code: 'NETWORK_ERROR', message, retryable: true },
      });
      throw new OptimizerError('PARSE_FAILED', message);
    } finally {
      unregister();
    }
  }
}

/* ---------------- 便捷函数 ---------------- */

/**
 * 一次姓优化入口：内部创建优化器实例并执行。
 */
export async function optimizeRequirement(
  input: OptimizerInput,
  onEvent?: OptimizerEventHandler,
): Promise<OptimizedRequirement> {
  const optimizer = new PromptOptimizer();
  return optimizer.optimize(input, onEvent);
}