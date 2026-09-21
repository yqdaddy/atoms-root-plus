/**
 * 流式消息组件。
 * 在消息列表中渲染 LLM 的流式输出，支持 Markdown 渲染。
 * 类似 Claude Code 的流式输出体验。
 */
import { Icon } from '@iconify/react';
import ReactMarkdown from 'react-markdown';
import type { GenerationStatus } from '../services/ai/types';

interface StreamingMessageProps {
  /** 流式文本内容 */
  content: string;
  /** 当前生成阶段 */
  stage: GenerationStatus;
  /** 当前正在生成的文件路径（可选） */
  activeFilePath?: string | null;
}

/** 阶段到文案和图标的映射 */
const STAGE_CONFIG: Record<GenerationStatus, { label: string; icon: string }> = {
  analyzing: { label: '正在分析...', icon: 'lucide:search' },
  generating: { label: '正在生成...', icon: 'lucide:code-2' },
  reviewing: { label: '正在审查...', icon: 'lucide:eye' },
  done: { label: '完成', icon: 'lucide:check-circle' },
  error: { label: '出错', icon: 'lucide:alert-circle' },
  idle: { label: '准备中', icon: 'lucide:sparkles' },
};

export function StreamingMessage({ content, stage, activeFilePath }: StreamingMessageProps) {
  const config = STAGE_CONFIG[stage] ?? STAGE_CONFIG.idle;

  return (
    <div className="flex gap-3">
      {/* AI 头像 */}
      <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
        <Icon icon="lucide:bot" width={16} height={16} className="text-[var(--color-accent)]" />
      </div>

      {/* 消息内容 */}
      <div className="flex-1 min-w-0">
        {/* 头部：AI 助手 + 阶段标签 */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            AI 助手
          </span>
          {stage !== 'done' && stage !== 'error' && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-accent)]">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
              <span>{config.label}</span>
              {activeFilePath && stage === 'generating' && (
                <span className="text-[var(--color-text-tertiary)]">
                  · {activeFilePath.split('/').pop()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Markdown 内容 */}
        {content && (
          <div className="prose prose-sm max-w-none text-[13px] text-[var(--color-text-primary)] leading-[1.6]">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}

        {/* 空状态提示 */}
        {!content && (
          <div className="text-[13px] text-[var(--color-text-tertiary)] italic">
            正在思考...
          </div>
        )}
      </div>
    </div>
  );
}