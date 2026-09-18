/**
 * LLM 调用核心逻辑。
 * 调用 Agnes AI API，支持流式输出与取消。
 */

/**
 * 三阶段生成 prompt 配置
 */
const STAGE_PROMPTS = {
  analysis: `你是产品分析师。分析用户需求，输出简洁的技术方案要点。

要求：
- 识别核心功能点
- 确定技术实现方案
- 列出关键组件

输出格式：直接输出分析要点，每点一行。`,

  generate: `你是前端工程师。根据分析结果生成完整的单页应用代码。

要求：
- 使用现代 HTML/CSS/JavaScript
- 代码可直接运行
- 包含完整结构和样式
- 使用 Tailwind CSS CDN

输出格式：直接输出完整 HTML 代码，从 <!DOCTYPE html> 开始。`,

  review: `你是代码审查员。检查生成的代码质量。

检查要点：
- 代码完整性
- 潜在 bug
- 性能问题
- 可访问性

输出格式：列出发现的问题（如有）或确认"代码质量良好"。`,
};

/**
 * SSE 事件类型
 */
export type LLMEventType = 'stage' | 'delta' | 'done' | 'error';

export interface LLMEvent {
  type: LLMEventType;
  payload: {
    stage?: 'analysis' | 'generate' | 'review';
    content?: string;
    fullHtml?: string;
    error?: string;
  };
}

/**
 * 生成请求选项
 */
export interface GenerateOptions {
  prompt: string;
  currentHtml?: string;
  abortSignal?: AbortSignal;
  onEvent: (event: LLMEvent) => void;
}

/**
 * 对话消息
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 中止控制器管理
 * 用于取消进行中的请求
 */
const activeControllers = new Map<string, AbortController>();

/**
 * 取消进行中的请求
 */
export function cancelGeneration(requestId: string): boolean {
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeControllers.delete(requestId);
    return true;
  }
  return false;
}

/**
 * 调用 OpenAI 兼容 API 流式生成
 */
async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('LLM_API_KEY 环境变量未配置');
  }

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.agnes-ai.cn/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'agnes-3.0-flash';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API 错误 (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('无法获取响应流');
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 数据
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留未完成的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              onDelta(content);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullContent;
}

/**
 * 三阶段生成
 */
export async function generateWithStages(options: GenerateOptions): Promise<void> {
  const { prompt, currentHtml, abortSignal, onEvent } = options;
  const requestId = crypto.randomUUID();
  const controller = new AbortController();

  // 注册可取消
  activeControllers.set(requestId, controller);

  // 合并中止信号
  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, controller.signal])
    : controller.signal;

  try {
    let accumulatedHtml = currentHtml || '';

    // 阶段 1：分析
    onEvent({ type: 'stage', payload: { stage: 'analysis' } });

    const analysisMessages: ChatMessage[] = [
      { role: 'system', content: STAGE_PROMPTS.analysis },
      { role: 'user', content: prompt },
    ];

    await streamChatCompletion(
      analysisMessages,
      (text) => onEvent({ type: 'delta', payload: { content: text, stage: 'analysis' } }),
      combinedSignal
    );

    if (combinedSignal.aborted) return;

    // 阶段 2：生成
    onEvent({ type: 'stage', payload: { stage: 'generate' } });

    const generateMessages: ChatMessage[] = [
      { role: 'system', content: STAGE_PROMPTS.generate },
      {
        role: 'user',
        content: currentHtml
          ? `用户需求: ${prompt}\n\n当前代码:\n${currentHtml}\n\n请根据需求修改代码。`
          : `用户需求: ${prompt}\n\n请生成完整的单页应用。`,
      },
    ];

    const generatedHtml = await streamChatCompletion(
      generateMessages,
      (text) => {
        accumulatedHtml += text;
        onEvent({ type: 'delta', payload: { content: text, stage: 'generate' } });
      },
      combinedSignal
    );

    if (combinedSignal.aborted) return;

    // 阶段 3：审查
    onEvent({ type: 'stage', payload: { stage: 'review' } });

    const reviewMessages: ChatMessage[] = [
      { role: 'system', content: STAGE_PROMPTS.review },
      { role: 'user', content: `请审查以下代码:\n${generatedHtml}` },
    ];

    await streamChatCompletion(
      reviewMessages,
      (text) => onEvent({ type: 'delta', payload: { content: text, stage: 'review' } }),
      combinedSignal
    );

    if (combinedSignal.aborted) return;

    // 完成
    onEvent({ type: 'done', payload: { fullHtml: generatedHtml } });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onEvent({ type: 'error', payload: { error: '请求已取消' } });
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      onEvent({ type: 'error', payload: { error: message } });
    }
  } finally {
    activeControllers.delete(requestId);
  }
}