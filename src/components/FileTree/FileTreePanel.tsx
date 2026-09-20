/**
 * 文件树面板组件。
 * 展示项目文件结构，支持文件切换和目录展开/收起。
 */
import { Icon } from '@iconify/react';
import type { TreeNode } from './types';
import { countFiles } from './types';
import { FileTreeEmpty } from './FileTreeEmpty';
import { FileTreeItem } from './FileTreeItem';
import { FileTreeFolder } from './FileTreeFolder';
import type { FileTreePanelProps } from './types';

/** 文件列表组件 */
export function FileTreeList({
  nodes,
  level,
  activeFilePath,
  onFileSelect,
  onFolderToggle,
}: {
  nodes: TreeNode[];
  level: number;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
  onFolderToggle: (path: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) =>
        node.type === 'folder' ? (
          <FileTreeFolder
            key={node.id}
            node={node}
            level={level}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onFolderToggle={onFolderToggle}
          />
        ) : (
          <FileTreeItem
            key={node.id}
            node={node}
            level={level}
            isActive={activeFilePath === node.path}
            onSelect={onFileSelect}
          />
        )
      )}
    </div>
  );
}

/** 文件树面板组件 */
export function FileTreePanel({
  tree,
  activeFilePath,
  onFileSelect,
  onFolderToggle,
  isVisible = true,
}: FileTreePanelProps) {
  const fileCount = countFiles(tree);

  if (!isVisible) return null;

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-default)] overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2">
          <Icon
            icon="lucide:folder"
            width={14}
            height={14}
            className="text-amber-500"
            aria-hidden="true"
          />
          <span className="text-[12px] font-medium text-[var(--color-text-primary)]">项目文件</span>
        </div>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{fileCount} 文件</span>
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <FileTreeEmpty />
        ) : (
          <FileTreeList
            nodes={tree}
            level={0}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onFolderToggle={onFolderToggle}
          />
        )}
      </div>
    </div>
  );
}