/**
 * 项目资料面板：工作台右侧 360px 抽屉。
 *
 * 遵循 docs/ux-p1-p2.md 资料面板章节：
 * - 遮罩 bg-black/50、200ms translate-x 入场，Esc、遮罩、x 均可关闭
 * - 标题区（配额 mono 计数 + 进度条，90% 转 amber、满格 danger）
 * - 粘贴文本 / 上传文件两枚 tab（clipboard-list / file-up）
 * - divide-y 列表（file-text + 名称 + mono 大小 + 相对时间 + chevron + trash-2，32px 命中区），
 *   点击条目展开等宽字体全文（数据来自列表响应的 content 字段，无需二次请求）
 * - 行内错误三类：超限、类型错、文件过大；错误文案 role="alert"
 * - 四态齐备：加载骨架 3 行、错误三段式（重试）、空态（folder）、成功列表
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import {
  createResource,
  defaultResourceName,
  deleteResource,
  formatKb,
  isAllowedResourceFileName,
  listResources,
  utf8ByteLength,
  MAX_PROJECT_RESOURCE_COUNT,
  MAX_PROJECT_TOTAL_BYTES,
  MAX_RESOURCE_CONTENT_BYTES,
  MAX_RESOURCE_NAME_LENGTH,
  type ProjectResource,
} from '../services/projectResources';
import { ApiError } from '../services/apiClient';
import { toast } from './Toast';

export interface ResourcesPanelProps {
  /** 是否展开 */
  open: boolean;
  /** 当前项目 ID（资料按项目归组） */
  projectId: string;
  /** 关闭回调（Esc、遮罩、x 共用） */
  onClose: () => void;
  /** 列表增删后向父级同步资料条数（驱动输入区"将注入 N 份资料"徽标） */
  onCountChange: (count: number) => void;
}

type ResourceTab = 'paste' | 'upload';

/** 相对时间文案（与 ProjectsPage formatTime 口径一致，入参为毫秒时间戳） */
function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function ResourcesPanel({ open, projectId, onClose, onCountChange }: ResourcesPanelProps) {
  const [items, setItems] = useState<ProjectResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<ResourceTab>('paste');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 当前展开查看全文的资料条目（单开，点击行切换）
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [entered, setEntered] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<FileReader | null>(null);

  // 入场动画：下一帧再置 entered，触发 translate-x 过渡
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Esc 关闭 + 背景滚动锁定（与 Modal 同模式）
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  // 卸载时中止进行中的文件读取
  useEffect(() => () => readerRef.current?.abort(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listResources(projectId);
      setItems(list);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : '资料列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 打开时拉取列表；projectId 变化时重新拉取
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 列表变化后同步计数给父级（生成输入区徽标）
  useEffect(() => {
    if (open && !loading) onCountChange(items.length);
  }, [open, loading, items, onCountChange]);

  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.size, 0),
    [items],
  );
  const remainingBytes = Math.max(0, MAX_PROJECT_TOTAL_BYTES - totalBytes);
  const countFull = items.length >= MAX_PROJECT_RESOURCE_COUNT;
  const quotaFull = countFull || totalBytes >= MAX_PROJECT_TOTAL_BYTES;
  const usedPercent = Math.min(100, (totalBytes / MAX_PROJECT_TOTAL_BYTES) * 100);
  const barColor =
    usedPercent >= 100
      ? 'bg-[var(--color-danger)]'
      : usedPercent >= 90
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--color-accent)]';

  const handleDelete = useCallback(
    async (item: ProjectResource) => {
      if (deletingId) return;
      if (!window.confirm(`确定删除资料「${item.name}」吗？此操作不可恢复。`)) return;
      setDeletingId(item.id);
      try {
        await deleteResource(projectId, item.id);
        setItems((prev) => prev.filter((r) => r.id !== item.id));
        toast.success('资料已删除');
      } catch {
        toast.error('资料删除失败，请重试');
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId, projectId],
  );

  const switchTab = useCallback((next: ResourceTab) => {
    setTab(next);
    setFormError(null);
    setFileError(null);
  }, []);

  const handleAdd = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName || !content.trim() || submitting) return;

      const bytes = utf8ByteLength(content);
      if (bytes > MAX_RESOURCE_CONTENT_BYTES) {
        setFormError(`内容 ${formatKb(bytes)}，超过单条上限 16 KB，请精简后再添加。`);
        return;
      }
      if (countFull) {
        setFormError(`资料数量超过上限（每个项目最多 ${MAX_PROJECT_RESOURCE_COUNT} 条）。`);
        return;
      }
      if (bytes > remainingBytes) {
        setFormError(`内容 ${formatKb(bytes)}，剩余配额 ${formatKb(remainingBytes)}，放不下。`);
        return;
      }

      setSubmitting(true);
      setFormError(null);
      try {
        const created = await createResource(projectId, trimmedName, content);
        setItems((prev) => [...prev, created]);
        setName('');
        setContent('');
        toast.success('资料已添加');
      } catch (error) {
        // 保存失败：输入内容保留不清空，行内展示具体原因（400 透出后端中文信息）
        setFormError(error instanceof ApiError ? error.message : '资料保存失败，请重试');
        toast.error('资料保存失败，请重试');
      } finally {
        setSubmitting(false);
      }
    },
    [name, content, submitting, countFull, remainingBytes, projectId],
  );

  const readFileText = useCallback(
    (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        readerRef.current = reader;
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsText(file);
      }),
    [],
  );

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || uploading) return;
      setFileError(null);
      if (!isAllowedResourceFileName(file.name)) {
        setFileError('仅支持 .md、.txt、.json 文件');
        return;
      }

      let text: string;
      try {
        text = await readFileText(file);
      } catch {
        setFileError('文件读取失败，请重试');
        return;
      }

      const bytes = utf8ByteLength(text);
      if (bytes === 0) {
        setFileError('文件内容为空，请更换文件。');
        return;
      }
      if (bytes > MAX_RESOURCE_CONTENT_BYTES) {
        setFileError(`文件 ${formatKb(bytes)}，超过单条上限 16 KB，请精简后再上传。`);
        return;
      }
      if (countFull) {
        setFileError(`资料数量超过上限（每个项目最多 ${MAX_PROJECT_RESOURCE_COUNT} 条）。`);
        return;
      }
      if (bytes > remainingBytes) {
        setFileError(`文件 ${formatKb(bytes)}，剩余配额 ${formatKb(remainingBytes)}，放不下。`);
        return;
      }

      setUploading(true);
      try {
        const created = await createResource(projectId, defaultResourceName(file.name), text);
        setItems((prev) => [...prev, created]);
        toast.success('资料已添加');
      } catch (error) {
        setFileError(error instanceof ApiError ? error.message : '资料保存失败，请重试');
        toast.error('资料保存失败，请重试');
      } finally {
        setUploading(false);
      }
    },
    [uploading, readFileText, countFull, remainingBytes, projectId],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setDragOver(false);
      void handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  if (!open) return null;

  const inputClasses =
    'w-full px-3 py-2 rounded-md bg-[var(--color-bg-base)] border border-[var(--color-border-default)] text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] transition-colors outline-none';

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${entered ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 抽屉主体 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="项目资料"
        className={`absolute right-0 top-0 flex h-full w-[360px] max-w-[calc(100vw-2rem)] flex-col bg-[var(--color-bg-surface)] border-l border-[var(--color-border-default)] shadow-[0_8px_32px_rgba(0,0,0,0.24)] transition-transform duration-200 ease-[var(--ease-standard)] motion-reduce:transition-none ${entered ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* 标题区 */}
        <div className="flex items-start justify-between px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)]">项目资料</h2>
            <p className="mt-1 font-mono text-[12px] text-[var(--color-text-secondary)] tabular-nums">
              已用 {formatKb(totalBytes)} / {MAX_PROJECT_TOTAL_BYTES / 1024} KB，{items.length}/{MAX_PROJECT_RESOURCE_COUNT} 条
            </p>
            <div className="mt-2 h-1 rounded-full bg-[var(--color-bg-inset)] overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${usedPercent}%` }} />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭资料面板"
            className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors duration-[80ms]"
          >
            <Icon icon="lucide:x" width={16} height={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* tab 切换 */}
          <div className="flex gap-1 rounded-md bg-[var(--color-bg-base)] p-1">
            <button
              type="button"
              onClick={() => switchTab('paste')}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] text-[12px] transition-colors duration-[80ms] ${tab === 'paste' ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
            >
              <Icon icon="lucide:clipboard-list" width={14} height={14} />
              粘贴文本
            </button>
            <button
              type="button"
              onClick={() => switchTab('upload')}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] text-[12px] transition-colors duration-[80ms] ${tab === 'upload' ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
            >
              <Icon icon="lucide:file-up" width={14} height={14} />
              上传文件
            </button>
          </div>

          {/* 配额已满提示（添加按钮随之禁用） */}
          {quotaFull && (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12px] text-[var(--color-danger)]">
              <Icon icon="lucide:alert-triangle" width={12} height={12} className="mt-0.5 shrink-0" />
              {countFull
                ? `资料数量已达上限（每个项目最多 ${MAX_PROJECT_RESOURCE_COUNT} 条）。删除部分资料后再添加。`
                : '配额已用完（32 KB）。删除部分资料或精简内容后再添加。'}
            </p>
          )}

          {tab === 'paste' ? (
            /* 粘贴文本表单 */
            <form onSubmit={handleAdd} className="mt-3">
              <label htmlFor="resource-name" className="mb-1 block text-[12px] text-[var(--color-text-secondary)]">
                名称
              </label>
              <input
                id="resource-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="资料名称，如：产品介绍"
                maxLength={MAX_RESOURCE_NAME_LENGTH}
                autoFocus
                className={inputClasses}
              />
              <label htmlFor="resource-content" className="mb-1 mt-3 block text-[12px] text-[var(--color-text-secondary)]">
                内容
              </label>
              <textarea
                id="resource-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="粘贴规范、数据结构等文本内容"
                rows={5}
                className={`${inputClasses} resize-none max-h-[160px] overflow-y-auto`}
              />
              <div className="mt-1 text-right font-mono text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                {formatKb(utf8ByteLength(content))}
              </div>
              {formError && (
                <p role="alert" className="mt-1 flex items-start gap-1.5 text-[12px] text-[var(--color-danger)]">
                  <Icon icon="lucide:alert-triangle" width={12} height={12} className="mt-0.5 shrink-0" />
                  {formError}
                </p>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={!name.trim() || !content.trim() || submitting || quotaFull}
                  className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors duration-[80ms] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon icon={submitting ? 'lucide:loader-circle' : 'lucide:plus'} width={14} height={14} className={submitting ? 'animate-spin' : ''} />
                  添加
                </button>
              </div>
            </form>
          ) : (
            /* 上传文件区 */
            <div className="mt-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                disabled={uploading}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed py-8 transition-colors duration-[140ms] disabled:opacity-60 ${dragOver ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border-default)] hover:border-[var(--color-border-strong)]'}`}
              >
                <Icon
                  icon={uploading ? 'lucide:loader-circle' : 'lucide:file-up'}
                  width={20}
                  height={20}
                  className={`text-[var(--color-text-secondary)] ${uploading ? 'animate-spin' : ''}`}
                />
                <span className="text-[13px] text-[var(--color-text-secondary)]">
                  {uploading ? '正在读取文件...' : '点击选择或拖入文件'}
                </span>
                <span className="text-[12px] text-[var(--color-text-tertiary)]">支持 .md、.txt、.json，单条不超过 16 KB</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json"
                className="hidden"
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {fileError && (
                <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--color-danger)]">
                  <Icon icon="lucide:alert-triangle" width={12} height={12} className="mt-0.5 shrink-0" />
                  {fileError}
                </p>
              )}
            </div>
          )}

          {/* 列表区 */}
          <div className="mt-4 border-t border-[var(--color-border-default)]">
            {loading ? (
              /* 骨架 3 行 */
              <div className="divide-y divide-[var(--color-border-default)]">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-2 py-2.5 motion-reduce:animate-none animate-pulse">
                    <div className="h-4 w-4 rounded-[4px] bg-[var(--color-bg-elevated)]" />
                    <div className="h-3 flex-1 rounded-[4px] bg-[var(--color-bg-elevated)]" />
                    <div className="h-3 w-10 rounded-[4px] bg-[var(--color-bg-elevated)]" />
                    <div className="h-3 w-12 rounded-[4px] bg-[var(--color-bg-elevated)]" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              /* 错误三段式：发生了什么 + 能做什么 + 恢复按钮 */
              <div className="mt-4 rounded-md border border-[var(--color-border-default)] p-4">
                <div className="flex items-center gap-2">
                  <Icon icon="lucide:alert-triangle" width={16} height={16} className="text-[var(--color-danger)]" />
                  <h4 className="text-[13px] font-medium text-[var(--color-text-primary)]">资料列表加载失败</h4>
                </div>
                <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">检查网络后重试，已添加的资料不会丢失</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-3 flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[var(--color-accent-hover)] transition-colors duration-[80ms]"
                >
                  <Icon icon="lucide:refresh-cw" width={14} height={14} />
                  重试
                </button>
              </div>
            ) : items.length === 0 ? (
              /* 空态：添加区常驻即行动入口 */
              <div className="py-8 text-center">
                <Icon icon="lucide:folder" width={24} height={24} className="mx-auto text-[var(--color-text-tertiary)]" />
                <p className="mt-2 text-[13px] text-[var(--color-text-primary)]">还没有资料</p>
                <p className="mx-auto mt-1 max-w-[240px] text-[12px] text-[var(--color-text-secondary)]">
                  粘贴文本或上传 .md、.txt、.json，生成时会作为参考注入
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-border-default)]">
                {items.map((item) => (
                  <li key={item.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                        aria-expanded={expandedId === item.id}
                        aria-label={`${expandedId === item.id ? '收起' : '查看'}资料 ${item.name}`}
                        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                      >
                        <Icon icon="lucide:file-text" width={16} height={16} className="shrink-0 text-[var(--color-text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]" title={item.name}>
                          {item.name}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-[var(--color-text-secondary)] tabular-nums">
                          {formatKb(item.size)}
                        </span>
                        <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
                          {formatRelativeTime(item.created_at)}
                        </span>
                        <Icon
                          icon="lucide:chevron-down"
                          width={14}
                          height={14}
                          className={`shrink-0 text-[var(--color-text-secondary)] transition-transform duration-[140ms] motion-reduce:transition-none ${expandedId === item.id ? 'rotate-180' : ''}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item)}
                        disabled={deletingId !== null}
                        aria-label={`删除资料 ${item.name}`}
                        className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-base)] transition-colors duration-[80ms] disabled:opacity-50"
                      >
                        <Icon
                          icon={deletingId === item.id ? 'lucide:loader-circle' : 'lucide:trash-2'}
                          width={14}
                          height={14}
                          className={deletingId === item.id ? 'animate-spin' : ''}
                        />
                      </button>
                    </div>
                    {/* 展开区：等宽字体全文，超长内部滚动 */}
                    {expandedId === item.id && (
                      <pre className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-base)] p-3 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words text-[var(--color-text-primary)]">
                        {item.content}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
