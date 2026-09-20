/**
 * CodeViewer 组件：代码查看面板。
 * 支持多文件展示：左侧文件树 + 右侧代码区。
 * 支持 HTML/CSS/JS/JSON 语法高亮、行号显示、复制代码、导出文件。
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { FileNode } from '../types/project';
import { FileTreePanel, type TreeNode, type FileType } from './FileTree';
import { buildTree, isMultiFileProject } from './FileTree/buildTree';

interface CodeViewerProps {
  /** 是否显示面板 */
  isOpen: boolean;
  /** 关闭面板回调 */
  onClose: () => void;
  /** HTML 源码（单文件模式，向后兼容） */
  html?: string;
  /** 多文件项目（多文件模式） */
  files?: Record<string, FileNode> | undefined;
  /** 入口文件路径（多文件模式） */
  entryFile?: string;
  /** 文件名（单文件模式，用于导出） */
  fileName?: string;
}

/** 转义 HTML 实体 */
function escapeHtml(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** HTML 语法高亮 */
function highlightHtml(code: string): string {
  const escaped = escapeHtml(code);

  return escaped
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
}

/** CSS 语法高亮 */
function highlightCss(code: string): string {
  const escaped = escapeHtml(code);

  return escaped
    // CSS 注释
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-[#5c6370]">$1</span>')
    // 选择器
    .replace(/([.#]?[\w-]+)(\s*[,{])/g, '<span class="text-[#e06c75]">$1</span>$2')
    // 属性名
    .replace(/([\w-]+)(\s*:)/g, '<span class="text-[#d19a66]">$1</span>$2')
    // 属性值中的数字和单位
    .replace(/:\s*([\d.]+)(px|em|rem|%|vh|vw|deg|s|ms)/g, ': <span class="text-[#d19a66]">$1$2</span>')
    // 颜色值
    .replace(/(#[\da-fA-F]{3,8})/g, '<span class="text-[#98c379]">$1</span>')
    // 字符串
    .replace(/(".*?"|'.*?')/g, '<span class="text-[#98c379]">$1</span>');
}

/** JavaScript 语法高亮 */
function highlightJavaScript(code: string): string {
  const escaped = escapeHtml(code);

  return escaped
    // 单行注释
    .replace(/(\/\/.*$)/gm, '<span class="text-[#5c6370]">$1</span>')
    // 多行注释
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-[#5c6370]">$1</span>')
    // 字符串（双引号）
    .replace(/(".*?")/g, '<span class="text-[#98c379]">$1</span>')
    // 字符串（单引号）
    .replace(/('.*?')/g, '<span class="text-[#98c379]">$1</span>')
    // 模板字符串
    .replace(/(`[\s\S]*?`)/g, '<span class="text-[#98c379]">$1</span>')
    // 关键字
    .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false)\b/g, '<span class="text-[#c678dd]">$1</span>')
    // 数字
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="text-[#d19a66]">$1</span>')
    // 函数调用
    .replace(/\b([\w]+)(\()/g, '<span class="text-[#61afef]">$1</span>$2');
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

/** 根据 FileType 获取高亮函数 */
function getHighlighter(fileType: FileType): (code: string) => string {
  switch (fileType) {
    case 'html':
      return highlightHtml;
    case 'css':
      return highlightCss;
    case 'javascript':
    case 'typescript':
    case 'tsx':
      return highlightJavaScript;
    case 'json':
      return highlightJson;
    default:
      return escapeHtml;
  }
}

/** 从文件路径推断 FileType */
function inferFileType(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'json':
      return 'json';
    default:
      return 'text';
  }
}

/** 从 FileType 获取文件扩展名 */
function getFileExtension(fileType: FileType): string {
  switch (fileType) {
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'javascript':
      return 'js';
    case 'typescript':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'json':
      return 'json';
    default:
      return 'txt';
  }
}

/** 从 FileType 获取 MIME 类型 */
function getMimeType(fileType: FileType): string {
  switch (fileType) {
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'javascript':
      return 'text/javascript';
    case 'typescript':
    case 'tsx':
      return 'text/typescript';
    case 'json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}

export default function CodeViewer({
  isOpen,
  onClose,
  html,
  files,
  entryFile = '/index.html',
  fileName = 'index.html',
}: CodeViewerProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  // 判断是否为多文件模式
  const isMultiFile = useMemo(() => isMultiFileProject(files), [files]);

  // 构建文件树
  const fileTree = useMemo((): TreeNode[] => {
    if (!files) return [];
    return buildTree(files);
  }, [files]);

  // 初始化选中文件
  useEffect(() => {
    if (isOpen) {
      if (isMultiFile && files) {
        // 多文件模式：默认选中入口文件
        const entry = files[entryFile] ? entryFile : Object.keys(files)[0];
        setActiveFilePath(entry ?? null);
      } else {
        // 单文件模式：不激活任何文件树项
        setActiveFilePath(null);
      }
    }
  }, [isOpen, isMultiFile, files, entryFile]);

  // 当前文件内容
  const currentFile = useMemo(() => {
    if (isMultiFile && files && activeFilePath) {
      return files[activeFilePath] ?? null;
    }
    // 单文件模式：使用 html
    return html ? { path: '/index.html', content: html, language: 'html' as const, updatedAt: '' } : null;
  }, [isMultiFile, files, activeFilePath, html]);

  // 当前文件类型
  const currentFileType: FileType = useMemo(() => {
    if (currentFile) {
      const language = currentFile.language;
      if (language === 'html' || language === 'css' || language === 'javascript' || language === 'json') {
        const typeMap: Record<string, FileType> = {
          html: 'html',
          css: 'css',
          javascript: 'javascript',
          json: 'json',
        };
        return typeMap[language] ?? 'text';
      }
      return inferFileType(currentFile.path);
    }
    return 'html';
  }, [currentFile]);

  // 语法高亮后的代码
  const highlightedCode = useMemo(() => {
    if (!currentFile) return '';
    const highlighter = getHighlighter(currentFileType);
    return highlighter(currentFile.content);
  }, [currentFile, currentFileType]);

  // 行号
  const lines = currentFile?.content.split('\n') ?? [];
  const lineCount = lines.length;

  // 处理文件选择
  const handleFileSelect = useCallback((path: string) => {
    setActiveFilePath(path);
  }, []);

  // 处理目录展开/收起（当前未实现持久化，使用默认展开）
  const handleFolderToggle = useCallback((_path: string) => {
    // 目录节点默认展开，此回调预留用于未来实现持久化
  }, []);

  // 复制代码
  const handleCopy = useCallback(async () => {
    if (!currentFile) return;
    try {
      await navigator.clipboard.writeText(currentFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败
    }
  }, [currentFile]);

  // 导出文件
  const handleExport = useCallback(() => {
    if (!currentFile) return;
    const ext = getFileExtension(currentFileType);
    const name = currentFile.path.split('/').pop() ?? fileName;
    const blob = new Blob([currentFile.content], { type: getMimeType(currentFileType) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [currentFile, currentFileType, fileName]);

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

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div className="flex flex-col w-full max-w-5xl max-h-[80vh] bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-default)] shadow-2xl overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
          <div className="flex items-center gap-2">
            <Icon icon="lucide:code" width={18} height={18} className="text-[var(--color-text-secondary)]" />
            <span className="text-[14px] font-medium text-[var(--color-text-primary)]">查看代码</span>
            {currentFile && (
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                {currentFile.path.split('/').pop()}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-all duration-[140ms]"
            title="关闭"
          >
            <Icon icon="lucide:x" width={16} height={16} />
          </button>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 文件树（多文件模式显示） */}
          {isMultiFile && fileTree.length > 0 && (
            <div className="w-48 shrink-0 border-r border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
              <FileTreePanel
                tree={fileTree}
                activeFilePath={activeFilePath}
                onFileSelect={handleFileSelect}
                onFolderToggle={handleFolderToggle}
              />
            </div>
          )}

          {/* 代码区域 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 文件信息栏 */}
            {currentFile && (
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--color-text-tertiary)]">
                    {currentFile.path}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-[var(--color-text-tertiary)]">
                  <span>{(currentFile.content.length / 1024).toFixed(1)} KB</span>
                  <span>{lineCount} 行</span>
                </div>
              </div>
            )}

            {/* 代码内容 */}
            <div className="flex-1 overflow-auto">
              {currentFile ? (
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
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-[var(--color-text-tertiary)]">
                    <Icon icon="lucide:file-code" width={48} height={48} className="mx-auto mb-4 opacity-50" />
                    <p className="text-[14px]">选择文件查看代码</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
          <button
            onClick={handleCopy}
            disabled={!currentFile}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] hover:bg-[var(--color-bg-inset)] transition-all duration-[140ms] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} width={14} height={14} />
            {copied ? '已复制' : '复制代码'}
          </button>
          <button
            onClick={handleExport}
            disabled={!currentFile}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] transition-all duration-[140ms] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon icon="lucide:download" width={14} height={14} />
            导出文件
          </button>
        </div>
      </div>
    </div>
  );
}