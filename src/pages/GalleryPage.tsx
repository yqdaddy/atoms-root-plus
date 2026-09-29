/**
 * 作品广场页面（/gallery，公开路由，无需登录）。
 * 布局：复用 landing Header（nav 含「广场」，当前页高亮）+ max-w-6xl 内容区。
 * 功能：卡片网格（项目名/作者/简介两行/复刻数/相对时间）、
 * 排序切换（最新/最多复刻，segmented control 无图标）、
 * 四态（骨架屏/空态/错误三段式/正常）、点卡片打开只读预览 Modal、
 * 一键复刻（已登录：fork 后 toast 并进入工作台；未登录：登录引导，AC-G4.3）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import Header from '../components/landing/Header';
import GalleryCard, { GalleryCardSkeleton } from '../components/gallery/GalleryCard';
import GalleryPreviewModal from '../components/gallery/GalleryPreviewModal';
import { toast } from '../components/Toast';
import { useAuthStore } from '../stores/authStore';
import {
  fetchGalleryList,
  fetchGalleryDetail,
  forkGalleryItem,
  type GalleryListItem,
  type GalleryDetail,
  type GallerySort,
} from '../services/gallery';
import { ApiError } from '../services/apiClient';

/** 单次拉取条数：当前规模一次取满（服务端钳制上限 50） */
const LIST_LIMIT = 50;

const SORT_OPTIONS: ReadonlyArray<{ value: GallerySort; label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'forks', label: '最多复刻' },
];

/** 骨架屏张数（UX 规范：6 张卡片） */
const SKELETON_COUNT = 6;

export default function GalleryPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // 列表状态
  const [sort, setSort] = useState<GallerySort>('latest');
  const [items, setItems] = useState<GalleryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSorting, setIsSorting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 预览状态
  const [previewItem, setPreviewItem] = useState<GalleryListItem | null>(null);
  const [detail, setDetail] = useState<GalleryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetryNonce, setDetailRetryNonce] = useState(0);

  // 复刻状态
  const [forkingId, setForkingId] = useState<string | null>(null);

  // 首屏加载失败后的重试计数（递增触发列表 effect 重跑）
  const [listRetryNonce, setListRetryNonce] = useState(0);

  // 预览触发元素，关闭后焦点归还
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  // 是否已完成过一次成功加载（区分首屏骨架与切换排序的「保留列表」）
  const hasLoadedRef = useRef(false);

  // 列表拉取：首屏骨架屏；排序切换保留旧列表，segmented 禁用（UX 规范）
  useEffect(() => {
    let cancelled = false;
    if (hasLoadedRef.current) {
      setIsSorting(true);
    }
    setLoadError(null);

    fetchGalleryList({ sort, limit: LIST_LIMIT })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        hasLoadedRef.current = true;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : '广场加载失败';
        if (hasLoadedRef.current) {
          // 排序切换失败：保留现有列表，toast 提示
          toast.error('排序更新失败，请重试');
        } else {
          setLoadError(message);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsSorting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sort, listRetryNonce]);

  // 快照详情拉取：随预览目标与重试计数变化
  const previewId = previewItem?.id;
  useEffect(() => {
    if (!previewId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setDetailError(null);

    fetchGalleryDetail(previewId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDetailError(e instanceof Error ? e.message : '快照加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewId, detailRetryNonce]);

  const openPreview = useCallback((item: GalleryListItem, trigger: HTMLElement) => {
    previewTriggerRef.current = trigger;
    setPreviewItem(item);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewItem(null);
    setDetail(null);
    setDetailError(null);
    requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }, []);

  const handleLoginToFork = useCallback(() => {
    navigate('/login?redirect=%2Fgallery');
  }, [navigate]);

  // 复刻：已登录 fork 后 toast 并进入工作台（AC-G4.1）；未登录跳登录页（AC-G4.3）
  const handleFork = useCallback(
    async (item: GalleryListItem) => {
      if (!user) {
        handleLoginToFork();
        return;
      }
      if (forkingId) return;
      setForkingId(item.id);
      try {
        await forkGalleryItem(item.id);
        toast.success('已复刻到我的项目');
        navigate('/workspace');
      } catch (e: unknown) {
        // 401 由 apiClient 全局拦截处理（会话过期提示与跳转），此处不重复提示
        if (!(e instanceof ApiError && e.status === 401)) {
          toast.error('复刻失败，请重试');
        }
      } finally {
        setForkingId(null);
      }
    },
    [user, forkingId, navigate, handleLoginToFork]
  );

  const handleGoWorkspace = useCallback(() => {
    navigate('/workspace');
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)] flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8">
        {/* 页头：标题 + 计数 + 排序 segmented */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">广场</h1>
            <span className="text-[12px] text-[var(--color-text-secondary)] font-mono">
              {total} 个项目
            </span>
          </div>
          <div
            role="group"
            aria-label="排序方式"
            className="flex items-center h-8 p-0.5 rounded-[10px] border border-[var(--color-border-default)] bg-[var(--color-bg-base)]"
          >
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSort(option.value)}
                disabled={isSorting}
                aria-pressed={sort === option.value}
                className={`h-7 px-3 rounded-[6px] text-[13px] transition-colors duration-[140ms] disabled:cursor-not-allowed ${
                  sort === option.value
                    ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* 首屏加载：骨架屏 */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <GalleryCardSkeleton key={i} />
            ))}
          </div>
        ) : loadError ? (
          /* 错误三段式：发生了什么 + 能做什么 + 恢复动作 */
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <Icon icon="lucide:alert-triangle" width={32} height={32} className="text-[var(--color-danger)]" />
            <h2 className="text-[16px] font-medium text-[var(--color-text-primary)]">广场加载失败</h2>
            <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[360px]">
              {loadError}。检查网络后重试，已加载内容不会丢失。
            </p>
            <button
              onClick={() => setListRetryNonce((n) => n + 1)}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors duration-[140ms]"
            >
              <Icon icon="lucide:refresh-cw" width={14} height={14} />
              重试
            </button>
          </div>
        ) : items.length === 0 ? (
          /* 空态 */
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <Icon icon="lucide:compass" width={24} height={24} className="text-[var(--color-text-tertiary)]" />
            <h2 className="text-[16px] font-medium text-[var(--color-text-primary)]">广场还没有项目</h2>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              在项目卡片上选择发布到广场，作品就会出现在这里
            </p>
            <button
              onClick={handleGoWorkspace}
              className="px-4 py-2 rounded-[10px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] transition-colors duration-[140ms]"
            >
              去工作台
            </button>
          </div>
        ) : (
          /* 正常列表 */
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity duration-[140ms] ${
              isSorting ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {items.map((item) => (
              <GalleryCard
                key={item.id}
                item={item}
                isLoggedIn={user !== null}
                isForking={forkingId === item.id}
                onOpen={(trigger) => openPreview(item, trigger)}
                onFork={() => handleFork(item)}
                onLoginToFork={handleLoginToFork}
              />
            ))}
          </div>
        )}
      </main>

      {/* 只读预览 Modal */}
      <GalleryPreviewModal
        item={previewItem}
        detail={detail}
        isLoading={detailLoading}
        error={detailError}
        isForking={previewItem !== null && forkingId === previewItem.id}
        isLoggedIn={user !== null}
        onClose={closePreview}
        onRetry={() => setDetailRetryNonce((n) => n + 1)}
        onFork={() => {
          if (previewItem) handleFork(previewItem);
        }}
        onLoginToFork={handleLoginToFork}
      />
    </div>
  );
}
