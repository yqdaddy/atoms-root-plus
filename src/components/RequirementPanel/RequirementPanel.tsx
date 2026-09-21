/**
 * 需求确认面板。
 * 优化器前置流程的核心 UI：按状态渲染四种形态：
 * 1. loading：优化器流式分析中
 * 2. error：优化失败，可重试或取消
 * 3. ready：展示结构化需求文档，支持一键接受 / 编辑 / 取消
 * 4. editing：表单编辑模式（RequirementEditor）
 */
import { useState, useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { OptimizedRequirement } from '../../services/ai/optimizer';
import { RequirementDisplay } from './RequirementDisplay';
import { RequirementEditor } from './RequirementEditor';
import type { RequirementPanelProps } from './types';

/** 面板头部（各状态共用） */
function PanelHeader({ subtitle, tone }: { subtitle: string; tone: 'default' | 'loading' | 'error' }) {
  const iconMap = {
    default: 'lucide:file-text',
    loading: 'lucide:loader-circle',
    error: 'lucide:alert-circle',
  } as const;
  const iconColor =
    tone === 'error'
      ? 'text-red-400'
      : 'text-[var(--color-accent)]';

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
        tone === 'error' ? 'bg-red-500/10' : 'bg-[var(--color-accent)]/10'
      }`}>
        <Icon
          icon={iconMap[tone]}
          width={20}
          height={20}
          className={`${iconColor} ${tone === 'loading' ? 'animate-spin' : ''}`}
        />
      </div>
      <div className="min-w-0">
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">需求确认</h3>
        <p className="text-[12px] text-[var(--color-text-tertiary)] truncate">{subtitle}</p>
      </div>
    </div>
  );
}

export function RequirementPanel({
  requirement,
  isOptimizing,
  streamText,
  error,
  originalPrompt,
  onAccept,
  onAcceptWithEdits,
  onCancel,
  onRetry,
}: RequirementPanelProps) {
  /** 是否处于编辑模式 */
  const [isEditing, setIsEditing] = useState(false);
  /** 进入编辑模式时的基线快照（用于修改说明对照） */
  const [editBaseline, setEditBaseline] = useState<OptimizedRequirement | null>(null);

  /** requirement 内容标识：外部结果变化（重新优化）时自动退出编辑模式 */
  const requirementKey = useMemo(() => (requirement ? JSON.stringify(requirement) : ''), [requirement]);
  const [seenKey, setSeenKey] = useState(requirementKey);
  if (seenKey !== requirementKey) {
    setSeenKey(requirementKey);
    setIsEditing(false);
    setEditBaseline(null);
  }

  /* ---------------- 状态 1：优化中 ---------------- */
  if (isOptimizing) {
    return (
      <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl p-4">
        <PanelHeader subtitle="正在优化需求，补充细节" tone="loading" />
        <div className="rounded-lg bg-[var(--color-bg-surface)] px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
            <span className="text-[12px] text-[var(--color-text-tertiary)]">正在生成结构化需求文档...</span>
          </div>
          <pre className="text-[11px] leading-[1.6] text-[var(--color-text-tertiary)] font-mono whitespace-pre-wrap max-h-[100px] overflow-y-auto">
            {streamText ? streamText.slice(-400) : '等待响应...'}
          </pre>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-surface)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Icon icon="lucide:x" width={13} height={13} />
          取消分析
        </button>
      </div>
    );
  }

  /* ---------------- 状态 2：优化失败 ---------------- */
  if (error) {
    return (
      <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl p-4">
        <PanelHeader subtitle="需求分析失败" tone="error" />
        <p className="text-[13px] leading-[1.6] text-[var(--color-text-secondary)]">{error}</p>
        {originalPrompt && (
          <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)] truncate" title={originalPrompt}>
            原始需求：{originalPrompt}
          </p>
        )}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--color-border-default)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <Icon icon="lucide:refresh-cw" width={14} height={14} />
            重试
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- 无结果时不渲染（理论上不应到达） ---------------- */
  if (!requirement) return null;

  /* ---------------- 状态 4：编辑模式 ---------------- */
  if (isEditing && editBaseline) {
    return (
      <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl p-4">
        <PanelHeader subtitle="直接修改下方内容，保存后开始生成" tone="default" />
        <RequirementEditor
          requirement={requirement}
          original={editBaseline}
          onSubmit={(edited, notes) => onAcceptWithEdits(edited, notes)}
          onCancel={() => {
            setIsEditing(false);
            setEditBaseline(null);
          }}
        />
      </div>
    );
  }

  /* ---------------- 状态 3：只读确认 ---------------- */
  return (
    <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl p-4">
      <PanelHeader subtitle="请确认以下结构化需求，确认后开始生成" tone="default" />
      {originalPrompt && (
        <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)] truncate" title={originalPrompt}>
          来自你的描述：{originalPrompt}
        </p>
      )}
      <div className="max-h-[420px] overflow-y-auto pr-1">
        <RequirementDisplay requirement={requirement} />
      </div>
      <div className="flex items-center gap-3 pt-3 mt-4 border-t border-[var(--color-border-default)]">
        <button
          type="button"
          onClick={() => {
            setEditBaseline(requirement);
            setIsEditing(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
        >
          <Icon icon="lucide:pencil" width={13} height={13} />
          编辑修改
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onAccept}
          autoFocus
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Icon icon="lucide:check" width={14} height={14} />
          一键接受，开始生成
        </button>
      </div>
    </div>
  );
}
