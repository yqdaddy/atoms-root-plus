/**
 * LLM 调用核心逻辑。
 * 调用 Agnes AI API，支持流式输出与取消。
 * 支持批准流程：分析完成后暂停等待用户批准。
 * 支持多文件项目生成：工程师阶段输出 JSON 格式的多文件结构。
 * 支持多轮对话上下文：迭代请求携带最近 N 条对话历史。
 */

import {
  parseMultiFileOutput,
  repairTruncatedMultiFileOutput,
  toFileNodeRecord,
  generateFileTreeSummary,
  formatAffectedFiles,
  type MultiFileOutput,
  type GeneratedFile,
  type FileLanguage,
} from './multiFileParser.js';

/**
 * 对话轮次输入（从前端传入，用于构建多轮上下文）。
 */
export interface ChatTurnInput {
  role: 'user' | 'assistant';
  content: string;
}

/** 多轮上下文构建配置 */
const CHAT_CONTEXT_CONFIG = {
  /** 最多保留的用户指令条数（4.2 设计：最近 5 条修改指令） */
  MAX_USER_TURNS: 5,
  /** 单条用户消息字符上限 */
  USER_MSG_CAP: 200,
  /** 单条助手消息字符上限（摘要用途） */
  ASSISTANT_MSG_CAP: 120,
  /** 整个上下文块字符上限（约 1000 tokens） */
  TOTAL_BLOCK_CAP: 1600,
  /** 用户消息超出时的截断标记 */
  TRUNCATE_MARKER: '…',
} as const;

/**
 * 构建多轮对话上下文块（纯函数，可离线测试）。
 *
 * 策略：
 * 1. 从末尾向前扫描，保留最近 N=5 条用户指令
 * 2. 每条用户指令后若紧跟助手消息，一并纳入
 * 3. 对每条消息应用字符上限截断
 * 4. 总字符数超限时，从最早的轮次开始丢弃
 *
 * @param turns 原始对话轮次数组（已按时间升序）
 * @param originalRequest 可选的最初需求（当历史窗口不含首条时单独标注）
 * @returns 格式化的上下文块字符串，无有效内容时返回空字符串
 */
export function buildChatContextBlock(
  turns: ChatTurnInput[],
  originalRequest?: string
): string {
  if (!turns || turns.length === 0) return '';

  // 过滤无效条目
  const validTurns = turns.filter(
    (t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim().length > 0
  );
  if (validTurns.length === 0) return '';

  // 从后向前收集最近 N 条用户指令及其助手回复
  const selectedTurns: ChatTurnInput[] = [];
  let userCount = 0;
  for (let i = validTurns.length - 1; i >= 0 && userCount < CHAT_CONTEXT_CONFIG.MAX_USER_TURNS; i--) {
    const turn = validTurns[i];
    if (!turn) continue;
    if (turn.role === 'user') {
      userCount++;
      // 助手回复在时间上位于用户之后，即数组中 index i+1
      const next = validTurns[i + 1];
      if (next && next.role === 'assistant') {
        selectedTurns.unshift(next); // 先加助手（保持时间顺序）
      }
      selectedTurns.unshift(turn); // 再加用户
    }
    // 助手消息单独出现时会在上述逻辑中被跳过（由用户触发纳入）
  }

  if (selectedTurns.length === 0) return '';

  // 对每条消息应用截断
  const truncatedTurns = selectedTurns.map((t) => {
    const cap = t.role === 'user' ? CHAT_CONTEXT_CONFIG.USER_MSG_CAP : CHAT_CONTEXT_CONFIG.ASSISTANT_MSG_CAP;
    const trimmed = t.content.trim();
    const truncated = trimmed.length > cap ? trimmed.slice(0, cap) + CHAT_CONTEXT_CONFIG.TRUNCATE_MARKER : trimmed;
    return { role: t.role, content: truncated };
  });

  // 构建原始需求行（如果提供且不在窗口中）
  const firstUserInWindow = truncatedTurns.find((t) => t.role === 'user');
  const originalLine =
    originalRequest && firstUserInWindow && firstUserInWindow.content !== originalRequest.trim().slice(0, CHAT_CONTEXT_CONFIG.USER_MSG_CAP)
      ? [`用户最初需求：${originalRequest.trim().slice(0, CHAT_CONTEXT_CONFIG.USER_MSG_CAP)}${originalRequest.trim().length > CHAT_CONTEXT_CONFIG.USER_MSG_CAP ? CHAT_CONTEXT_CONFIG.TRUNCATE_MARKER : ''}`]
      : [];

  // 构建对话行
  const turnLines = truncatedTurns.map((t) => {
    const prefix = t.role === 'user' ? '用户：' : '助手：';
    return `${prefix}${t.content}`;
  });

  // 合并并检查总长度
  let allLines = [...originalLine, ...turnLines];
  let block = allLines.join('\n');

  // 总长度超限时，从最早的用户轮次开始丢弃（保留原始需求行）
  while (block.length > CHAT_CONTEXT_CONFIG.TOTAL_BLOCK_CAP && turnLines.length > 1) {
    // 找到第一个用户行索引（跳过原始需求行）
    const firstUserIdx = originalLine.length > 0 ? allLines.findIndex((l, i) => i >= originalLine.length && l.startsWith('用户：')) : allLines.findIndex((l) => l.startsWith('用户：'));
    if (firstUserIdx === -1) break;
    // 移除该用户行及其前面的助手行（如果有）
    const removeIdx = firstUserIdx > 0 && allLines[firstUserIdx - 1]?.startsWith('助手：') ? firstUserIdx - 1 : firstUserIdx;
    allLines = allLines.filter((_, i) => i !== removeIdx);
    // 如果移除的是助手行，还需移除对应的用户行
    if (allLines[removeIdx]?.startsWith('用户：')) {
      // 已移除助手，继续
    } else if (removeIdx < allLines.length && allLines[removeIdx]?.startsWith('用户：')) {
      // 正常
    }
    // 重建 turnLines 和 allLines
    const newTurnLines: string[] = [];
    for (let i = originalLine.length; i < allLines.length; i++) {
      newTurnLines.push(allLines[i]!);
    }
    allLines = [...originalLine, ...newTurnLines];
    block = allLines.join('\n');
  }

  return block.trim();
}

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

/** 迭代模式的分析师追加指令 */
const ANALYST_ITERATION_PROMPT = `## 本次为迭代修改任务

用户会对现有应用提出修改要求。你的 features 列表描述的是"本次需要落地的变更项"而非全新功能；must 条目即本次必须完成的修改。请在 assumptions 中列出你无法从描述中确定的点。

## 现有项目文件结构
{{FILE_TREE_SUMMARY}}

请基于现有项目理解当前功能，仅针对用户的新需求或修改要求输出变更项。`;

/** 工程师系统提示词（多文件项目生成） */
const ENGINEER_SYSTEM_PROMPT = `你是 Atoms 平台的前端工程师。你根据功能清单生成一个多文件结构的前端项目。你输出 JSON 格式的文件列表。

## 输出格式
只输出一个 JSON 对象，禁止输出任何解释文字。结构如下：
{
  "files": [
    { "path": "/index.html", "content": "文件内容", "language": "html" },
    { "path": "/styles/main.css", "content": "文件内容", "language": "css" },
    { "path": "/src/main.js", "content": "文件内容", "language": "javascript" }
  ]
}

## 文件组织规范
1. 入口文件必须是 /index.html
2. CSS 文件放在 /styles/ 目录
3. JavaScript 文件放在 /src/ 目录，可进一步分 /src/components/, /src/utils/
4. 每个文件内容独立完整，不引用其他本地文件（引用通过路径声明，由组装器处理）

## 产物铁律
1. 所有文件自包含，组装后可在浏览器直接运行
2. 外部资源只允许 https://cdn.jsdelivr.net
3. 禁止手写 SVG 图标，使用 CSS 形状或 Unicode 符号
4. 数据持久化只用 localStorage

## 设计规范
- 字体使用系统字体栈：system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
- 禁用紫色渐变，使用明确主题色加中性灰阶
- 布局响应式，移动端不塌陷
- 中文文案使用中文标点

## 引用规范
在 index.html 中引用其他文件：
- CSS: <link rel="stylesheet" href="./styles/main.css">
- JS: <script src="./src/main.js"></script>
这些引用会在预览时由组装器内联替换。

## 输出前自检
输出结束前逐条确认：所有标签闭合；<script> 内无语法错误；功能清单中 priority 为 must 的功能全部有对应实现；无白名单外资源。`;

/** 审查者系统提示词 */
const REVIEWER_SYSTEM_PROMPT = `你是 Atoms 平台的质量审查者。你审查多文件项目是否合格交付。你不重写代码，只输出审查结论。

## 审查维度（按顺序逐条检查）
1. 结构完整：有 /index.html 入口文件，且 HTML 有 <!DOCTYPE html>、<html>、<head>、<body> 且标签全部闭合
2. 脚本可执行：每个 .js 文件内无明显语法错误；HTML 中引用的 JS 文件路径在 files 中存在
3. 样式合规：HTML 中引用的 CSS 文件路径在 files 中存在
4. 功能覆盖：功能清单中 priority 为 must 的每条功能在代码中有对应实现
5. 交互真实：按钮与表单有事件绑定和对应处理逻辑，不是纯静态
6. 资源合规：外部资源只允许来自 cdn.jsdelivr.net
7. 体验底线：首屏有可见内容；无紫色渐变；未使用 Inter 字体

## 输出格式
只输出一个 JSON 对象，禁止输出其他任何文字：
{
  "pass": true 或 false,
  "checks": [
    { "item": "结构完整", "pass": true, "note": "一句话说明，20 字以内" }
  ],
  "repairInstructions": [],
  "missingFiles": ["不存在的文件路径列表"]
}
约束：checks 必须覆盖上述 7 个维度。
pass 为 false 时 repairInstructions 必填：最多 3 条，每条是一个具体、可独立执行的修复指令。
pass 为 true 时 repairInstructions 必须是空数组，missingFiles 必须是空数组。`;

/**
 * SSE 事件类型
 *
 * warning：非致命异常通知（当前仅截断抢救）。前端未知事件类型会安全忽略，
 * 该事件为协议预留，供前端后续展示抢救提示。
 */
export type LLMEventType = 'stage' | 'delta' | 'approval_required' | 'done' | 'error' | 'warning';

export interface LLMEvent {
  type: LLMEventType;
  payload: {
    phase?: 'analysis' | 'generate' | 'review';
    text?: string;
    analysis?: string; // 分析结果 JSON 字符串
    features?: unknown; // 功能清单
    html?: string; // 单文件 HTML（向后兼容）
    files?: Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }>; // 多文件结构
    message?: string;
    sessionId?: string; // 会话 ID，用于批准后继续
    rescuedFiles?: string[]; // 截断抢救成功时，被恢复的文件路径列表（warning 事件）
  };
}

/**
 * 待批准的会话
 */
interface PendingSession {
  prompt: string;
  currentHtml?: string; // 向后兼容：单文件模式
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>; // 多文件模式
  analysisResult: string;
  features: unknown;
  /** 预构建的对话上下文块，用于工程师阶段注入 */
  chatContextBlock?: string;
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
  currentHtml?: string; // 向后兼容：单文件模式
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>; // 多文件模式
  /** 多轮对话上下文：最近的对话轮次（用户+助手交替） */
  chatTurns?: ChatTurnInput[];
  /** 原始需求（首次用户输入），用于标注"用户最初需求" */
  originalRequest?: string;
  abortSignal?: AbortSignal;
  onEvent: (event: LLMEvent) => void;
}

/**
 * 对话消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 单次调用的可覆盖参数（可选，缺省走环境变量与既有默认值）。
 * model 默认不开放给客户端覆盖：服务端以 LLM_MODEL 为准，避免前端传入
 * 上游不认识的模型名导致 4xx。
 */
export interface StreamChatCallOptions {
  /** 覆盖模型名（默认取 LLM_MODEL 环境变量） */
  model?: string;
  /** 覆盖 max_tokens 上限（默认 8192） */
  maxTokens?: number;
  /** 采样温度；不传则不下发该字段，由上游默认值决定 */
  temperature?: number;
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
export async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  abortSignal?: AbortSignal,
  callOptions?: StreamChatCallOptions
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('LLM_API_KEY 环境变量未配置');
  }

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.agnes-ai.cn/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'agnes-3.0-flash';

  const requestBody: Record<string, unknown> = {
    model: callOptions?.model || model,
    messages,
    stream: true,
    // 完整单文件 HTML 应用实测 12KB+（约 4000-6000 token），4096 会把生成截断在
    // 半途；8192 提供约 2 倍余量。该值在主流 flash 级模型（含默认的 agnes-3.0-flash）
    // 输出上限之内；若供应商上限更低，API 会返回 4xx 走已有的 error 事件分支。
    // 输出较短的调用方（如需求优化器）可通过 callOptions.maxTokens 收紧上限。
    max_tokens: callOptions?.maxTokens ?? 8192,
  };
  if (typeof callOptions?.temperature === 'number') {
    requestBody.temperature = callOptions.temperature;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
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
  const { prompt, currentHtml, currentFiles, chatTurns, originalRequest, abortSignal, onEvent } = options;
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

    // 构建分析师消息
    const analysisMessages: ChatMessage[] = [
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
    ];

    // 迭代模式：添加文件树摘要
    const isIteration = currentFiles && Object.keys(currentFiles).length > 0;
    if (isIteration && currentFiles) {
      const fileTreeSummary = generateFileTreeSummary(currentFiles);
      const iterationPrompt = ANALYST_ITERATION_PROMPT.replace('{{FILE_TREE_SUMMARY}}', fileTreeSummary);
      analysisMessages[0] = { role: 'system', content: ANALYST_SYSTEM_PROMPT + '\n\n' + iterationPrompt };
    }

    // 构建对话上下文块（多轮修改时注入）
    const chatContextBlock = buildChatContextBlock(chatTurns ?? [], originalRequest);
    const userContent = chatContextBlock
      ? `${prompt}\n\n## 此前的对话上下文\n${chatContextBlock}`
      : prompt;
    analysisMessages.push({ role: 'user', content: userContent });

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
      currentFiles,
      analysisResult,
      features,
      chatContextBlock,
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
 * 批准后继续生成（多文件模式）
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
    const { prompt, currentHtml, currentFiles, features, chatContextBlock } = session;

    // 阶段 2：生成
    onEvent({ type: 'stage', payload: { phase: 'generate' } });

    const featureListStr = typeof features === 'string'
      ? features
      : JSON.stringify(features, null, 2);

    // 构建工程师消息
    const generateMessages: ChatMessage[] = [
      { role: 'system', content: ENGINEER_SYSTEM_PROMPT },
    ];

    // 判断是否为迭代模式
    const isIteration = currentFiles && Object.keys(currentFiles).length > 0;

    // 构建对话上下文附加块
    const chatContextSection = chatContextBlock
      ? `\n\n## 此前的对话上下文\n${chatContextBlock}`
      : '';

    if (isIteration && currentFiles) {
      // 迭代模式：传递受影响文件的完整内容
      // 从 features 中提取可能受影响的文件路径（简化：传递所有文件）
      const affectedPaths = Object.keys(currentFiles);
      const affectedFilesContent = formatAffectedFiles(currentFiles, affectedPaths);

      generateMessages.push({
        role: 'user',
        content: `## 功能清单\n${featureListStr}\n\n## 当前项目文件\n${affectedFilesContent}\n\n## 用户修改需求\n${prompt}${chatContextSection}\n\n请根据修改需求更新需要变更的文件（只输出变更的文件，未变更的文件不需要输出）。`,
      });
    } else {
      // 首次生成模式
      generateMessages.push({
        role: 'user',
        content: `## 功能清单\n${featureListStr}\n\n## 用户需求\n${prompt}\n\n请生成完整的多文件项目。`,
      });
    }

    let accumulatedOutput = '';
    const generatedOutput = await streamChatCompletion(
      generateMessages,
      (text) => {
        accumulatedOutput += text;
        onEvent({ type: 'delta', payload: { text, phase: 'generate' } });
      },
      combinedSignal
    );

    if (combinedSignal.aborted) return;

    // 解析多文件输出；解析失败时尝试截断抢救：输出可能因 max_tokens 耗尽中途
    // 截断，残缺 JSON 中通常仍有结构完整的文件，抢救出含入口文件的集合即可
    // 继续走正常管线交付，只有完全无法抢救时才作废本次生成
    let multiFileOutput: MultiFileOutput;
    let rescueNotice: string | null = null;
    let rescuedPaths: string[] = [];
    try {
      multiFileOutput = parseMultiFileOutput(generatedOutput);
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : '输出解析失败';
      console.error('[continueAfterApproval] 多文件解析失败:', errorMsg);

      const rescued = repairTruncatedMultiFileOutput(generatedOutput);
      if (!rescued) {
        // 抢救不出任何可用文件（无完整文件或缺 /index.html），维持原错误路径
        pendingSessions.delete(sessionId);
        onEvent({ type: 'error', payload: { message: `生成输出格式错误: ${errorMsg}` } });
        return;
      }

      rescuedPaths = rescued.files.map(f => f.path);
      rescueNotice = `输出因长度限制被截断，已恢复 ${rescuedPaths.length} 个已完成文件`;
      console.warn('[continueAfterApproval] 截断抢救成功:', rescueNotice, rescuedPaths.join(', '));
      multiFileOutput = rescued;
    }

    if (rescueNotice) {
      // 结构化 warning 事件入协议（前端 default 分支安全忽略，协议留档供后续消费）；
      // 同时以 delta 落入 generate 阶段的显示文本，让用户当场看到抢救结果
      onEvent({ type: 'warning', payload: { message: rescueNotice, rescuedFiles: rescuedPaths } });
      onEvent({ type: 'delta', payload: { text: `\n\n${rescueNotice}，不完整的文件已丢弃。`, phase: 'generate' } });
    }

    // 合并文件：迭代模式下保留未变更文件
    const finalFiles = isIteration && currentFiles
      ? toFileNodeRecord(multiFileOutput, currentFiles)
      : toFileNodeRecord(multiFileOutput);

    // 阶段 3：审查（可跳过以节省内存：SKIP_REVIEW=true）
    if (process.env.SKIP_REVIEW !== 'true') {
      onEvent({ type: 'stage', payload: { phase: 'review' } });

      const filesJson = JSON.stringify(multiFileOutput, null, 2);
      const reviewMessages: ChatMessage[] = [
        { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
        { role: 'user', content: `## 功能清单\n${featureListStr}\n\n## 待审查的项目文件\n${filesJson}\n\n请审查这个多文件项目。` },
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

    // 组装单文件 HTML（用于向后兼容和预览）
    // 从入口文件开始，内联所有引用
    const indexFile = multiFileOutput.files.find(f => f.path === '/index.html');
    let assembledHtml = indexFile?.content || '';

    // 简单内联 CSS 和 JS 引用
    if (indexFile) {
      // 内联 CSS
      for (const file of multiFileOutput.files.filter(f => f.language === 'css')) {
        const relativePath = '.' + file.path;
        const linkPattern = new RegExp(`<link[^>]*href=["']${escapeRegExp(relativePath)}["'][^>]*>`, 'gi');
        assembledHtml = assembledHtml.replace(linkPattern, `<style>\n${file.content}\n</style>`);
      }

      // 内联 JS
      for (const file of multiFileOutput.files.filter(f => f.language === 'javascript')) {
        const relativePath = '.' + file.path;
        const scriptPattern = new RegExp(`<script[^>]*src=["']${escapeRegExp(relativePath)}["'][^>]*>\\s*<\\/script>`, 'gi');
        assembledHtml = assembledHtml.replace(scriptPattern, `<script>\n${file.content}\n</script>`);
      }
    }

    // 完成：同时返回 html（向后兼容）和 files（多文件结构）
    onEvent({
      type: 'done',
      payload: {
        html: assembledHtml,
        files: finalFiles,
      },
    });

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

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}