/**
 * LLM 调用核心逻辑。
 * 调用 Agnes AI API，支持流式输出与取消。
 * 支持批准流程：分析完成后暂停等待用户批准。
 * 支持多文件项目生成：工程师阶段输出 JSON 格式的多文件结构。
 * 支持多轮对话上下文：迭代请求携带最近 N 条对话历史。
 */

import {
  parseMultiFileOutput,
  parseOutput,
  repairTruncatedMultiFileOutput,
  toFileNodeRecord,
  generateFileTreeSummary,
  formatAffectedFiles,
  type MultiFileOutput,
  type GeneratedFile,
  type FileLanguage,
  type ParseResult,
} from './multiFileParser.js';
import { classifyIntent, INTENT_LABELS, type IntentResult, type IntentType } from './intentClassifier.js';
import { buildIterationSummary, estimateSummaryTokens } from './utils/iterationSummary.js';
import { buildScaffoldDocs, parseBlueprint } from './utils/scaffoldDocs.js';
import { validateProject, type ValidationIssue } from './utils/projectValidator.js';
import { withRetry, DegradationTriggeredError, type RetryProgressEvent } from './utils/retry.js';
import {
  trimContext,
  calculateTokenSavings,
} from './utils/contextTrimming.js';
import type { ChangeList, FileChange } from './types.js';
import {
  ANALYST_SYSTEM_PROMPT_V2,
  ENGINEER_BASE_PROMPT_V2,
  REVIEWER_SYSTEM_PROMPT_V2,
  buildEngineerSystemPromptV2,
} from './prompts-v2.js';

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
const ANALYST_SYSTEM_PROMPT = ANALYST_SYSTEM_PROMPT_V2;

/** 迭代模式的分析师追加指令 */
const ANALYST_ITERATION_PROMPT = `## 本次为迭代修改任务

用户会对现有应用提出修改要求。你的 features 列表描述的是"本次需要落地的变更项"而非全新功能；must 条目即本次必须完成的修改。请在 assumptions 中列出你无法从描述中确定的点。

## 现有项目文件结构
{{FILE_TREE_SUMMARY}}

请基于现有项目理解当前功能，仅针对用户的新需求或修改要求输出变更项。`;

/** 工程师系统提示词基础部分（与框架无关） */
const ENGINEER_BASE_PROMPT = ENGINEER_BASE_PROMPT_V2;

/**
 * 构建完整的工程师系统提示词。
 * 基础部分 + 用户选择的框架特定规范。
 */
export function buildEngineerSystemPrompt(framework: 'html' | 'react-cdn' | 'vue-cdn'): string {
  return buildEngineerSystemPromptV2(framework);
}

/** 迭代模式的工程师追加指令 */
const ENGINEER_ITERATION_PROMPT = `## 迭代修改模式

你正在修改一个已有项目。必须遵循以下原则：

### 输出格式【必须严格遵守】
- 输出格式仍是 { "files": [...] } JSON，与全新生成完全相同
- 只包含被修改或新增的文件，每个文件输出**完整内容**，path、content、language 三字段齐全
- **禁止**输出 { "changes": [...] } 变更清单/diff 编辑格式，本模式不支持该格式，输出将导致交付失败

### 核心原则
1. **最小变更**：只修改用户要求的部分，不改动其他代码
2. **保持一致性**：延续现有代码的风格、命名、结构
3. **增量修改**：基于现有代码修改，不要重写整个文件

### 输出规则
- 只输出**被修改的文件**，未修改的文件不要输出
- 保留所有未涉及变更的代码片段
- 新增功能时，尽量复用现有组件和样式
- 删除功能时，清理相关代码但保留其他部分

### 禁止行为
- 不要重新生成整个项目
- 不要输出 { "changes": [...] } 变更清单格式，必须输出 { "files": [...] }
- 不要改变现有代码的命名风格
- 不要添加用户未要求的新功能
- 不要删除用户未要求删除的功能

### 自检清单
输出前确认：
- 我只修改了用户要求的部分
- 未修改的代码保持原样
- 变更是增量式的，不是重写`;

/**
 * 工程师 diff 模式系统提示词（modify 意图）。
 *
 * 输出 JSON 变更清单而非完整文件，节省输出 token 并强制最小变更。
 * 配套 applyChanges 将清单应用到现有文件；解析或应用失败时，
 * 调用方必须回退到 ENGINEER_BASE_PROMPT + ENGINEER_ITERATION_PROMPT 的
 * 全量文件模式（降级路径），避免用户面对裸报错。
 * 反向容错：迭代全量模式误输出变更清单时，由非 diff 解析路径
 * （continueAfterApproval）复用 applyChanges 自动应用，不报错不重试。
 */
const ENGINEER_DIFF_PROMPT = `你是 Litpp 平台的前端工程师，负责根据修改请求**增量修改**代码。

【重要】你是修改模式，只输出变更的部分，不要重新生成整个文件。

【输入】
1. 用户的修改请求
2. 现有文件内容（带行号标注，行号仅供定位，输出时使用去掉行号后的原文）

【输出格式】【必须严格遵守】

**重要：你必须输出 \`{ "changes": [...] }\` 格式，不是其他格式！**

只输出一个 JSON 对象，禁止输出任何解释文字、禁止用 markdown 围栏包裹：
{
  "changes": [
    {
      "file": "文件路径（与输入中的文件路径完全一致）",
      "edits": [
        {
          "line": 行号,
          "old": "原行内容（必须与原文件该行逐字符精确匹配，包括缩进）",
          "new": "新行内容",
          "type": "replace 或 insert 或 delete"
        }
      ]
    }
  ],
  "summary": "变更摘要（一句话，20 字以内）"
}

**禁止输出**：
- ❌ \`{ "files": [...] }\` 格式（这是完整文件模式的格式）
- ❌ 带解释文字的输出
- ❌ markdown 围栏包裹

**正确输出示例**：
{
  "changes": [
    {
      "file": "/index.html",
      "edits": [
        { "line": 2, "old": "  <button class=\"bg-red-500\">点击</button>", "new": "  <button class=\"bg-blue-500\">点击</button>", "type": "replace" }
      ]
    }
  ],
  "summary": "按钮颜色从红色改为蓝色"
}

【编辑类型说明】
- replace：将 line 指定的行替换为 new 内容，old 必须与原行完全一致
- insert：在 line 指定的行之后插入 new 内容，old 填该行原文（用于校验定位）
- delete：删除 line 指定的行，old 填该行原文，new 填空字符串

【规则】
1. old 必须精确匹配原文件中的行，包括空格和缩进；匹配失败将导致整个变更被拒绝
2. line 是 1-indexed 的行号，基于原始文件（未应用任何编辑前）的行号
3. 同一文件的多个编辑按行号从大到小排列（从文件末尾往前改，避免行号偏移）
4. 每次只修改必要的行，不要重写未变更的部分
5. 删除多行时，每行单独一个 delete 操作
6. 插入多行时，new 中用 \\n 分隔（JSON 转义），一次 insert 可插入多行内容
7. 只修改用户要求的部分，不要顺手改动其他代码
8. 保持现有代码的风格、命名、缩进一致
9. 如果修改请求不明确、无法在现有文件中定位要修改的位置，或确认无需任何修改，不要猜测或编造变更：输出 { "changes": [], "summary": "说明原因，或向用户提出需要澄清的问题" }

【示例】
用户请求："把按钮改成蓝色"
现有文件 index.html：
1 | <div class="container">
2 |   <button class="bg-red-500">点击</button>
3 | </div>

输出：
{
  "changes": [
    {
      "file": "/index.html",
      "edits": [
        {
          "line": 2,
          "old": "  <button class=\\"bg-red-500\\">点击</button>",
          "new": "  <button class=\\"bg-blue-500\\">点击</button>",
          "type": "replace"
        }
      ]
    }
  ],
  "summary": "按钮颜色从红色改为蓝色"
}

【自检清单】
输出前确认：
- old 与原文件对应行逐字符一致（含缩进）
- 行号基于原始文件且从大到小排列
- 没有输出未变更的行
- 只输出 JSON，无其他文字`;

/** 审查者系统提示词 */
const REVIEWER_SYSTEM_PROMPT = REVIEWER_SYSTEM_PROMPT_V2;

/** 分析模式系统提示词（analyze 意图：解释现有项目，不改动、不生成代码） */
const ANALYZE_SYSTEM_PROMPT = `你是 Litpp 平台的需求分析师。用户想了解现有项目的功能、结构或实现，你的任务是解释与分析，不是修改代码。

## 输出要求
- 用简体中文输出结构化的分析报告（可用 Markdown 小标题与列表）
- 覆盖：应用概况、主要功能清单、技术实现要点、已知局限或改进建议
- 只基于提供的项目文件与用户问题作答，不要臆造不存在的功能
- 篇幅控制在 500 字以内，直接输出报告正文，不要输出 JSON`;

/** 诊断模式系统提示词（diagnose 意图：定位问题并给出修复建议，不直接改代码） */
const DIAGNOSE_SYSTEM_PROMPT = `你是 Litpp 平台的问题诊断工程师。用户报告了应用的问题或异常行为，你的任务是根据项目代码定位原因并给出修复建议。你不直接重写代码。

## 输出格式
只输出一个 JSON 对象，禁止输出其他任何文字：
{
  "problem": "用户报告的问题，一句话概括",
  "rootCause": "根因分析：具体到文件与代码位置，说明为什么会出现该问题",
  "affectedFiles": ["涉及的文件路径"],
  "fixSuggestions": ["具体、可独立执行的修复建议，最多 3 条"]
}
约束：rootCause 必须引用具体文件路径与相关代码行为；无法定位时如实说明，并列出最可能的方向。`;

/**
 * SSE 事件类型
 *
 * warning：非致命异常通知（当前仅截断抢救）。前端未知事件类型会安全忽略，
 * 该事件为协议预留，供前端后续展示抢救提示。
 * retry：重试进度通知。API 调用失败重试时发送，前端可在思考区展示重试状态。
 */
export type LLMEventType = 'stage' | 'delta' | 'approval_required' | 'done' | 'error' | 'warning' | 'retry';

/** 意图信息（SSE stage 事件携带，供前端展示识别结果与纠正入口） */
export interface IntentInfo {
  type: IntentType;
  confidence: number;
  reasoning?: string;
  /** 建议的框架（自动识别结果） */
  suggestedFramework?: 'html' | 'react-cdn' | 'vue-cdn';
}

/** token 统计信息（done 事件携带） */
export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMEvent {
  type: LLMEventType;
  payload: {
    phase?: 'analysis' | 'generate' | 'review' | 'diagnose';
    text?: string;
    analysis?: string; // 分析/诊断结果文本（analyze 与 diagnose 意图、diff 模式空变更的 done 载荷；存在时前端作为对话内容展示，不进入应用流程）
    features?: unknown; // 功能清单
    html?: string; // 单文件 HTML（向后兼容）
    files?: Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }>; // 多文件结构
    message?: string;
    sessionId?: string; // 会话 ID，用于批准后继续
    rescuedFiles?: string[]; // 截断抢救成功时，被恢复的文件路径列表（warning 事件）
    /** 意图识别结果（首个 stage 事件附带） */
    intent?: IntentInfo;
    /** 重试事件字段 */
    retry?: {
      attempt: number;
      maxRetries: number;
      delayMs: number;
      errorMessage: string;
    };
    /** 降级标记（error 事件）：连续容量错误触发降级 */
    degraded?: boolean;
    /** token 统计（done 事件携带） */
    stats?: TokenStats;
    /** 变更清单（diff 模式 done 事件携带） */
    changes?: ChangeList;
    /** 变更摘要（diff 模式 done 事件携带，与 changes.summary 一致，供前端快速访问） */
    changeSummary?: string;
  };
}

/**
 * 待批准的会话
 */
interface PendingSession {
  /** 关联的请求 ID，用于取消时清理会话 */
  requestId?: string;
  prompt: string;
  currentHtml?: string; // 向后兼容：单文件模式
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>; // 多文件模式（裁剪后）
  /** 原始文件集合（裁剪前的完整文件），用于合并时保留未变更文件 */
  originalFiles?: Record<string, { path: string; content: string; language: FileLanguage }>;
  analysisResult: string;
  features: unknown;
  /** 预构建的对话上下文块，用于工程师阶段注入 */
  chatContextBlock?: string;
  /** 原始对话轮次，迭代模式下用于构建 9 段式结构化摘要 */
  chatTurns?: ChatTurnInput[];
  /** 原始需求（首次用户输入），摘要中标注"用户最初需求" */
  originalRequest?: string;
  /** 项目偏好记忆，批准后继续生成时注入工程师 prompt */
  preferences?: GenerateOptions['preferences'];
  /** 全局偏好记忆（跨项目生效），注入工程师 prompt */
  globalPreferences?: GenerateOptions['globalPreferences'];
  /** 分析阶段的 token 使用量，用于最终统计 */
  analysisUsage?: LLMUsage;
  /** 目标框架：html / react-cdn / vue-cdn */
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
  /** 是否使用 diff 模式（modify 意图）：输出 JSON 变更清单而非完整文件 */
  useDiffMode?: boolean;
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
  /** 强制指定意图（可选透传，白名单与前端契约一致） */
  intentOverride?: 'create' | 'modify' | 'analyze' | 'diagnose';
  /** 项目偏好记忆，注入工程师 prompt */
  preferences?: Array<{
    type: string;
    key: string;
    value: string;
    reason?: string;
  }>;
  /** 全局偏好记忆（跨项目生效），注入分析师和工程师 prompt */
  globalPreferences?: {
    defaultFramework?: 'html' | 'react-cdn' | 'vue-cdn';
    preferredLanguage?: 'zh' | 'en';
    namingStyle?: 'camelCase' | 'snake_case' | 'PascalCase';
    globalStyles?: string[];
    globalCorrections?: string[];
  };
  /** 目标框架：html / react-cdn / vue-cdn，缺省为 html */
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
  /** 用户手动选择的框架（优先级最高，覆盖自动识别） */
  explicitFramework?: 'html' | 'react-cdn' | 'vue-cdn';
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
  /** 总超时时间（毫秒），默认 120000（2 分钟） */
  timeout?: number;
  /** 重试进度回调（withRetry 触发时通知调用方，用于向客户端转发 retry 事件） */
  onRetry?: (event: RetryProgressEvent) => void;
}

/**
 * 中止控制器管理
 * 用于取消进行中的请求
 */
const activeControllers = new Map<string, AbortController>();

/**
 * 取消进行中的请求
 * 同时清理关联的待批准会话
 */
export function cancelGeneration(requestId: string): boolean {
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeControllers.delete(requestId);
  }

  // 清理关联的待批准会话
  for (const [sessionId, session] of pendingSessions.entries()) {
    if (session.requestId === requestId) {
      pendingSessions.delete(sessionId);
      break;
    }
  }

  return controller != null;
}

/**
 * LLM API usage 字段结构
 */
interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * 流式调用结果（包含 usage 信息）
 */
export interface StreamChatResult {
  content: string;
  usage?: LLMUsage;
}

/**
 * 调用 OpenAI 兼容 API 流式生成
 *
 * 支持重试（server/utils/retry.ts withRetry）：
 * - 429/529/超时 → 自动重试（指数退避 + 抖动）
 * - 400 参数错 → 不重试
 * - 连续 3 次容量错误 → 抛 DegradationTriggeredError 触发降级
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  abortSignal?: AbortSignal,
  callOptions?: StreamChatCallOptions
): Promise<string> {
  const result = await streamChatCompletionWithUsage(messages, onDelta, abortSignal, callOptions);
  return result.content;
}

/**
 * 调用 OpenAI 兼容 API 流式生成（带 usage 返回）
 *
 * 支持重试（server/utils/retry.ts withRetry）：
 * - 429/529/超时 → 自动重试（指数退避 + 抖动）
 * - 400 参数错 → 不重试
 * - 连续 3 次容量错误 → 抛 DegradationTriggeredError 触发降级
 */
export async function streamChatCompletionWithUsage(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  abortSignal?: AbortSignal,
  callOptions?: StreamChatCallOptions
): Promise<StreamChatResult> {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('LLM_API_KEY 环境变量未配置');
  }

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.agnes-ai.cn/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'agnes-3.0-flash';
  const timeout = callOptions?.timeout ?? 300000; // 默认 5 分钟总超时

  const requestBody: Record<string, unknown> = {
    model: callOptions?.model || model,
    messages,
    stream: true,
    // 完整单文件 HTML 应用实测 12KB+（约 4000-6000 token），4096 会把生成截断在
    // 半途；8192 提供约 2 倍余量。该值在主流 flash 级模型（含默认的 agnes-3.0-flash）
    // 输出上限之内；若供应商上限更低，API 会返回 4xx 走已有的 error 事件分支。
    // 输出较短的调用方（如需求优化器）可通过 callOptions.maxTokens 收紧上限。
    max_tokens: callOptions?.maxTokens ?? 8192,
    // 请求返回 usage 字段（流式模式下通常在最后一个 chunk）
    stream_options: { include_usage: true },
  };
  if (typeof callOptions?.temperature === 'number') {
    requestBody.temperature = callOptions.temperature;
  }

  // 创建超时控制器
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeout);

  // 合并外部 abortSignal 与超时信号
  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // 核心 fetch 与流消费（可重试单元：每次重试从头建立连接，delta 只在上游
  // 返回 2xx 后才产生，重试不会向前端重复推送已发出的增量）
  const fetchStream = async (): Promise<StreamChatResult> => {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        // 状态码必须以 "HTTP <code>" 形式出现在消息中：classifyAPIError 依赖
        // /HTTP (\d+)/ 正则提取状态码做重试分类
        throw new Error(`LLM API 错误 (HTTP ${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let usage: LLMUsage | undefined;
      let finishReason: string | undefined;

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

                // 提取内容增量
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  onDelta(content);
                }

                // 提取 finish_reason（P1-3：检测截断信号）
                const reason = json.choices?.[0]?.finish_reason;
                if (reason) {
                  finishReason = reason;
                }

                // 提取 usage 字段（通常在最后一个 chunk）
                if (json.usage) {
                  usage = {
                    prompt_tokens: json.usage.prompt_tokens ?? 0,
                    completion_tokens: json.usage.completion_tokens ?? 0,
                    total_tokens: json.usage.total_tokens ?? 0,
                  };
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

      // P1-3：检测 finish_reason === 'length'，触发截断抢救
      if (finishReason === 'length') {
        console.warn(
          '[streamChatCompletion] 检测到输出因 max_tokens 截断，finish_reason=length'
        );
        // 将截断标记附加到结果，由调用方决定是否触发 repairTruncatedMultiFileOutput
        // 这里不直接抢救，因为不同调用方有不同的输出格式（单文件/多文件/变更清单）
        // 抢救逻辑在 continueAfterApproval 和 parseChangeList 中处理
      }

      return { content: fullContent, usage };
    } catch (error) {
      // 区分超时错误与其他错误
      if (error instanceof Error && error.name === 'AbortError') {
        // 检查是否是超时导致的 abort
        if (timeoutController.signal.aborted && !abortSignal?.aborted) {
          throw new Error('LLM 调用超时（超过 300 秒），请稍后重试');
        }
        throw error;
      }
      throw error;
    }
  };

  // 带重试执行
  try {
    return await withRetry(fetchStream, {
      maxRetries: 3,
      signal: abortSignal,
      onProgress: callOptions?.onRetry,
    });
  } catch (error) {
    if (error instanceof DegradationTriggeredError) {
      console.error('[streamChatCompletion] 连续容量错误，触发降级');
    }
    throw error;
  } finally {
    // 清理超时定时器
    clearTimeout(timeoutId);
  }
}

/**
 * 剥离 LLM 输出中误加的 markdown 代码围栏。
 * 提示词（ENGINEER_BASE_PROMPT）要求首行 <!DOCTYPE html>，但模型偶尔仍以 ```html
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
  const { prompt, currentHtml, currentFiles, chatTurns, originalRequest, abortSignal, onEvent, preferences, globalPreferences, intentOverride, framework = 'html', explicitFramework } = options;

  const requestId = crypto.randomUUID();
  const controller = new AbortController();

  // 注册可取消
  activeControllers.set(requestId, controller);

  // 合并中止信号
  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, controller.signal])
    : controller.signal;

  try {
    // 意图识别：先于一切阶段执行。intentOverride 由前端纠正入口传入
    // （路由层已做白名单校验），否则走关键词 + 项目状态自动识别
    const fileCount = currentFiles ? Object.keys(currentFiles).length : 0;
    const intent: IntentResult = intentOverride
      ? { type: intentOverride, confidence: 1, reasoning: '用户手动指定意图' }
      : await classifyIntent({ userPrompt: prompt, hasExistingProject: fileCount > 0, fileCount });
    console.info(
      '[generateWithStages] 意图识别:',
      INTENT_LABELS[intent.type],
      `(type=${intent.type}, confidence=${intent.confidence.toFixed(2)})`,
      intent.reasoning ?? ''
    );

    // 框架选择优先级：
    // 1. 用户手动选择（explicitFramework）→ 最高优先级
    // 2. 意图识别建议（intent.suggestedFramework）
    // 3. 全局偏好（globalPreferences.defaultFramework）
    // 4. 传入参数（framework，默认 html）
    let selectedFramework: 'html' | 'react-cdn' | 'vue-cdn';
    if (explicitFramework) {
      selectedFramework = explicitFramework;
      console.info(`[generateWithStages] 使用用户手动选择的框架: ${selectedFramework}`);
    } else if (intent.suggestedFramework) {
      selectedFramework = intent.suggestedFramework;
      console.info(`[generateWithStages] 使用意图识别建议的框架: ${selectedFramework}`);
    } else if (globalPreferences?.defaultFramework) {
      selectedFramework = globalPreferences.defaultFramework;
      console.info(`[generateWithStages] 使用全局偏好框架: ${selectedFramework}`);
    } else {
      selectedFramework = framework;
      console.info(`[generateWithStages] 使用默认框架: ${selectedFramework}`);
    }

    // 意图分发：analyze/diagnose 只跑分析师（done 只带 analysis），
    // conversation 直接返回对话响应，不走代码生成流程，
    // modify 直通工程师（跳过分析师与批准），create 走完整四角色流水线
    if (intent.type === 'analyze') {
      await runAnalyzePipeline({ prompt, currentFiles, intent, onEvent, signal: combinedSignal });
      return;
    }
    if (intent.type === 'diagnose') {
      await runDiagnosePipeline({ prompt, currentFiles, intent, onEvent, signal: combinedSignal });
      return;
    }
    if (intent.type === 'conversation') {
      // conversation 意图：直接返回对话响应，不走代码生成流程
      await runConversationPipeline({ prompt, intent, onEvent, signal: combinedSignal });
      return;
    }
    if (intent.type === 'modify' && currentFiles && fileCount > 0) {
      // 无现有文件的 modify 视为创建需求的一部分，回退完整流水线
      await runDirectModifyPipeline({ prompt, currentFiles, intent, chatTurns, originalRequest, preferences, globalPreferences, framework: selectedFramework, onEvent, signal: combinedSignal });
      return;
    }

    // 阶段 1：分析（create 意图的完整流水线）
    onEvent({ type: 'stage', payload: { phase: 'analysis', intent } });

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

    // 构建全局偏好块（分析师阶段注入）
    const globalPrefSection = formatGlobalPreferencesForAnalyst(globalPreferences);

    const userContent = [
      globalPrefSection,
      chatContextBlock ? `${prompt}\n\n## 此前的对话上下文\n${chatContextBlock}` : prompt,
    ].filter(Boolean).join('\n\n');
    analysisMessages.push({ role: 'user', content: userContent });

    const analysisResult = await streamChatCompletionWithUsage(
      analysisMessages,
      (text) => onEvent({ type: 'delta', payload: { text, phase: 'analysis' } }),
      combinedSignal,
      {
        onRetry: (event) => {
          onEvent({
            type: 'retry',
            payload: {
              retry: {
                attempt: event.attempt,
                maxRetries: event.maxRetries,
                delayMs: event.delayMs,
                errorMessage: event.errorMessage,
              },
            },
          });
        },
      }
    );

    if (combinedSignal.aborted) return;

    // 检查分析结果是否是对话内容而非功能清单。
    // parseOutput 只认 files 结构，对功能清单 JSON（{appTitle, features, ...}，无
    // files 数组）必然抛错，不能裸调作为"是否对话"的判定器（a2d9eae 回归）：
    // 仅当它成功且判定为 conversation 时走对话路径，其余情况（含抛错）回落到
    // 下方括号配平的 JSON 提取。
    const analysisText = analysisResult.content.trim();
    try {
      const analysisParseResult = parseOutput(analysisText);

      // 如果分析师返回的是纯文本对话（澄清需求、解释概念），直接返回给用户
      if (analysisParseResult.type === 'conversation') {
        console.log('[generateWithStages] 分析师返回对话内容，跳过工程师阶段');
        onEvent({
          type: 'done',
          payload: {
            analysis: analysisParseResult.content || analysisText,
            stats: analysisResult.usage ? {
              inputTokens: analysisResult.usage.prompt_tokens,
              outputTokens: analysisResult.usage.completion_tokens,
            } : undefined,
          },
        });
        return;
      }
    } catch {
      // 功能清单 JSON 或畸形输出：交给下方括号配平提取（解析失败时 features 记为 raw）
    }

    // 解析分析结果（尝试提取 JSON）
    let features: unknown;
    try {
      // 括号配平提取首个完整 JSON 对象（避免贪婪匹配跨多个 JSON 块）
      let depth = 0;
      let start = -1;
      let jsonStr: string | null = null;

      for (let i = 0; i < analysisText.length; i++) {
        if (analysisText[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (analysisText[i] === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            jsonStr = analysisText.slice(start, i + 1);
            break;
          }
        }
      }

      if (jsonStr) {
        features = JSON.parse(jsonStr);
      } else {
        features = { raw: analysisText };
      }
    } catch {
      features = { raw: analysisText };
    }

    // 发送批准请求事件
    const sessionId = crypto.randomUUID();
    pendingSessions.set(sessionId, {
      requestId,
      prompt,
      currentHtml,
      currentFiles,
      analysisResult: analysisResult.content,
      features,
      chatContextBlock,
      chatTurns,
      originalRequest,
      preferences,
      globalPreferences,
      analysisUsage: analysisResult.usage,
      framework: selectedFramework,
      createdAt: new Date(),
    });

    onEvent({
      type: 'approval_required',
      payload: {
        sessionId,
        analysis: analysisResult.content,
        features,
      },
    });

    // 注意：这里不继续执行，等待用户批准
    // 批准后调用 continueGeneration
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onEvent({ type: 'error', payload: { message: '请求已取消' } });
    } else if (error instanceof DegradationTriggeredError) {
      // 降级事件：连续容量错误
      onEvent({
        type: 'error',
        payload: {
          message: 'API 服务持续过载，已触发降级。请稍后重试或切换模型。',
          degraded: true,
        },
      });
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
 * @param intent 意图信息（modify 直通模式由 runDirectModifyPipeline 传入，
 *               附着到 stage 事件供前端展示；批准流程入口不传）
 */
export async function continueAfterApproval(
  sessionId: string,
  onEvent: (event: LLMEvent) => void,
  abortSignal?: AbortSignal,
  intent?: IntentResult
): Promise<void> {
  const session = pendingSessions.get(sessionId);
  if (!session) {
    onEvent({ type: 'error', payload: { message: '会话已过期，请重新开始' } });
    return;
  }

  const controller = new AbortController();
  // 注册控制器以便取消
  activeControllers.set(sessionId, controller);

  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, controller.signal])
    : controller.signal;

  const forwardRetry = (event: RetryProgressEvent) => {
    onEvent({
      type: 'retry',
      payload: {
        retry: {
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        },
      },
    });
  };

  try {
    const { prompt, currentHtml, currentFiles, features, chatContextBlock, chatTurns, originalRequest } = session;
    const framework = session.framework ?? 'html';
    const useDiffMode = session.useDiffMode && currentFiles && Object.keys(currentFiles).length > 0;

    // 阶段 2：生成
    onEvent({ type: 'stage', payload: { phase: 'generate', ...(intent ? { intent } : {}) } });

    const featureListStr = typeof features === 'string'
      ? features
      : JSON.stringify(features, null, 2);

    // 判断是否为迭代模式
    const isIteration = currentFiles && Object.keys(currentFiles).length > 0;

    // 构建工程师消息：diff 模式使用专用 prompt，否则使用框架特定的系统提示词
    let systemPrompt: string;
    if (useDiffMode) {
      systemPrompt = ENGINEER_DIFF_PROMPT;
    } else if (isIteration) {
      systemPrompt = buildEngineerSystemPrompt(framework) + '\n\n' + ENGINEER_ITERATION_PROMPT;
    } else {
      systemPrompt = buildEngineerSystemPrompt(framework);
    }
    const generateMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // 构建对话上下文附加块。
    // 迭代模式且有对话历史时，用 9 段式结构化摘要（server/utils/iterationSummary.ts）
    // 替代逐条上下文块：压缩历史避免全量重发，同时保留任务引用防漂移；
    // 无对话历史时回退原有 chatContextBlock（降级路径）
    let contextSection = chatContextBlock
      ? `\n\n## 此前的对话上下文\n${chatContextBlock}`
      : '';
    if (isIteration && chatTurns && chatTurns.length > 0) {
      const summaryText = buildIterationSummary({
        turns: chatTurns,
        snapshot: currentFiles ? { files: currentFiles } : undefined,
        currentPrompt: prompt,
        originalRequest,
      });
      contextSection = `\n\n${summaryText}`;
      console.info(
        `[continueAfterApproval] 迭代摘要注入: 约 ${estimateSummaryTokens(summaryText)} tokens（历史 ${chatTurns.length} 轮）`
      );
    }
    const chatContextSection = contextSection;

    // 构建偏好块（有偏好时注入"项目偏好档案"与"全局偏好档案"）
    const preferenceSection = formatPreferencesSection(session.preferences, session.globalPreferences);

    if (useDiffMode && currentFiles) {
      // diff 模式：带行号标注的文件内容
      const numberedFiles = formatFilesWithLineNumbers(currentFiles);
      generateMessages.push({
        role: 'user',
        content: `${preferenceSection}## 用户修改需求\n${prompt}\n\n## 当前项目文件（带行号）\n${numberedFiles}\n\n请根据修改需求输出变更清单。`,
      });
    } else if (isIteration && currentFiles) {
      // 迭代模式（全量文件）：传递受影响文件的完整内容
      // 从 features 中提取可能受影响的文件路径（简化：传递所有文件）
      const affectedPaths = Object.keys(currentFiles);
      const affectedFilesContent = formatAffectedFiles(currentFiles, affectedPaths);

      generateMessages.push({
        role: 'user',
        content: `${preferenceSection}## 功能清单\n${featureListStr}\n\n## 当前项目文件\n${affectedFilesContent}\n\n## 用户修改需求\n${prompt}${chatContextSection}\n\n请根据修改需求，**增量修改**需要变更的文件。只输出被修改的文件，未修改的文件不要输出。保持现有代码风格一致。`,
      });
    } else {
      // 首次生成模式
      const frameworkHint = getFrameworkHint(framework);
      generateMessages.push({
        role: 'user',
        content: `${preferenceSection}## 功能清单\n${featureListStr}\n\n## 用户需求\n${prompt}\n\n## 目标框架\n使用 **${framework}** 模式：${frameworkHint}\n\n请生成完整的多文件项目。`,
      });
    }

    // 工程师生成与解析（带格式错误重试）
    // 最多尝试 2 次：首次失败且检测到格式错误时重试一次
    let retryCount = 0;
    let formatErrorHint = '';
    let generatedOutput = '';
    let generateResult: { content: string; usage?: LLMUsage } | undefined;
    let finalFiles: Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }> | undefined;
    let changeList: ChangeList | undefined;
    let multiFileOutput: MultiFileOutput | undefined;
    let rescueNotice: string | null = null;
    let rescuedPaths: string[] = [];
    // 结构校验最终失败时的问题清单（降级交付不阻塞 done，见循环后处理）
    let validationIssues: ValidationIssue[] = [];

    // 解析格式重试：最多 3 次尝试（首次 + 格式提示重试 + 策略切换重试）
    const MAX_PARSE_ATTEMPTS = 3;
    // 重试循环
    for (let attempt = 0; attempt < MAX_PARSE_ATTEMPTS; attempt++) {
      // 重试时在提示词中强调格式要求，并向前端广播重试进度（retry 事件 + generate 阶段 delta）
      const retryMessages: ChatMessage[] = [...generateMessages];
      if (retryCount > 0 && formatErrorHint) {
        const isFinalStrategySwitch = retryCount >= MAX_PARSE_ATTEMPTS - 1;
        // 策略切换：两次格式纠正仍失败时，放弃"纠正"改用最强指令——
        // 给出最小正确的 JSON 结构示例，要求模型忽略增量修改思路、从零输出完整项目
        const strategySwitch = isFinalStrategySwitch
          ? `\n\n【最后一次尝试】请忽略之前"增量修改/变更清单"的思路，从零重新输出完整项目。格式必须严格为如下 JSON 结构（示例）：\n${useDiffMode ? '{ "changes": [ { "file": "/index.html", "edits": [ { "line": 3, "old": "旧行内容", "new": "新行内容", "type": "replace" } ], "summary": "变更摘要" } ] }' : '{ "files": [ { "path": "/index.html", "content": "<!DOCTYPE html><html>...完整文件内容...</html>", "language": "html" } ] }'}\n除该 JSON 外不要输出任何其他内容。`
          : '';
        const originalUserMsg = retryMessages[1]!.content;
        retryMessages[1] = {
          role: 'user',
          content: `${originalUserMsg}\n\n【重要】上次输出格式错误：${formatErrorHint}\n\n请确保输出格式正确：${useDiffMode ? 'diff 模式必须输出 { "changes": [...] } 格式，包含 file、edits、summary 字段' : '必须输出 { "files": [...] } 格式，每个文件包含 path、content、language 字段；禁止输出 { "changes": [...] } 变更清单格式'}${strategySwitch}`,
        };
        // 前端可见的重试进度：协议 retry 事件（liveEngine 在思考区渲染）+ 聊天区 delta 文本
        onEvent({
          type: 'retry',
          payload: {
            retry: {
              attempt: retryCount,
              maxRetries: MAX_PARSE_ATTEMPTS - 1,
              delayMs: 0,
              errorMessage: '输出格式不符合要求',
            },
          },
        });
        onEvent({
          type: 'delta',
          payload: {
            text: `\n[输出格式不符合要求，自动重试中（第 ${retryCount}/${MAX_PARSE_ATTEMPTS - 1} 次）${isFinalStrategySwitch ? '，已切换为完整重生成策略' : ''}]\n`,
            phase: 'generate',
          },
        });
        console.log(`[continueAfterApproval] 格式错误重试（第 ${retryCount}/${MAX_PARSE_ATTEMPTS - 1} 次）${isFinalStrategySwitch ? '，策略切换' : ''}`);
      }

      // 执行生成
      let accumulatedOutput = '';
      const result = await streamChatCompletionWithUsage(
        retryMessages,
        (text) => {
          accumulatedOutput += text;
          onEvent({ type: 'delta', payload: { text, phase: 'generate' } });
        },
        combinedSignal,
        { onRetry: forwardRetry }
      );
      generatedOutput = result.content;
      generateResult = result;

      if (combinedSignal.aborted) return;

      // 解析输出
      let parseSuccess = false;
      let shouldRetry = false;

      if (useDiffMode) {
        // diff 模式解析
        try {
          changeList = parseChangeList(generatedOutput);
          parseSuccess = true;

          // 空变更检查
          if (changeList.changes.length === 0) {
            console.info('[continueAfterApproval] diff 输出为空变更，转对话模式:', changeList.summary);
            pendingSessions.delete(sessionId);
            onEvent({
              type: 'done',
              payload: {
                html: '',
                files: {},
                analysis: changeList.summary || '本次未对代码做任何修改：未能确定需要变更的内容，请补充更具体的需求。',
                stats: result.usage ? {
                  inputTokens: result.usage.prompt_tokens,
                  outputTokens: result.usage.completion_tokens,
                } : undefined,
              },
            });
            return;
          }

          console.info(
            `[continueAfterApproval] diff 解析成功: ${changeList.changes.length} 个文件, ${changeList.changes.reduce((sum, c) => sum + c.edits.length, 0)} 处编辑`
          );

          // 应用变更
          const mergeBase = session.originalFiles ?? currentFiles ?? {};
          const { newFiles, appliedCount, errors } = applyChanges(mergeBase, changeList.changes);

          if (errors.length > 0) {
            console.warn('[continueAfterApproval] 部分编辑未成功应用:', errors.join('; '));
          }

          console.info(`[continueAfterApproval] 已应用 ${appliedCount} 处编辑`);

          const now = new Date().toISOString();
          finalFiles = {};
          for (const [path, file] of Object.entries(newFiles)) {
            finalFiles[path] = {
              path: file.path,
              content: file.content,
              language: file.language,
              updatedAt: now,
            };
          }
        } catch (diffError) {
          const errorMsg = diffError instanceof Error ? diffError.message : 'diff 解析失败';
          console.error('[continueAfterApproval] diff 解析失败:', errorMsg);
          changeList = undefined;

          // 检测是否应该重试
          shouldRetry = retryCount < MAX_PARSE_ATTEMPTS - 1 && (errorMsg.includes('格式') || generatedOutput.includes('"files"'));

          // 如果不重试，尝试降级为多文件解析
          if (!shouldRetry) {
            try {
              const parseResult = parseOutput(generatedOutput);
              if (parseResult.type === 'conversation') {
                pendingSessions.delete(sessionId);
                onEvent({ type: 'delta', payload: { text: parseResult.content || '', phase: 'generate' } });
                onEvent({
                  type: 'done',
                  payload: {
                    html: '',
                    files: {},
                    analysis: parseResult.content,
                    stats: result.usage ? {
                      inputTokens: result.usage.prompt_tokens,
                      outputTokens: result.usage.completion_tokens,
                    } : undefined,
                  },
                });
                return;
              }
              multiFileOutput = { files: parseResult.files! };
              parseSuccess = true;
            } catch (parseError) {
              const parseErrorMsg = parseError instanceof Error ? parseError.message : '输出解析失败';
              const rescued = repairTruncatedMultiFileOutput(generatedOutput);
              if (!rescued) {
                pendingSessions.delete(sessionId);
                // 最终失败：给用户明确说明与重试指引，技术细节只留服务端日志
                onEvent({
                  type: 'error',
                  payload: { message: `生成结果格式不符合要求，已自动重试 ${MAX_PARSE_ATTEMPTS - 1} 次仍未成功。请点击重试再次生成，或换一种描述方式（例如注明"重新生成完整页面"）。` },
                });
                return;
              }
              rescuedPaths = rescued.files.map(f => f.path);
              rescueNotice = `输出因长度限制被截断，已恢复 ${rescuedPaths.length} 个已完成文件`;
              multiFileOutput = rescued;
              parseSuccess = true;
            }
          } else {
            // 设置重试提示
            formatErrorHint = errorMsg;
          }
        }
      } else {
        // 非 diff 模式解析
        try {
          const parseResult = parseOutput(generatedOutput);

          if (parseResult.type === 'conversation') {
            console.log('[continueAfterApproval] 检测到纯文本对话内容，跳过代码生成');
            pendingSessions.delete(sessionId);
            onEvent({
              type: 'done',
              payload: {
                html: '',
                files: {},
                analysis: parseResult.content || generatedOutput,
                stats: result.usage ? {
                  inputTokens: result.usage.prompt_tokens,
                  outputTokens: result.usage.completion_tokens,
                } : undefined,
              },
            });
            return;
          }

          multiFileOutput = { files: parseResult.files! };
          parseSuccess = true;
        } catch (parseError) {
          const errorMsg = parseError instanceof Error ? parseError.message : '输出解析失败';
          console.error('[continueAfterApproval] 多文件解析失败:', errorMsg);

          // 智能容错：迭代模式下模型误输出 diff 模式的 { "changes": [...] } 变更清单。
          // 迭代模式必有现有文件上下文，复用 diff 模式的 applyChanges 将清单应用到
          // 现有文件，转换为全量文件走与非 diff 模式相同的交付流程，避免用户面对格式报错。
          // 仅当无法应用（无现有文件 / 清单为空 / 全部编辑不可应用）时降级走重试。
          if (isIteration && currentFiles) {
            try {
              const toleratedList = parseChangeList(generatedOutput);
              if (toleratedList.changes.length === 0) {
                // 与 diff 模式空变更处理一致：交付说明而非报错
                console.info('[continueAfterApproval] 容错解析到空变更，转对话模式:', toleratedList.summary);
                pendingSessions.delete(sessionId);
                onEvent({
                  type: 'done',
                  payload: {
                    html: '',
                    files: {},
                    analysis: toleratedList.summary || '本次未对代码做任何修改：未能确定需要变更的内容，请补充更具体的需求。',
                    stats: result.usage ? {
                      inputTokens: result.usage.prompt_tokens,
                      outputTokens: result.usage.completion_tokens,
                    } : undefined,
                  },
                });
                return;
              }

              const mergeBase = session.originalFiles ?? currentFiles;
              const { newFiles, appliedCount, errors } = applyChanges(mergeBase, toleratedList.changes);
              if (appliedCount > 0) {
                if (errors.length > 0) {
                  console.warn('[continueAfterApproval] changes 格式容错：部分编辑未成功应用:', errors.join('; '));
                }
                changeList = toleratedList;
                // 全量文件走正常交付流程（后续审查、finalFiles 组装与 diff 模式共用）
                multiFileOutput = { files: Object.values(newFiles) };
                parseSuccess = true;
                console.info(
                  `[continueAfterApproval] changes 格式容错成功: 应用 ${appliedCount} 处编辑，交付 ${Object.keys(newFiles).length} 个文件`
                );
              } else {
                console.warn('[continueAfterApproval] changes 格式容错失败：无可用编辑，降级走重试');
              }
            } catch (tolerantError) {
              // 输出不是合法的 changes 格式（多为截断的 files 输出），继续走重试/抢救
              const tolerantMsg = tolerantError instanceof Error ? tolerantError.message : 'changes 容错解析失败';
              console.info('[continueAfterApproval] 非 changes 格式，继续重试/抢救路径:', tolerantMsg);
            }
          }

          if (!parseSuccess) {
            // 检测是否是格式错误（files vs changes）
            const isFormatError = errorMsg.includes('输出格式错误') ||
                                 (generatedOutput.includes('"changes"') && !generatedOutput.includes('"files"'));
            shouldRetry = retryCount < MAX_PARSE_ATTEMPTS - 1 && isFormatError;

            if (!shouldRetry) {
              // 不重试，尝试抢救
              const rescued = repairTruncatedMultiFileOutput(generatedOutput);
              if (!rescued) {
                pendingSessions.delete(sessionId);
                // 最终失败：给用户明确说明与重试指引，技术细节只留服务端日志
                onEvent({
                  type: 'error',
                  payload: { message: `生成结果格式不符合要求，已自动重试 ${MAX_PARSE_ATTEMPTS - 1} 次仍未成功。请点击重试再次生成，或换一种描述方式（例如注明"重新生成完整页面"）。` },
                });
                return;
              }
              rescuedPaths = rescued.files.map(f => f.path);
              rescueNotice = `输出因长度限制被截断，已恢复 ${rescuedPaths.length} 个已完成文件`;
              multiFileOutput = rescued;
              parseSuccess = true;
            } else {
              // 设置重试提示
              formatErrorHint = errorMsg;
              console.log('[continueAfterApproval] 检测到格式错误，准备重试');
            }
          }
        }
      }

      // 三件套注入 + 确定性结构校验（P0 M4）：解析成功后执行
      if (parseSuccess) {
        // 统一解析产物为 finalFiles 候选（含合并基准），供注入与校验。
        // 每次尝试都从最新 multiFileOutput 重建，避免上一轮校验失败后的
        // 旧产物残留导致重试结果被忽略、校验永远命中同一批 stale 文件。
        // diff 模式不经过此处（finalFiles 直接赋值，multiFileOutput 保持 undefined）。
        if (multiFileOutput) {
          const mergeBase = isIteration && session.originalFiles ? session.originalFiles : currentFiles;
          finalFiles = isIteration && mergeBase
            ? toFileNodeRecord(multiFileOutput, mergeBase)
            : toFileNodeRecord(multiFileOutput);
        }
        if (finalFiles) {
          // 三件套注入：仅 create 全量流水线（modify/diff 不注入）；
          // LLM 已生成同名非空文件时不覆盖（尊重模型产出）
          if (!useDiffMode && !isIteration) {
            const blueprint = parseBlueprint(session.features);
            const scaffold = buildScaffoldDocs(blueprint, Object.keys(finalFiles), framework);
            for (const [scaffoldPath, scaffoldFile] of scaffold) {
              const existing = finalFiles[scaffoldPath];
              if (!existing || existing.content.trim().length === 0) {
                finalFiles[scaffoldPath] = { ...scaffoldFile, updatedAt: new Date().toISOString() };
              }
            }
          }
          // 确定性结构校验：注入保证类规则仅在 create 全量流水线强制，
          // modify/diff 仅查入口（P0 之前存量项目无 README/注册约定，不误报）
          const enforceP0 = !useDiffMode && !isIteration;
          const validation = validateProject(finalFiles, framework, {
            enforceScaffold: enforceP0,
            enforceGlobalReg: enforceP0,
          });
          if (validation.errors.length > 0) {
            const errorSummary = validation.errors.map((e) => `${e.file} ${e.message}`).join('；');
            console.warn('[continueAfterApproval] 结构校验失败:', errorSummary);
            if (retryCount < MAX_PARSE_ATTEMPTS - 1) {
              // 复用格式重试通道：带错误清单再来一次
              parseSuccess = false;
              shouldRetry = true;
              formatErrorHint = `项目结构不完整（${errorSummary}）。请修正后重新输出完整文件`;
            } else {
              // 重试额度耗尽：降级交付，记录问题清单
              validationIssues = validation.errors;
            }
          }
        }
      }

      // 如果解析成功或不需要重试，跳出循环
      if (parseSuccess || !shouldRetry) {
        break;
      }

      retryCount++;
    }

    // 处理 multiFileOutput（如果解析成功且需要转换为 finalFiles）
    if (multiFileOutput && !finalFiles) {
      const mergeBase = isIteration && session.originalFiles ? session.originalFiles : currentFiles;
      finalFiles = isIteration && mergeBase
        ? toFileNodeRecord(multiFileOutput, mergeBase)
        : toFileNodeRecord(multiFileOutput);
    }

    // 如果仍然没有 finalFiles，说明解析失败且重试耗尽
    if (!finalFiles) {
      pendingSessions.delete(sessionId);
      onEvent({ type: 'error', payload: { message: `生成结果格式不符合要求，已自动重试 ${MAX_PARSE_ATTEMPTS - 1} 次仍未成功。请点击重试或换一种描述方式。` } });
      return;
    }

    if (validationIssues.length > 0) {
      // 结构校验重试耗尽：降级交付不阻塞 done，经既有 delta 通道给一句人话提示（不新建前端 UI）
      const firstIssue = validationIssues[0]!;
      const notice = `提示：自动重试后仍有 ${validationIssues.length} 处结构问题（如：${firstIssue.message}），本次按现状交付；应用可继续使用，也可点击重试重新生成。`;
      console.warn(
        '[continueAfterApproval] 降级交付，结构问题:',
        validationIssues.map((e) => `${e.code}:${e.file}`).join('; ')
      );
      onEvent({ type: 'warning', payload: { message: notice } });
      onEvent({ type: 'delta', payload: { text: `\n${notice}\n`, phase: 'generate' } });
    }

    if (rescueNotice) {
      // 结构化 warning 事件入协议（前端 default 分支安全忽略，协议留档供后续消费）；
      // 同时以 delta 落入 generate 阶段的显示文本，让用户当场看到抢救结果
      onEvent({ type: 'warning', payload: { message: rescueNotice, rescuedFiles: rescuedPaths } });
      onEvent({ type: 'delta', payload: { text: `\n\n${rescueNotice}，不完整的文件已丢弃。`, phase: 'generate' } });
    }

    // 收集审查阶段的 usage（如果有）
    let reviewUsage: LLMUsage | undefined;

    // 阶段 3：审查（diff 模式跳过审查，非 diff 模式可配置跳过）
    if (useDiffMode) {
      // diff 模式：轻量级确认（变更已最小化，审查成本高）
      onEvent({ type: 'stage', payload: { phase: 'review', ...(intent ? { intent } : {}) } });
      onEvent({ type: 'delta', payload: { text: '变更已应用（diff 模式跳过审查）', phase: 'review' } });
    } else if (process.env.SKIP_REVIEW !== 'true' && multiFileOutput) {
      onEvent({ type: 'stage', payload: { phase: 'review', ...(intent ? { intent } : {}) } });

      const filesJson = JSON.stringify(multiFileOutput, null, 2);
      const reviewMessages: ChatMessage[] = [
        { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
        { role: 'user', content: `## 功能清单\n${featureListStr}\n\n## 待审查的项目文件\n${filesJson}\n\n请审查这个多文件项目。` },
      ];

      const reviewResult = await streamChatCompletionWithUsage(
        reviewMessages,
        (text) => onEvent({ type: 'delta', payload: { text, phase: 'review' } }),
        combinedSignal,
        { onRetry: forwardRetry }
      );
      reviewUsage = reviewResult.usage;
    } else {
      // 轻量级审查：仅发送确认
      onEvent({ type: 'stage', payload: { phase: 'review', ...(intent ? { intent } : {}) } });
      onEvent({ type: 'delta', payload: { text: '代码生成完成（审查已跳过）', phase: 'review' } });
    }

    if (combinedSignal.aborted) return;

    // 组装单文件 HTML（用于向后兼容和预览）
    // 使用 finalFiles（合并后的完整文件集），确保迭代模式下也能正确组装
    const allFiles = Object.values(finalFiles);
    const indexFile = allFiles.find(f => f.path === '/index.html');
    let assembledHtml = indexFile?.content || '';

    // 简单内联 CSS 和 JS 引用
    if (indexFile) {
      // 内联 CSS
      for (const file of allFiles.filter(f => f.language === 'css')) {
        const relativePath = '.' + file.path;
        const linkPattern = new RegExp(`<link[^>]*href=["']${escapeRegExp(relativePath)}["'][^>]*>`, 'gi');
        // 使用函数形式避免 file.content 中的 $&、$`、$'、$$ 被解释为替换模式
        assembledHtml = assembledHtml.replace(linkPattern, () => `<style>\n${file.content}\n</style>`);
      }

      // 内联 JS
      for (const file of allFiles.filter(f => f.language === 'javascript')) {
        const relativePath = '.' + file.path;
        const scriptPattern = new RegExp(`<script[^>]*src=["']${escapeRegExp(relativePath)}["'][^>]*>\\s*<\\/script>`, 'gi');
        // 使用函数形式避免 file.content 中的 $&、$`、$'、$$ 被解释为替换模式
        assembledHtml = assembledHtml.replace(scriptPattern, () => `<script>\n${file.content}\n</script>`);
      }
    }

    // 计算 token 统计：累加分析、工程师和审查阶段的 usage
    const totalStats = (() => {
      const analysisUsage = session.analysisUsage;
      const genUsage = generateResult?.usage;
      if (!analysisUsage && !genUsage && !reviewUsage) return undefined;
      return {
        inputTokens: (analysisUsage?.prompt_tokens ?? 0) + (genUsage?.prompt_tokens ?? 0) + (reviewUsage?.prompt_tokens ?? 0),
        outputTokens: (analysisUsage?.completion_tokens ?? 0) + (genUsage?.completion_tokens ?? 0) + (reviewUsage?.completion_tokens ?? 0),
      };
    })();

    // 完成：同时返回 html（向后兼容）和 files（多文件结构）
    onEvent({
      type: 'done',
      payload: {
        html: assembledHtml,
        files: finalFiles,
        stats: totalStats,
        // diff 模式：携带变更清单与摘要
        changes: changeList,
        changeSummary: changeList?.summary,
      },
    });

    // 清理会话
    pendingSessions.delete(sessionId);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // 取消时也要清理会话
      pendingSessions.delete(sessionId);
      onEvent({ type: 'error', payload: { message: '请求已取消' } });
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      onEvent({ type: 'error', payload: { message } });
    }
  } finally {
    // 清理控制器注册
    activeControllers.delete(sessionId);
  }
}

/**
 * 格式化全局偏好为可注入分析师 user prompt 的记忆块。
 * 分析师阶段只需要知道用户的全局偏好，项目偏好由工程师阶段注入。
 * 空偏好返回空字符串。
 */
function formatGlobalPreferencesForAnalyst(
  globalPreferences?: GenerateOptions['globalPreferences'],
): string {
  if (!globalPreferences) return '';

  const lines: string[] = [];
  if (globalPreferences.defaultFramework) {
    lines.push(`- 默认框架：${globalPreferences.defaultFramework}`);
  }
  if (globalPreferences.preferredLanguage) {
    lines.push(`- 首选语言：${globalPreferences.preferredLanguage}`);
  }
  if (globalPreferences.namingStyle) {
    lines.push(`- 命名风格：${globalPreferences.namingStyle}`);
  }
  if (globalPreferences.globalStyles && globalPreferences.globalStyles.length > 0) {
    lines.push(`- 样式偏好：${globalPreferences.globalStyles.join('、')}`);
  }
  if (globalPreferences.globalCorrections && globalPreferences.globalCorrections.length > 0) {
    lines.push(`- 纠正记录：${globalPreferences.globalCorrections.join('、')}`);
  }

  if (lines.length === 0) return '';

  return ['## 用户偏好记忆', ''].concat(lines, ['', '请在规划时参考以上偏好。', '']).join('\n');
}

/**
 * 格式化偏好为可注入工程师 user prompt 的"项目偏好档案"块。
 * 参考 Claude Code 记忆系统的 body 结构：规则在前，括号内给出 Why（用户原话）。
 * 空偏好返回空字符串，不产生多余空行。
 *
 * 支持三层记忆注入：
 * 1. 全局偏好（跨项目生效）：默认框架、语言、命名风格
 * 2. 项目偏好：样式、技术、纠正、其他
 */
function formatPreferencesSection(
  preferences: GenerateOptions['preferences'],
  globalPreferences?: GenerateOptions['globalPreferences'],
): string {
  const lines: string[] = [];

  // 全局偏好
  if (globalPreferences) {
    const globalLines: string[] = [];
    if (globalPreferences.defaultFramework) {
      globalLines.push(`- [全局] 默认框架：${globalPreferences.defaultFramework}`);
    }
    if (globalPreferences.preferredLanguage) {
      globalLines.push(`- [全局] 首选语言：${globalPreferences.preferredLanguage}`);
    }
    if (globalPreferences.namingStyle) {
      globalLines.push(`- [全局] 命名风格：${globalPreferences.namingStyle}`);
    }
    if (globalPreferences.globalStyles && globalPreferences.globalStyles.length > 0) {
      globalLines.push(`- [全局] 样式偏好：${globalPreferences.globalStyles.join('、')}`);
    }
    if (globalPreferences.globalCorrections && globalPreferences.globalCorrections.length > 0) {
      globalLines.push(`- [全局] 纠正记录：${globalPreferences.globalCorrections.join('、')}`);
    }

    if (globalLines.length > 0) {
      lines.push('## 全局偏好档案', '');
      lines.push(...globalLines);
      lines.push('');
    }
  }

  // 项目偏好
  if (preferences && preferences.length > 0) {
    lines.push('## 项目偏好档案', '');
    for (const pref of preferences) {
      const line = `- [${pref.type}] ${pref.key}: ${pref.value}${pref.reason ? `（Why: ${pref.reason}）` : ''}`;
      lines.push(line);
    }
    lines.push('');
  }

  if (lines.length === 0) return '';

  lines.push('请在生成时遵守以上偏好；与本次需求冲突时以本次需求为准。', '');
  return lines.join('\n');
}

/**
 * 根据框架返回提示文本，帮助模型理解应该使用哪种代码风格。
 */
function getFrameworkHint(framework: 'html' | 'react-cdn' | 'vue-cdn'): string {
  switch (framework) {
    case 'html':
      return '纯 HTML + Tailwind CDN，JavaScript 写在 <script> 标签中';
    case 'react-cdn':
      return 'React 组件（JSX），使用 ReactDOM.createRoot 挂载到 <div id="root">，<script> 标签使用 type="text/babel"';
    case 'vue-cdn':
      return 'Vue 单文件组件格式（<template> + <script> + <style>）或 Vue 3 Composition API，挂载到 <div id="app">';
    default:
      return '纯 HTML + Tailwind CDN';
  }
}

/** 分析/诊断流水线的共享入参 */
interface AnalystPipelineParams {
  prompt: string;
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>;
  intent: IntentResult;
  onEvent: (event: LLMEvent) => void;
  signal: AbortSignal;
}

/**
 * 构建分析/诊断模式的用户消息：用户问题 + 现有项目文件内容（如有）。
 */
function buildAnalystUserContent(
  prompt: string,
  currentFiles: AnalystPipelineParams['currentFiles']
): string {
  if (!currentFiles || Object.keys(currentFiles).length === 0) {
    return prompt;
  }
  const allPaths = Object.keys(currentFiles);
  return `${prompt}\n\n## 现有项目文件\n${formatAffectedFiles(currentFiles, allPaths)}`;
}

/**
 * 功能分析流水线（analyze 意图）：只跑分析师，结果经 done.analysis 返回，
 * 不进入工程阶段、无批准暂停。前端将 analysis 字段作为 assistant 消息展示。
 */
export async function runAnalyzePipeline({
  prompt,
  currentFiles,
  intent,
  onEvent,
  signal,
}: AnalystPipelineParams): Promise<void> {
  onEvent({ type: 'stage', payload: { phase: 'analysis', intent } });

  const messages: ChatMessage[] = [
    { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
    { role: 'user', content: buildAnalystUserContent(prompt, currentFiles) },
  ];

  const result = await streamChatCompletionWithUsage(
    messages,
    (text) => onEvent({ type: 'delta', payload: { text, phase: 'analysis' } }),
    signal
  );

  if (signal.aborted) return;

  onEvent({
    type: 'done',
    payload: {
      analysis: result.content,
      stats: result.usage ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
      } : undefined,
    },
  });
}

/**
 * 问题诊断流水线（diagnose 意图）：分析师以诊断模式定位问题并输出结构化
 * 诊断 JSON，经 done.analysis 返回（{problem, rootCause, affectedFiles,
 * fixSuggestions}），不进入工程阶段。
 */
export async function runDiagnosePipeline({
  prompt,
  currentFiles,
  intent,
  onEvent,
  signal,
}: AnalystPipelineParams): Promise<void> {
  onEvent({ type: 'stage', payload: { phase: 'diagnose', intent } });

  const messages: ChatMessage[] = [
    { role: 'system', content: DIAGNOSE_SYSTEM_PROMPT },
    { role: 'user', content: buildAnalystUserContent(prompt, currentFiles) },
  ];

  const result = await streamChatCompletionWithUsage(
    messages,
    (text) => onEvent({ type: 'delta', payload: { text, phase: 'diagnose' } }),
    signal
  );

  if (signal.aborted) return;

  onEvent({
    type: 'done',
    payload: {
      analysis: result.content,
      stats: result.usage ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
      } : undefined,
    },
  });
}

/** 对话模式系统提示词（conversation 意图：纯对话、问候、澄清等，不生成代码） */
const CONVERSATION_SYSTEM_PROMPT = `你是 Litpp 平台的智能助手。用户正在与你进行对话，可能是在打招呼、致谢、询问概念或澄清需求。你的任务是以友好、专业的方式回应。

## 输出要求
- 用简体中文回复（用户用英文时可用英文）
- 友好、简洁、专业
- 如果用户的需求不明确，温和地追问或提供引导
- 如果用户想创建或修改应用，引导他们描述具体需求
- 不要输出代码或 JSON，只输出对话内容`;

/**
 * 对话流水线（conversation 意图）：纯对话回复，不进入代码生成流程。
 * 结果经 done.analysis 返回，前端作为 assistant 消息展示。
 */
export async function runConversationPipeline({
  prompt,
  intent,
  onEvent,
  signal,
}: Omit<AnalystPipelineParams, 'currentFiles'>): Promise<void> {
  onEvent({ type: 'stage', payload: { phase: 'analysis', intent } });

  const messages: ChatMessage[] = [
    { role: 'system', content: CONVERSATION_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  const result = await streamChatCompletionWithUsage(
    messages,
    (text) => onEvent({ type: 'delta', payload: { text, phase: 'analysis' } }),
    signal
  );

  if (signal.aborted) return;

  onEvent({
    type: 'done',
    payload: {
      analysis: result.content,
      stats: result.usage ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
      } : undefined,
    },
  });
}

/**
 * 迭代修改直通流水线（modify 意图）：跳过分析师与批准，直接进入工程师
 * 增量修改 → 审查者。复用 continueAfterApproval：合成单条"用户修改需求"
 * 功能清单写入待批准会话，避免重复实现工程阶段。
 */
export async function runDirectModifyPipeline({
  prompt,
  currentFiles,
  intent,
  chatTurns,
  originalRequest,
  preferences,
  globalPreferences,
  framework,
  onEvent,
  signal,
}: AnalystPipelineParams & {
  chatTurns?: ChatTurnInput[];
  originalRequest?: string;
  preferences?: GenerateOptions['preferences'];
  globalPreferences?: GenerateOptions['globalPreferences'];
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
}): Promise<void> {
  if (!currentFiles) return;

  // 智能裁剪：只携带相关文件及其依赖
  const allFilePaths = Object.keys(currentFiles);
  const trimResult = trimContext(prompt, currentFiles, {
    pathMatchThreshold: 0.35, // 提高路径匹配阈值，避免误匹配
    contentMatchThreshold: 0.15,
    includeEntry: true, // 默认携带入口文件，避免修改工具函数时丢失引用方
  });
  const trimmedFilePaths = trimResult.trimmedPaths;

  // 输出裁剪日志
  console.info(
    '[runDirectModifyPipeline] 上下文裁剪:',
    `${trimmedFilePaths.length}/${allFilePaths.length} 文件`,
    `关键词: [${trimResult.keywords.join(', ')}]`,
    `匹配: 路径=${trimResult.stats.matchedByPath}, 内容=${trimResult.stats.matchedByContent}, 依赖=${trimResult.stats.addedByDependency}`
  );

  // 计算节省的 token
  const savings = calculateTokenSavings(currentFiles, trimmedFilePaths);
  if (savings.savedTokens > 0) {
    console.info(
      '[runDirectModifyPipeline] Token 节省:',
      `${savings.savedTokens} (${savings.savedPercent.toFixed(1)}%)`,
      `${savings.trimmedTokens}/${savings.totalTokens}`
    );
  }

  // 使用裁剪后的文件集合
  const trimmedFiles: Record<string, { path: string; content: string; language: FileLanguage }> = {};
  for (const path of trimmedFilePaths) {
    const file = currentFiles[path];
    if (file) {
      trimmedFiles[path] = file;
    }
  }

  // 合成功能清单：无分析师参与，用户修改需求即变更项
  const features = {
    appTitle: '',
    appType: 'other',
    summary: `迭代修改：${prompt.slice(0, 80)}`,
    features: [
      { id: 'M1', name: '用户修改需求', description: prompt, priority: 'must' },
    ],
    interactions: [],
    assumptions: [],
  };

  const sessionId = crypto.randomUUID();
  pendingSessions.set(sessionId, {
    prompt,
    currentFiles: trimmedFiles, // 存入裁剪后的文件
    // 保留原始文件引用，用于后续合并时保留未变更文件
    originalFiles: currentFiles,
    analysisResult: JSON.stringify(features),
    features,
    chatContextBlock: buildChatContextBlock(chatTurns ?? [], originalRequest),
    chatTurns,
    originalRequest,
    preferences,
    globalPreferences,
    framework,
    useDiffMode: true, // modify 意图使用 diff 模式
    createdAt: new Date(),
  });

  // 首个 stage 事件（generate）与后续 review 事件由 continueAfterApproval
  // 发出并附着 intent；错误由其内部 catch 兜底（不向上抛，避免双重 error 事件）
  await continueAfterApproval(sessionId, onEvent, signal, intent);
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============== Diff 模式：变更清单解析与应用 ============== */

/**
 * 格式化文件内容为带行号标注的形式（diff 模式输入）。
 * 格式：路径，然后每行 "N | content"。
 */
function formatFilesWithLineNumbers(
  files: Record<string, { path: string; content: string; language: FileLanguage }>
): string {
  return Object.values(files)
    .map((file) => {
      const lines = file.content.split('\n');
      const numbered = lines
        .map((line, i) => `${i + 1} | ${line}`)
        .join('\n');
      return `### ${file.path}\n${numbered}`;
    })
    .join('\n\n');
}

/**
 * 解析工程师 diff 输出为 ChangeList。
 * 支持剥离 markdown 围栏。解析失败抛出错误。
 */
export function parseChangeList(output: string): ChangeList {
  // 剥离可能的 markdown 围栏
  let cleaned = output.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = firstNewline === -1 ? '' : cleaned.slice(firstNewline + 1);
  }
  if (cleaned.endsWith('```')) {
    const lastNewline = cleaned.lastIndexOf('\n');
    cleaned = lastNewline === -1 ? '' : cleaned.slice(0, lastNewline);
  }
  cleaned = cleaned.trim();

  // 括号配平提取首个完整 JSON 对象（避免贪婪匹配跨多个 JSON 块）
  let depth = 0;
  let start = -1;
  let jsonStr: string | null = null;

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        jsonStr = cleaned.slice(start, i + 1);
        break;
      }
    }
  }

  const finalJsonStr = jsonStr || cleaned;
  const parsed = JSON.parse(finalJsonStr);

  // 校验结构
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('变更清单不是 JSON 对象');
  }
  if (!Array.isArray(parsed.changes)) {
    throw new Error('变更清单缺少 changes 数组');
  }
  if (typeof parsed.summary !== 'string') {
    parsed.summary = '';
  }

  // 校验每个变更
  for (const change of parsed.changes) {
    if (typeof change.file !== 'string' || !change.file) {
      throw new Error('变更缺少 file 字段');
    }
    if (!Array.isArray(change.edits)) {
      throw new Error(`文件 ${change.file} 的变更缺少 edits 数组`);
    }
    for (const edit of change.edits) {
      if (typeof edit.line !== 'number' || edit.line < 1) {
        throw new Error(`文件 ${change.file} 的编辑缺少有效 line 字段`);
      }
      if (!['replace', 'insert', 'delete'].includes(edit.type)) {
        throw new Error(`文件 ${change.file} 的编辑 type 非法: ${edit.type}`);
      }
      if (typeof edit.old !== 'string') edit.old = '';
      if (typeof edit.new !== 'string') edit.new = '';
    }
  }

  return parsed as ChangeList;
}

/**
 * 将变更清单应用到文件集合。
 *
 * 校验规则：
 * - old 字段与实际行精确匹配（宽松模式：trim 后匹配也可接受）
 * - 行号从大到小应用（避免行号偏移）
 *
 * 返回 { newFiles, appliedCount, errors }：
 * - appliedCount：成功应用的编辑数
 * - errors：失败的编辑及其原因（部分失败仍返回更新后的文件）
 */
export function applyChanges(
  files: Record<string, { path: string; content: string; language: FileLanguage }>,
  changes: FileChange[]
): {
  newFiles: Record<string, { path: string; content: string; language: FileLanguage }>;
  appliedCount: number;
  errors: string[];
} {
  const newFiles = { ...files };
  let appliedCount = 0;
  const errors: string[] = [];

  for (const change of changes) {
    const file = newFiles[change.file];
    if (!file) {
      errors.push(`文件不存在: ${change.file}`);
      continue;
    }

    const lines = file.content.split('\n');

    // 编辑按行号从大到小应用（避免行号偏移）
    const sortedEdits = [...change.edits].sort((a, b) => b.line - a.line);

    for (const edit of sortedEdits) {
      const idx = edit.line - 1;

      if (idx < 0 || idx > lines.length) {
        errors.push(`${change.file}:${edit.line} 行号超出文件范围（共 ${lines.length} 行）`);
        continue;
      }

      // 校验 old 字段（宽松匹配：精确匹配或 trim 后匹配）
      const actualLine = idx < lines.length ? lines[idx] : '';
      const oldMatch = edit.old === actualLine || edit.old.trim() === actualLine.trim();
      if (!oldMatch && edit.old.trim().length > 0) {
        // 不匹配但 old 非空，记录警告但继续应用（信任 LLM 的定位）
        console.warn(
          `[applyChanges] ${change.file}:${edit.line} old 字段不匹配\n期望: "${edit.old}"\n实际: "${actualLine}"`
        );
      }

      if (edit.type === 'insert') {
        // 在指定行后插入（idx 为目标行索引，在其后插入）
        const newLines = edit.new.split('\n');
        if (idx === lines.length) {
          // 行号指向文件末尾之后，追加到末尾
          lines.push(...newLines);
        } else {
          lines.splice(idx + 1, 0, ...newLines);
        }
        appliedCount++;
      } else if (edit.type === 'delete') {
        if (idx >= lines.length) {
          errors.push(`${change.file}:${edit.line} 行号超出文件范围`);
          continue;
        }
        lines.splice(idx, 1);
        appliedCount++;
      } else {
        // replace
        if (idx >= lines.length) {
          errors.push(`${change.file}:${edit.line} 行号超出文件范围`);
          continue;
        }
        lines[idx] = edit.new;
        appliedCount++;
      }
    }

    newFiles[change.file] = {
      ...file,
      content: lines.join('\n'),
    };
  }

  return { newFiles, appliedCount, errors };
}