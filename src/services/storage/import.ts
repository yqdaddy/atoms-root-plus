/**
 * 数据导入功能。
 * 解析 JSON 文件并恢复项目。
 */

import type { ExportData, ImportOptions, ImportResult } from './types';
import { EXPORT_VERSION } from './types';
import { storageKey, CURRENT_SCHEMA_VERSION } from '../../types/storage';
import type { StorageEnvelope } from '../../types/storage';
import type { Project } from '../../types/project';
import { isProject } from '../../types/project';
import { quarantineData } from './quarantine';

/**
 * 导入项目数据。
 *
 * @param json JSON 字符串
 * @param options 导入选项
 * @returns 导入结果
 */
export function importProjects(json: string, options: ImportOptions): ImportResult {
  const result: ImportResult = {
    success: false,
    imported: 0,
    skipped: 0,
    errors: [],
    importedIds: [],
  };

  // 1. 解析 JSON
  let data: ExportData;
  try {
    data = JSON.parse(json) as ExportData;
  } catch (err) {
    result.errors.push(`JSON 解析失败: ${err}`);
    return result;
  }

  // 2. 验证导出格式版本
  if (data.version !== EXPORT_VERSION) {
    result.errors.push(`不支持的导出版本: ${data.version}，期望 ${EXPORT_VERSION}`);
    return result;
  }

  // 3. 验证项目列表
  if (!Array.isArray(data.projects)) {
    result.errors.push('缺少 projects 字段或格式错误');
    return result;
  }

  if (data.projects.length === 0) {
    result.errors.push('没有可导入的项目');
    return result;
  }

  // 4. 获取当前项目 ID 列表
  const existingIds = new Set(getAllProjectIds());

  // 5. 处理覆盖模式
  if (!options.merge) {
    // 覆盖模式：清空现有项目
    const allIds = Array.from(existingIds);
    for (const id of allIds) {
      try {
        localStorage.removeItem(storageKey('projects', id));
      } catch {
        // 忽略删除错误
      }
    }
    existingIds.clear();
  }

  // 6. 逐个导入项目
  for (const project of data.projects) {
    const importResult = importSingleProject(project, existingIds, options);

    if (importResult.success) {
      result.imported++;
      if (importResult.id) {
        result.importedIds.push(importResult.id);
        existingIds.add(importResult.id);
      }
    } else {
      result.skipped++;
      if (importResult.error) {
        result.errors.push(importResult.error);
      }
    }
  }

  // 7. 标记成功
  if (result.imported > 0) {
    result.success = true;
  }

  return result;
}

/**
 * 获取所有项目 ID。
 */
function getAllProjectIds(): string[] {
  const ids: string[] = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('atoms:v1:projects:') || key === 'atoms:v1:projects') {
        continue;
      }

      // 提取项目 ID
      const parts = key.split(':');
      if (parts.length === 4) {
        ids.push(parts[3]!);
      }
    }
  } catch {
    // 忽略扫描错误
  }

  return ids;
}

/**
 * 导入单个项目。
 */
function importSingleProject(
  project: unknown,
  existingIds: Set<string>,
  options: ImportOptions
): { success: boolean; id?: string; error?: string } {
  // 1. 验证项目结构
  if (!isProject(project)) {
    // 数据损坏，隔离备份
    const backupId = quarantineData(
      'import',
      JSON.stringify(project),
      '项目结构验证失败'
    );
    return {
      success: false,
      error: `项目结构验证失败，已备份 (ID: ${backupId})`,
    };
  }

  // 2. 处理 ID 冲突
  let finalId = project.id;
  let finalProject = project;
  if (existingIds.has(project.id)) {
    if (options.skipDuplicates) {
      return {
        success: false,
        error: `项目 ID 冲突，跳过: ${project.id}`,
      };
    }

    // 生成新 ID
    const prefix = options.idPrefix || 'imported-';
    finalId = `${prefix}${project.id}-${Date.now()}`;
    finalProject = { ...project, id: finalId };
  }

  // 3. 写入 localStorage
  try {
    const envelope: StorageEnvelope<Project> = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      data: finalProject,
    };
    localStorage.setItem(storageKey('projects', finalId), JSON.stringify(envelope));

    return { success: true, id: finalId };
  } catch (err) {
    return {
      success: false,
      error: `写入失败: ${err}`,
    };
  }
}

/**
 * 验证导出文件的完整性。
 *
 * @param json JSON 字符串
 * @returns 验证结果
 */
export function validateExportFile(json: string): {
  valid: boolean;
  projectCount: number;
  version: string;
  errors: string[];
} {
  const errors: string[] = [];
  let projectCount = 0;
  let version = '';

  try {
    const data = JSON.parse(json) as ExportData;

    if (data.version !== EXPORT_VERSION) {
      errors.push(`版本不匹配: ${data.version}`);
    } else {
      version = data.version;
    }

    if (!Array.isArray(data.projects)) {
      errors.push('缺少 projects 字段');
    } else {
      projectCount = data.projects.length;

      // 检查每个项目
      for (let i = 0; i < data.projects.length; i++) {
        if (!isProject(data.projects[i])) {
          errors.push(`项目 ${i + 1} 结构无效`);
        }
      }
    }
  } catch (err) {
    errors.push(`JSON 解析失败: ${err}`);
  }

  return {
    valid: errors.length === 0,
    projectCount,
    version,
    errors,
  };
}