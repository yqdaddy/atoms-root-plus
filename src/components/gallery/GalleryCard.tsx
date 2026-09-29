/**
 * 广场项目卡片。
 * 视觉语言沿用 ProjectsPage 卡片容器（bg-surface + border-default + hover:border-strong），
 * 去掉 more 菜单与状态徽章；缩略图装饰位为 lucide:eye。
 * footer：作者与相对时间（12px text-secondary）、复刻计数（copy 图标 + mono），
 * 已登录显示主色小按钮「复刻」，未登录显示 ghost「登录后复刻」。
 */
import { Icon } from '@iconify/react';
import type { GalleryListItem } from '../../services/gallery';
import { formatRelativeTime } from '../../utils/formatTime';

export interface GalleryCardProps {
  item: GalleryListItem;
  /** 当前用户是否已登录（决定复刻按钮形态） */
  isLoggedIn: boolean;
  /** 该卡片是否处于复刻请求中（禁用防重复提交） */
  isForking: boolean;
  /** 打开只读预览，回传触发元素供关闭后焦点归还 */
  onOpen: (trigger: HTMLElement) => void;
  /** 点击复刻（仅已登录时可触发） */
  onFork: () => void;
  /** 未登录点击复刻入口，跳转登录页 */
  onLoginToFork: () => void;
}

/** 主色小复刻按钮（已登录） */
function ForkButton({ isForking, onFork }: { isForking: boolean; onFork: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onFork();
      }}
      disabled={isForking}
      className="flex items-center gap-1 h-7 px-2.5 shrink-0 rounded-[6px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[12px] font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[140ms]"
    >
      {isForking && <Icon icon="lucide:loader-circle" width={12} height={12} className="animate-spin" />}
      复刻
    </button>
  );
}

/** ghost 登录引导按钮（未登录） */
function LoginToForkButton({ onLoginToFork }: { onLoginToFork: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onLoginToFork();
      }}
      className="flex items-center gap-1 h-7 px-2.5 shrink-0 rounded-[6px] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] text-[12px] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors duration-[140ms]"
    >
      <Icon icon="lucide:log-in" width={12} height={12} />
      登录后复刻
    </button>
  );
}

export default function GalleryCard({
  item,
  isLoggedIn,
  isForking,
  onOpen,
  onFork,
  onLoginToFork,
}: GalleryCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`预览 ${item.project_name}`}
      className="group bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[10px] overflow-hidden hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-accent)] transition-colors duration-[140ms] cursor-pointer outline-none"
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(e.currentTarget);
        }
      }}
    >
      {/* 缩略图装饰位 */}
      <div className="aspect-[4/3] bg-[var(--color-bg-base)] flex items-center justify-center">
        <Icon icon="lucide:eye" width={32} height={32} className="text-[var(--color-text-tertiary)]" />
      </div>

      {/* 信息区 */}
      <div className="p-3">
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)] truncate">
          {item.project_name}
        </h3>
        <p className="mt-1 text-[13px] leading-[1.5] text-[var(--color-text-secondary)] line-clamp-2 min-h-[39px]">
          {item.description ?? '作者没有填写简介'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[12px] text-[var(--color-text-secondary)] truncate max-w-[80px]">
            {item.owner_name}
          </span>
          <span className="text-[12px] text-[var(--color-text-secondary)] shrink-0">
            {formatRelativeTime(new Date(item.created_at))}
          </span>
          <span
            className="ml-auto flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] font-mono shrink-0"
            title={`已被复刻 ${item.fork_count} 次`}
          >
            <Icon icon="lucide:copy" width={12} height={12} />
            {item.fork_count}
          </span>
          {isLoggedIn ? (
            <ForkButton isForking={isForking} onFork={onFork} />
          ) : (
            <LoginToForkButton onLoginToFork={onLoginToFork} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 骨架卡片：缩略图块加两条文字条（shimmer，reduced-motion 停） */
export function GalleryCardSkeleton() {
  return (
    <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[10px] overflow-hidden">
      <div className="aspect-[4/3] skeleton-shimmer" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 w-2/3 rounded-[6px] skeleton-shimmer" />
        <div className="h-3 w-full rounded-[6px] skeleton-shimmer" />
      </div>
    </div>
  );
}
