/**
 * DiffViewer 组件：显示代码差异对比。
 * 左侧显示删除内容（红色），右侧显示新增内容（绿色）。
 * 支持 JSON 格式和 Unified Diff 格式。
 */
import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { DiffResult, FileChange, LineEdit } from '../types/diff';
import { formatDiffSummary } from '../types/diff';

/** 单行差异显示 */
interface DiffLineProps {
  edit: LineEdit;
  showLineNumbers?: boolean;
}

function DiffLine({ edit, showLineNumbers = true }: DiffLineProps) {
  const isDelete = edit.type === 'delete';
  const isInsert = edit.type === 'insert';
  const isReplace = edit.type === 'replace';

  return (
    <div className="flex">
      {/* 行号 */}
      {showLineNumbers && (
        <div className="w-12 shrink-0 text-right pr-3 text-[11px] text-[var(--color-text-tertiary)] select-none font-mono">
          {edit.line}
        </div>
      )}

      {/* 标记列 */}
      <div className={`w-6 shrink-0 text-center text-[11px] font-mono ${
        isDelete ? 'text-red-400 bg-red-500/10' :
        isInsert ? 'text-green-400 bg-green-500/10' :
        'text-amber-400 bg-amber-500/10'
      }`}>
        {isDelete ? '-' : isInsert ? '+' : '~'}
      </div>

      {/* 内容 */}
      <div className={`flex-1 px-3 py-0.5 text-[13px] font-mono whitespace-pre-wrap break-all ${
        isDelete ? 'bg-red-500/5 text-red-200' :
        isInsert ? 'bg-green-500/5 text-green-200' :
        'bg-amber-500/5 text-amber-200'
      }`}>
        {isDelete && edit.old}
        {isInsert && edit.new}
        {isReplace && (
          <>
            <span className="line-through opacity-60">{edit.old}</span>
            <span className="ml-2">{edit.new}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** 单文件差异显示 */
interface FileDiffProps {
  change: FileChange;
  defaultExpanded?: boolean;
}

function FileDiff({ change, defaultExpanded = false }: FileDiffProps) {
  const fileName = change.path.split('/').pop() ?? change.path;

  return (
    <details open={defaultExpanded} className="group">
      <summary className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-base)] cursor-pointer hover:bg-[var(--color-bg-elevated)] transition-colors list-none">
        <Icon
          icon="lucide:chevron-right"
          width={14}
          height={14}
          className="text-[var(--color-text-tertiary)] transition-transform group-open:rotate-90"
        />
        <Icon
          icon={change.path.endsWith('.css') ? 'lucide:palette' :
                change.path.endsWith('.js') ? 'lucide:file-code' :
                'lucide:file'}
          width={14}
          height={14}
          className="text-[var(--color-text-secondary)]"
        />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{fileName}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)] ml-auto">
          {change.edits.length} 处变更
        </span>
      </summary>

      <div className="border-t border-[var(--color-border-default)]">
        {change.edits.map((edit, idx) => (
          <DiffLine key={`${edit.line}-${idx}`} edit={edit} />
        ))}
      </div>
    </details>
  );
}

/** DiffViewer 主组件 */
interface DiffViewerProps {
  diff: DiffResult;
  onAccept: () => void;
  onReject: () => void;
  isApplying?: boolean;
}

export function DiffViewer({ diff, onAccept, onReject, isApplying = false }: DiffViewerProps) {
  const summary = useMemo(() => formatDiffSummary(diff), [diff]);

  return (
    <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-xl overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
          <Icon icon="lucide:git-compare" width={16} height={16} className="text-green-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">变更预览</h3>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">{summary}</p>
        </div>
      </div>

      {/* 文件列表 */}
      <div className="max-h-[400px] overflow-y-auto">
        {diff.changes.map((change, idx) => (
          <FileDiff
            key={change.path}
            change={change}
            defaultExpanded={idx === 0}
          />
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
        <button
          onClick={onReject}
          disabled={isApplying}
          className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onAccept}
          disabled={isApplying}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-500 text-white text-[13px] font-medium hover:bg-green-600 transition-colors disabled:opacity-50"
        >
          {isApplying ? (
            <>
              <Icon icon="lucide:loader-circle" width={14} height={14} className="animate-spin" />
              应用中...
            </>
          ) : (
            <>
              <Icon icon="lucide:check" width={14} height={14} />
              应用变更
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** 简化的差异显示（折叠状态） */
interface DiffSummaryProps {
  diff: DiffResult;
  onClick: () => void;
}

export function DiffSummary({ diff, onClick }: DiffSummaryProps) {
  const summary = useMemo(() => formatDiffSummary(diff), [diff]);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/20 text-left hover:bg-green-500/10 transition-colors"
    >
      <Icon icon="lucide:git-compare" width={14} height={14} className="text-green-500" />
      <span className="flex-1 text-[13px] text-[var(--color-text-secondary)]">{summary}</span>
      <Icon icon="lucide:chevron-right" width={14} height={14} className="text-[var(--color-text-tertiary)]" />
    </button>
  );
}