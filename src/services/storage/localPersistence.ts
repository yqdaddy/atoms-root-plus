/**
 * 本地持久化辅助函数。
 * 独立模块避免循环依赖。
 */
import type { Project, ProjectSummary, IsoDateTime } from '../../types/project';
import { storageKey, CURRENT_SCHEMA_VERSION, type StorageEnvelope } from '../../types/storage';

/** 获取当前 ISO 时间戳 */
function now(): IsoDateTime {
  return new Date().toISOString();
}

/**
 * 写回前校验/补齐的字段清单：必填字段 + 行为必需的可选字段（framework 参与迭代请求
 * 的框架取值）。任何路径写回项目时，若内存态对象缺失这些字段，用既有持久化值补齐。
 */
const PROJECT_GUARDED_FIELDS = [
  'id',
  'name',
  'description',
  'status',
  'framework',
  'files',
  'chat',
  'preview',
  'createdAt',
  'updatedAt',
] as const;

/**
 * 从摘要索引恢复项目 framework：摘要与详情的 framework 在创建时同源写入，
 * 既有详情已丢失该字段时（历史脏写污染的记录），摘要索引是最后的恢复来源。
 */
function frameworkFromSummariesIndex(id: string): Project['framework'] {
  try {
    const raw = localStorage.getItem(storageKey('projects'));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: { summaries?: ProjectSummary[] } } | null;
    return parsed?.state?.summaries?.find((s) => s.id === id)?.framework;
  } catch {
    return undefined;
  }
}

/**
 * 将项目详情持久化到 localStorage。
 * envelope 格式与 loadProject 的读取约定对应（schemaVersion + savedAt + data）。
 * 写入失败（quota 超限等）时静默降级：内存态仍可用，仅失去刷新恢复能力。
 *
 * 字段完整性防御：崩溃恢复、服务端合并等路径可能产生缺字段的项目对象，
 * 写回前与既有持久化值逐字段比对，缺失的字段用旧值补齐，防止把字段丢失固化到 localStorage。
 */
export function persistProjectDetail(project: Project): void {
  try {
    const key = storageKey('projects', project.id);
    let data = project;

    const existingRaw = localStorage.getItem(key);
    if (existingRaw) {
      try {
        const existing = (JSON.parse(existingRaw) as StorageEnvelope<Project> | null)?.data;
        if (existing) {
          for (const field of PROJECT_GUARDED_FIELDS) {
            if (data[field] === undefined && existing[field] !== undefined) {
              data = { ...data, [field]: existing[field] } as Project;
            }
          }
        }
      } catch {
        // 既有数据损坏则按原样写入
      }
    }

    // 兜底：既有详情本就没有 framework（历史脏写污染）时，从摘要索引恢复
    if (data.framework === undefined) {
      const summaryFramework = frameworkFromSummariesIndex(project.id);
      if (summaryFramework) {
        data = { ...data, framework: summaryFramework };
      }
    }

    const envelope: StorageEnvelope<Project> = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: now(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // 存储失败静默降级
  }
}