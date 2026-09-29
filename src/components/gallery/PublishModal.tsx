/**
 * 「发布到广场」弹窗。
 * 展示待发布项目名，填写可选简介（上限 200 字符，与服务端一致），
 * 提交 POST /api/gallery（同一项目重复发布则由服务端更新快照）。
 * 成功回调由父级负责 toast、本会话已发布标记与关闭弹窗。
 */
import { useState } from 'react';
import { Icon } from '@iconify/react';
import Modal from '../Modal';
import { toast } from '../Toast';
import { publishToGallery } from '../../services/gallery';
import { ApiError } from '../../services/apiClient';

/** 与服务端 MAX_DESCRIPTION_LENGTH 一致 */
const MAX_DESCRIPTION_LENGTH = 200;

export interface PublishModalProps {
  open: boolean;
  /** 待发布项目（null 表示弹窗关闭） */
  project: { id: string; name: string } | null;
  onClose: () => void;
  /** 发布成功（含更新已有发布），回传项目 id 与发布快照 id（供取消发布使用） */
  onPublished: (projectId: string, galleryId: string) => void;
}

export default function PublishModal({ open, project, onClose, onPublished }: PublishModalProps) {
  const [description, setDescription] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  const trimmed = description.trim();
  const isOverLimit = trimmed.length > MAX_DESCRIPTION_LENGTH;
  const canSubmit = project !== null && !isPublishing && !isOverLimit;

  const handleClose = () => {
    if (isPublishing) return;
    setDescription('');
    onClose();
  };

  const handlePublish = async () => {
    if (!project || isPublishing || isOverLimit) return;
    setIsPublishing(true);
    try {
      const result = await publishToGallery({
        projectId: project.id,
        description: trimmed === '' ? undefined : trimmed,
      });
      onPublished(project.id, result.id);
      toast.success(result.updated ? '已更新广场快照' : '已发布到广场');
      setDescription('');
    } catch (e: unknown) {
      // 401 由 apiClient 全局拦截（会话过期提示与跳转），不重复提示
      if (!(e instanceof ApiError && e.status === 401)) {
        const message = e instanceof Error ? e.message : '发布失败';
        toast.error(`${message}，请重试`);
      }
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Modal
      open={open && project !== null}
      onClose={handleClose}
      title="发布到广场"
      footer={
        <>
          <button
            onClick={handleClose}
            disabled={isPublishing}
            className="px-4 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] disabled:opacity-60 transition-colors duration-[140ms]"
          >
            取消
          </button>
          <button
            onClick={handlePublish}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[13px] font-medium hover:bg-[var(--color-accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[140ms]"
          >
            {isPublishing && <Icon icon="lucide:loader-circle" width={14} height={14} className="animate-spin" />}
            发布
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-1">项目</p>
          <p className="text-[14px] text-[var(--color-text-primary)] font-medium truncate">
            {project?.name ?? ''}
          </p>
        </div>
        <div>
          <label htmlFor="gallery-description" className="block text-[13px] text-[var(--color-text-secondary)] mb-1">
            简介（可选）
          </label>
          <textarea
            id="gallery-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话介绍这个作品，让广场访客更快了解它"
            rows={4}
            className="w-full px-3 py-2 rounded-[10px] bg-[var(--color-bg-base)] border border-[var(--color-border-default)] text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] outline-none resize-none transition-colors duration-[140ms]"
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              发布后作品公开展示，访客可预览与复刻快照
            </p>
            <span
              className={`text-[12px] font-mono shrink-0 ml-3 ${isOverLimit ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-secondary)]'}`}
              aria-live="polite"
            >
              {description.length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </div>
          {isOverLimit && (
            <p role="alert" className="mt-1 text-[12px] text-[var(--color-danger)]">
              简介超过 {MAX_DESCRIPTION_LENGTH} 字符，请精简后再发布。
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
