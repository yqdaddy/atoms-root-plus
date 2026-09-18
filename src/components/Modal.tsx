/**
 * Modal 通用弹窗组件。
 * 支持遮罩层点击关闭、ESC 键关闭、内容区域自定义。
 */
import { useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';

export interface ModalProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title?: string;
  /** 子内容 */
  children: ReactNode;
  /** 底部操作区 */
  footer?: ReactNode;
  /** 是否允许点击遮罩关闭（默认 true） */
  closeOnOverlay?: boolean;
  /** 最大宽度 */
  maxWidth?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeOnOverlay = true,
  maxWidth = '480px',
}: ModalProps) {
  // ESC 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    },
    [open, onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      // 禁止背景滚动
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  // 遮罩点击
  const handleOverlayClick = useCallback(() => {
    if (closeOnOverlay) {
      onClose();
    }
  }, [closeOnOverlay, onClose]);

  // 内容区点击阻止冒泡
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-150"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[16px] shadow-[0_8px_32px_rgba(0,0,0,0.24)] animate-in zoom-in-95 duration-150"
        style={{ maxWidth, width: '100%' }}
        onClick={handleContentClick}
      >
        {/* 标题栏 */}
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-default)]">
            <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="p-1 rounded-[6px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[80ms]"
            >
              <Icon icon="lucide:x" width={16} height={16} />
            </button>
          </div>
        )}

        {/* 内容区 */}
        <div className="px-5 py-4">{children}</div>

        {/* 底部操作区 */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--color-border-default)]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}