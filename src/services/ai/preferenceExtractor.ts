/**
 * 项目偏好提取器。
 * 在生成完成后，分析用户反馈提取偏好。
 *
 * 提取规则：
 * - 纠正类反馈（"不要 X", "别用 X"）→ correction
 * - 风格类反馈（"深色模式", "极简风格"）→ style
 * - 技术类反馈（"用 React", "用 Tailwind"）→ tech
 * - 其他明确偏好 → preference
 */

import type { ProjectPreference } from '../../types/project';
import { upsertPreference } from '../storage/preferences';

/** 偏好提取规则 */
interface ExtractionRule {
  /** 匹配模式（关键词或正则） */
  patterns: (string | RegExp)[];
  /** 提取的偏好类型 */
  type: ProjectPreference['type'];
  /** 提取的偏好 key */
  key: string;
  /** 提取的偏好值 */
  value: string;
  /** 是否匹配 */
  match: (text: string) => boolean;
}

/** 预定义的提取规则 */
const EXTRACTION_RULES: ExtractionRule[] = [
  // 风格类
  {
    patterns: ['深色', '暗色', 'dark mode', '深色模式'],
    type: 'style',
    key: 'color-scheme',
    value: 'dark',
    match: (text) => /深色|暗色|dark\s*mode/i.test(text),
  },
  {
    patterns: ['浅色', '亮色', 'light mode', '浅色模式'],
    type: 'style',
    key: 'color-scheme',
    value: 'light',
    match: (text) => /浅色|亮色|light\s*mode/i.test(text),
  },
  {
    patterns: ['极简', 'minimal', '简约'],
    type: 'style',
    key: 'design-style',
    value: 'minimal',
    match: (text) => /极简|minimal|简约/i.test(text),
  },
  {
    patterns: ['渐变', 'gradient'],
    type: 'correction',
    key: 'avoid-gradients',
    value: 'true',
    match: (text) => /不要渐变|禁用渐变|不要.*渐变/i.test(text),
  },

  // 技术类
  {
    patterns: ['React', 'react'],
    type: 'tech',
    key: 'framework',
    value: 'react',
    match: (text) => /用\s*react|使用\s*react/i.test(text),
  },
  {
    patterns: ['Vue', 'vue'],
    type: 'tech',
    key: 'framework',
    value: 'vue',
    match: (text) => /用\s*vue|使用\s*vue/i.test(text),
  },
  {
    patterns: ['Tailwind', 'tailwind'],
    type: 'tech',
    key: 'css-framework',
    value: 'tailwind',
    match: (text) => /用\s*tailwind|使用\s*tailwind/i.test(text),
  },

  // 纠正类
  {
    patterns: ['不要动画', '去掉动画', 'no animation'],
    type: 'correction',
    key: 'avoid-animations',
    value: 'true',
    match: (text) => /不要动画|去掉动画|no\s*animation/i.test(text),
  },
  {
    patterns: ['不要紫色', '禁用紫色', 'no purple'],
    type: 'correction',
    key: 'avoid-purple',
    value: 'true',
    match: (text) => /不要紫色|禁用紫色|no\s*purple/i.test(text),
  },
];

/**
 * 从用户反馈中提取偏好。
 * @param projectId 项目 ID
 * @param userFeedback 用户的反馈文本（如修改要求、纠正意见）
 * @returns 新提取的偏好列表
 */
export function extractPreferences(
  projectId: string,
  userFeedback: string,
): ProjectPreference[] {
  const extracted: ProjectPreference[] = [];

  for (const rule of EXTRACTION_RULES) {
    if (rule.match(userFeedback)) {
      // 提取偏好，记录用户原话作为 reason
      const preference = upsertPreference(
        projectId,
        rule.type,
        rule.key,
        rule.value,
        `用户反馈: "${userFeedback.slice(0, 100)}"`,
      );
      extracted.push(preference);
    }
  }

  return extracted;
}

/**
 * 批量提取偏好，支持多轮对话。
 * @param projectId 项目 ID
 * @param messages 对话消息列表（user 角色）
 */
export function extractFromMessages(
  projectId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): ProjectPreference[] {
  const extracted: ProjectPreference[] = [];

  // 只分析 user 消息
  const userMessages = messages.filter((m) => m.role === 'user');

  for (const message of userMessages) {
    const prefs = extractPreferences(projectId, message.content);
    extracted.push(...prefs);
  }

  return extracted;
}