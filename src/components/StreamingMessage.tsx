/**
 * 流式消息组件。
 * 在消息列表中渲染 LLM 的流式输出，支持 Markdown 渲染。
 * 类似 Claude Code 的流式输出体验。
 *
 * 改进：
 * - 增加进度指示器（骨架屏、加载动画）
 * - 显示更丰富的阶段信息
 * - 确保长文本自动换行
 * - 增加已用时间计时器
 */
import { useState, useEffect } from 'react';
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
const STAGE_CONFIG: Record<GenerationStatus, { label: string; icon: string; description: string }> = {
  idle: {
    label: '准备中',
    icon: 'lucide:sparkles',
    description: '正在初始化...'
  },
  analyzing: {
    label: '正在分析',
    icon: 'lucide:search',
    description: '正在分析需求结构，识别功能要点...'
  },
  generating: {
    label: '正在生成',
    icon: 'lucide:code-2',
    description: '正在生成代码，实时预览中...'
  },
  reviewing: {
    label: '正在审查',
    icon: 'lucide:eye',
    description: '正在验证代码质量，检查功能完整性...'
  },
  done: {
    label: '完成',
    icon: 'lucide:check-circle',
    description: '生成完成'
  },
  error: {
    label: '出错',
    icon: 'lucide:alert-circle',
    description: '生成失败'
  },
};

/** 格式化已用时间 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

/** 骨架屏加载动画组件 */
function SkeletonLoader() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-[var(--color-border-default)] rounded w-3/4" />
      <div className="h-4 bg-[var(--color-border-default)] rounded w-5/6" />
      <div className="h-4 bg-[var(--color-border-default)] rounded w-2/3" />
      <div className="h-4 bg-[var(--color-border-default)] rounded w-4/5" />
    </div>
  );
}

/** 进度指示器组件 */
function ProgressIndicator({
  stage,
  elapsedSeconds,
  isCollapsed = false,
  onToggleCollapse,
}: {
  stage: GenerationStatus;
  elapsedSeconds: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const config = STAGE_CONFIG[stage] ?? STAGE_CONFIG.idle;

  // 定义阶段顺序
  const stageOrder: GenerationStatus[] = ['analyzing', 'generating', 'reviewing'];
  const currentIndex = stageOrder.indexOf(stage);

  // 判断是否已完成
  const isCompleted = stage === 'done';

  // 收起状态：显示简要信息
  if (isCollapsed && isCompleted) {
    return (
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-lg hover:border-[var(--color-accent)] transition-colors group"
      >
        <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center">
          <Icon icon="lucide:check-circle" width={14} height={14} className="text-green-500" />
        </div>
        <span className="text-[12px] text-[var(--color-text-secondary)] flex-1 text-left">
          生成完成，耗时 {formatElapsedTime(elapsedSeconds)}
        </span>
        <Icon
          icon="lucide:chevron-down"
          width={14}
          height={14}
          className="text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent)] transition-colors"
        />
      </button>
    );
  }

  // 展开状态：显示完整信息
  return (
    <div className="space-y-3">
      {/* 阶段步骤指示 */}
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          stage === 'error' ? 'bg-red-500/10' : 'bg-[var(--color-accent)]/10'
        }`}>
          <Icon
            icon={config.icon}
            width={16}
            height={16}
            className={stage === 'error' ? 'text-red-500' : 'text-[var(--color-accent)]'}
          />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {config.label}
            </span>
            <span className="text-[12px] text-[var(--color-text-tertiary)] tabular-nums">
              {formatElapsedTime(elapsedSeconds)}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">
            {config.description}
          </p>
        </div>
        {/* 完成状态时显示收起按钮 */}
        {isCompleted && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--color-bg-base)] transition-colors"
            title="收起"
          >
            <Icon
              icon="lucide:chevron-up"
              width={14}
              height={14}
              className="text-[var(--color-text-tertiary)]"
            />
          </button>
        )}
      </div>

      {/* 进度条 */}
      <div className="flex gap-1.5">
        {stageOrder.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              s === stage
                ? 'bg-[var(--color-accent)]'
                : i < currentIndex
                  ? 'bg-green-500'
                  : 'bg-[var(--color-border-default)]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/** 动态加载点动画 */
function LoadingDots() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

export function StreamingMessage({ content, stage, activeFilePath }: StreamingMessageProps) {
  const config = STAGE_CONFIG[stage] ?? STAGE_CONFIG.idle;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  // 计时器：生成过程中持续计时
  useEffect(() => {
    if (stage === 'done' || stage === 'error') {
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [stage]);

  // 生成完成时，默认收起进度信息
  // 生成中时，默认展开
  useEffect(() => {
    if (stage === 'done') {
      setIsExpanded(false);
    } else if (stage !== 'error') {
      setIsExpanded(true);
    }
  }, [stage]);

  // 判断是否显示进度指示器（内容为空或刚开始生成时）
  const showProgressIndicator = !content || content.length < 50;

  // 判断是否正在生成（非完成/错误状态）
  const isActive = stage !== 'done' && stage !== 'error';

  // 判断是否已完成（需要显示可折叠的进度信息）
  const isCompleted = stage === 'done';

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
          {isActive && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-accent)]">
              <LoadingDots />
              <span>{config.label}</span>
              {activeFilePath && stage === 'generating' && (
                <span className="text-[var(--color-text-tertiary)]">
                  · {activeFilePath.split('/').pop()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 进度指示器：生成中或完成后都可显示 */}
        {showProgressIndicator && isActive && (
          <div className="mb-4 p-4 bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-xl">
            <ProgressIndicator stage={stage} elapsedSeconds={elapsedSeconds} />
          </div>
        )}

        {/* 完成后的折叠进度信息 */}
        {isCompleted && (
          <div className="mb-4 overflow-hidden transition-all duration-200">
            <ProgressIndicator
              stage={stage}
              elapsedSeconds={elapsedSeconds}
              isCollapsed={!isExpanded}
              onToggleCollapse={() => setIsExpanded(!isExpanded)}
            />
          </div>
        )}

        {/* Markdown 内容：确保正确换行 */}
        {content && (
          <div className="prose prose-sm max-w-none text-[13px] text-[var(--color-text-primary)] leading-[1.6] whitespace-pre-wrap break-words">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}

        {/* 骨架屏加载动画：内容为空且正在生成时显示 */}
        {!content && isActive && stage !== 'analyzing' && (
          <div className="mt-3">
            <SkeletonLoader />
          </div>
        )}
      </div>
    </div>
  );
}