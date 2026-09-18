/**
 * Toast 通知组件。
 * 支持成功/错误/信息三种类型，自动消失。
 */
import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number | undefined;
}

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? 4000;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onDismiss(toast.id), 150);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const icons = {
    success: 'lucide:check',
    error: 'lucide:x',
    info: 'lucide:shield-check',
  };

  const colors = {
    success: 'text-[var(--color-accent)]',
    error: 'text-[#ef4444]',
    info: 'text-[var(--color-text-primary)]',
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.16)] ${
        isExiting ? 'animate-out fade-out slide-out-to-right-4 duration-150' : 'animate-in fade-in slide-in-from-right-4 duration-150'
      }`}
    >
      <Icon icon={icons[toast.type]} width={18} height={18} className={colors[toast.type]} />
      <p className="flex-1 text-[14px] text-[var(--color-text-primary)] leading-[1.5]">{toast.message}</p>
      <button
        onClick={() => {
          setIsExiting(true);
          setTimeout(() => onDismiss(toast.id), 150);
        }}
        aria-label="关闭通知"
        className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <Icon icon="lucide:x" width={14} height={14} />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return createPortal(
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 max-w-[400px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}

// 全局状态管理
let toastId = 0;
const listeners = new Set<(toasts: ToastMessage[]) => void>();
let currentToasts: ToastMessage[] = [];

function notifyListeners() {
  listeners.forEach((listener) => listener([...currentToasts]));
}

function addToast(type: ToastType, message: string, duration?: number) {
  const id = `toast-${++toastId}`;
  currentToasts = [...currentToasts, { id, type, message, duration }];
  notifyListeners();
}

function dismissToast(id: string) {
  currentToasts = currentToasts.filter((t) => t.id !== id);
  notifyListeners();
}

// 导出的 toast API
export const toast = {
  success: (message: string, duration?: number) => addToast('success', message, duration),
  error: (message: string, duration?: number) => addToast('error', message, duration),
  info: (message: string, duration?: number) => addToast('info', message, duration),
  dismiss: dismissToast,
};

// Toast Provider 组件
export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  const handleDismiss = useCallback((id: string) => {
    dismissToast(id);
  }, []);

  return <ToastContainer toasts={toasts} onDismiss={handleDismiss} />;
}