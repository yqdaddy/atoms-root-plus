/**
 * 记忆服务统一入口。
 * 负责加载、合并项目偏好和全局偏好，并提供给 AI 生成流程。
 */

import { loadPreferences } from '../storage/preferences';
import {
  loadGlobalPreferences,
  extractGlobalPreferenceList,
  buildMemoryContext,
  formatMemoryContext,
  updateGlobalPreference,
  addGlobalStyle,
  addGlobalCorrection,
} from './memoryStore';
import { recallMemory, isRecallQuery, generateRecallResponse } from './memoryRecall';
import type { PreferenceItem } from '../../types/memory';

export type { GlobalPreferences, MemoryContext, MemoryRecallResult, PreferenceItem } from '../../types/memory';

// 重导出子模块
export { loadGlobalPreferences, extractGlobalPreferenceList, buildMemoryContext, formatMemoryContext };
export { recallMemory, isRecallQuery, generateRecallResponse };

/**
 * 加载完整的记忆上下文（项目偏好 + 全局偏好）。
 * 用于注入到 AI 生成请求中。
 *
 * @param projectId 项目 ID（可选，不传则只加载全局偏好）
 * @returns 记忆上下文
 */
export function loadMemoryForGeneration(projectId?: string) {
  // 加载项目偏好
  const projectPrefs = projectId ? loadPreferences(projectId) : [];

  // 加载全局偏好
  const globalPrefs = loadGlobalPreferences();

  // 提取全局偏好列表（与项目偏好合并）
  const globalPrefList = extractGlobalPreferenceList();

  // 合并偏好：全局偏好在前，项目偏好在后
  const allPreferences: PreferenceItem[] = [
    ...globalPrefList,
    ...projectPrefs.map(p => ({
      type: p.type as 'style' | 'tech' | 'correction' | 'preference',
      key: p.key,
      value: p.value,
      ...(p.reason ? { reason: p.reason } : {}),
    }) as PreferenceItem),
  ];

  // 构建格式化文本（用于 Recall 查询）
  const context = buildMemoryContext(projectPrefs);
  const formatted = formatMemoryContext(context);

  return {
    projectPreferences: allPreferences,
    globalPreferences: globalPrefs,
    formatted,
  };
}

/**
 * 从用户消息中提取全局偏好并更新。
 * 当用户明确表达全局偏好时（如"以后都用 React"），更新全局偏好。
 *
 * @param message 用户消息
 */
export function extractAndUpdateGlobalPreferences(message: string): void {
  // 框架偏好
  if (/以后.*用\s*react|默认.*react/i.test(message)) {
    updateGlobalPreference('defaultFramework', 'react-cdn');
  }
  if (/以后.*用\s*vue|默认.*vue/i.test(message)) {
    updateGlobalPreference('defaultFramework', 'vue-cdn');
  }
  if (/以后.*用\s*html|默认.*html/i.test(message)) {
    updateGlobalPreference('defaultFramework', 'html');
  }

  // 语言偏好
  if (/以后.*用\s*中文|默认.*中文/i.test(message)) {
    updateGlobalPreference('preferredLanguage', 'zh');
  }
  if (/以后.*用\s*英文|默认.*英文/i.test(message)) {
    updateGlobalPreference('preferredLanguage', 'en');
  }

  // 命名风格
  if (/camelCase|驼峰/i.test(message)) {
    updateGlobalPreference('namingStyle', 'camelCase');
  }
  if (/snake_case|下划线/i.test(message)) {
    updateGlobalPreference('namingStyle', 'snake_case');
  }

  // 全局样式
  if (/以后.*深色|以后.*暗色/i.test(message)) {
    addGlobalStyle('深色主题');
  }
  if (/以后.*极简|以后.*简约/i.test(message)) {
    addGlobalStyle('极简风格');
  }

  // 全局纠正
  if (/以后.*不要.*渐变|以后.*禁用.*渐变/i.test(message)) {
    addGlobalCorrection('不要渐变');
  }
  if (/以后.*不要.*动画|以后.*禁用.*动画/i.test(message)) {
    addGlobalCorrection('不要动画');
  }
}