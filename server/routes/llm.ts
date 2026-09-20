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
  type LLMEvent,
} from '../llm.js';

export const llmRouter = new Hono();

/**
 * POST /api/llm/generate
 * 生成应用代码（三阶段流式）
 *
 * Body: { prompt: string, options?: { currentHtml?: string } }
 *
 * SSE 事件流：
 * - stage: { phase: 'analysis' | 'generate' | 'review' }
 * - delta: { text: string, phase?: string }
 * - approval_required: { sessionId: string, analysis: string, features: object }
 * - done: { html: string }
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