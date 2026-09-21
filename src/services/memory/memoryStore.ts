/**
 * 记忆存储层：负责全局偏好的持久化与读取。
 * 项目偏好已有 preferences.ts 实现，此处只处理全局记忆。
 */

import type { GlobalPreferences, MemoryContext, MemoryUpdateEvent, PreferenceItem } from '../../types/memory';
import type { ProjectPreference } from '../../types/project';

const GLOBAL_PREFERENCES_KEY = 'atoms:global-preferences';
const MEMORY_EVENTS_KEY = 'atoms:memory-events';

/** 获取当前 ISO 时间戳 */
function now(): string {
  return new Date().toISOString();
}

/**
 * 加载全局偏好。
 */
export function loadGlobalPreferences(): GlobalPreferences {
  try {
    const raw = localStorage.getItem(GLOBAL_PREFERENCES_KEY);
    if (!raw) return {};

    const prefs: GlobalPreferences = JSON.parse(raw);
    return prefs;
  } catch (error) {
    console.warn('[MemoryStore] 加载全局偏好失败:', error);
    return {};
  }
}

/**
 * 保存全局偏好。
 */
export function saveGlobalPreferences(prefs: GlobalPreferences): void {
  try {
    prefs.updatedAt = now();
    localStorage.setItem(GLOBAL_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn('[MemoryStore] 保存全局偏好失败:', error);
  }
}

/**
 * 更新全局偏好项。
 */
export function updateGlobalPreference<K extends keyof GlobalPreferences>(
  key: K,
  value: GlobalPreferences[K],
): void {
  const prefs = loadGlobalPreferences();
  prefs[key] = value;
  saveGlobalPreferences(prefs);
}

/**
 * 添加全局样式偏好。
 */
export function addGlobalStyle(style: string): void {
  const prefs = loadGlobalPreferences();
  if (!prefs.globalStyles) prefs.globalStyles = [];
  if (!prefs.globalStyles.includes(style)) {
    prefs.globalStyles.push(style);
    saveGlobalPreferences(prefs);
  }
}

/**
 * 添加全局纠正记录。
 */
export function addGlobalCorrection(correction: string): void {
  const prefs = loadGlobalPreferences();
  if (!prefs.globalCorrections) prefs.globalCorrections = [];
  if (!prefs.globalCorrections.includes(correction)) {
    prefs.globalCorrections.push(correction);
    saveGlobalPreferences(prefs);
  }
}

/**
 * 记录记忆更新事件（用于召回）。
 */
export function recordMemoryEvent(event: Omit<MemoryUpdateEvent, 'timestamp'>): void {
  try {
    const raw = localStorage.getItem(MEMORY_EVENTS_KEY);
    const events: MemoryUpdateEvent[] = raw ? JSON.parse(raw) : [];

    events.push({
      ...event,
      timestamp: now(),
    });

    // 只保留最近 50 条事件
    if (events.length > 50) {
      events.shift();
    }

    localStorage.setItem(MEMORY_EVENTS_KEY, JSON.stringify(events));
  } catch (error) {
    console.warn('[MemoryStore] 记录记忆事件失败:', error);
  }
}

/**
 * 加载记忆更新事件。
 */
export function loadMemoryEvents(): MemoryUpdateEvent[] {
  try {
    const raw = localStorage.getItem(MEMORY_EVENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[MemoryStore] 加载记忆事件失败:', error);
    return [];
  }
}

/**
 * 构建完整的记忆上下文（用于注入 prompt）。
 * @param projectId 项目 ID（用于加载项目偏好）
 * @param projectPreferences 项目偏好（已从外部加载）
 */
export function buildMemoryContext(
  projectPreferences: ProjectPreference[],
): MemoryContext {
  const globalPrefs = loadGlobalPreferences();

  return {
    projectPreferences: projectPreferences.map(p => ({
      type: p.type as 'style' | 'tech' | 'correction' | 'preference',
      key: p.key,
      value: p.value,
      ...(p.reason ? { reason: p.reason } : {}),
    })),
    globalPreferences: globalPrefs,
  };
}

/**
 * 格式化记忆上下文为可读文本（用于 Recall 查询）。
 */
export function formatMemoryContext(context: MemoryContext): string {
  const lines: string[] = [];

  // 全局偏好
  const global = context.globalPreferences;
  if (global.defaultFramework || global.preferredLanguage || global.namingStyle) {
    lines.push('## 全局偏好');
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
  if (context.projectPreferences.length > 0) {
    lines.push('## 项目偏好');
    const grouped = groupBy(context.projectPreferences, 'type');
    for (const [type, prefs] of Object.entries(grouped)) {
      lines.push(`### ${getPreferenceTypeLabel(type)}`);
      for (const pref of prefs) {
        const reason = pref.reason ? `（${pref.reason}）` : '';
        lines.push(`- ${pref.key}: ${pref.value}${reason}`);
      }
    }
  }

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

/**
 * 从全局偏好中提取可注入 prompt 的偏好列表。
 * 用于与项目偏好合并。
 */
export function extractGlobalPreferenceList(): PreferenceItem[] {
  const prefs = loadGlobalPreferences();
  const result: PreferenceItem[] = [];

  // 默认框架
  if (prefs.defaultFramework) {
    result.push({
      type: 'tech',
      key: 'default-framework',
      value: prefs.defaultFramework,
      reason: '用户全局偏好',
    });
  }

  // 首选语言
  if (prefs.preferredLanguage) {
    result.push({
      type: 'preference',
      key: 'preferred-language',
      value: prefs.preferredLanguage,
      reason: '用户全局偏好',
    });
  }

  // 命名风格
  if (prefs.namingStyle) {
    result.push({
      type: 'preference',
      key: 'naming-style',
      value: prefs.namingStyle,
      reason: '用户全局偏好',
    });
  }

  // 全局样式偏好
  if (prefs.globalStyles) {
    for (const style of prefs.globalStyles) {
      result.push({
        type: 'style',
        key: 'global-style',
        value: style,
        reason: '用户全局偏好',
      });
    }
  }

  // 全局纠正记录
  if (prefs.globalCorrections) {
    for (const correction of prefs.globalCorrections) {
      result.push({
        type: 'correction',
        key: 'global-correction',
        value: correction,
        reason: '用户全局偏好',
      });
    }
  }

  return result;
}