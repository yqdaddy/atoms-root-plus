/**
 * 差异对比类型定义。
 * 用于修改模式下的增量变更展示与确认。
 */

/** 单行编辑类型 */
export type LineEditType = 'replace' | 'insert' | 'delete';

/** 单行编辑 */
export interface LineEdit {
  /** 行号（从 1 开始） */
  line: number;
  /** 旧文本（replace/delete 时必填） */
  old: string;
  /** 新文本（replace/insert 时必填） */
  new: string;
  /** 编辑类型 */
  type: LineEditType;
}

/** 单文件变更 */
export interface FileChange {
  /** 文件路径 */
  path: string;
  /** 编辑列表 */
  edits: LineEdit[];
}

/** 差异结果（工程师输出的变更清单） */
export interface DiffResult {
  /** 变更清单 */
  changes: FileChange[];
  /** 变更摘要 */
  summary: string;
}

/** 待确认的变更状态 */
export interface PendingChanges {
  /** 变更清单 */
  diff: DiffResult;
  /** 原始文件（变更前） */
  originalFiles: Record<string, { path: string; content: string; language: string }>;
  /** 应用变更后的预览文件 */
  previewFiles: Record<string, { path: string; content: string; language: string }>;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 生成变更摘要文本。
 * @param diff 差异结果
 * @returns 摘要文本
 */
export function formatDiffSummary(diff: DiffResult): string {
  const fileCount = diff.changes.length;
  const editCount = diff.changes.reduce((sum, f) => sum + f.edits.length, 0);

  if (fileCount === 0) {
    return '无变更';
  }

  const parts: string[] = [];
  for (const change of diff.changes) {
    const fileName = change.path.split('/').pop() ?? change.path;
    parts.push(`${fileName}(${change.edits.length} 处)`);
  }

  return `共 ${fileCount} 个文件、${editCount} 处变更：${parts.join('、')}`;
}