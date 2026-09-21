/**
 * 记忆召回功能：响应用户查询偏好的请求。
 * 支持：
 * - "我之前说过什么偏好？"
 * - "我的设置有哪些？"
 * - "记得我的框架选择吗？"
 */

import { loadPreferences } from '../storage/preferences';
import {
  loadGlobalPreferences,
  formatMemoryContext,
  buildMemoryContext,
  loadMemoryEvents,
} from './memoryStore';
import type { MemoryRecallResult } from '../../types/memory';

/**
 * 召回记忆：返回项目和全局偏好。
 */
export function recallMemory(projectId?: string): MemoryRecallResult {
  // 加载项目偏好
  const projectPrefs = projectId ? loadPreferences(projectId) : [];

  // 加载全局偏好
  const globalPrefs = loadGlobalPreferences();

  // 构建上下文
  const context = buildMemoryContext(projectPrefs);

  // 格式化输出
  const formatted = formatMemoryContext(context);

  return {
    projectPreferences: context.projectPreferences,
    globalPreferences: globalPrefs,
    formatted,
  };
}

/**
 * 召回最近的记忆事件。
 */
export function recallRecentEvents(limit = 10): Array<{
  type: string;
  key: string;
  value: string;
  timestamp: string;
}> {
  const events = loadMemoryEvents();
  return events
    .slice(-limit)
    .map(e => ({
      type: e.type,
      key: e.key,
      value: e.value,
      timestamp: e.timestamp,
    }));
}

/**
 * 判断用户消息是否为 Recall 查询（纯查询偏好，非生成意图）。
 *
 * 规则：
 * 1. 包含特定查询关键词（偏好/设置/配置/记忆）
 * 2. 不包含生成意图词（创建/生成/做/实现/写/帮我/帮我做）
 * 3. 或者以问句结尾且包含"我.*说/要求/提过"等回忆性词汇
 */
export function isRecallQuery(message: string): boolean {
  // 生成意图关键词：包含这些词的消息不应被拦截
  const generationIntentPatterns = [
    /创建/,
    /生成/,
    /做/,
    /实现/,
    /写/,
    /帮我/,
    /帮我做/,
    /做一个/,
    /做一个.*应用/,
    /做一个.*页面/,
  ];

  // 如果包含生成意图，直接返回 false
  if (generationIntentPatterns.some(p => p.test(message))) {
    return false;
  }

  // 纯查询模式：必须同时包含查询关键词和问句特征
  const queryKeywords = ['偏好', '设置', '配置', '记忆'];
  const hasQueryKeyword = queryKeywords.some(k => message.includes(k));
  const endsWithQuestion = message.includes('？') || message.includes('?');

  // 模式 1：包含查询关键词 + 问句结尾
  if (hasQueryKeyword && endsWithQuestion) {
    return true;
  }

  // 模式 2：特定查询句式（不包含生成意图）
  const pureQueryPatterns = [
    /^我.*(偏好|设置|配置|记忆)/,  // "我的偏好"
    /^查看.*偏好/,                  // "查看偏好"
    /^显示.*偏好/,                  // "显示偏好"
    /^偏好.*有哪些/,               // "偏好有哪些"
    /^记得.*吗/,                   // "记得吗"
    /^记得.*么/,                   // "记得么"
    /^recall/i,
  ];

  return pureQueryPatterns.some(p => p.test(message));
}

/**
 * 生成 Recall 响应文本。
 */
export function generateRecallResponse(result: MemoryRecallResult): string {
  const lines: string[] = [];

  if (result.projectPreferences.length === 0 && Object.keys(result.globalPreferences).length === 0) {
    return '我还没有记录您的偏好。您可以在对话中告诉我您的偏好，比如"我喜欢深色主题"、"以后用 Vue 框架"等。';
  }

  lines.push('以下是我记录的您的偏好：\n');

  // 全局偏好
  const global = result.globalPreferences;
  if (global.defaultFramework || global.preferredLanguage || global.namingStyle) {
    lines.push('**全局偏好**（跨项目生效）：');
    if (global.defaultFramework) {
      lines.push(`- 默认框架：${global.defaultFramework}`);
    }
    if (global.preferredLanguage) {
      lines.push(`- 首选语言：${global.preferredLanguage}`);
    }
    if (global.namingStyle) {
      lines.push(`- 命名风格：${global.namingStyle}`);
    }
    if (global.globalStyles && global.globalStyles.length > 0) {
      lines.push(`- 样式偏好：${global.globalStyles.join('、')}`);
    }
    if (global.globalCorrections && global.globalCorrections.length > 0) {
      lines.push(`- 纠正记录：${global.globalCorrections.join('、')}`);
    }
    lines.push('');
  }

  // 项目偏好
  if (result.projectPreferences.length > 0) {
    lines.push('**当前项目偏好**：');
    const grouped = groupBy(result.projectPreferences, 'type');
    for (const [type, prefs] of Object.entries(grouped)) {
      const label = getPreferenceTypeLabel(type);
      lines.push(`\n**${label}**：`);
      for (const pref of prefs) {
        const reason = pref.reason ? `（${pref.reason}）` : '';
        lines.push(`- ${pref.key}: ${pref.value}${reason}`);
      }
    }
  }

  lines.push('\n您可以在任何时候修改这些偏好，只需告诉我新的要求即可。');

  return lines.join('\n');
}

/**
 * 分组辅助函数。
 */
function groupBy<T, K extends keyof T>(
  array: T[],
  key: K,
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of array) {
    const groupKey = String(item[key]);
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
  }
  return result;
}

/**
 * 偏好类型标签。
 */
function getPreferenceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    style: '样式偏好',
    tech: '技术偏好',
    correction: '纠正记录',
    preference: '其他偏好',
  };
  return labels[type] || type;
}