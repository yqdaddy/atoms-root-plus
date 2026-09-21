/**
 * 框架选择器组件。
 * 用于项目创建时选择生成代码的目标框架（原生 HTML / React CDN / Vue CDN）。
 */
import { Icon } from '@iconify/react';
import type { ProjectFramework } from '../types/project';

interface FrameworkOption {
  id: ProjectFramework;
  label: string;
  description: string;
  icon: string;
}

/** 框架选项清单：图标均已下载至 assets/icons 并经 lib/icons.ts 本地注册 */
export const FRAMEWORK_OPTIONS: FrameworkOption[] = [
  {
    id: 'html',
    label: '原生 HTML',
    description: '纯 HTML/CSS/JS',
    icon: 'lucide:file-code',
  },
  {
    id: 'react-cdn',
    label: 'React CDN',
    description: 'JSX + React 18 CDN',
    icon: 'lucide:atom',
  },
  {
    id: 'vue-cdn',
    label: 'Vue CDN',
    description: 'Vue 3 CDN',
    icon: 'lucide:layers',
  },
];

/** 按框架 ID 获取显示信息（label 与图标），未知框架返回 null */
export function getFrameworkInfo(framework?: ProjectFramework): { label: string; icon: string } | null {
  if (!framework) return null;
  const option = FRAMEWORK_OPTIONS.find((opt) => opt.id === framework);
  return option ? { label: option.label, icon: option.icon } : null;
}

interface FrameworkSelectorProps {
  value: ProjectFramework;
  onChange: (framework: ProjectFramework) => void;
  disabled?: boolean;
}

/**
 * 紧凑分段式框架选择器。
 * 三档横排：图标 + 短标签，悬停 title 提示描述；选中项以 accent 高亮。
 */
export function FrameworkSelector({ value, onChange, disabled }: FrameworkSelectorProps) {
  return (
    <div
      className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-default)]"
      role="radiogroup"
      aria-label="选择生成框架"
    >
      {FRAMEWORK_OPTIONS.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.description}
            onClick={() => onChange(option.id)}
            disabled={disabled}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors ${
              selected
                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Icon icon={option.icon} width={13} height={13} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
