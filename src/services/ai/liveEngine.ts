/**
 * 真实引擎（LivePipeline）：后端代理模式。
 * 调用本地后端 `/api/llm/generate` 端点，后端负责 LLM 调用与流水线编排。
 * 前端只负责：发起请求 + 解析 SSE 事件 + 取消控制。
 * 降级策略：后端不可用（网络错误、5xx）时由 index.ts 回退 demoEngine。
 */
import { cancelActiveRun, registerActiveRun } from './activeRun';
import {
  type AIEngine,
  type GenerateOptions,
  type StreamEventHandler,
  type StreamEvent,
} from './types';

/* ---------------- SSE 解析 ---------------- */

/**
 * 解析后端返回的 SSE 事件流。
 * 事件格式：
 *   event: stage
 *   data: {"runId":"r_xxx","stage":"analyzing",...}
 *
 *   event: delta
 *   data: {"runId":"r_xxx","phase":"analyze","text":"..."}
 *
 *   event: done
 *   data: {"runId":"r_xxx","html":"...",...}
 *
 *   event: error
 *   data: {"runId":"r_xxx","code":"...","message":"...",...}
 */
async function parseSSEStream(
  response: Response,
  onEvent: StreamEventHandler,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let chunkCount = 0;

  try {
    for (;;) {
      if (signal.aborted) {
        reader.cancel();
        return;
      }

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        throw error;
      }

      if (chunk.done) {
        console.log('[liveEngine] 流结束，共接收', chunkCount, '个数据块');
        break;
      }

      chunkCount += 1;
      buffer += decoder.decode(chunk.value, { stream: true });

      // 解析 SSE 行：每行格式为 "event: xxx\ndata: {...}\n\n"
      let eventEndIndex = buffer.indexOf('\n\n');
      while (eventEndIndex >= 0) {
        const eventBlock = buffer.slice(0, eventEndIndex);
        buffer = buffer.slice(eventEndIndex + 2);
        eventEndIndex = buffer.indexOf('\n\n');

        const lines = eventBlock.split('\n');
        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            eventData = line.slice(5).trim();
          }
        }

        if (eventType && eventData) {
          try {
            const payload = JSON.parse(eventData);
            // 根据事件类型构造对应的 StreamEvent
            let event: StreamEvent;
            switch (eventType) {
              case 'stage':
                event = { type: 'stage', payload };
                break;
              case 'delta':
                event = { type: 'delta', payload };
                break;
              case 'done':
                event = { type: 'done', payload };
                break;
              case 'error':
                event = { type: 'error', payload };
                break;
              default:
                console.warn('[liveEngine] 未知事件类型', eventType);
                continue;
            }
            console.log('[liveEngine] 收到事件', event.type, eventBlock.length, '字节');
            onEvent(event);
          } catch (parseError) {
            console.warn('[liveEngine] 无法解析事件数据', eventData.slice(0, 200));
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ---------------- 主流程 ---------------- */

/**
 * 调用后端代理并解析事件流。
 */
async function runPipeline(
  prompt: string,
  options: GenerateOptions,
  onEvent: StreamEventHandler,
): Promise<void> {
  // 新提交隐式取消进行中的旧任务
  cancelActiveRun();

  const controller = new AbortController();
  const unregister = registerActiveRun(() => {
    controller.abort();
  });

  try {
    console.log('[liveEngine] 发起请求到后端代理', {
      prompt: prompt.slice(0, 50),
      hasRecentContext: Boolean(options.recentContext),
      hasCurrentHtml: Boolean(options.currentHtml),
    });

    const response = await fetch('/api/llm/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        options: {
          recentContext: options.recentContext,
          currentHtml: options.currentHtml,
        },
      }),
      signal: controller.signal,
    });

    console.log('[liveEngine] 后端响应状态', response.status, response.statusText);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('[liveEngine] 后端错误', response.status, bodyText.slice(0, 200));

      // 根据错误类型判断是否可降级
      const isRetryable = response.status >= 500 || response.status === 429;
      const errorCode = response.status === 429 ? 'RATE_LIMITED' : 'NETWORK_TIMEOUT';
      onEvent({
        type: 'error',
        payload: {
          runId: `r_${Date.now()}`,
          code: errorCode,
          message: response.status >= 500
            ? '后端服务暂时不可用，请稍后重试'
            : `请求失败（HTTP ${response.status}）`,
          retryable: isRetryable,
          fallbackToDemo: true,
          detail: `HTTP ${response.status} ${bodyText.slice(0, 100)}`,
        },
      });
      return;
    }

    if (!response.body) {
      console.error('[liveEngine] 空响应体');
      onEvent({
        type: 'error',
        payload: {
          runId: `r_${Date.now()}`,
          code: 'NETWORK_TIMEOUT',
          message: '后端返回了空响应体',
          retryable: true,
          fallbackToDemo: true,
        },
      });
      return;
    }

    // 解析 SSE 流
    await parseSSEStream(response, onEvent, controller.signal);

  } catch (error) {
    // 用户取消
    if (controller.signal.aborted) {
      console.log('[liveEngine] 用户取消');
      onEvent({
        type: 'error',
        payload: {
          runId: `r_${Date.now()}`,
          code: 'CANCELLED',
          message: '已停止生成',
          retryable: false,
          fallbackToDemo: false,
        },
      });
      return;
    }

    // 网络错误（后端不可达）
    console.error('[liveEngine] 网络错误', error);
    onEvent({
      type: 'error',
      payload: {
        runId: `r_${Date.now()}`,
        code: 'NETWORK_TIMEOUT',
        message: '无法连接后端服务，请检查网络或稍后重试',
        retryable: true,
        fallbackToDemo: true,
        detail: error instanceof Error ? error.message : String(error),
      },
    });

  } finally {
    unregister();
  }
}

/* ---------------- 引擎工厂 ---------------- */

/**
 * 创建 live 引擎（后端代理模式）。
 * 不再需要 apiKey/baseURL/model 参数，后端从环境变量读取配置。
 */
export function createLiveEngine(): AIEngine {
  return {
    mode: 'live',

    async generateStream(
      prompt: string,
      onEvent: StreamEventHandler,
      generateOptions?: GenerateOptions,
    ): Promise<void> {
      return runPipeline(prompt, generateOptions ?? {}, onEvent);
    },

    cancelGeneration(): void {
      cancelActiveRun();
    },
  };
}

/* ---------------- 类型导出（保持向后兼容）---------------- */

/**
 * @deprecated 后端代理模式下不再需要配置，保留类型以避免破坏性变更。
 */
export interface LiveEngineOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * @deprecated 后端代理模式下不再需要配置，保留常量以避免破坏性变更。
 */
export const DEFAULT_LIVE_CONFIG = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

/**
 * @deprecated 后端代理模式下不再需要预设，保留类型以避免破坏性变更。
 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  defaultModel?: string;
}

/**
 * @deprecated 后端代理模式下不再需要预设，保留常量以避免破坏性变更。
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { id: 'moonshot', name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' },
  { id: 'dashscope', name: '阿里百炼（兼容模式）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'siliconflow', name: 'SiliconFlow', baseURL: 'https://api.siliconflow.cn/v1' },
  { id: 'agnes', name: 'Agnes（agnes-ai）', baseURL: 'https://api.agnes-ai.cn/v1', defaultModel: 'agnes-3.0-flash' },
];