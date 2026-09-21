/**
 * 迭代摘要工具：将历史对话与当前状态压缩为 9 段式结构化摘要。
 * 设计依据：Claude Code services/compact/prompt.ts
 * 场景：迭代模式下传递给工程师角色，避免全量重发历史对话。
 */

import type { ChatTurnInput } from '../llm.js';

/** 当前项目文件快照 */
export interface ProjectSnapshot {
  files: Record<string, { path: string; content: string; language: string }>;
  appTitle?: string;
}

/** 摘要构建输入 */
export interface IterationSummaryInput {
  /** 历史对话轮次（时间升序） */
  turns: ChatTurnInput[];
  /** 当前项目文件快照 */
  snapshot?: ProjectSnapshot;
  /** 本次用户修改需求 */
  currentPrompt: string;
  /** 原始需求（首次输入） */
  originalRequest?: string;
}

/** 9 段式摘要结构（中文标签） */
export interface NineSectionSummary {
  /** 1. 主要请求与意图 */
  primaryRequest: string;
  /** 2. 关键技术概念 */
  keyConcepts: string[];
  /** 3. 文件与代码片段 */
  filesAndCode: Array<{
    path: string;
    importance: string;
    changes?: string;
    snippet?: string;
  }>;
  /** 4. 错误与修复 */
  errorsAndFixes: Array<{
    error: string;
    fix: string;
    userFeedback?: string;
  }>;
  /** 5. 问题解决 */
  problemSolving: string;
  /** 6. 所有用户消息 */
  userMessages: string[];
  /** 7. 待处理任务 */
  pendingTasks: string[];
  /** 8. 当前工作 */
  currentWork: string;
  /** 9. 下一步行动 */
  nextStep?: string;
}

/** 摘要 token 预算配置 */
const SUMMARY_CONFIG = {
  /** 总 token 上限（约 2000 中文 token） */
  MAX_TOTAL_CHARS: 3000,
  /** 单段字符上限 */
  MAX_SECTION_CHARS: 600,
  /** 文件片段字符上限 */
  MAX_SNIPPET_CHARS: 200,
  /** 用户消息条数上限（最近 N 条） */
  MAX_USER_MESSAGES: 5,
} as const;

/**
 * 构建 9 段式迭代摘要文本。
 * 输出为可直接注入工程师 prompt 的文本块。
 */
export function buildIterationSummary(input: IterationSummaryInput): string {
  const summary = extractNineSectionSummary(input);
  return formatSummaryAsText(summary, input.currentPrompt);
}

/**
 * 从历史对话提取 9 段式摘要结构。
 * 当前实现：基于启发式规则提取关键信息。
 * 未来优化：可接入 LLM 做语义压缩。
 */
function extractNineSectionSummary(input: IterationSummaryInput): NineSectionSummary {
  const { turns, snapshot, currentPrompt, originalRequest } = input;

  // 1. 主要请求与意图
  const primaryRequest = originalRequest || currentPrompt;

  // 2. 关键技术概念：从文件语言推断
  const keyConcepts = extractKeyConcepts(snapshot, turns);

  // 3. 文件与代码片段：当前快照 + 变更摘要
  const filesAndCode = extractFilesAndCode(snapshot, turns);

  // 4. 错误与修复：从对话中提取错误关键词
  const errorsAndFixes = extractErrorsAndFixes(turns);

  // 5. 问题解决：基于错误修复与用户反馈推断
  const problemSolving = summarizeProblemSolving(errorsAndFixes, turns);

  // 6. 所有用户消息：提取最近 N 条非工具调用消息
  const userMessages = extractUserMessages(turns, originalRequest);

  // 7. 待处理任务：当前用户需求
  const pendingTasks = [currentPrompt];

  // 8. 当前工作：最新一轮交互的描述
  const currentWork = summarizeCurrentWork(turns, currentPrompt);

  // 9. 下一步行动：基于当前需求的行动建议
  const nextStep = inferNextStep(currentPrompt, snapshot);

  return {
    primaryRequest,
    keyConcepts,
    filesAndCode,
    errorsAndFixes,
    problemSolving,
    userMessages,
    pendingTasks,
    currentWork,
    nextStep,
  };
}

/**
 * 提取关键技术概念
 */
function extractKeyConcepts(
  snapshot: ProjectSnapshot | undefined,
  turns: ChatTurnInput[]
): string[] {
  const concepts: Set<string> = new Set();

  // 从文件语言推断
  if (snapshot?.files) {
    const languages = new Set(
      Object.values(snapshot.files).map(f => f.language)
    );
    if (languages.has('html')) concepts.add('HTML 结构');
    if (languages.has('css')) concepts.add('CSS 样式');
    if (languages.has('javascript')) concepts.add('JavaScript 交互');
  }

  // 从对话中提取关键词
  const techKeywords = ['图表', '表单', '动画', '响应式', 'localStorage', 'Canvas', '游戏'];
  const allContent = turns.map(t => t.content).join(' ');
  techKeywords.forEach(kw => {
    if (allContent.includes(kw)) concepts.add(kw);
  });

  return Array.from(concepts).slice(0, 6);
}

/**
 * 提取文件与代码片段信息
 */
function extractFilesAndCode(
  snapshot: ProjectSnapshot | undefined,
  turns: ChatTurnInput[]
): NineSectionSummary['filesAndCode'] {
  if (!snapshot?.files) return [];

  const result: NineSectionSummary['filesAndCode'] = [];
  const entries = Object.values(snapshot.files);

  // 优先展示入口文件
  const indexFile = entries.find(f => f.path === '/index.html');
  if (indexFile) {
    result.push({
      path: '/index.html',
      importance: '入口文件，包含 HTML 结构与资源引用',
      snippet: indexFile.content.slice(0, SUMMARY_CONFIG.MAX_SNIPPET_CHARS),
    });
  }

  // 展示主要脚本与样式
  entries
    .filter(f => f.path !== '/index.html')
    .slice(0, 3)
    .forEach(file => {
      result.push({
        path: file.path,
        importance: `${file.language} 文件`,
        snippet: file.content.slice(0, SUMMARY_CONFIG.MAX_SNIPPET_CHARS),
      });
    });

  return result;
}

/**
 * 从对话中提取错误与修复记录
 */
function extractErrorsAndFixes(turns: ChatTurnInput[]): NineSectionSummary['errorsAndFixes'] {
  const result: NineSectionSummary['errorsAndFixes'] = [];
  const errorPatterns = [
    /错误[：:]\s*(.+)/,
    /报错[：:]\s*(.+)/,
    /失败[：:]\s*(.+)/,
    /(.*?)\s*不工作/,
    /(.*?)\s*没有效果/,
  ];

  // 扫描用户消息中的错误描述
  for (let i = 0; i < turns.length - 1; i++) {
    const turn = turns[i];
    if (turn?.role !== 'user') continue;

    const content = turn.content;
    for (const pattern of errorPatterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        // 后续助手消息作为修复
        const nextTurn = turns[i + 1];
        if (nextTurn?.role === 'assistant') {
          result.push({
            error: match[1].trim().slice(0, 100),
            fix: nextTurn.content.trim().slice(0, 100),
          });
        }
        break;
      }
    }

    if (result.length >= 3) break; // 最多 3 条
  }

  return result;
}

/**
 * 总结问题解决过程
 */
function summarizeProblemSolving(
  errorsAndFixes: NineSectionSummary['errorsAndFixes'],
  turns: ChatTurnInput[]
): string {
  if (errorsAndFixes.length === 0) {
    // 无显式错误时，从迭代次数推断
    const userTurns = turns.filter(t => t.role === 'user').length;
    if (userTurns > 2) {
      return `已进行 ${userTurns} 轮迭代修改，持续优化应用功能与体验。`;
    }
    return '应用按需求逐步构建，无明显问题。';
  }

  return `已解决 ${errorsAndFixes.length} 个问题，包括：${errorsAndFixes.map(e => e.error).join('、')}。`;
}

/**
 * 提取所有用户消息（最近 N 条）
 */
function extractUserMessages(
  turns: ChatTurnInput[],
  originalRequest?: string
): string[] {
  const userMessages: string[] = [];
  const userTurns = turns.filter(t => t.role === 'user');

  // 从后向前取最近 N 条
  const recentTurns = userTurns.slice(-SUMMARY_CONFIG.MAX_USER_MESSAGES);

  recentTurns.forEach((turn, idx) => {
    const msg = turn.content.trim();
    if (idx === 0 && originalRequest && msg === originalRequest.trim()) {
      // 首条与原始需求相同时标注
      userMessages.push(`[原始需求] ${msg.slice(0, SUMMARY_CONFIG.MAX_SECTION_CHARS)}`);
    } else {
      userMessages.push(msg.slice(0, SUMMARY_CONFIG.MAX_SECTION_CHARS));
    }
  });

  return userMessages;
}

/**
 * 总结当前工作状态
 */
function summarizeCurrentWork(turns: ChatTurnInput[], currentPrompt: string): string {
  // 最后一条用户消息即为当前工作
  const lastUserTurn = turns.filter(t => t.role === 'user').pop();

  if (lastUserTurn) {
    const lastContent = lastUserTurn.content.trim();
    if (lastContent === currentPrompt.trim()) {
      return `用户提出修改需求：${currentPrompt}`;
    }
  }

  return `正在响应用户的最新修改需求：${currentPrompt}`;
}

/**
 * 推断下一步行动
 */
function inferNextStep(
  currentPrompt: string,
  snapshot: ProjectSnapshot | undefined
): string | undefined {
  // 简单策略：根据关键词推断
  const actionKeywords: Record<string, string> = {
    '添加': '新增指定功能模块',
    '修改': '调整现有功能实现',
    '删除': '移除指定功能或组件',
    '修复': '修正报告的问题',
    '优化': '改进性能或体验',
  };

  for (const [keyword, action] of Object.entries(actionKeywords)) {
    if (currentPrompt.includes(keyword)) {
      return `${action}，保持现有代码风格一致。`;
    }
  }

  // 默认：按用户需求处理
  return `按用户需求"${currentPrompt.slice(0, 50)}"执行增量修改。`;
}

/**
 * 将 9 段式摘要格式化为文本块
 */
function formatSummaryAsText(
  summary: NineSectionSummary,
  currentPrompt: string
): string {
  const sections: string[] = [];

  // 标题
  sections.push('## 历史对话摘要（迭代上下文）');
  sections.push('');

  // 1. 主要请求与意图
  sections.push('### 1. 主要请求与意图');
  sections.push(summary.primaryRequest);
  sections.push('');

  // 2. 关键技术概念
  if (summary.keyConcepts.length > 0) {
    sections.push('### 2. 关键技术概念');
    summary.keyConcepts.forEach(c => sections.push(`- ${c}`));
    sections.push('');
  }

  // 3. 文件与代码片段
  if (summary.filesAndCode.length > 0) {
    sections.push('### 3. 文件与代码片段');
    summary.filesAndCode.forEach(f => {
      sections.push(`- **${f.path}**`);
      sections.push(`  - ${f.importance}`);
      if (f.snippet) {
        sections.push(`  - 代码片段：\`${f.snippet.slice(0, 50)}…\``);
      }
    });
    sections.push('');
  }

  // 4. 错误与修复
  if (summary.errorsAndFixes.length > 0) {
    sections.push('### 4. 错误与修复');
    summary.errorsAndFixes.forEach(e => {
      sections.push(`- 错误：${e.error}`);
      sections.push(`  - 修复：${e.fix}`);
    });
    sections.push('');
  }

  // 5. 问题解决
  sections.push('### 5. 问题解决');
  sections.push(summary.problemSolving);
  sections.push('');

  // 6. 所有用户消息
  if (summary.userMessages.length > 0) {
    sections.push('### 6. 所有用户消息');
    summary.userMessages.forEach((msg, idx) => {
      sections.push(`${idx + 1}. ${msg}`);
    });
    sections.push('');
  }

  // 7. 待处理任务
  sections.push('### 7. 待处理任务');
  summary.pendingTasks.forEach(t => sections.push(`- ${t}`));
  sections.push('');

  // 8. 当前工作
  sections.push('### 8. 当前工作');
  sections.push(summary.currentWork);
  sections.push('');

  // 9. 下一步行动
  if (summary.nextStep) {
    sections.push('### 9. 下一步行动');
    sections.push(summary.nextStep);
    sections.push('');
  }

  // 引用原文（防止任务漂移）
  sections.push('---');
  sections.push('**引用原文**：用户最新需求为 "' + currentPrompt.slice(0, 100) + '"');
  sections.push('');

  const result = sections.join('\n');

  // 长度控制
  if (result.length > SUMMARY_CONFIG.MAX_TOTAL_CHARS) {
    return result.slice(0, SUMMARY_CONFIG.MAX_TOTAL_CHARS) + '\n\n[摘要已截断]';
  }

  return result;
}

/**
 * 计算摘要的预估 token 数（中文按 1.5 字符/token，英文按 4 字符/token）
 */
export function estimateSummaryTokens(text: string): number {
  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}