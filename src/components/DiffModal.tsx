/**
 * DiffModal 组件：弹窗显示代码差异对比。
 * 用于消息列表中的"查看变更"功能。
 */
import { useState, useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { ChangeList, FileChange } from '../types/project';

interface DiffModalProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 变更清单 */
  changes: ChangeList;
}

export function DiffModal({ open, onClose, changes }: DiffModalProps) {
  const [viewMode, setViewMode] = useState<'summary' | 'detail'>('summary');

  // 计算变更统计
  const stats = useMemo(() => {
    const fileCount = changes.changes.length;
    const editCount = changes.changes.reduce((sum, f) => sum + f.edits.length, 0);
    return { fileCount, editCount };
  }, [changes]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--color-bg-elevated)] rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col border border-[var(--color-border-default)]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-default)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <Icon icon="lucide:git-compare" width={20} height={20} className="text-green-500" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">变更详情</h2>
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                共 {stats.fileCount} 个文件、{stats.editCount} 处变更
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 视图切换 */}
            <div className="flex items-center gap-1 bg-[var(--color-bg-base)] rounded-lg p-1">
              <button
                onClick={() => setViewMode('summary')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  viewMode === 'summary'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                摘要
              </button>
              <button
                onClick={() => setViewMode('detail')}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  viewMode === 'detail'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                详情
              </button>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--color-bg-base)] transition-colors"
            >
              <Icon icon="lucide:x" width={16} height={16} className="text-[var(--color-text-secondary)]" />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-6">
          {viewMode === 'summary' ? (
            <div className="space-y-3">
              {/* 摘要信息 */}
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                <h3 className="text-[14px] font-medium text-green-500 mb-2">变更摘要</h3>
                <p className="text-[13px] text-[var(--color-text-secondary)]">{changes.summary}</p>
              </div>

              {/* 文件列表 */}
              <div className="space-y-2">
                {changes.changes.map((change, idx) => (
                  <FileChangeSummary key={`${change.file}-${idx}`} change={change} />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 详细 diff 视图 */}
              {changes.changes.map((change, idx) => (
                <FileChangeDetail key={`${change.file}-${idx}`} change={change} />
              ))}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-default)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/** 单文件变更摘要 */
function FileChangeSummary({ change }: { change: FileChange }) {
  const fileName = change.file.split('/').pop() ?? change.file;
  const editCount = change.edits.length;

  // 统计操作类型
  const stats = useMemo(() => {
    let replace = 0;
    let insert = 0;
    let deleteCount = 0;
    for (const edit of change.edits) {
      if (edit.type === 'replace') replace++;
      else if (edit.type === 'insert') insert++;
      else if (edit.type === 'delete') deleteCount++;
    }
    return { replace, insert, delete: deleteCount };
  }, [change.edits]);

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg-base)] rounded-lg border border-[var(--color-border-default)]">
      <Icon
        icon={change.file.endsWith('.css') ? 'lucide:palette' :
              change.file.endsWith('.js') || change.file.endsWith('.jsx') ? 'lucide:file-code' :
              'lucide:file'}
        width={16}
        height={16}
        className="text-[var(--color-text-secondary)]"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
          {fileName}
        </div>
        <div className="text-[11px] text-[var(--color-text-tertiary)]">
          {editCount} 处变更
          {stats.replace > 0 && ` · ${stats.replace} 处修改`}
          {stats.insert > 0 && ` · ${stats.insert} 处新增`}
          {stats.delete > 0 && ` · ${stats.delete} 处删除`}
        </div>
      </div>
      <Icon icon="lucide:chevron-right" width={14} height={14} className="text-[var(--color-text-tertiary)]" />
    </div>
  );
}

/** 单文件变更详情 */
function FileChangeDetail({ change }: { change: FileChange }) {
  const [expanded, setExpanded] = useState(true);
  const fileName = change.file.split('/').pop() ?? change.file;

  return (
    <details open={expanded} className="group">
      <summary
        onClick={(e) => {
          e.preventDefault();
          setExpanded(!expanded);
        }}
        className="flex items-center gap-2 px-4 py-3 bg-[var(--color-bg-base)] rounded-t-lg border border-[var(--color-border-default)] cursor-pointer hover:bg-[var(--color-bg-surface)] transition-colors list-none"
      >
        <Icon
          icon={expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
          width={14}
          height={14}
          className="text-[var(--color-text-tertiary)]"
        />
        <Icon
          icon={change.file.endsWith('.css') ? 'lucide:palette' :
                change.file.endsWith('.js') || change.file.endsWith('.jsx') ? 'lucide:file-code' :
                'lucide:file'}
          width={16}
          height={16}
          className="text-[var(--color-text-secondary)]"
        />
        <span className="text-[14px] font-medium text-[var(--color-text-primary)]">{fileName}</span>
        <span className="text-[12px] text-[var(--color-text-tertiary)] ml-auto">
          {change.edits.length} 处变更
        </span>
      </summary>

      {expanded && (
        <div className="border border-t-0 border-[var(--color-border-default)] rounded-b-lg overflow-hidden">
          {change.edits.map((edit, idx) => (
            <div key={`${edit.line}-${idx}`} className="flex border-b border-[var(--color-border-default)] last:border-b-0">
              {/* 行号 */}
              <div className="w-12 shrink-0 text-right pr-3 py-1 text-[11px] text-[var(--color-text-tertiary)] select-none font-mono bg-[var(--color-bg-base)]">
                {edit.line}
              </div>

              {/* 标记列 */}
              <div className={`w-8 shrink-0 text-center py-1 text-[11px] font-mono ${
                edit.type === 'delete' ? 'text-red-400 bg-red-500/10' :
                edit.type === 'insert' ? 'text-green-400 bg-green-500/10' :
                'text-amber-400 bg-amber-500/10'
              }`}>
                {edit.type === 'delete' ? '-' : edit.type === 'insert' ? '+' : '~'}
              </div>

              {/* 内容 */}
              <div className={`flex-1 px-3 py-1 text-[12px] font-mono whitespace-pre-wrap break-all ${
                edit.type === 'delete' ? 'bg-red-500/5 text-red-200' :
                edit.type === 'insert' ? 'bg-green-500/5 text-green-200' :
                'bg-amber-500/5 text-amber-200'
              }`}>
                {edit.type === 'delete' && edit.old}
                {edit.type === 'insert' && edit.new}
                {edit.type === 'replace' && (
                  <>
                    <span className="line-through opacity-60">{edit.old}</span>
                    <span className="ml-2">{edit.new}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}