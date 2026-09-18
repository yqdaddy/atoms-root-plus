/**
 * 导出/导入数据格式。
 */

import type { Project, ProjectSummary } from '../../types/project';

/** 导出版本号，与 schemaVersion 独立。仅当导出格式发生不可逆变化时才升级。 */
export const EXPORT_VERSION = '1.0' as const;

/** 导出数据结构 */
export interface ExportData {
  /** 导出格式版本 */
  version: typeof EXPORT_VERSION;
  /** 导出时间戳 */
  exportedAt: string; // ISO timestamp
  /** 导出的项目列表（完整数据，非摘要） */
  projects: Project[];
  /** 可选：导出时的设置 */
  settings?: {
    providerId?: string;
    theme?: 'light' | 'dark' | 'system';
    deviceMode?: 'desktop' | 'tablet' | 'mobile';
  };
  /** 可选：导出时的摘要列表（用于版本回溯） */
  summaries?: ProjectSummary[];
}

/** 导入选项 */
export interface ImportOptions {
  /** true = 合并现有项目，false = 覆盖全部项目 */
  merge: boolean;
  /** true = 跳过 ID 重复的项目，false = 覆盖重复项目 */
  skipDuplicates: boolean;
  /** 导入时的项目 ID 前缀（用于避免冲突） */
  idPrefix?: string;
}

/** 导入结果 */
export interface ImportResult {
  /** 是否成功（即使有错误，只要有项目导入成功即为 true） */
  success: boolean;
  /** 成功导入的项目数量 */
  imported: number;
  /** 跳过的项目数量（重复或无效） */
  skipped: number;
  /** 错误信息列表 */
  errors: string[];
  /** 导入的项目 ID 列表 */
  importedIds: string[];
}