/**
 * SandboxFrame 组件：iframe 沙箱预览。
 * 使用 srcdoc + sandbox 属性隔离执行生成的应用代码。
 * 支持单文件和多文件项目：多文件项目通过 assembler 组装为单文件后预览。
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Icon } from '@iconify/react';
import {
  buildSandboxAttribute,
  buildPreviewCsp,
  parseSandboxMessage,
  DEFAULT_CDN_HOSTS,
} from '../types/sandbox';
import type { SandboxAllowFlag, FileNode } from '../types/project';
import { useSettingsStore, type DeviceMode, DEVICE_VIEWPORTS } from '../stores/settingsStore';
import { assembleFiles } from '../services/sandbox/assembler';
import CodeViewer from './CodeViewer';

interface SandboxFrameProps {
  /** 生成的 HTML 代码（单文件模式，向后兼容） */
  html?: string;
  /** 多文件项目（多文件模式） */
  files?: Record<string, FileNode> | undefined;
  /** 入口文件路径（多文件模式），默认 /index.html */
  entryFile?: string;
  /** 额外的 sandbox 标志 */
  extraSandboxFlags?: readonly SandboxAllowFlag[];
  /** 自定义 CDN 主机白名单 */
  cdnHosts?: readonly string[];
  /** 沙箱就绪回调 */
  onReady?: () => void;
  /** 沙箱错误回调 */
  onError?: (error: { message: string; source: string; lineno: number; colno: number }) => void;
  /** 控制台日志回调 */
  onLog?: (log: { level: 'log' | 'info' | 'warn' | 'error'; text: string }) => void;
}

/** 生成唯一会话 ID */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 组装完整的预览 HTML，注入 CSP 和消息桥接脚本 */
function assemblePreviewHtml(
  userHtml: string,
  sessionId: string,
  cdnHosts: readonly string[]
): string {
  const csp = buildPreviewCsp(cdnHosts);

  // 注入消息桥接脚本（监听错误、日志、resize）
  const bridgeScript = `
<script>
(function() {
  const sessionId = "${sessionId}";
  const protocol = 1;
  let seq = 0;

  function send(type, payload) {
    window.parent.postMessage({ protocol, from: "guest", sessionId, seq: seq++, type, payload }, "*");
  }

  // ready 消息
  window.addEventListener("DOMContentLoaded", function() {
    send("ready", { documentHeight: document.documentElement.scrollHeight });
  });

  // 错误监听
  window.addEventListener("error", function(e) {
    send("error", {
      level: "error",
      message: e.message,
      source: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack
    });
  });

  // 未处理的 Promise 拒绝
  window.addEventListener("unhandledrejection", function(e) {
    send("error", {
      level: "unhandledrejection",
      message: String(e.reason),
      source: "unhandledrejection",
      lineno: 0,
      colno: 0
    });
  });

  // console 桥接
  ["log", "info", "warn", "error"].forEach(function(level) {
    const original = console[level];
    console[level] = function() {
      send("log", { level, text: Array.from(arguments).map(String).join(" ") });
      original.apply(console, arguments);
    };
  });
})();
</script>`;

  // 在 <head> 中注入 CSP meta 标签
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  if (userHtml.includes('<head>')) {
    return userHtml.replace('<head>', `<head>${cspMeta}${bridgeScript}`);
  } else if (userHtml.includes('<html>')) {
    return userHtml.replace('<html>', `<html><head>${cspMeta}${bridgeScript}</head>`);
  } else {
    // 最小化 HTML 包装
    return `<!DOCTYPE html><html><head>${cspMeta}${bridgeScript}</head><body>${userHtml}</body></html>`;
  }
}

/** 判断是否为多文件项目 */
function isMultiFile(files: Record<string, FileNode> | undefined): boolean {
  if (!files) return false;
  const paths = Object.keys(files);
  if (paths.length > 1) return true;
  if (paths.length === 1 && paths[0] !== '/index.html') return true;
  return false;
}

/** 获取最终的预览 HTML */
function getPreviewHtml(
  html: string | undefined,
  files: Record<string, FileNode> | undefined,
  entryFile: string
): string {
  // 多文件模式：调用 assembler 组装
  if (files && isMultiFile(files)) {
    const result = assembleFiles(files, entryFile);

    // 记录组装警告
    if (result.warnings.length > 0) {
      console.warn('[SandboxFrame] 组装警告:', result.warnings);
    }

    return result.html;
  }

  // 单文件模式：直接使用 html 或 files 中的入口文件
  if (html) {
    return html;
  }

  if (files) {
    const entry = files[entryFile] ?? files['/index.html'];
    return entry?.content ?? '';
  }

  return '';
}

export default function SandboxFrame({
  html,
  files,
  entryFile = '/index.html',
  extraSandboxFlags = [],
  cdnHosts = DEFAULT_CDN_HOSTS,
  onReady,
  onError,
  onLog,
}: SandboxFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [sessionId, setSessionId] = useState(generateSessionId);
  const [isLoading, setIsLoading] = useState(true);
  const [isCodeViewerOpen, setIsCodeViewerOpen] = useState(false);
  const { deviceMode, isFullscreen, toggleFullscreen, setDeviceMode } = useSettingsStore();

  // 组装沙箱属性
  const sandboxAttr = useMemo(() => buildSandboxAttribute(extraSandboxFlags), [extraSandboxFlags]);

  // 获取最终预览 HTML（支持多文件）
  const previewSourceHtml = useMemo(
    () => getPreviewHtml(html, files, entryFile),
    [html, files, entryFile]
  );

  // 组装预览 HTML（注入 CSP 和桥接脚本）
  const previewHtml = useMemo(
    () => assemblePreviewHtml(previewSourceHtml, sessionId, cdnHosts),
    [previewSourceHtml, sessionId, cdnHosts]
  );

  // 监听来自沙箱的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = parseSandboxMessage(event.data, sessionId, 'guestToHost');
      if (!message) return;

      switch (message.type) {
        case 'ready':
          setIsLoading(false);
          onReady?.();
          break;
        case 'error':
          onError?.({
            message: message.payload.message,
            source: message.payload.source,
            lineno: message.payload.lineno,
            colno: message.payload.colno,
          });
          break;
        case 'log':
          onLog?.(message.payload);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId, onReady, onError, onLog]);

  // 刷新预览
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setSessionId(generateSessionId());
  }, []);

  // 设备模式切换
  const handleDeviceSwitch = useCallback(
    (mode: DeviceMode) => {
      setDeviceMode(mode);
    },
    [setDeviceMode]
  );

  // 视口尺寸
  const viewport = DEVICE_VIEWPORTS[deviceMode];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="h-12 flex items-center justify-between px-3 sm:px-4 border-b border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="hidden sm:flex items-center gap-1">
          {/* 设备切换按钮（小屏隐藏，避免窄屏工具栏拥挤） */}
          {(['desktop', 'tablet', 'mobile'] as DeviceMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleDeviceSwitch(mode)}
              className={`flex items-center justify-center w-8 h-8 rounded-[10px] transition-all duration-[140ms] ${
                deviceMode === mode
                  ? 'text-[var(--color-accent)] bg-[var(--color-bg-elevated)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]'
              }`}
              title={mode === 'desktop' ? '桌面' : mode === 'tablet' ? '平板' : '手机'}
            >
              <Icon
                icon={mode === 'desktop' ? 'lucide:monitor' : mode === 'tablet' ? 'lucide:tablet' : 'lucide:smartphone'}
                width={16}
                height={16}
              />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {/* 查看代码按钮 */}
          <button
            onClick={() => setIsCodeViewerOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="查看代码"
          >
            <Icon icon="lucide:code" width={16} height={16} />
          </button>

          {/* 刷新按钮 */}
          <button
            onClick={handleRefresh}
            className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title="刷新预览"
          >
            <Icon icon="lucide:refresh-cw" width={16} height={16} />
          </button>

          {/* 全屏按钮 */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center w-8 h-8 rounded-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            <Icon icon={isFullscreen ? 'lucide:minimize-2' : 'lucide:maximize-2'} width={16} height={16} />
          </button>
        </div>
      </div>

      {/* 预览区域 */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden bg-[var(--color-bg-inset)]">
        <div
          className="relative bg-white rounded-lg shadow-lg overflow-hidden transition-all duration-300"
          style={{
            width: isFullscreen ? '100%' : viewport.width,
            height: isFullscreen ? '100%' : viewport.height,
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-surface)]">
              <div className="flex flex-col items-center gap-2">
                <Icon icon="lucide:refresh-cw" width={20} height={20} className="animate-spin text-[var(--color-text-secondary)]" />
                <span className="text-[14px] text-[var(--color-text-secondary)]">加载中...</span>
              </div>
            </div>
          )}

          <iframe
            ref={iframeRef}
            srcDoc={previewHtml}
            sandbox={sandboxAttr}
            className="w-full h-full border-0"
            title="预览"
          />
        </div>
      </div>

      {/* 代码查看面板 */}
      <CodeViewer
        isOpen={isCodeViewerOpen}
        onClose={() => setIsCodeViewerOpen(false)}
        html={previewSourceHtml}
        files={files}
        entryFile={entryFile}
        fileName="index.html"
      />
    </div>
  );
}