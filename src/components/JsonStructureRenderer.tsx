/**
 * 结构化 JSON 渲染组件。
 * 根据 JSON 内容类型自动识别并渲染不同的可视化样式。
 *
 * 设计原则：
 * - 禁止 AI 紫渐变
 * - 使用 Tailwind 原子类
 * - 图标来自 iconify（lucide 集）
 * - 无 Em-dash
 */
import { useState, useCallback, useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { FeatureList, FeatureItem } from '../services/ai/types';

/** JSON 结构类型 */
type JsonStructureType =
  | 'feature-list' // 分析结果（FeatureList）
  | 'review-report' // 审查报告（pass + checks）
  | 'interactions' // 交互列表
  | 'generic'; // 通用 JSON

/** 检测 JSON 结构类型 */
function detectJsonStructure(json: unknown): JsonStructureType {
  if (typeof json !== 'object' || json === null) {
    return 'generic';
  }

  const obj = json as Record<string, unknown>;

  // 审查报告: 必须有 pass 和 checks 数组
  if (
    typeof obj.pass === 'boolean' &&
    Array.isArray(obj.checks) &&
    obj.checks.length > 0
  ) {
    return 'review-report';
  }

  // FeatureList: 必须有 appTitle 和 features 数组
  if (
    typeof obj.appTitle === 'string' &&
    Array.isArray(obj.features) &&
    obj.features.length > 0
  ) {
    return 'feature-list';
  }

  // 纯交互列表: 只有 interactions 数组
  if (
    Object.keys(obj).length === 1 &&
    Array.isArray(obj.interactions)
  ) {
    return 'interactions';
  }

  return 'generic';
}

/** 应用类型标签颜色映射 */
const APP_TYPE_COLORS: Record<string, string> = {
  tool: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  game: 'bg-green-500/10 text-green-600 border-green-500/20',
  dashboard: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  form: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  default: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
};

/** 优先级标签样式 */
const PRIORITY_STYLES: Record<FeatureItem['priority'], { bg: string; icon: string }> = {
  must: {
    bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    icon: 'lucide:check-circle',
  },
  nice: {
    bg: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
    icon: 'lucide:star',
  },
};

/** 优先级标签组件 */
function PriorityBadge({ priority }: { priority: FeatureItem['priority'] }) {
  const style = PRIORITY_STYLES[priority];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${style.bg}`}
    >
      <Icon icon={style.icon} width={12} height={12} />
      {priority === 'must' ? '必需' : '可选'}
    </span>
  );
}

/** 功能卡片组件 */
function FeatureCard({ feature, index }: { feature: FeatureItem; index: number }) {
  return (
    <div className="group p-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-default)] hover:border-[var(--color-accent)] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-[var(--color-accent)]/10 flex items-center justify-center text-[12px] font-medium text-[var(--color-accent)]">
            {index + 1}
          </span>
          <h4 className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {feature.name}
          </h4>
        </div>
        <PriorityBadge priority={feature.priority} />
      </div>
      <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed pl-8">
        {feature.description}
      </p>
    </div>
  );
}

/** 分析结果卡片（FeatureList） */
function AnalysisResultCard({ data }: { data: FeatureList }) {
  return (
    <div className="my-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] overflow-hidden">
      {/* 头部：标题 + 类型标签 */}
      <div className="p-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center">
            <Icon icon="lucide:box" width={20} height={20} className="text-[var(--color-accent)]" />
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              {data.appTitle}
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border mt-1 ${
                APP_TYPE_COLORS[data.appType] || APP_TYPE_COLORS.default
              }`}
            >
              <Icon icon="lucide:tag" width={10} height={10} />
              {data.appType}
            </span>
          </div>
        </div>
        {data.summary && (
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            {data.summary}
          </p>
        )}
      </div>

      {/* 功能列表 */}
      {data.features && data.features.length > 0 && (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon
              icon="lucide:list"
              width={14}
              height={14}
              className="text-[var(--color-text-secondary)]"
            />
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              功能清单
            </span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              ({data.features.length} 项)
            </span>
          </div>
          <div className="grid gap-2">
            {data.features.map((feature, i) => (
              <FeatureCard key={feature.id || i} feature={feature} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* 交互方式 */}
      {data.interactions && data.interactions.length > 0 && (
        <div className="p-4 border-t border-[var(--color-border-default)]">
          <div className="flex items-center gap-2 mb-2">
            <Icon
              icon="lucide:mouse-pointer-click"
              width={14}
              height={14}
              className="text-[var(--color-text-secondary)]"
            />
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              交互方式
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.interactions.map((interaction, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--color-bg-inset)] text-[12px] text-[var(--color-text-secondary)]"
              >
                <Icon icon="lucide:circle-dot" width={10} height={10} />
                {interaction}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 假设与约束 */}
      {data.assumptions && data.assumptions.length > 0 && (
        <div className="p-4 border-t border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
          <div className="flex items-center gap-2 mb-2">
            <Icon
              icon="lucide:info"
              width={14}
              height={14}
              className="text-[var(--color-text-tertiary)]"
            />
            <span className="text-[12px] font-medium text-[var(--color-text-tertiary)]">
              假设与约束
            </span>
          </div>
          <ul className="space-y-1">
            {data.assumptions.map((assumption, i) => (
              <li
                key={i}
                className="text-[11px] text-[var(--color-text-tertiary)] pl-4 relative before:content-['·'] before:absolute before:left-0 before:text-[var(--color-text-tertiary)]"
              >
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 交互列表组件 */
function InteractionListCard({ interactions }: { interactions: string[] }) {
  return (
    <div className="my-4 p-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)]">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center">
          <Icon
            icon="lucide:mouse-pointer-click"
            width={14}
            height={14}
            className="text-[var(--color-accent)]"
          />
        </div>
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
          交互方式
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {interactions.map((interaction, i) => (
          <div
            key={i}
            className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-default)]"
          >
            <Icon
              icon="lucide:circle-dot"
              width={12}
              height={12}
              className="text-[var(--color-accent)] shrink-0"
            />
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              {interaction}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 审查报告项 */
interface ReviewCheckItem {
  item: string;
  pass: boolean;
  note?: string;
}

/** 审查报告数据 */
interface ReviewReport {
  pass: boolean;
  checks: ReviewCheckItem[];
  repairInstructions?: string[];
  missingFiles?: string[];
}

/** 审查报告卡片组件 */
function ReviewReportCard({ data }: { data: ReviewReport }) {
  const passedCount = data.checks.filter(c => c.pass).length;
  const totalCount = data.checks.length;

  return (
    <div className="my-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] overflow-hidden">
      {/* 头部：总体结果 */}
      <div className={`p-4 ${data.pass ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${data.pass ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
            <Icon
              icon={data.pass ? 'lucide:check-circle' : 'lucide:x-circle'}
              width={20}
              height={20}
              className={data.pass ? 'text-emerald-600' : 'text-red-600'}
            />
          </div>
          <div>
            <h3 className={`text-[16px] font-semibold ${data.pass ? 'text-emerald-700' : 'text-red-700'}`}>
              {data.pass ? '审查通过' : '审查未通过'}
            </h3>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              {passedCount}/{totalCount} 项检查通过
            </p>
          </div>
        </div>
      </div>

      {/* 检查项列表 */}
      <div className="p-4">
        <div className="grid gap-2">
          {data.checks.map((check, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg border ${
                check.pass
                  ? 'bg-[var(--color-bg-base)] border-[var(--color-border-default)]'
                  : 'bg-red-500/5 border-red-500/20'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon
                  icon={check.pass ? 'lucide:check' : 'lucide:x'}
                  width={14}
                  height={14}
                  className={check.pass ? 'text-emerald-600' : 'text-red-600'}
                />
                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  {check.item}
                </span>
                <span
                  className={`ml-auto text-[11px] px-2 py-0.5 rounded ${
                    check.pass
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-red-500/10 text-red-600'
                  }`}
                >
                  {check.pass ? '通过' : '未通过'}
                </span>
              </div>
              {check.note && (
                <p className="text-[12px] text-[var(--color-text-secondary)] pl-6">
                  {check.note}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 修复指令 */}
      {data.repairInstructions && data.repairInstructions.length > 0 && (
        <div className="p-4 border-t border-[var(--color-border-default)] bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Icon icon="lucide:wrench" width={14} height={14} className="text-amber-600" />
            <span className="text-[12px] font-medium text-amber-700">修复建议</span>
          </div>
          <ul className="space-y-1">
            {data.repairInstructions.map((instruction, i) => (
              <li
                key={i}
                className="text-[12px] text-[var(--color-text-secondary)] pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-amber-600"
              >
                {instruction}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 转义 HTML 实体 */
function escapeHtml(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** JSON 语法高亮 */
function highlightJson(code: string): string {
  const escaped = escapeHtml(code);

  return escaped
    // 字符串 key
    .replace(/"([\w-]+)"(\s*:)/g, '<span class="text-[#e06c75]">"$1"</span>$2')
    // 字符串值
    .replace(/:\s*"([^"]*)"/g, ': <span class="text-[#98c379]">"$1"</span>')
    // 数字
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="text-[#d19a66]">$1</span>')
    // 布尔和 null
    .replace(/:\s*(true|false|null)/g, ': <span class="text-[#c678dd]">$1</span>');
}

/** 通用 JSON 视图（保持现有高亮 + 折叠） */
function GenericJsonView({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(code.split('\n').length > 20);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败
    }
  }, [code]);

  const highlightedCode = useMemo(() => highlightJson(code), [code]);
  const lineCount = code.split('\n').length;
  const canCollapse = lineCount > 10;

  return (
    <div className="relative my-3 rounded-lg bg-[var(--color-bg-inset)] border border-[var(--color-border-default)] overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-mono text-[var(--color-text-secondary)]">json</span>
          {canCollapse && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
            >
              <Icon
                icon={isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'}
                width={12}
                height={12}
              />
              {isCollapsed ? `展开 (${lineCount} 行)` : '收起'}
            </button>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
        >
          <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} width={14} height={14} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* 代码内容：自动换行 */}
      <div
        className={`${isCollapsed ? 'max-h-[300px]' : ''} ${isCollapsed && canCollapse ? 'relative' : ''}`}
      >
        <pre className="p-3 text-[13px] font-mono leading-[1.6] text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
          <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
        </pre>
        {isCollapsed && canCollapse && (
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[var(--color-bg-inset)] to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  );
}

/** JSON 结构渲染器 */
interface JsonStructureRendererProps {
  /** JSON 字符串 */
  jsonString: string;
  /** 是否流式输出中 */
  isStreaming?: boolean;
}

export function JsonStructureRenderer({ jsonString, isStreaming = false }: JsonStructureRendererProps) {
  // 尝试解析 JSON
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonString);
  } catch {
    // 解析失败，回退到原始文本
    return <GenericJsonView code={jsonString} />;
  }

  // 流式输出中，显示原始 JSON
  if (isStreaming) {
    return <GenericJsonView code={jsonString} />;
  }

  // 检测结构类型
  const structureType = detectJsonStructure(parsedJson);

  // 根据结构类型渲染对应组件
  switch (structureType) {
    case 'review-report':
      return <ReviewReportCard data={parsedJson as ReviewReport} />;

    case 'feature-list':
      return <AnalysisResultCard data={parsedJson as FeatureList} />;

    case 'interactions':
      return (
        <InteractionListCard interactions={(parsedJson as { interactions: string[] }).interactions} />
      );

    case 'generic':
    default:
      return <GenericJsonView code={jsonString} />;
  }
}

export default JsonStructureRenderer;