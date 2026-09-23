/**
 * 构建步骤实时显示组件。
 * 显示当前生成的文件列表，支持折叠/展开，实时更新状态。
 */
import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { FileGenerationStatus } from '../stores/chatStore';

interface BuildGroupProps {
  /** 文件列表 */
  files: FileGenerationStatus[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 当前正在生成的文件路径 */
  activeFilePath?: string | null;
}

/**
 * 构建步骤组件
 */
export function BuildGroup({ files, isGenerating, activeFilePath }: BuildGroupProps) {
  const [expanded, setExpanded] = useState(false);

  // 判断是否全部完成
  const isComplete = files.every(f => f.status === 'completed' || f.status === 'failed');
  const completedCount = files.filter(f => f.status === 'completed').length;

  return (
    <div className="space-y-1">
      {/* 折叠/展开按钮 */}
      {files.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-0.5 transition-colors"
        >
          <Icon
            icon={expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
            width={12}
            height={12}
          />
          {isComplete
            ? `${files.length} 个文件`
            : `正在生成... (${completedCount}/${files.length})`
          }
          {!isComplete && isGenerating && (
            <Icon icon="lucide:loader-circle" width={12} height={12} className="animate-spin text-gray-400" />
          )}
        </button>
      )}

      {/* 展开的文件列表 */}
      {expanded && (
        <div className="space-y-0.5 pl-4 border-l-2 border-[var(--color-border-default)]">
          {files.map((file, idx) => (
            <BuildFileItem
              key={idx}
              file={file}
              isActive={file.path === activeFilePath || file.status === 'generating'}
            />
          ))}
        </div>
      )}

      {/* 实时显示当前正在生成的文件（总是可见） */}
      {!isComplete && !expanded && files.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400 pl-4 py-0.5">
          <Icon icon="lucide:loader-circle" width={12} height={12} className="animate-spin text-gray-400 mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            {activeFilePath
              ? `正在生成 ${activeFilePath.split('/').pop()}`
              : files.find(f => f.status === 'generating')
                ? `正在生成 ${files.find(f => f.status === 'generating')?.name}`
                : '准备中...'}
          </span>
        </div>
      )}

      {/* 完成状态 */}
      {isComplete && (
        <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 py-1">
          <Icon icon="lucide:check" width={14} height={14} />
          <span className="font-medium">已完成</span>
        </div>
      )}
    </div>
  );
}

/**
 * 文件项组件
 */
function BuildFileItem({ file, isActive }: { file: FileGenerationStatus; isActive: boolean }) {
  const statusIcon = (() => {
    switch (file.status) {
      case 'pending':
        return <span className="text-[var(--color-text-tertiary)]">○</span>;
      case 'generating':
        return (
          <Icon
            icon="lucide:loader-circle"
            width={14}
            height={14}
            className="animate-spin text-[var(--color-accent)]"
          />
        );
      case 'completed':
        return (
          <Icon
            icon="lucide:check"
            width={14}
            height={14}
            className="text-green-500"
          />
        );
      case 'failed':
        return (
          <Icon
            icon="lucide:x"
            width={14}
            height={14}
            className="text-red-500"
          />
        );
    }
  })();

  return (
    <div
      className={`flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-0.5 ${
        isActive ? 'text-[var(--color-accent)]' : ''
      }`}
    >
      {statusIcon}
      <Icon icon="lucide:file-code" width={12} height={12} />
      <span className="flex-1 truncate">{file.name}</span>
      {file.status === 'generating' && file.charCount > 0 && (
        <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
          {file.lineCount} 行
        </span>
      )}
      {file.status === 'completed' && file.charCount > 0 && (
        <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
          {(file.charCount / 1024).toFixed(1)}KB
        </span>
      )}
    </div>
  );
}