/**
 * 跨会话记忆类型定义。
 * 分三层：项目级记忆（项目内生效）+ 全局记忆（跨项目生效）+ 会话记忆（可选）。
 */

import type { IsoDateTime } from './project';

/**
 * 全局用户偏好：跨项目生效。
 * 存储在 localStorage['litpp:global-preferences']。
 */
export interface GlobalPreferences {
  /** 默认框架 */
  defaultFramework?: 'html' | 'react-cdn' | 'vue-cdn';
  /** 首选语言 */
  preferredLanguage?: 'zh' | 'en';
  /** 命名风格 */
  namingStyle?: 'camelCase' | 'snake_case' | 'PascalCase';
  /** 全局样式偏好（跨项目通用） */
  globalStyles?: string[];
  /** 全局纠正记录（跨项目通用） */
  globalCorrections?: string[];
  /** 最后更新时间 */
  updatedAt?: IsoDateTime;
}

/**
 * 会话记忆：存储在 IndexedDB（可选实现）。
 * 用于召回历史对话。
 */
export interface SessionMemory {
  /** 会话 ID */
  id: string;
  /** 项目 ID */
  projectId: string;
  /** 对话消息 */
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: IsoDateTime;
  }>;
  /** 压缩后的摘要 */
  summary?: string;
  /** 创建时间 */
  createdAt: IsoDateTime;
  /** 最后更新时间 */
  updatedAt: IsoDateTime;
}

/**
 * 偏好项格式（统一类型，避免 exactOptionalPropertyTypes 冲突）。
 */
export interface PreferenceItem {
  type: 'style' | 'tech' | 'correction' | 'preference';
  key: string;
  value: string;
  reason?: string;
}

/**
 * 完整的记忆结构（用于注入到 prompt）。
 */
export interface MemoryContext {
  /** 项目偏好（从 localStorage['litpp:v1:preferences:{projectId}'] 加载） */
  projectPreferences: PreferenceItem[];
  /** 全局偏好（从 localStorage['litpp:global-preferences'] 加载） */
  globalPreferences: GlobalPreferences;
  /** 会话摘要（可选） */
  sessionSummary?: string;
}

/**
 * 记忆召回查询结果。
 */
export interface MemoryRecallResult {
  /** 项目偏好 */
  projectPreferences: PreferenceItem[];
  /** 全局偏好 */
  globalPreferences: GlobalPreferences;
  /** 格式化后的可读文本 */
  formatted: string;
}

/**
 * 记忆更新事件。
 */
export interface MemoryUpdateEvent {
  type: 'project_preference' | 'global_preference';
  key: string;
  value: string;
  reason?: string;
  projectId?: string;
  timestamp: IsoDateTime;
}