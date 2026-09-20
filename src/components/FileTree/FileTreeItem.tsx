/**
 * 文件树文件节点组件。
 * 展示单个文件项，支持状态指示、点击选中。
 */
import { Icon } from '@iconify/react';
import { cn } from '../../utils/cn';
import type { FileNode, FileStatus, FileType } from './types';
import { FILE_TYPE_ICONS, FILE_TYPE_COLORS } from './types';

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  isActive: boolean;
  onSelect: (path: string) => void;
}

/** 状态图标组件 */
function StatusIcon({ status }: { status: FileStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span
          className="w-3.5 h-3.5 flex items-center justify-center text-[var(--color-text-tertiary)]"
          aria-hidden="true"
        >
          ○
        </span>
      );
    case 'generating':
      return (
        <Icon
          icon="lucide:loader-circle"
          width={14}
          height={14}
          className="animate-spin text-[var(--color-accent)]"
          aria-hidden="true"
        />
      );
    case 'completed':
      return (
        <Icon
          icon="lucide:check"
          width={14}
          height={14}
          className="text-green-500"
          aria-hidden="true"
        />
      );
    case 'error':
      return (
        <Icon
          icon="lucide:alert-circle"
          width={14}
          height={14}
          className="text-red-500"
          aria-hidden="true"
        />
      );
  }
}

/** 获取文件类型图标 */
function useFileIcon(fileType: FileType): string {
  return FILE_TYPE_ICONS[fileType] ?? FILE_TYPE_ICONS.text;
}

/** 获取文件类型颜色 */
function useFileColor(fileType: FileType): string {
  return FILE_TYPE_COLORS[fileType] ?? '';
}

export function FileTreeItem({ node, level, isActive, onSelect }: FileTreeItemProps) {
  const fileIcon = useFileIcon(node.fileType);
  const fileColor = useFileColor(node.fileType);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(node.path);
    }
  };

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] transition-colors duration-[140ms] ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1',
        isActive
          ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      aria-current={isActive ? 'page' : undefined}
    >
      {/* 状态图标 */}
      <StatusIcon status={node.status} />

      {/* 文件类型图标 */}
      <Icon
        icon={fileIcon}
        width={14}
        height={14}
        className={cn(isActive ? 'text-[var(--color-accent)]' : fileColor)}
        aria-hidden="true"
      />

      {/* 文件名 */}
      <span className="flex-1 text-left truncate">{node.name}</span>

      {/* 元信息 */}
      {node.status === 'completed' && node.size !== undefined && node.size > 0 && (
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          {(node.size / 1024).toFixed(1)}KB
        </span>
      )}

      {/* 错误状态提示 */}
      {node.status === 'error' && (
        <span className="text-[11px] text-red-400">生成失败</span>
      )}
    </button>
  );
}