/**
 * 文件树目录节点组件。
 * 支持展开/收起，显示子文件列表。
 */
import { Icon } from '@iconify/react';
import { cn } from '../../utils/cn';
import type { FolderNode } from './types';
import { FileTreeList } from './FileTreePanel';

interface FileTreeFolderProps {
  node: FolderNode;
  level: number;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
  onFolderToggle: (path: string) => void;
}

export function FileTreeFolder({
  node,
  level,
  activeFilePath,
  onFileSelect,
  onFolderToggle,
}: FileTreeFolderProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFolderToggle(node.path);
    }
  };

  // 检测是否使用减少动效模式
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  return (
    <div>
      {/* 目录头部 */}
      <button
        type="button"
        onClick={() => onFolderToggle(node.path)}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px]',
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]',
          'transition-colors duration-[140ms] ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1'
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        aria-expanded={node.expanded}
        aria-label={`${node.expanded ? '收起' : '展开'} ${node.name}`}
      >
        {/* 展开指示图标 */}
        <Icon
          icon="lucide:chevron-right"
          width={14}
          height={14}
          className={cn(
            'text-[var(--color-text-tertiary)] shrink-0',
            prefersReducedMotion ? '' : 'transition-transform duration-[180ms] ease-out',
            node.expanded ? 'rotate-90' : ''
          )}
          aria-hidden="true"
        />

        {/* 目录图标 */}
        <Icon
          icon={node.expanded ? 'lucide:folder-open' : 'lucide:folder'}
          width={14}
          height={14}
          className="text-amber-500 shrink-0"
          aria-hidden="true"
        />

        {/* 目录名 */}
        <span className="flex-1 text-left truncate">{node.name}</span>
      </button>

      {/* 子文件列表 */}
      <div
        className={cn(
          'overflow-hidden',
          prefersReducedMotion ? '' : 'transition-all duration-[180ms] ease-out'
        )}
        style={{
          maxHeight: node.expanded ? '1000px' : '0',
          opacity: prefersReducedMotion ? (node.expanded ? 1 : 0) : undefined,
          display: prefersReducedMotion ? (node.expanded ? 'block' : 'none') : undefined,
        }}
      >
        <FileTreeList
          nodes={node.children}
          level={level + 1}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          onFolderToggle={onFolderToggle}
        />
      </div>
    </div>
  );
}