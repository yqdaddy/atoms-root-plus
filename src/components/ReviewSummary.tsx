/**
 * 审查摘要组件：将审查者产出的检查结果折叠为单行摘要。
 * 点击可展开查看每项检查的详情。
 * 参考 Claude Code 的工具结果折叠设计：默认 condensed，点击展开详情。
 */
import { useState } from 'react';
import { Icon } from '@iconify/react';

/** 单条审查检查项 */
export interface ReviewCheckItem {
  /** 检查项名称 */
  item: string;
  /** 是否通过 */
  pass: boolean;
  /** 备注 */
  note: string;
}

interface ReviewSummaryProps {
  /** 检查结果列表 */
  checks: ReviewCheckItem[];
  /** 是否处于折叠状态（默认折叠） */
  defaultCollapsed?: boolean;
}

/** 审查摘要：单行折叠视图 + 可展开详情 */
export function ReviewSummary({ checks, defaultCollapsed = true }: ReviewSummaryProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  if (checks.length === 0) return null;

  const passedCount = checks.filter(c => c.pass).length;
  const failedCount = checks.length - passedCount;
  const allPassed = failedCount === 0;

  return (
    <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-base)] overflow-hidden">
      {/* 折叠头：单行摘要 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--color-bg-surface)] transition-colors"
      >
        <Icon
          icon={expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
          width={14}
          height={14}
          className="text-[var(--color-text-tertiary)] shrink-0"
        />
        <Icon
          icon={allPassed ? 'lucide:check-circle' : 'lucide:alert-circle'}
          width={14}
          height={14}
          className={allPassed ? 'text-green-500 shrink-0' : 'text-amber-500 shrink-0'}
        />
        <span className="text-[12px] text-[var(--color-text-secondary)] flex-1">
          {allPassed
            ? `${checks.length} 项检查通过`
            : `${passedCount} 项通过，${failedCount} 项未过`}
        </span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">审查</span>
      </button>

      {/* 展开的详情列表 */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--color-border-default)] space-y-1.5">
          {checks.map((check, idx) => (
            <div key={`${check.item}-${idx}`} className="flex items-start gap-2">
              <Icon
                icon={check.pass ? 'lucide:check' : 'lucide:x'}
                width={12}
                height={12}
                className={`${check.pass ? 'text-green-500' : 'text-red-500'} shrink-0 mt-0.5`}
              />
              <div className="min-w-0">
                <span className="text-[12px] text-[var(--color-text-primary)]">{check.item}</span>
                {check.note && (
                  <span className="text-[11px] text-[var(--color-text-tertiary)] ml-2">{check.note}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}