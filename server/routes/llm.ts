/**
 * LLM 代理路由。
 * 服务端持有 API Key，代理调用 LLM API，SSE 流式返回。
 * 支持批准流程：分析完成后暂停等待用户批准。
 *
 * 安全：所有端点强制登录（requireAuth），防止匿名滥用 LLM API Key。
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireAuth } from '../auth.js';
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
import type { AppEnv } from '../types.js';

export const llmRouter = new Hono<AppEnv>();

// 全路由强制认证：所有 LLM 端点必须登录
llmRouter.use('*', requireAuth);

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

  // prompt 长度上限：防止超长请求进入 LLM 造成成本放大滥用
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return c.json({ error: `prompt 长度超过上限（最多 ${MAX_PROMPT_LENGTH} 字符）` }, 400);
  }

  const currentHtml = body.options?.currentHtml;
  const currentFiles = body.options?.currentFiles;

  // currentFiles 基本校验：结构、文件数量与单文件大小上限
  const currentFilesError = validateCurrentFiles(currentFiles);
  if (currentFilesError) {
    return c.json({ error: currentFilesError }, 400);
  }

  // currentHtml（单文件模式向后兼容）与多文件模式共用单文件大小上限
  if (typeof currentHtml === 'string' && currentHtml.length > MAX_CURRENT_FILE_SIZE) {
    return c.json({ error: `currentHtml 超过大小上限（最多 ${MAX_CURRENT_FILE_SIZE} 字符）` }, 400);
  }
  const chatTurns = parseChatTurns(body.options?.chatTurns);
  const originalRequest = typeof body.options?.originalRequest === 'string' ? body.options.originalRequest : undefined;
  const intentOverride = parseIntentOverride(body.options?.intentOverride);
  const preferences = Array.isArray(body.options?.preferences)
    ? body.options.preferences.filter(
        (p: unknown): p is { type: string; key: string; value: string; reason?: string } =>
          typeof p === 'object' && p !== null &&
          typeof (p as Record<string, unknown>).type === 'string' &&
          typeof (p as Record<string, unknown>).key === 'string' &&
          typeof (p as Record<string, unknown>).value === 'string',
      ).slice(0, 20)
    : undefined;
  const { framework: userFramework, isExplicitlySet: isFrameworkExplicitlySet } = parseFramework(body.options?.framework);
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
      chatTurns,
      originalRequest,
      intentOverride,
      preferences,
      // 用户明确选择框架时，使用 explicitFramework（最高优先级）
      // 否则使用默认的 framework 参数，让意图识别决定
      explicitFramework: isFrameworkExplicitlySet ? userFramework : undefined,
      framework: userFramework,
      onEvent,
      abortSignal: c.req.raw.signal, // 客户端断连时触发 abort
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
    const continuePromise = continueAfterApproval(sessionId, onEvent, c.req.raw.signal);

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

/** intentOverride 白名单：与 server/intentClassifier.ts 的 IntentType 对齐 */
const INTENT_OVERRIDE_VALUES: readonly string[] = ['create', 'modify', 'analyze', 'diagnose'];

/**
 * 解析强制意图参数：白名单外的值整体丢弃（走服务端自动识别）。
 * 前端误判纠正入口传 create/modify/analyze/diagnose，非法值不报错、静默忽略。
 * @param value 前端传入的 options.intentOverride 字段
 */
function parseIntentOverride(value: unknown): 'create' | 'modify' | 'analyze' | 'diagnose' | undefined {
  if (typeof value !== 'string') return undefined;
  return INTENT_OVERRIDE_VALUES.includes(value)
    ? (value as 'create' | 'modify' | 'analyze' | 'diagnose')
    : undefined;
}

/** framework 白名单：与 ProjectFramework 对齐 */
const FRAMEWORK_VALUES: readonly string[] = ['html', 'react-cdn', 'vue-cdn'];

/**
 * 解析框架参数：白名单外的值回退到 'html'。
 * 返回值包含 isExplicitlySet 字段，用于判断是否为用户手动选择。
 * @param value 前端传入的 options.framework 字段
 */
function parseFramework(value: unknown): { framework: 'html' | 'react-cdn' | 'vue-cdn'; isExplicitlySet: boolean } {
  if (typeof value !== 'string') {
    return { framework: 'html', isExplicitlySet: false };
  }
  const isValid = FRAMEWORK_VALUES.includes(value);
  return {
    framework: isValid ? (value as 'html' | 'react-cdn' | 'vue-cdn') : 'html',
    isExplicitlySet: true,
  };
}

/**
 * 解析对话轮次输入：校验数组结构与每个条目的 role/content 类型。
 * 不合规格式整体丢弃，返回 undefined。
 * @param value 前端传入的 chatTurns 字段
 * @param maxItems 最大条目数（防止过大载荷），默认 20
 */
function parseChatTurns(value: unknown, maxItems = 20): Array<{ role: 'user' | 'assistant'; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return undefined;
  if (value.length > maxItems) return undefined;

  const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined;
    const obj = item as Record<string, unknown>;
    if (obj.role !== 'user' && obj.role !== 'assistant') return undefined;
    if (typeof obj.content !== 'string') return undefined;
    // 单条消息长度上限（防止极端 payload）
    if (obj.content.length > 5000) return undefined;
    result.push({ role: obj.role, content: obj.content });
  }
  return result;
}

/** prompt 长度上限：32KB 字符，足够正常需求描述，同时防止成本放大滥用 */
const MAX_PROMPT_LENGTH = 32_768;

/** currentFiles 文件数量上限 */
const MAX_CURRENT_FILES_COUNT = 50;

/** 单文件内容长度上限：1MB 字符（多文件 currentFiles 与单文件 currentHtml 共用） */
const MAX_CURRENT_FILE_SIZE = 1_048_576;

/**
 * 校验迭代上下文 currentFiles：结构、文件数量与单文件大小上限。
 * 防止过大载荷进入 LLM 请求体造成成本放大。
 * @param value 前端传入的 options.currentFiles 字段
 * @returns 错误消息；合法或未提供时返回 null
 */
function validateCurrentFiles(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'currentFiles 必须是文件对象映射';
  }
  const files = Object.values(value);
  if (files.length > MAX_CURRENT_FILES_COUNT) {
    return `currentFiles 文件数量超过上限（最多 ${MAX_CURRENT_FILES_COUNT} 个）`;
  }
  for (const file of files) {
    if (typeof file !== 'object' || file === null) {
      return 'currentFiles 条目格式错误';
    }
    const content = (file as Record<string, unknown>).content;
    if (typeof content !== 'string') {
      return 'currentFiles 条目缺少 content 字符串';
    }
    if (content.length > MAX_CURRENT_FILE_SIZE) {
      return `单个文件内容超过大小上限（最多 ${MAX_CURRENT_FILE_SIZE} 字符）`;
    }
  }
  return null;
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