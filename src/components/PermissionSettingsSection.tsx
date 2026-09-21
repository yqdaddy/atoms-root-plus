/**
 * 权限配置面板组件。
 * 展示分类默认规则与工具覆盖规则，支持三态切换。
 */
import { useMemo, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { usePermissionStore } from '../stores/permissionStore';
import type { PermissionLevel, PermissionCategory } from '../types/permission';
import { TOOL_CATEGORIES } from '../types/permission';

/** 三态选项配置 */
const LEVEL_OPTIONS: Array<{ value: PermissionLevel; label: string; activeClass: string }> = [
  { value: 'allow', label: '允许', activeClass: 'bg-[#10b981] text-white' },
  { value: 'ask', label: '询问', activeClass: 'bg-[#f59e0b] text-white' },
  { value: 'deny', label: '禁止', activeClass: 'bg-[#ef4444] text-white' },
];

/** 分类展示信息 */
const CATEGORY_META: Record<PermissionCategory, { label: string; icon: string; description: string }> = {
  file: {
    label: '文件操作',
    icon: 'lucide:folder',
    description: '读取、写入、创建、删除项目文件',
  },
  network: {
    label: '网络请求',
    icon: 'lucide:search',
    description: '访问外部网络资源与 API',
  },
  command: {
    label: '命令执行',
    icon: 'lucide:settings',
    description: '执行系统命令（高风险操作）',
  },
  sandbox: {
    label: '沙箱环境',
    icon: 'lucide:code-2',
    description: '创建与管理隔离的执行沙箱',
  },
  other: {
    label: '其他操作',
    icon: 'lucide:sparkles',
    description: '剪贴板等辅助能力',
  },
};

/** 三态切换控件 */
function LevelSwitch({
  value,
  onChange,
}: {
  value: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-[8px] border border-[var(--color-border-default)] overflow-hidden">
      {LEVEL_OPTIONS.map((opt, idx) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={[
            'px-2.5 py-1 text-[12px] font-medium transition-all duration-[80ms]',
            idx > 0 ? 'border-l border-[var(--color-border-default)]' : '',
            value === opt.value ? opt.activeClass : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function PermissionSettingsSection() {
  const config = usePermissionStore((s) => s.config);
  const setCategoryPermission = usePermissionStore((s) => s.setCategoryPermission);
  const setToolPermission = usePermissionStore((s) => s.setToolPermission);
  const clearToolPermission = usePermissionStore((s) => s.clearToolPermission);
  const resetToDefault = usePermissionStore((s) => s.resetToDefault);

  const categories = useMemo<PermissionCategory[]>(
    () => ['file', 'network', 'command', 'sandbox', 'other'],
    []
  );

  const handleReset = useCallback(() => {
    resetToDefault();
  }, [resetToDefault]);

  return (
    <div className="space-y-4">
      {/* 分类默认规则 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[14px] font-medium text-[var(--color-text-primary)]">
            分类默认规则
          </label>
          <button
            type="button"
            onClick={handleReset}
            className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            恢复默认
          </button>
        </div>
        <div className="space-y-2">
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat];
            return (
              <div
                key={cat}
                className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[var(--color-bg-elevated)] rounded-[10px] border border-[var(--color-border-default)]"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    icon={meta.icon}
                    width={15}
                    height={15}
                    className="text-[var(--color-text-tertiary)] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] text-[var(--color-text-primary)]">{meta.label}</p>
                    <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">
                      {meta.description}
                    </p>
                  </div>
                </div>
                <LevelSwitch
                  value={config.categoryRules[cat]}
                  onChange={(level) => setCategoryPermission(cat, level)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 工具覆盖规则 */}
      {Object.keys(config.tools).length > 0 && (
        <div className="space-y-2">
          <label className="text-[14px] font-medium text-[var(--color-text-primary)]">
            工具覆盖规则
          </label>
          <div className="space-y-2">
            {Object.entries(config.tools).map(([toolName, level]) => {
              const category = TOOL_CATEGORIES[toolName];
              const meta = category ? CATEGORY_META[category] : CATEGORY_META.other;
              return (
                <div
                  key={toolName}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[var(--color-bg-surface)] rounded-[10px] border border-dashed border-[var(--color-border-default)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      icon={meta.icon}
                      width={15}
                      height={15}
                      className="text-[var(--color-text-tertiary)] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] text-[var(--color-text-primary)] font-mono">
                        {toolName}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-tertiary)]">
                        覆盖自分类默认值
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <LevelSwitch
                      value={level}
                      onChange={(l) => setToolPermission(toolName, l)}
                    />
                    <button
                      type="button"
                      onClick={() => clearToolPermission(toolName)}
                      aria-label={`清除 ${toolName} 的覆盖规则`}
                      className="p-1.5 rounded-[6px] text-[var(--color-text-tertiary)] hover:text-[#ef4444] hover:bg-[rgba(239,68,68,0.08)] transition-all duration-[80ms]"
                    >
                      <Icon icon="lucide:x" width={13} height={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            工具规则优先于分类规则。在权限弹窗中选择"始终允许"会自动生成这里。
          </p>
        </div>
      )}
    </div>
  );
}