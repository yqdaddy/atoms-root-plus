/**
 * 本地持久化辅助函数。
 * 独立模块避免循环依赖。
 */
import type { Project, IsoDateTime } from '../../types/project';
import { storageKey, CURRENT_SCHEMA_VERSION, type StorageEnvelope } from '../../types/storage';

/** 获取当前 ISO 时间戳 */
function now(): IsoDateTime {
  return new Date().toISOString();
}

/**
 * 将项目详情持久化到 localStorage。
 * envelope 格式与 loadProject 的读取约定对应（schemaVersion + savedAt + data）。
 * 写入失败（quota 超限等）时静默降级：内存态仍可用，仅失去刷新恢复能力。
 */
export function persistProjectDetail(project: Project): void {
  try {
    const envelope: StorageEnvelope<Project> = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: now(),
      data: project,
    };
    localStorage.setItem(storageKey('projects', project.id), JSON.stringify(envelope));
  } catch {
    // 存储失败静默降级
  }
}