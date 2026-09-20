/**
 * LLM 调用核心逻辑。
 * 调用 Agnes AI API，支持流式输出与取消。
 * 支持批准流程：分析完成后暂停等待用户批准。
 */

/** 分析师系统提示词（生成功能清单） */
const ANALYST_SYSTEM_PROMPT = `你是 Atoms 平台的需求分析师。分析用户需求，输出可在浏览器内实现的功能清单。

## 输出格式
只输出一个 JSON 对象，不要任何解释文字：
{
  "appTitle": "应用标题",
  "appType": "dashboard | landing | todo | chart | tool | other",
  "summary": "一句话概述",
  "features": [
    { "id": "F1", "name": "功能名", "description": "功能描述", "priority": "must 或 nice" }
  ],
  "interactions": ["关键交互列表"],
  "assumptions": ["假设列表"]
}

## 约束
- 功能最多 6 条，priority 为 must 的最多 4 条
- 每条功能必须是浏览器内可演示的真实交互
- 不允许假设后端服务、数据库或第三方接口`;

/** 工程师系统提示词 */
const ENGINEER_SYSTEM_PROMPT = `你是 Atoms 平台的前端工程师。根据功能清单生成单文件 HTML 应用。

## 产物铁律
1. 单文件自包含：全部 HTML/CSS/JS 在一个文件内
2. 输出第一行是 <!DOCTYPE html>，最后一行是 </html>
3. 禁止任何后端网络请求，数据持久化只用 localStorage
4. 外部资源只允许 https://cdn.jsdelivr.net
5. 禁止手写 SVG 图标，使用 CSS 形状或 Unicode 符号

## 设计规范
- 字体使用系统字体栈：system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
- 禁用紫色渐变，使用明确主题色加中性灰阶
- 布局响应式，移动端不塌陷
- CSS 集中在 <style>，JS 集中在 </body> 前的 <script>`;

/** 审查者系统提示词 */
const REVIEWER_SYSTEM_PROMPT = `你是代码审查员。检查生成的代码质量。

检查要点：结构完整、脚本可执行、功能覆盖、交互真实、资源合规、体验底线

输出格式：直接列出发现的问题（如有）或确认"代码质量良好"。`;

/**
 * SSE 事件类型
 */
export type LLMEventType = 'stage' | 'delta' | 'approval_required' | 'done' | 'error';

export interface LLMEvent {
  type: LLMEventType;
  payload: {
    phase?: 'analysis' | 'generate' | 'review';
    text?: string;
    analysis?: string; // 分析结果 JSON 字符串
    features?: unknown; // 功能清单
    html?: string;
    message?: string;
    sessionId?: string; // 会话 ID，用于批准后继续
  };
}

/**
 * 待批准的会话
 */
interface PendingSession {
  prompt: string;
  currentHtml?: string;
  analysisResult: string;
  features: unknown;
  createdAt: Date;
}

/** 待批准会话存储（内存，生产环境应使用 Redis） */
const pendingSessions = new Map<string, PendingSession>();

/**
 * 获取待批准会话
 */
export function getPendingSession(sessionId: string): PendingSession | undefined {
  return pendingSessions.get(sessionId);
}

/**
 * 删除待批准会话
 */
export function deletePendingSession(sessionId: string): boolean {
  return pendingSessions.delete(sessionId);
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
      // 完整单文件 HTML 应用实测 12KB+（约 4000-6000 token），4096 会把生成截断在
      // 半途；8192 提供约 2 倍余量。该值在主流 flash 级模型（含默认的 agnes-3.0-flash）
      // 输出上限之内；若供应商上限更低，API 会返回 4xx 走已有的 error 事件分支。
      max_tokens: 8192,
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
 * 剥离 LLM 输出中误加的 markdown 代码围栏。
 * 提示词（ENGINEER_SYSTEM_PROMPT）要求首行 <!DOCTYPE html>，但模型偶尔仍以 ```html
 * 围栏包裹输出。采用"流式拼接完成后一次性剥离"而非逐 delta 处理：
 * 围栏序列可能被拆分在相邻 delta 的边界上，逐 delta 剥离需要跨 delta 状态机，
 * 而 delta 仅用于前端实时显示（围栏前缀只影响开头几个字符的显示），只有 done
 * 载荷的 fullHtml 会被校验与落盘，在源头一次性处理即可。
 * 仅剥离首行围栏与末行围栏，不触碰 HTML 内部内容。
 */
export function stripMarkdownFence(html: string): string {
  let result = html.trim();
  // 剥离开头围栏行（```html / ``` 等）
  if (result.startsWith('```')) {
    const firstNewline = result.indexOf('\n');
    result = firstNewline === -1 ? '' : result.slice(firstNewline + 1);
  }
  // 剥离结尾的围栏行（模型补的闭合围栏，或截断时的残留围栏）
  if (result.endsWith('```')) {
    const lastNewline = result.lastIndexOf('\n');
    result = lastNewline === -1 ? '' : result.slice(0, lastNewline);
  }
  return result.trim();
}

/**
 * 完整 HTML 文档校验（截断检测兜底）：
 * 以 <!DOCTYPE 开头且以 </html> 结尾才算完整。max_tokens 截断的产物不满足，
 * 不应作为 done 载荷下发，由调用方改发 error 事件。
 */
export function isCompleteHtmlDocument(html: string): boolean {
  const trimmed = html.trim();
  return /^<!doctype/i.test(trimmed) && trimmed.endsWith('</html>');
}

/**
 * 三阶段生成（支持批准流程）
 * @param waitForApproval - 是否等待批准（默认 true）
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
    // 阶段 1：分析
    onEvent({ type: 'stage', payload: { phase: 'analysis' } });

    const analysisMessages: ChatMessage[] = [
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    const analysisResult = await streamChatCompletion(
      analysisMessages,
      (text) => onEvent({ type: 'delta', payload: { text, phase: 'analysis' } }),
      combinedSignal
    );

    if (combinedSignal.aborted) return;

    // 解析分析结果
    let features: unknown;
    try {
      // 尝试提取 JSON
      const jsonMatch = analysisResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        features = JSON.parse(jsonMatch[0]);
      } else {
        features = { raw: analysisResult };
      }
    } catch {
      features = { raw: analysisResult };
    }

    // 发送批准请求事件
    const sessionId = crypto.randomUUID();
    pendingSessions.set(sessionId, {
      prompt,
      currentHtml,
      analysisResult,
      features,
      createdAt: new Date(),
    });

    onEvent({
      type: 'approval_required',
      payload: {
        sessionId,
        analysis: analysisResult,
        features,
      },
    });

    // 注意：这里不继续执行，等待用户批准
    // 批准后调用 continueGeneration
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onEvent({ type: 'error', payload: { message: '请求已取消' } });
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      onEvent({ type: 'error', payload: { message } });
    }
  } finally {
    activeControllers.delete(requestId);
  }
}

/**
 * 批准后继续生成
 */
export async function continueAfterApproval(
  sessionId: string,
  onEvent: (event: LLMEvent) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  const session = pendingSessions.get(sessionId);
  if (!session) {
    onEvent({ type: 'error', payload: { message: '会话已过期，请重新开始' } });
    return;
  }

  const controller = new AbortController();
  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, controller.signal])
    : controller.signal;

  try {
    const { prompt, currentHtml, features } = session;

    // 阶段 2：生成
    onEvent({ type: 'stage', payload: { phase: 'generate' } });

    const featureListStr = typeof features === 'string'
      ? features
      : JSON.stringify(features, null, 2);

    const generateMessages: ChatMessage[] = [
      { role: 'system', content: ENGINEER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: currentHtml
          ? `## 功能清单\n${featureListStr}\n\n## 当前代码\n${currentHtml}\n\n## 用户修改需求\n${prompt}\n\n请根据修改需求更新代码。`
          : `## 功能清单\n${featureListStr}\n\n## 用户需求\n${prompt}\n\n请生成完整的单页应用。`,
      },
    ];

    let accumulatedHtml = '';
    const generatedHtml = await streamChatCompletion(
      generateMessages,
      (text) => {
        accumulatedHtml += text;
        onEvent({ type: 'delta', payload: { text, phase: 'generate' } });
      },
      combinedSignal
    );

    if (combinedSignal.aborted) return;

    // 防御性剥离 LLM 误加的 markdown 围栏，得到干净的 HTML
    const cleanHtml = stripMarkdownFence(generatedHtml);

    // 截断检测兜底：不完整的 HTML（如被 max_tokens 截断）不发 done，
    // 改发 error 事件让前端走已有错误分支给用户明确反馈
    if (!isCompleteHtmlDocument(cleanHtml)) {
      pendingSessions.delete(sessionId);
      onEvent({ type: 'error', payload: { message: '生成内容不完整，请重试' } });
      return;
    }

    // 阶段 3：审查（可跳过以节省内存：SKIP_REVIEW=true）
    if (process.env.SKIP_REVIEW !== 'true') {
      onEvent({ type: 'stage', payload: { phase: 'review' } });

      const reviewMessages: ChatMessage[] = [
        { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
        { role: 'user', content: `请审查以下代码:\n${cleanHtml}` },
      ];

      await streamChatCompletion(
        reviewMessages,
        (text) => onEvent({ type: 'delta', payload: { text, phase: 'review' } }),
        combinedSignal
      );
    } else {
      // 轻量级审查：仅发送确认
      onEvent({ type: 'stage', payload: { phase: 'review' } });
      onEvent({ type: 'delta', payload: { text: '代码生成完成（审查已跳过）', phase: 'review' } });
    }

    if (combinedSignal.aborted) return;

    // 完成
    onEvent({ type: 'done', payload: { html: cleanHtml } });

    // 清理会话
    pendingSessions.delete(sessionId);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onEvent({ type: 'error', payload: { message: '请求已取消' } });
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      onEvent({ type: 'error', payload: { message } });
    }
  }
}