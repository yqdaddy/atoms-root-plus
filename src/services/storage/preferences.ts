/**
 * 项目偏好记忆存储层。
 * 每个项目独立存储，key 格式：atoms:v1:preferences:{projectId}
 * 限制：每个项目最多 20 条偏好，超出后采用 FIFO 淘汰。
 */

import type { ProjectPreference, IsoDateTime } from '../../types/project';
import { storageKey, CURRENT_SCHEMA_VERSION, type StorageEnvelope } from '../../types/storage';

/** 每个项目最多保留的偏好数量 */
const MAX_PREFERENCES_PER_PROJECT = 20;

/** 偏好存储的信封格式 */
type PreferenceEnvelope = StorageEnvelope<ProjectPreference[]>;

/** 获取当前 ISO 时间戳 */
function now(): IsoDateTime {
  return new Date().toISOString();
}

/** 生成 UUID v4 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 加载项目的所有偏好。
 * 返回偏好数组，解析失败返回空数组。
 */
export function loadPreferences(projectId: string): ProjectPreference[] {
  try {
    const key = storageKey('preferences', projectId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];

    const envelope: PreferenceEnvelope = JSON.parse(raw);
    // 验证 envelope 结构
    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      !Array.isArray(envelope.data)
    ) {
      console.warn(`[Preferences] 损坏的偏好数据，已丢弃：${key}`);
      return [];
    }

    return envelope.data;
  } catch (error) {
    console.warn('[Preferences] 加载偏好失败，已丢弃:', error);
    return [];
  }
}

/**
 * 保存项目的偏好列表。
 * 写入失败时静默降级。
 */
function savePreferences(projectId: string, preferences: ProjectPreference[]): void {
  try {
    const key = storageKey('preferences', projectId);
    const envelope: PreferenceEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: now(),
      data: preferences,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch (error) {
    console.warn('[Preferences] 保存偏好失败:', error);
  }
}

/**
 * 添加或更新偏好。
 * - 如果相同 key 已存在，更新 value 和 updatedAt
 * - 如果不存在，新增偏好
 * - 超出数量限制时，删除最旧的偏好
 */
export function upsertPreference(
  projectId: string,
  type: ProjectPreference['type'],
  key: string,
  value: string,
  reason?: string,
): ProjectPreference {
  const preferences = loadPreferences(projectId);

  // 查找是否已存在相同 key 的偏好
  const existingIndex = preferences.findIndex((p) => p.key === key);

  const timestamp = now();

  if (existingIndex >= 0) {
    // 更新现有偏好
    const existing = preferences[existingIndex];
    if (!existing) {
      // 理论上不会发生，但做类型守卫
      throw new Error('Existing preference not found');
    }
    const updated: ProjectPreference = {
      ...existing,
      type,
      value,
      updatedAt: timestamp,
    };
    // 只在提供了 reason 时才更新
    if (reason !== undefined) {
      updated.reason = reason;
    }
    preferences[existingIndex] = updated;
    savePreferences(projectId, preferences);
    return updated;
  }

  // 新增偏好
  const newPreference: ProjectPreference = {
    id: generateId(),
    projectId,
    type,
    key,
    value,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  // 只在提供了 reason 时才添加
  if (reason !== undefined) {
    newPreference.reason = reason;
  }

  // 检查数量限制
  if (preferences.length >= MAX_PREFERENCES_PER_PROJECT) {
    // 按 updatedAt 排序，删除最旧的
    preferences.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    preferences.shift();
  }

  preferences.push(newPreference);
  savePreferences(projectId, preferences);
  return newPreference;
}

/**
 * 删除指定偏好。
 */
export function deletePreference(projectId: string, preferenceId: string): boolean {
  const preferences = loadPreferences(projectId);
  const index = preferences.findIndex((p) => p.id === preferenceId);

  if (index < 0) return false;

  preferences.splice(index, 1);
  savePreferences(projectId, preferences);
  return true;
}

/**
 * 按 key 删除偏好。
 */
export function deletePreferenceByKey(projectId: string, key: string): boolean {
  const preferences = loadPreferences(projectId);
  const index = preferences.findIndex((p) => p.key === key);

  if (index < 0) return false;

  preferences.splice(index, 1);
  savePreferences(projectId, preferences);
  return true;
}

/**
 * 清空项目的所有偏好。
 */
export function clearPreferences(projectId: string): void {
  try {
    const key = storageKey('preferences', projectId);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('[Preferences] 清空偏好失败:', error);
  }
}