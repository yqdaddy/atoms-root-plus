/**
 * 隔离备份机制。
 * 将解析失败或迁移失败的数据隔离存储，避免静默丢弃。
 */

import type { QuarantineMeta } from '../../types/storage';
import { storageKey } from '../../types/storage';

/**
 * 隔离备份数据结构。
 * 包含原始数据、错误原因和隔离时间。
 */
interface QuarantineEntry {
  /** 原始 localStorage key */
  originalKey: string;
  /** 隔离原因 */
  reason: string;
  /** 隔离时间 */
  quarantinedAt: string;
  /** 原始数据（原始字符串） */
  rawData: string;
}

/**
 * 将数据隔离备份到 localStorage。
 *
 * @param originalKey 原始 localStorage key
 * @param rawData 原始数据字符串
 * @param reason 隔离原因
 * @returns 备份 ID（用于后续恢复或清理）
 */
export function quarantineData(originalKey: string, rawData: string, reason: string): string {
  const backupId = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const timestamp = new Date().toISOString();

  const entry: QuarantineEntry = {
    originalKey,
    reason,
    quarantinedAt: timestamp,
    rawData,
  };

  try {
    // 存储隔离数据
    localStorage.setItem(storageKey('backup', backupId), JSON.stringify(entry));

    // 更新隔离索引
    const indexKey = storageKey('backup', 'index');
    const rawIndex = localStorage.getItem(indexKey);
    const index = rawIndex ? JSON.parse(rawIndex) : [];
    index.push({
      backupId,
      originalKey,
      reason,
      quarantinedAt: timestamp,
    });
    localStorage.setItem(indexKey, JSON.stringify(index));

    return backupId;
  } catch {
    // localStorage 满了，尝试清理旧的备份
    try {
      cleanupOldQuarantines(5); // 保留最近的 5 个备份
      localStorage.setItem(storageKey('backup', backupId), JSON.stringify(entry));
      return backupId;
    } catch {
      // 仍然失败，静默降级
      console.warn(`隔离备份失败: ${originalKey}`);
      return '';
    }
  }
}

/**
 * 恢复隔离的数据。
 *
 * @param backupId 备份 ID
 * @returns 原始数据字符串，或 null（不存在）
 */
export function restoreQuarantine(backupId: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey('backup', backupId));
    if (!raw) return null;

    const entry = JSON.parse(raw) as QuarantineEntry;
    return entry.rawData;
  } catch {
    return null;
  }
}

/**
 * 列出所有隔离备份。
 */
export function listQuarantines(): QuarantineMeta[] {
  try {
    const rawIndex = localStorage.getItem(storageKey('backup', 'index'));
    if (!rawIndex) return [];
    return JSON.parse(rawIndex) as QuarantineMeta[];
  } catch {
    return [];
  }
}

/**
 * 清理旧的隔离备份。
 *
 * @param keepCount 保留最近的备份数量
 */
export function cleanupOldQuarantines(keepCount: number): void {
  try {
    const quarantines = listQuarantines();

    if (quarantines.length <= keepCount) return;

    // 按隔离时间降序排序
    const sorted = quarantines.sort((a, b) =>
      new Date(b.quarantinedAt).getTime() - new Date(a.quarantinedAt).getTime()
    );

    // 删除旧的备份
    const toRemove = sorted.slice(keepCount);
    for (const meta of toRemove) {
      try {
        localStorage.removeItem(storageKey('backup', meta.backupId || ''));
      } catch {
        // 忽略删除错误
      }
    }

    // 更新索引
    const newIndex = sorted.slice(0, keepCount);
    localStorage.setItem(storageKey('backup', 'index'), JSON.stringify(newIndex));
  } catch {
    // 忽略清理错误
  }
}

/**
 * 清理所有隔离备份。
 */
export function clearAllQuarantines(): void {
  try {
    const quarantines = listQuarantines();
    for (const meta of quarantines) {
      try {
        localStorage.removeItem(storageKey('backup', meta.backupId || ''));
      } catch {
        // 忽略删除错误
      }
    }
    localStorage.removeItem(storageKey('backup', 'index'));
  } catch {
    // 忽略清理错误
  }
}