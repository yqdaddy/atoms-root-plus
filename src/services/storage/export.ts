/**
 * 数据导出功能。
 * 将所有项目打包为可读的 JSON 文件。
 */

import type { ExportData } from './types';
import { EXPORT_VERSION } from './types';
import { storageKey } from '../../types/storage';
import type { Project } from '../../types/project';
import { migrateProject } from './migration';

/**
 * 导出所有项目。
 *
 * @returns JSON 字符串
 */
export function exportAllProjects(): string {
  // 从 localStorage 扫描所有项目
  const projects: Project[] = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('atoms:v1:projects:') || key === 'atoms:v1:projects') {
        continue;
      }

      const project = loadProjectFromStorage(key);
      if (project) {
        projects.push(project);
      }
    }
  } catch {
    // 忽略扫描错误
  }

  // 构造导出数据
  const exportData: ExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projects,
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * 导出单个项目。
 *
 * @param projectId 项目 ID
 * @returns JSON 字符串，或 null（项目不存在）
 */
export function exportProject(projectId: string): string | null {
  const project = loadProjectFromStorage(projectId);
  if (!project) return null;

  const exportData: ExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projects: [project],
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * 从 localStorage 加载项目完整数据。
 * 支持数据迁移。
 *
 * @param key localStorage key 或项目 ID
 * @returns 项目数据，或 null（不存在或损坏）
 */
function loadProjectFromStorage(keyOrId: string): Project | null {
  try {
    // 判断是完整 key 还是项目 ID
    const key = keyOrId.startsWith('atoms:')
      ? keyOrId
      : storageKey('projects', keyOrId);

    const raw = localStorage.getItem(key);
    if (!raw) return null;

    // 使用迁移系统处理数据
    const result = migrateProject(raw);

    if (result.ok && result.envelope) {
      return result.envelope.data;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 触发浏览器下载 JSON 文件。
 *
 * @param json JSON 字符串
 * @param filename 文件名（默认 atoms-projects.json）
 */
export function downloadExport(json: string, filename: string = 'atoms-projects.json'): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  // 清理 URL
  setTimeout(() => URL.revokeObjectURL(url), 100);
}