/**
 * 消息渲染组件。
 * 支持 Markdown 渲染、代码块语法高亮、复制代码按钮。
 */
import { useState, useCallback, useMemo } from 'react';
import { Icon } from '@iconify/react';

interface MessageRendererProps {
  /** 消息内容（支持 Markdown） */
  content: string;
  /** 是否流式输出中 */
  isStreaming?: boolean;
}

/** 简单的 Markdown 解析（支持代码块、行内代码、粗体、链接） */
function parseMarkdown(text: string): React.ReactNode[] {
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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败
    }
  }, [code]);

  // 简单的语法高亮（关键词高亮）
  const highlightedCode = useMemo(() => {
    // 先转义 HTML 实体再高亮：防止代码内容注入主文档，并让下方的标签高亮规则能命中 &lt; 形式
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

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

  return (
    <div className="relative my-3 rounded-lg bg-[var(--color-bg-inset)] border border-[var(--color-border-default)] overflow-hidden">
      {/* 头部：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
        <span className="text-[12px] font-mono text-[var(--color-text-secondary)]">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
        >
          <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} width={14} height={14} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* 代码内容 */}
      <pre className="p-3 overflow-x-auto text-[13px] font-mono leading-[1.6] text-[var(--color-text-primary)]">
        <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
      </pre>
    </div>
  );
}

export default function MessageRenderer({ content, isStreaming }: MessageRendererProps) {
  return (
    <div className="text-[14px] leading-[1.65] text-[var(--color-text-primary)]">
      {parseMarkdown(content)}
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-1 bg-[var(--color-accent)] animate-pulse" />
      )}
    </div>
  );
}