/**
 * 消息渲染组件。
 * 支持 Markdown 渲染、代码块语法高亮、复制代码按钮。
 * 支持 JSON 结构化渲染：分析结果卡片、功能列表、交互列表。
 * 支持大文本自动截断（F-004）。
 */
import { useState, useCallback, useMemo } from 'react';
import { Icon } from '@iconify/react';
import JsonStructureRenderer from './JsonStructureRenderer';

interface MessageRendererProps {
  /** 消息内容（支持 Markdown） */
  content: string;
  /** 是否流式输出中 */
  isStreaming?: boolean;
}

/** 截断阈值（字符数） */
const TRUNCATE_THRESHOLD = 500;

/** 转义 HTML 实体 */
function escapeHtml(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 截断消息文本
 * @param text 原始文本
 * @returns 截断结果：预览文本、完整文本、是否截断标志
 */
function truncateMessage(text: string): { preview: string; full: string; truncated: boolean } {
  // 先移除代码块，计算纯文本长度
  const codeBlockRegex = /```[\s\S]*?```/g;
  let textWithoutCode = text.replace(codeBlockRegex, '');
  textWithoutCode = textWithoutCode.replace(/`[^`]+`/g, ''); // 移除行内代码

  // 纯文本长度不超过阈值，不截断
  if (textWithoutCode.length <= TRUNCATE_THRESHOLD) {
    return { preview: text, full: text, truncated: false };
  }

  // 截断纯文本部分，保留代码块完整
  // 找到代码块的位置
  const codeBlocks: { start: number; end: number; content: string }[] = [];
  let match;
  let lastIndex = 0;
  const regex = /```[\s\S]*?```/g;
  while ((match = regex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[0],
    });
  }

  // 按代码块分割文本
  const parts: string[] = [];
  lastIndex = 0;
  for (const block of codeBlocks) {
    // 添加代码块前的文本
    if (block.start > lastIndex) {
      parts.push(text.slice(lastIndex, block.start));
    }
    // 添加代码块标记（保留完整）
    parts.push(block.content);
    lastIndex = block.end;
  }
  // 添加最后一段文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // 如果没有代码块，直接截断
  if (codeBlocks.length === 0) {
    // 在单词边界截断（优先在句子结束处）
    let truncateIndex = TRUNCATE_THRESHOLD;

    // 向后查找句子结束符
    const nextSentenceEnd = text.indexOf('。', TRUNCATE_THRESHOLD);
    const nextPeriod = text.indexOf('.', TRUNCATE_THRESHOLD);
    const nextNewline = text.indexOf('\n', TRUNCATE_THRESHOLD);

    const candidates = [nextSentenceEnd, nextPeriod, nextNewline].filter(i => i > 0 && i < TRUNCATE_THRESHOLD + 100);
    if (candidates.length > 0) {
      truncateIndex = Math.min(...candidates) + 1;
    }

    const preview = text.slice(0, truncateIndex);
    return { preview, full: text, truncated: true };
  }

  // 有代码块：累计预览长度，在合适位置截断
  let previewLength = 0;
  const previewParts: string[] = [];

  for (const part of parts) {
    // 判断是否为代码块
    const isCodeBlock = part.startsWith('```');

    if (isCodeBlock) {
      // 代码块不计入长度，直接添加
      previewParts.push(part);
    } else {
      // 纯文本部分
      const remaining = TRUNCATE_THRESHOLD - previewLength;
      if (remaining <= 0) break;

      if (part.length <= remaining) {
        previewParts.push(part);
        previewLength += part.length;
      } else {
        // 截断这部分文本
        const truncatedPart = part.slice(0, remaining);
        previewParts.push(truncatedPart);
        previewLength += truncatedPart.length;
        break;
      }
    }
  }

  const preview = previewParts.join('');
  return { preview, full: text, truncated: true };
}

/** 检测文本是否为纯 JSON（可能是 LLM 直接输出的分析结果） */
function isPureJson(text: string): { isJson: boolean; parsed?: unknown } {
  const trimmed = text.trim();
  // 必须以 { 开头且以 } 结尾
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { isJson: false };
  }
  try {
    const parsed = JSON.parse(trimmed);
    return { isJson: true, parsed };
  } catch {
    return { isJson: false };
  }
}

/** 解析 Markdown 为 React 元素 */
function parseMarkdown(text: string): React.ReactNode[] {
  // 先检查是否是纯 JSON（LLM 直接输出的分析结果）
  const jsonCheck = isPureJson(text);
  if (jsonCheck.isJson) {
    // 直接使用结构化渲染器
    return [<JsonStructureRenderer key="json-0" jsonString={text} />];
  }

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = '';
  let codeBlockKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 代码块开始/结束
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockContent = '';
        codeBlockKey++;
      } else {
        inCodeBlock = false;
        elements.push(
          <CodeBlock key={`code-${codeBlockKey}`} language={codeBlockLang} code={codeBlockContent} />
        );
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line;
      continue;
    }

    // 普通文本行
    elements.push(
      <p key={`p-${i}`} className="mb-2 last:mb-0">
        {parseInlineMarkdown(line)}
      </p>
    );
  }

  // 未闭合的代码块
  if (inCodeBlock) {
    elements.push(
      <CodeBlock key={`code-unclosed`} language={codeBlockLang} code={codeBlockContent} />
    );
  }

  return elements;
}

/** 行内 Markdown 解析 */
function parseInlineMarkdown(text: string): React.ReactNode {
  // 简化实现：只处理行内代码、粗体、链接
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // 行内代码 `code`
    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index !== undefined) {
      const before = remaining.slice(0, codeMatch.index);
      if (before) parts.push(<span key={`text-${key++}`}>{before}</span>);
      parts.push(
        <code
          key={`code-${key++}`}
          className="px-1.5 py-0.5 rounded bg-[var(--color-bg-inset)] text-[var(--color-text-primary)] text-[13px] font-mono"
        >
          {codeMatch[1]!}
        </code>
      );
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    // 粗体 **text**
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      const before = remaining.slice(0, boldMatch.index);
      if (before) parts.push(<span key={`text-${key++}`}>{before}</span>);
      parts.push(
        <strong key={`bold-${key++}`} className="font-semibold text-[var(--color-text-primary)]">
          {boldMatch[1]!}
        </strong>
      );
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      continue;
    }

    // 链接 [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined) {
      const before = remaining.slice(0, linkMatch.index);
      if (before) parts.push(<span key={`text-${key++}`}>{before}</span>);
      parts.push(
        <a
          key={`link-${key++}`}
          href={linkMatch[2]!}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {linkMatch[1]!}
        </a>
      );
      remaining = remaining.slice(linkMatch.index + linkMatch[0].length);
      continue;
    }

    // 无匹配，追加剩余文本
    parts.push(<span key={`text-${key++}`}>{remaining}</span>);
    break;
  }

  return parts.length > 0 ? parts : text;
}

/** 代码块组件 */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const isJson = language === 'json';

  // JSON 使用结构化渲染器
  if (isJson) {
    return <JsonStructureRenderer jsonString={code} />;
  }

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

  // 语法高亮
  const highlightedCode = useMemo(() => {
    // 先转义 HTML 实体
    const escaped = escapeHtml(code);

    if (!language || language === 'plaintext') {
      return escaped;
    }

    // HTML/JS 简单关键词高亮
    let result = escaped
      // 关键词
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await)\b/g, '<span class="text-[#c678dd]">$1</span>')
      // 字符串
      .replace(/(['"`])([^'"`]*)(['"`])/g, '<span class="text-[#98c379]">$1$2$3</span>')
      // 数字
      .replace(/\b(\d+)\b/g, '<span class="text-[#d19a66]">$1</span>')
      // 注释
      .replace(/(\/\/.*$)/gm, '<span class="text-[#5c6370]">$1</span>')
      // HTML 标签
      .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="text-[#e06c75]">$2</span>');

    return result;
  }, [code, language]);

  const lineCount = code.split('\n').length;
  const canCollapse = lineCount > 10;

  return (
    <div className="relative my-3 rounded-lg bg-[var(--color-bg-inset)] border border-[var(--color-border-default)] overflow-hidden">
      {/* 头部：语言标签 + 折叠按钮 + 复制按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-mono text-[var(--color-text-secondary)]">
            {language || 'code'}
          </span>
          {canCollapse && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
            >
              <Icon icon={isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'} width={12} height={12} />
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
      <div className={`${isCollapsed ? 'max-h-[300px]' : ''} ${isCollapsed && canCollapse ? 'relative' : ''}`}>
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

export default function MessageRenderer({ content, isStreaming }: MessageRendererProps) {
  const [expanded, setExpanded] = useState(false);

  // 流式输出中不截断
  const { preview, full, truncated } = useMemo(() => {
    if (isStreaming) {
      return { preview: content, full: content, truncated: false };
    }
    return truncateMessage(content);
  }, [content, isStreaming]);

  const displayContent = expanded ? full : preview;

  return (
    <div className="text-[14px] leading-[1.65] text-[var(--color-text-primary)]">
      {parseMarkdown(displayContent)}
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-1 bg-[var(--color-accent)] animate-pulse" />
      )}
      {/* 展开/收起按钮 */}
      {truncated && !isStreaming && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
        >
          <Icon icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'} width={14} height={14} />
          {expanded ? '收起' : '查看全部'}
        </button>
      )}
    </div>
  );
}