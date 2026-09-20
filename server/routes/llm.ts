/**
 * LLM 代理路由。
 * 服务端持有 API Key，代理调用 LLM API，SSE 流式返回。
 * 支持批准流程：分析完成后暂停等待用户批准。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  generateWithStages,
  continueAfterApproval,
  cancelGeneration,
  streamChatCompletion,
  type LLMEvent,
} from '../llm.js';
import {
  OPTIMIZER_SYSTEM_PROMPT,
  renderOptimizerUserPrompt,
  getTemplateHintText,
  type OptimizerExistingContext,
} from '../prompts.js';

export const llmRouter = new Hono();

/**
 * POST /api/llm/generate
 * 生成应用代码（三阶段流式）
 *
 * Body: {
 *   prompt: string,
 *   options?: {
 *     currentHtml?: string,         // 向后兼容：单文件模式
 *     currentFiles?: Record<string, { path: string; content: string; language: string }> // 多文件模式
 *   }
 * }
 *
 * SSE 事件流：
 * - stage: { phase: 'analysis' | 'generate' | 'review' }
 * - delta: { text: string, phase?: string }
 * - approval_required: { sessionId: string, analysis: string, features: object }
 * - done: { html: string, files?: Record<string, FileNode> }
 * - error: { message: string }
 */
llmRouter.post('/generate', async (c) => {
  // 解析请求体
  const body = await c.req.json().catch(() => ({}));

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return c.json({ error: 'prompt 为必填字段' }, 400);
  }

  const prompt = body.prompt.trim();
  const currentHtml = body.options?.currentHtml;
  const currentFiles = body.options?.currentFiles;
  const requestId = body.requestId;

  // 如果有 requestId，检查是否有进行中的请求并取消
  if (typeof requestId === 'string') {
    cancelGeneration(requestId);
  }

  // 返回 SSE 流
  return streamSSE(c, async (stream) => {
    const eventQueue: LLMEvent[] = [];
    let closed = false;

    // 事件处理函数
    const onEvent = (event: LLMEvent) => {
      if (closed) return;
      eventQueue.push(event);
    };

    // 启动生成（异步执行）
    const generatePromise = generateWithStages({
      prompt,
      currentHtml: typeof currentHtml === 'string' ? currentHtml : undefined,
      currentFiles: typeof currentFiles === 'object' && currentFiles !== null ? currentFiles : undefined,
      onEvent,
    });

    // 轮询事件队列并发送
    const sendEvents = async () => {
      while (!closed) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.payload),
          });

          // done、error 或 approval_required 后关闭流
          if (event.type === 'done' || event.type === 'error' || event.type === 'approval_required') {
            closed = true;
            break;
          }
        } else {
          // 等待一小段时间再检查
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    };

    // 并行执行生成和发送
    try {
      await Promise.all([generatePromise, sendEvents()]);
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : '未知错误';
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: message }),
        });
      }
    }
  });
});

/**
 * POST /api/llm/approve
 * 批准分析结果并继续生成
 *
 * Body: { sessionId: string }
 *
 * SSE 事件流：继续返回 generate、review、done 事件
 */
llmRouter.post('/approve', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId;

  if (typeof sessionId !== 'string') {
    return c.json({ error: 'sessionId 为必填字段' }, 400);
  }

  // 返回 SSE 流
  return streamSSE(c, async (stream) => {
    const eventQueue: LLMEvent[] = [];
    let closed = false;

    // 事件处理函数
    const onEvent = (event: LLMEvent) => {
      if (closed) return;
      eventQueue.push(event);
    };

    // 继续生成
    const continuePromise = continueAfterApproval(sessionId, onEvent);

    // 轮询事件队列并发送
    const sendEvents = async () => {
      while (!closed) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.payload),
          });

          // done 或 error 后关闭流
          if (event.type === 'done' || event.type === 'error') {
            closed = true;
            break;
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    };

    try {
      await Promise.all([continuePromise, sendEvents()]);
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : '未知错误';
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: message }),
        });
      }
    }
  });
});

/**
 * POST /api/llm/cancel
 * 取消进行中的生成请求
 *
 * Body: { requestId: string }
 */
llmRouter.post('/cancel', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const requestId = body.requestId;

  if (typeof requestId !== 'string') {
    return c.json({ error: 'requestId 为必填字段' }, 400);
  }

  const cancelled = cancelGeneration(requestId);
  return c.json({ success: cancelled, message: cancelled ? '请求已取消' : '未找到进行中的请求' });
});

/* ---------------- 提示词优化器 ---------------- */

/**
 * /optimize 端点的 SSE 事件类型
 */
interface OptimizeSSEEvent {
  type: 'delta' | 'done' | 'error';
  payload: Record<string, unknown>;
}

/** locale 白名单，与前端 OptimizerInput['locale'] 对齐 */
const OPTIMIZER_LOCALES: readonly string[] = ['zh-CN', 'en'];

/**
 * 数值参数钳制：非有限数返回 undefined，否则收敛到 [min, max] 整数/原值。
 * 客户端数值属不可信输入，进 LLM 请求体前必须经过钳制。
 */
function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/**
 * 解析迭代上下文：逐字段校验类型，不合规律段整体丢弃（不部分采用）。
 */
function parseExistingContext(value: unknown): OptimizerExistingContext | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.title !== 'string' ||
    typeof obj.summary !== 'string' ||
    !Array.isArray(obj.features)
  ) {
    return undefined;
  }
  return {
    title: obj.title,
    summary: obj.summary,
    features: obj.features.filter((f): f is string => typeof f === 'string'),
  };
}

/**
 * POST /api/llm/optimize
 * 提示词优化（需求澄清）：后端组装优化器 Prompt（模板镜像自前端
 * src/services/ai/optimizer/prompt.ts，见 server/prompts.ts）并调用 LLM，
 * SSE 流式返回。输出的 JSON 结构校验由前端 validator 完成，后端是纯代理。
 *
 * Body: {
 *   userPrompt: string            // 必填；兼容任务规格中的 prompt 字段名作为别名
 *   templateHint?: string         // 模板类型枚举值（dashboard/todo/...）
 *   locale?: string               // 'zh-CN' | 'en'，缺省或非法值回落 'zh-CN'
 *   existingContext?: { title: string, summary: string, features: string[] }
 *   maxTokens?: number            // 钳制到 [256, 8192]
 *   temperature?: number          // 钳制到 [0, 2]
 *   model?: string                // 忽略：模型名以服务端 LLM_MODEL 为准，
 *                                 // 避免前端传入上游不认识的模型名导致 4xx
 * }
 *
 * SSE 事件流：
 * - delta: { text: string }
 * - done:  {}
 * - error: { code: string, message: string, retryable: boolean }
 *   错误码：LLM_NOT_CONFIGURED（不可重试）/ UPSTREAM_ERROR（可重试）/
 *           CANCELLED（不可重试）/ INTERNAL_ERROR（可重试）
 */
llmRouter.post('/optimize', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  // userPrompt 必填（兼容 prompt 别名）
  const userPrompt =
    typeof body.userPrompt === 'string' && body.userPrompt.trim()
      ? body.userPrompt.trim()
      : typeof body.prompt === 'string'
        ? body.prompt.trim()
        : '';

  if (!userPrompt) {
    return c.json({ error: 'userPrompt 为必填字段' }, 400);
  }

  const templateHint = typeof body.templateHint === 'string' ? body.templateHint : '';
  const locale =
    typeof body.locale === 'string' && OPTIMIZER_LOCALES.includes(body.locale)
      ? body.locale
      : 'zh-CN';
  const existingContext = parseExistingContext(body.existingContext);
  const maxTokens = clampNumber(body.maxTokens, 256, 8192);
  const temperature = clampNumber(body.temperature, 0, 2);

  // 服务端组装 prompt。渲染抛错说明模板与取值不匹配（编程错误），以 500 JSON 答复
  const userContent = (() => {
    try {
      return renderOptimizerUserPrompt(
        userPrompt,
        getTemplateHintText(templateHint),
        locale,
        existingContext,
      );
    } catch (error) {
      console.error('[optimize] Prompt 模板渲染失败', error);
      return null;
    }
  })();

  if (userContent === null) {
    return c.json({ error: 'Prompt 模板渲染失败' }, 500);
  }

  // API Key 预检：未配置时以 error 事件答复（保持 SSE 协议一致），不可重试
  if (!process.env.LLM_API_KEY) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          code: 'LLM_NOT_CONFIGURED',
          message: 'LLM_API_KEY 环境变量未配置，请联系管理员',
          retryable: false,
        }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    const eventQueue: OptimizeSSEEvent[] = [];
    let closed = false;

    // 优化调用：单阶段，无批准流程。catch 已兜底，Promise 不会 reject
    const optimizePromise = (async () => {
      await streamChatCompletion(
        [
          { role: 'system', content: OPTIMIZER_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        (text) => {
          if (!closed) {
            eventQueue.push({ type: 'delta', payload: { text } });
          }
        },
        undefined, // abortSignal：优化器取消由前端断开连接完成
        { maxTokens, temperature },
      );
      if (!closed) {
        eventQueue.push({ type: 'done', payload: {} });
      }
    })().catch((error) => {
      if (closed) return;
      if (error instanceof Error && error.name === 'AbortError') {
        eventQueue.push({
          type: 'error',
          payload: { code: 'CANCELLED', message: '请求已取消', retryable: false },
        });
      } else {
        const message = error instanceof Error ? error.message : '未知错误';
        eventQueue.push({
          type: 'error',
          payload: { code: 'UPSTREAM_ERROR', message, retryable: true },
        });
      }
    });

    // 轮询事件队列并发送（与 generate/approve 端点同一模式）
    const sendEvents = async () => {
      while (!closed) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.payload),
          });

          // done 或 error 后关闭流
          if (event.type === 'done' || event.type === 'error') {
            closed = true;
            break;
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    };

    try {
      await Promise.all([optimizePromise, sendEvents()]);
    } catch (error) {
      // writeSSE 失败（客户端断开）等发送侧异常
      if (!closed) {
        const message = error instanceof Error ? error.message : '未知错误';
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ code: 'INTERNAL_ERROR', message, retryable: true }),
        });
      }
    }
  });
});