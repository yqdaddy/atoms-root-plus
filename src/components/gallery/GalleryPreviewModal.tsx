/**
 * 广场只读预览 Modal。
 * Modal 全屏容器 + SandboxFrame（sandbox + srcdoc，postMessage 校验）渲染快照，
 * 顶条「只读预览 · 项目名」+ x 关闭；预览内不提供任何编辑入口（US-G3）。
 * meta 行展示作者、发布时间、复刻计数与简介；已登录显示「复刻」，
 * 未登录显示「登录后复刻」引导。
 */
import { Icon } from '@iconify/react';
import Modal from '../Modal';
import SandboxFrame from '../SandboxFrame';
import type { GalleryDetail, GalleryListItem } from '../../services/gallery';
import { formatRelativeTime } from '../../utils/formatTime';

export interface GalleryPreviewModalProps {
  /** 当前预览的列表项（null 表示关闭） */
  item: GalleryListItem | null;
  /** 快照详情（随打开异步加载） */
  detail: GalleryDetail | null;
  /** 详情加载中 */
  isLoading: boolean;
  /** 详情加载失败的错误消息 */
  error: string | null;
  /** 复刻请求进行中 */
  isForking: boolean;
  /** 当前用户是否已登录 */
  isLoggedIn: boolean;
  onClose: () => void;
  /** 详情加载失败后的重试 */
  onRetry: () => void;
  /** 点击复刻（已登录） */
  onFork: () => void;
  /** 未登录点击复刻入口 */
  onLoginToFork: () => void;
}

/** 详情加载骨架：与预览区域形状匹配的 shimmer 块 */
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="预览加载中">
      <div className="flex gap-2">
        <div className="h-3.5 w-28 rounded-[6px] skeleton-shimmer" />
        <div className="h-3.5 w-20 rounded-[6px] skeleton-shimmer" />
      </div>
      <div className="h-[62vh] min-h-[380px] rounded-[10px] skeleton-shimmer" />
    </div>
  );
}

/** 详情加载失败：三段式（发生了什么 + 能做什么 + 恢复动作） */
function DetailError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Icon icon="lucide:alert-triangle" width={28} height={28} className="text-[var(--color-danger)]" />
      <h4 className="text-[15px] font-medium text-[var(--color-text-primary)]">预览加载失败</h4>
      <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[320px]">{message}。检查网络后重试。</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors duration-[140ms]"
      >
        <Icon icon="lucide:refresh-cw" width={14} height={14} />
        重试
      </button>
    </div>
  );
}

export default function GalleryPreviewModal({
  item,
  detail,
  isLoading,
  error,
  isForking,
  isLoggedIn,
  onClose,
  onRetry,
  onFork,
  onLoginToFork,
}: GalleryPreviewModalProps) {
  const forkButton = isLoggedIn ? (
    <button
      onClick={onFork}
      disabled={isForking}
      className="flex items-center gap-1.5 h-8 px-3 rounded-[6px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[140ms]"
    >
      {isForking && <Icon icon="lucide:loader-circle" width={14} height={14} className="animate-spin" />}
      复刻
    </button>
  ) : (
    <button
      onClick={onLoginToFork}
      className="flex items-center gap-1.5 h-8 px-3 rounded-[6px] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] text-[13px] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors duration-[140ms]"
    >
      <Icon icon="lucide:log-in" width={14} height={14} />
      登录后复刻
    </button>
  );

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={detail ? `只读预览 · ${detail.project_name}` : '只读预览'}
      maxWidth="min(76rem, 96vw)"
    >
      {error ? (
        <DetailError message={error} onRetry={onRetry} />
      ) : isLoading || !item || !detail ? (
        <DetailSkeleton />
      ) : (
        <div className="flex flex-col gap-3">
          {/* meta 行 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-[var(--color-text-secondary)]">{detail.owner_name}</span>
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              发布于 {formatRelativeTime(new Date(item.created_at))}
            </span>
            <span
              className="flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] font-mono"
              title={`已被复刻 ${detail.fork_count} 次`}
            >
              <Icon icon="lucide:copy" width={12} height={12} />
              {detail.fork_count}
            </span>
            {detail.description && (
              <p className="text-[13px] text-[var(--color-text-secondary)] line-clamp-1 flex-1 min-w-[200px]">
                {detail.description}
              </p>
            )}
            <div className="ml-auto shrink-0">{forkButton}</div>
          </div>

          {/* 快照沙箱预览（只读：无任何编辑入口） */}
          <div className="h-[62vh] min-h-[380px] flex flex-col border border-[var(--color-border-default)] rounded-[10px] overflow-hidden">
            <SandboxFrame
              html={detail.html}
              {...(detail.files !== null ? { files: detail.files } : {})}
              framework={detail.framework ?? 'html'}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
