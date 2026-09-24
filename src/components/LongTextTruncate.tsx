/**
 * 超长纯文本折叠组件（MAJOR-D1 超大 payload 防护）。
 *
 * 短文本直接渲染；超过预览阈值的文本默认只渲染预览片段，点击后按渲染
 * 上限展开，避免万级以上字符一次性全量进入 DOM。用于用户消息纯文本与
 * 错误降级卡片中的原始文本查看。
 */
import { useState } from 'react';
import { Icon } from '@iconify/react';
import {
  COLLAPSED_PREVIEW_LENGTH,
  RAW_TEXT_RENDER_LIMIT,
  clampRenderText,
} from '../lib/renderGuard';

interface LongTextTruncateProps {
  /** 原始文本 */
  text: string;
  /** 折叠预览长度（字符数），默认 2000 */
  previewLength?: number;
  /** 展开态渲染上限（字符数），默认 100000 */
  expandLimit?: number;
  /** 附加到文本容器的 className（如 whitespace-pre-wrap） */
  className?: string;
}

export default function LongTextTruncate({
  text,
  previewLength = COLLAPSED_PREVIEW_LENGTH,
  expandLimit = RAW_TEXT_RENDER_LIMIT,
  className,
}: LongTextTruncateProps) {
  const [expanded, setExpanded] = useState(false);

  // 短文本：直接渲染，不引入额外结构
  if (text.length <= previewLength) {
    return <p className={className}>{text}</p>;
  }

  const view = expanded
    ? clampRenderText(text, expandLimit)
    : { text: text.slice(0, previewLength), clipped: true };

  return (
    <div>
      <p className={className}>
        {view.text}
        {!expanded && '…'}
      </p>
      {expanded && view.clipped && (
        <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
          内容过长，仅显示前 {expandLimit.toLocaleString()} 字符（共 {text.length.toLocaleString()} 字符）
        </p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
      >
        <Icon
          icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
          width={14}
          height={14}
        />
        {expanded ? '收起' : `查看全部（共 ${text.length.toLocaleString()} 字符）`}
      </button>
    </div>
  );
}
