/**
 * 真实引擎（LivePipeline）：后端代理模式。
 * 调用本地后端 `/api/llm/generate` 端点，后端负责 LLM 调用与流水线编排。
 * 前端只负责：发起请求 + 解析 SSE 事件 + 取消控制。
 * 降级策略：后端不可用（网络错误、5xx）时由 index.ts 回退 demoEngine。
 */
import { cancelActiveRun, registerActiveRun } from './activeRun';
import { apiFetch } from '../apiClient';
import {
  type AIEngine,
  type GenerateOptions,
  type StreamEventHandler,
  type StreamEvent,
  type PipelineStage,
  type DeltaPhase,
} from './types';

/* ---------------- 格式转换 ---------------- */

/**
 * 后端 stage 到前端 PipelineStage 映射
 */
const STAGE_MAP: Record<string, PipelineStage> = {
  analysis: 'analyzing',
  generate: 'generating',
  review: 'reviewing',
  diagnose: 'analyzing',
};

/**
 * 后端 stage 到前端 DeltaPhase 映射
 * review 阶段的输出也归入 generate phase；
 * diagnose 阶段的输出归入 analyze phase（思考区展示）
 */
const STAGE_TO_PHASE: Record<string, DeltaPhase> = {
  analysis: 'analyze',
  generate: 'generate',
  review: 'generate',
  diagnose: 'analyze',
};

/**
 * 后端 stage 到中文消息映射
 */
const STAGE_MESSAGES: Record<string, string> = {
  analysis: '正在分析需求...',
  generate: '正在生成代码...',
  review: '正在审查代码...',
  diagnose: '正在诊断问题...',
};

/* ---------------- SSE 解析 ---------------- */

/**
 * 解析后端返回的 SSE 事件流并进行格式转换。
 * 后端格式 → 前端格式转换：
 *   stage: { stage: 'analysis' } → { runId, stage: 'analyzing', attempt: 1, message }
 *   delta: { content, stage } → { runId, phase, text }
 *   done: { html } → { runId, html }
 *   error: { error } → { runId, code, message, retryable, fallbackToDemo }
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
  const runId = `run-${Date.now()}`;

  // 当前事件的类型和数据
  let currentEventType = '';
  let currentData = '';

  // 同批次 delta 合并派发：单个网络分块可能携带上百个 SSE 事件（LLM 流式高频输出，
  // 实测单批最多 164 个）。逐个同步派发会让 React 的 useSyncExternalStore 订阅者
  // 产生 50+ 层嵌套更新，触发 "Maximum update depth exceeded" 并沿 promise 链
  // 炸掉整条生成管线（白屏根因）。连续同相位 delta 合并为一条，其余事件照常即时
  // 派发；stage/done/error 等边界事件派发前先冲刷缓冲，保证事件时序不变。
  let pendingDelta: Extract<StreamEvent, { type: 'delta' }> | null = null;
  const flushPendingDelta = (): void => {
    if (pendingDelta) {
      onEvent(pendingDelta);
      pendingDelta = null;
    }
  };
  const dispatchEvent = (event: StreamEvent | null): void => {
    if (!event) return;
    if (event.type === 'delta') {
      const pendingPayload = pendingDelta?.payload;
      if (pendingPayload && pendingPayload.phase === event.payload.phase) {
        pendingPayload.text += event.payload.text;
      } else {
        flushPendingDelta();
        pendingDelta = event;
      }
      return;
    }
    flushPendingDelta();
    onEvent(event);
  };

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
        // 处理最后一个事件（如果有）
        if (currentEventType && currentData) {
          dispatchEvent(processSSEEvent(currentEventType, currentData, runId));
        }
        // 冲刷尾部缓冲的合并 delta，保证 done 前文本完整
        flushPendingDelta();
        break;
      }

      chunkCount += 1;
      buffer += decoder.decode(chunk.value, { stream: true });

      // 逐行解析 SSE
      const lines = buffer.split('\n');
      // 保留最后一个不完整的行
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentData = line.slice(5).trim();
        } else if (line === '') {
          // 空行表示事件结束
          if (currentEventType && currentData) {
            dispatchEvent(processSSEEvent(currentEventType, currentData, runId));
          }
          currentEventType = '';
          currentData = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 处理单个 SSE 事件：解析并转换为前端 StreamEvent（不派发，派发由 parseSSEStream 统一处理）。
 */
/**
 * 解析单个 SSE 事件为前端 StreamEvent。
 * 无法识别或需跳过的事件返回 null（由调用方决定派发时机，见 parseSSEStream 的合并逻辑）。
 */
function processSSEEvent(
  eventType: string,
  eventData: string,
  runId: string,
): StreamEvent | null {
  try {
    const payload = JSON.parse(eventData);

    // 转换后端格式到前端格式
    let event: StreamEvent;
    switch (eventType) {
      case 'stage': {
        const backendStage = payload.phase as string;
        const frontendStage = STAGE_MAP[backendStage] || 'analyzing';
        const message = STAGE_MESSAGES[backendStage] || `${backendStage} 阶段`;
        console.log('[liveEngine] stage 事件:', { backendStage, frontendStage, message, intent: payload.intent });
        event = {
          type: 'stage',
          payload: {
            runId,
            stage: frontendStage,
            attempt: 1,
            message,
            ...(payload.intent ? { intent: payload.intent } : {}),
          },
        };
        break;
      }
      case 'delta': {
        const backendStage = payload.phase as string;
        event = {
          type: 'delta',
          payload: {
            runId,
            phase: STAGE_TO_PHASE[backendStage] || 'generate',
            text: payload.text || '',
          },
        };
        break;
      }
      case 'done': {
        const html = payload.html || '';
        const files = payload.files;
        const analysis = typeof payload.analysis === 'string' ? payload.analysis : undefined;
        const changes = payload.changes;
        const changeSummary = payload.changeSummary;
        // 从后端读取 token 统计，后端未返回时使用默认值
        const backendStats = payload.stats;
        console.log('[liveEngine] done 事件:', {
          htmlLength: html.length,
          htmlPreview: html.slice(0, 200),
          hasFiles: !!files,
          fileCount: files ? Object.keys(files).length : 0,
          hasAnalysis: !!analysis,
          hasChanges: !!changes,
          changeSummary,
          stats: backendStats,
        });
        event = {
          type: 'done',
          payload: {
            runId,
            html,
            files: files,
            warnings: [],
            stats: {
              mode: 'live',
              inputTokens: backendStats?.inputTokens ?? 0,
              outputTokens: backendStats?.outputTokens ?? 0,
              durationMs: 0,
              rounds: 1,
            },
            ...(analysis ? { analysis } : {}),
            ...(changes ? { changes } : {}),
            ...(changeSummary ? { changeSummary } : {}),
          },
        };
        break;
      }
      case 'error': {
        event = {
          type: 'error',
          payload: {
            runId,
            code: 'PARSE_FAILED' as const,
            message: payload.message || '生成失败',
            retryable: true,
            fallbackToDemo: false,
          },
        };
        break;
      }
      case 'retry': {
        // 重试进度事件：在思考区展示重试状态。
        // delayMs > 0 为传输层重试（限流/超时的真实等待），照常渲染等待提示；
        // delayMs === 0 为格式解析重试，server 侧已随事件发送信息更丰富的 delta
        // 文案（含失败原因与策略切换标记），此处跳过渲染，避免聊天区文案重复（D-1）。
        const retry = payload.retry;
        if (retry) {
          console.log('[liveEngine] retry 事件:', retry);
          if (retry.delayMs > 0) {
            event = {
              type: 'delta',
              payload: {
                runId,
                phase: 'generate',
                text: `\n[重试中，第 ${retry.attempt}/${retry.maxRetries} 次，等待 ${Math.round(retry.delayMs / 1000)}s]\n`,
              },
            };
          } else {
            return null;
          }
        } else {
          console.warn('[liveEngine] retry 事件缺少 retry 字段');
          return null;
        }
        break;
      }
      case 'approval_required': {
        event = {
          type: 'approval_required',
          payload: {
            runId,
            sessionId: payload.sessionId || '',
            analysis: payload.analysis || '',
            features: payload.features || { raw: '' },
          },
        };
        break;
      }
      default:
        console.warn('[liveEngine] 未知事件类型', eventType);
        return null;
    }
    return event;
  } catch (parseError) {
    console.warn('[liveEngine] 无法解析事件数据', eventData.slice(0, 200));
    return null;
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
  // 调试日志：framework 参数
  console.log('[liveEngine] runPipeline framework 参数:', options.framework);

  // 新提交隐式取消进行中的旧任务
  cancelActiveRun();

  const controller = new AbortController();
  const unregister = registerActiveRun(() => {
    controller.abort();
  });

  try {
    console.log('[liveEngine] 发起请求到后端代理', {
      prompt: prompt.slice(0, 50),
      hasCurrentFiles: Boolean(options.currentFiles),
      hasChatTurns: Boolean(options.chatTurns),
      hasCurrentHtml: Boolean(options.currentHtml),
      framework: options.framework,
    });

    // 统一走反向代理：开发环境由 Vite 代理转发，生产环境同源直出
    // 使用 apiFetch 统一拦截 401
    const response = await apiFetch('/api/llm/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        options: {
          currentHtml: options.currentHtml,
          currentFiles: options.currentFiles,
          chatTurns: options.chatTurns,
          originalRequest: options.originalRequest,
          intentOverride: options.intentOverride,
          preferences: options.preferences,
          globalPreferences: options.globalPreferences,
          framework: options.framework,
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

/* ---------------- 批准后继续生成 ---------------- */

/**
 * 批准分析结果并继续生成。
 * 调用后端 /api/llm/approve 端点继续生成流程。
 */
export async function approveAndContinue(
  sessionId: string,
  onEvent: StreamEventHandler,
): Promise<void> {
  cancelActiveRun();

  const controller = new AbortController();
  const unregister = registerActiveRun(() => {
    controller.abort();
  });

  try {
    console.log('[liveEngine] 批准后继续生成', { sessionId });

    // 使用 apiFetch 统一拦截 401
    const response = await apiFetch('/api/llm/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      onEvent({
        type: 'error',
        payload: {
          runId: `r_${Date.now()}`,
          code: 'PARSE_FAILED',
          message: `批准失败（HTTP ${response.status}）`,
          retryable: true,
          fallbackToDemo: false,
        },
      });
      return;
    }

    if (!response.body) {
      onEvent({
        type: 'error',
        payload: {
          runId: `r_${Date.now()}`,
          code: 'NETWORK_TIMEOUT',
          message: '后端返回了空响应体',
          retryable: true,
          fallbackToDemo: false,
        },
      });
      return;
    }

    // 解析 SSE 流
    await parseSSEStream(response, onEvent, controller.signal);

  } catch (error) {
    if (controller.signal.aborted) {
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

    onEvent({
      type: 'error',
      payload: {
        runId: `r_${Date.now()}`,
        code: 'NETWORK_TIMEOUT',
        message: '无法连接后端服务',
        retryable: true,
        fallbackToDemo: false,
        detail: error instanceof Error ? error.message : String(error),
      },
    });

  } finally {
    unregister();
  }
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