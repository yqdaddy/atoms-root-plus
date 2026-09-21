/**
 * 版本历史组件。
 * 显示版本列表（时间线样式），支持切换版本。
 */
import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useProjectStore } from '../stores/projectStore';
import type { Version } from '../types/project';

/** 格式化时间为相对时间 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  // 超过一周显示具体日期
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/** 版本类型标签 */
function VersionTypeTag({ type }: { type: Version['type'] }) {
  const config = {
    initial: { label: '初始', className: 'bg-blue-500/10 text-blue-500' },
    iteration: { label: '迭代', className: 'bg-green-500/10 text-green-500' },
    rollback: { label: '回滚', className: 'bg-amber-500/10 text-amber-500' },
  };
  const { label, className } = config[type];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${className}`}>
      {label}
    </span>
  );
}

/** 版本列表项 */
function VersionItem({
  version,
  index,
  isActive,
  onSwitch,
}: {
  version: Version;
  index: number;
  isActive: boolean;
  onSwitch: () => void;
}) {
  return (
    <div
      className={`relative pl-6 pb-4 ${
        index > 0 ? 'border-l-2 border-[var(--color-border-default)] ml-2' : ''
      }`}
    >
      {/* 时间线圆点 */}
      <div
        className={`absolute left-0 top-0 w-4 h-4 rounded-full border-2 ${
          isActive
            ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
            : 'bg-[var(--color-bg-surface)] border-[var(--color-border-default)]'
        }`}
        style={{ transform: 'translateX(-50%)' }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              V{index + 1}
            </span>
            <VersionTypeTag type={version.type} />
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {formatRelativeTime(version.createdAt)}
            </span>
          </div>
          <p className="text-[13px] text-[var(--color-text-primary)] truncate">
            {version.summary}
          </p>
        </div>

        <button
          onClick={onSwitch}
          disabled={isActive}
          className={`shrink-0 px-2 py-1 rounded text-[12px] transition-colors ${
            isActive
              ? 'bg-[var(--color-bg-base)] text-[var(--color-text-tertiary)] cursor-not-allowed'
              : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20'
          }`}
        >
          {isActive ? '当前' : '切换'}
        </button>
      </div>
    </div>
  );
}

export function VersionHistory() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const versions = useProjectStore((state) => state.versions);
  const currentVersionId = useProjectStore((state) => state.currentVersionId);
  const currentProject = useProjectStore((state) => state.currentProject);
  const loadVersion = useProjectStore((state) => state.loadVersion);

  // 点击外部关闭下拉面板
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isOpen]);

  // 无项目时不显示
  if (!currentProject) return null;

  // 当前版本：优先读显式标记，回退到最新版本
  const activeVersionId = currentVersionId ?? (versions.length > 0 ? versions[0]?.id : null);

  const handleSwitch = (versionId: string) => {
    loadVersion(versionId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 历史按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
          isOpen
            ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        }`}
        title="版本历史"
      >
        <Icon icon="lucide:history" width={14} height={14} />
        历史
        {versions.length > 0 && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            ({versions.length})
          </span>
        )}
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-xl shadow-lg z-50 overflow-hidden">
          {/* 头部 */}
          <div className="px-4 py-3 border-b border-[var(--color-border-default)]">
            <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
              版本历史
            </h3>
            <p className="text-[12px] text-[var(--color-text-tertiary)] mt-0.5">
              点击切换可恢复到该版本
            </p>
          </div>

          {/* 版本列表 */}
          <div className="max-h-80 overflow-y-auto p-4">
            {versions.length === 0 ? (
              <div className="text-center py-6">
                <Icon
                  icon="lucide:history"
                  width={32}
                  height={32}
                  className="mx-auto mb-2 text-[var(--color-text-tertiary)] opacity-50"
                />
                <p className="text-[13px] text-[var(--color-text-tertiary)]">
                  暂无版本记录
                </p>
                <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
                  生成应用后会自动保存版本
                </p>
              </div>
            ) : (
              <div className="space-y-0">
                {versions.map((version, index) => (
                  <VersionItem
                    key={version.id}
                    version={version}
                    index={index}
                    isActive={version.id === activeVersionId}
                    onSwitch={() => handleSwitch(version.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 底部 */}
          {versions.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                最多保留 20 个版本，超出后自动清理最旧的
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}