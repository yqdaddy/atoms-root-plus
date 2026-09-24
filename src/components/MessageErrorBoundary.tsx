/**
 * 消息级错误边界（MAJOR-D1 前端兜底）。
 *
 * 单条消息渲染抛错时降级为占位卡片：提示"该消息渲染失败"，并提供原始
 * 文本的折叠查看入口。错误不向上抛，对话面板的其余部分不受影响。
 *
 * 使用方式：在每条 AI 消息的内容渲染外层包裹一层，rawContent 传入消息
 * 原始文本。降级卡片自身只做纯文本渲染，不解析消息内容，保证兜底路径
 * 不会二次崩溃。
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Icon } from '@iconify/react';
import LongTextTruncate from './LongTextTruncate';

interface MessageErrorBoundaryProps {
  /** 被包裹的消息内容渲染器 */
  children: ReactNode;
  /** 原始消息文本：降级卡片中供用户折叠查看 */
  rawContent: string;
}

interface MessageErrorBoundaryState {
  hasError: boolean;
  /** 捕获到的错误类型名（只展示类型名，不展示可能超长的 message） */
  errorName: string;
}

/**
 * 消息渲染失败的降级占位卡片。
 * 独立函数组件，只依赖原始文本，不接收任何会被解析的消息结构。
 * 原始文本用原生 details 折叠（默认收起），内部由 LongTextTruncate 二次
 * 限量渲染，双重保证兜底路径不把超大 payload 直接灌进 DOM。
 */
function MessageFallbackCard({
  rawContent,
  errorName,
}: {
  rawContent: string;
  errorName: string;
}) {
  return (
    <div
      data-testid="message-fallback"
      className="my-2 rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden"
    >
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon
            icon="lucide:alert-triangle"
            width={16}
            height={16}
            className="text-amber-600 shrink-0"
          />
          <span className="text-[13px] font-medium text-amber-700">
            该消息渲染失败
          </span>
        </div>
        <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed mb-2">
          消息内容可能包含异常数据，已停止渲染以保护对话面板，其他消息不受影响。
        </p>
        <details className="group">
          <summary className="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] cursor-pointer transition-all duration-[140ms] list-none [&::-webkit-details-marker]:hidden">
            <Icon
              icon="lucide:chevron-down"
              width={14}
              height={14}
              className="group-open:hidden"
            />
            <Icon
              icon="lucide:chevron-up"
              width={14}
              height={14}
              className="hidden group-open:inline"
            />
            查看原始文本
          </summary>
          <div className="mt-2 p-2.5 rounded-lg bg-[var(--color-bg-inset)] border border-[var(--color-border-default)]">
            <LongTextTruncate
              text={rawContent}
              previewLength={2000}
              className="text-[12px] font-mono whitespace-pre-wrap break-words text-[var(--color-text-secondary)]"
            />
          </div>
        </details>
        <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
          渲染错误类型：{errorName || '未知'}
        </p>
      </div>
    </div>
  );
}

/**
 * 消息级错误边界（class 组件：React 错误边界当前仅支持 class 声明方式）。
 */
class MessageErrorBoundary extends Component<
  MessageErrorBoundaryProps,
  MessageErrorBoundaryState
> {
  override state: MessageErrorBoundaryState = {
    hasError: false,
    errorName: '',
  };

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<MessageErrorBoundaryState> {
    return {
      hasError: true,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 保留错误日志便于排查（生产构建保留 console.error 用于错误上报）
    console.error(
      '[MessageErrorBoundary] 消息渲染失败，已降级为占位卡片',
      error,
      errorInfo.componentStack,
    );
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <MessageFallbackCard
        rawContent={this.props.rawContent}
        errorName={this.state.errorName}
      />
    );
  }
}

export default MessageErrorBoundary;
