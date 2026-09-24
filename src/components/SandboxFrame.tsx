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
import type { SandboxAllowFlag, FileNode, ProjectFramework } from '../types/project';
import { useSettingsStore, type DeviceMode, DEVICE_VIEWPORTS } from '../stores/settingsStore';
import { assembleFiles, assembleProjectFiles, injectReactRuntime, injectVueRuntime } from '../services/sandbox/assembler';
import CodeViewer from './CodeViewer';

/**
 * 打包链路防抖窗口（P1 批次 2）。
 * 流式生成期间输入连续变化：窗口内保持同步产物（现状链路，行为与激活前一致），
 * 输入稳定后才升级为 mini-bundler 打包产物，避免每次流式 tick 双重 iframe 重载。
 */
const ASSEMBLY_DEBOUNCE_MS = 250;

interface SandboxFrameProps {
  /** 生成的 HTML 代码（单文件模式，向后兼容） */
  html?: string;
  /** 多文件项目（多文件模式） */
  files?: Record<string, FileNode> | undefined;
  /** 入口文件路径（多文件模式），默认 /index.html */
  entryFile?: string;
  /** 项目目标框架，默认 html；react-cdn 时注入 React/Sucrase 运行时 */
  framework?: ProjectFramework;
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
  cdnHosts: readonly string[],
  evalAllowed: boolean = false,
  selfOrigin?: string
): string {
  const csp = buildPreviewCsp(cdnHosts, evalAllowed, selfOrigin);

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

/**
 * 打包链路（P1 批次 2）仅作用于 react-cdn 多文件项目；
 * 其余组合的同步产物即最终产物，无需异步升级。
 */
function needsModuleAssembly(files: Record<string, FileNode> | undefined, framework: ProjectFramework): boolean {
  return framework === 'react-cdn' && isMultiFile(files);
}

/** 获取最终的预览 HTML */
function getPreviewHtml(
  html: string | undefined,
  files: Record<string, FileNode> | undefined,
  entryFile: string,
  framework: ProjectFramework
): string {
  // 多文件模式：调用 assembler 组装（React/Vue CDN 模式在组装器内注入运行时）
  if (files && isMultiFile(files)) {
    const result = assembleFiles(files, entryFile, framework);

    // 记录组装警告
    if (result.warnings.length > 0) {
      console.warn('[SandboxFrame] 组装警告:', result.warnings);
    }

    return result.html;
  }

  // 单文件模式：优先 html prop，其次 files 中的入口文件
  let source = '';
  if (html) {
    source = html;
  } else if (files) {
    const entry = files[entryFile] ?? files['/index.html'];
    source = entry?.content ?? '';
  }

  // React CDN 模式：注入 React/Sucrase 运行时并包装内联 JSX
  if (framework === 'react-cdn' && source) {
    return injectReactRuntime(source);
  }

  // Vue CDN 模式：注入 Vue/SFC 编译器运行时并包装内联 Vue 代码
  if (framework === 'vue-cdn' && source) {
    return injectVueRuntime(source);
  }

  return source;
}

export default function SandboxFrame({
  html,
  files,
  entryFile = '/index.html',
  framework = 'html',
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

  // 同步组装产物（现状逐文件链路）：用于首帧渲染与打包链路就绪前的回退，永不空白
  const syncAssembledHtml = useMemo(
    () => getPreviewHtml(html, files, entryFile, framework),
    [html, files, entryFile, framework]
  );

  // 打包链路产物（P1 批次 2 激活）：null 表示当前以同步产物为准
  const [bundledHtml, setBundledHtml] = useState<string | null>(null);

  // 组装输入快照（引用身份）：四项输入任一变化即视为新请求
  const assemblyInputs = useMemo(
    () => ({ html, files, entryFile, framework }),
    [html, files, entryFile, framework]
  );

  // 渲染期状态调整（React 认可的派生状态重置模式）：输入变化时在同一渲染帧
  // 丢弃上一轮异步产物，立即回退同步产物，杜绝跨项目/跨版本的 stale 闪现
  const [lastAssemblyInputs, setLastAssemblyInputs] = useState(assemblyInputs);
  if (lastAssemblyInputs !== assemblyInputs) {
    setLastAssemblyInputs(assemblyInputs);
    setBundledHtml(null);
  }

  // 异步升级：react-cdn 多文件项目经 mini-bundler 打包为单一脚本。
  // 竞态约束：只采纳最后一次请求的产物。三层防护：
  // 1. 渲染期重置（上）保证输入变化后任何时刻 DOM 都不显示旧产物；
  // 2. effect cleanup 的 cancelled 标志丢弃上一次请求的迟到结果；
  // 3. 防抖窗口内输入持续变化则打包请求不发出（流式期间的现状行为不变）
  useEffect(() => {
    if (!needsModuleAssembly(files, framework) || !files) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      assembleProjectFiles(files, entryFile, framework)
        .then((result) => {
          if (!cancelled) {
            setBundledHtml(result.html);
          }
        })
        .catch(() => {
          // 组装失败：落到现状链路重试一次（getPreviewHtml 即现状链路）；
          // 重试再失败则保持当前显示，不出现白屏
          try {
            const fallbackHtml = getPreviewHtml(html, files, entryFile, framework);
            if (!cancelled) setBundledHtml(fallbackHtml);
          } catch (retryError) {
            console.error('[SandboxFrame] 预览组装失败，保持最近一次可用产物:', retryError);
          }
        });
    }, ASSEMBLY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assemblyInputs, html, files, entryFile, framework]);

  // 最终预览源：打包产物就绪且对应最新输入时优先，否则同步产物。
  // 无 import 的存量项目升级结果与同步产物逐字符串相等，
  // previewHtml 的 useMemo 依赖 Object.is 短路，srcdoc 不变，iframe 不重载
  const previewSourceHtml = bundledHtml ?? syncAssembledHtml;

  // 组装预览 HTML（注入 CSP 和桥接脚本）
  // React/Vue CDN 模式：开放 unsafe-eval（编译器产物经 new Function 执行）
  // selfOrigin 放行同源 /vendor/ 本地运行时（React/ReactDOM/Sucrase 已零外网依赖）
  const previewHtml = useMemo(() => {
    const needsEval = framework === 'react-cdn' || framework === 'vue-cdn';
    return assemblePreviewHtml(previewSourceHtml, sessionId, cdnHosts, needsEval, window.location.origin);
  }, [previewSourceHtml, sessionId, cdnHosts, framework]);

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

  // 监听 previewHtml 变化，重置 loading 状态
  // 确保每次 iframe 重新加载时都显示 loading overlay
  useEffect(() => {
    setIsLoading(true);
  }, [previewHtml]);

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