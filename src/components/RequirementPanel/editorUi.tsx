/**
 * 需求编辑器基础 UI 元素：输入框样式、字段标签、条目增删按钮。
 */
import { Icon } from '@iconify/react';

/** 输入框基础样式（与全站表单风格一致） */
export const INPUT_CLASS =
  'w-full bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-strong)] transition-colors';

/** 字段标签 */
export function FieldLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{text}</span>
      {hint && <span className="text-[11px] text-[var(--color-text-tertiary)]">{hint}</span>}
    </div>
  );
}

/** 条目删除按钮 */
export function RemoveButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-1 rounded text-[var(--color-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-[var(--color-text-tertiary)] disabled:hover:bg-transparent"
    >
      <Icon icon="lucide:trash-2" width={13} height={13} />
    </button>
  );
}

/** 条目新增按钮 */
export function AddButton({ onClick, disabled, text }: { onClick: () => void; disabled?: boolean; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon icon="lucide:plus" width={12} height={12} />
      {text}
    </button>
  );
}
