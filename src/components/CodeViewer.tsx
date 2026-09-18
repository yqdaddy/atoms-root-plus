/**
 * CodeViewer 组件：代码查看面板。
 * 支持 HTML 语法高亮、行号显示、复制代码、导出文件。
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';

interface CodeViewerProps {
  /** 是否显示面板 */
  isOpen: boolean;
  /** 关闭面板回调 */
  onClose: () => void;
  /** HTML 源码 */
  code: string;
  /** 文件名（用于导出） */
  fileName?: string;
}

/** HTML 语法高亮 */
function highlightHtml(code: string): string {
  // 先转义 HTML 实体
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // HTML 语法高亮
  let result = escaped
    // HTML 注释
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="text-[#5c6370]">$1</span>')
    // DOCTYPE
    .replace(/(&lt;!DOCTYPE[^&]*&gt;)/gi, '<span class="text-[#c678dd]">$1</span>')
    // HTML 标签名（开标签）
    .replace(/(&lt;)([\w-]+)/g, '$1<span class="text-[#e06c75]">$2</span>')
    // HTML 标签名（闭标签）
    .replace(/(&lt;\/)([\w-]+)/g, '$1<span class="text-[#e06c75]">$2</span>')
    // 属性名
    .replace(/\s([\w-]+)(=)/g, ' <span class="text-[#d19a66]">$1</span>$2')
    // 属性值（双引号）
    .replace(/(=)(")([^"]*)(")/g, '$1<span class="text-[#98c379]">$2$3$4</span>')
    // 属性值（单引号）
    .replace(/(=)(')([^']*)(')/g, '$1<span class="text-[#98c379]">$2$3$4</span>');

  return result;
}

export default function CodeViewer({ isOpen, onClose, code, fileName = 'index.html' }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // 复制代码
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败
    }
  }, [code]);

  // 导出文件
  const handleExport = useCallback(() => {
    const blob = new Blob([code], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, fileName]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 点击背景关闭
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === modalRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  // 语法高亮后的代码
  const highlightedCode = useMemo(() => highlightHtml(code), [code]);

  // 行号
  const lines = code.split('\n');
  const lineCount = lines.length;

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div className="flex flex-col w-full max-w-4xl max-h-[80vh] bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-default)] shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-2">
            <Icon icon="lucide:code" width={18} height={18} className="text-[var(--color-text-secondary)]" />
            <span className="text-[14px] font-medium text-[var(--color-text-primary)]">查看代码</span>
            <span className="text-[12px] text-[var(--color-text-secondary)]">{fileName}</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
            title="关闭"
          >
            <Icon icon="lucide:x" width={16} height={16} />
          </button>
        </div>

        {/* 代码区域 */}
        <div className="flex-1 overflow-auto">
          <div className="flex min-w-max">
            {/* 行号列 */}
            <div className="sticky left-0 z-10 flex flex-col px-3 py-3 text-right select-none bg-[var(--color-bg-inset)] border-r border-[var(--color-border-default)]">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="h-[1.6em] text-[13px] font-mono leading-[1.6] text-[var(--color-text-secondary)]">
                  {i + 1}
                </div>
              ))}
            </div>

            {/* 代码内容 */}
            <pre className="flex-1 px-3 py-3 text-[13px] font-mono leading-[1.6] text-[var(--color-text-primary)]">
              <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
            </pre>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] hover:bg-[var(--color-bg-inset)] transition-all duration-[140ms]"
          >
            <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} width={14} height={14} />
            {copied ? '已复制' : '复制代码'}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] transition-all duration-[140ms]"
          >
            <Icon icon="lucide:download" width={14} height={14} />
            导出文件
          </button>
        </div>
      </div>
    </div>
  );
}