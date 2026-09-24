/**
 * JSX/TSX 浏览器内编译器。
 * 使用 Sucrase 在浏览器内将 JSX 编译为 JavaScript。
 *
 * 设计原则：
 * - Sucrase 与 React 均从同源 /vendor/ 本地运行时加载（零外网依赖）。
 *   背景：部署环境外网不可达，jsdelivr / esm.sh 引用曾导致 iframe
 *   每次重挂载超时 90-134 秒（M1 验证结论）。产物由
 *   scripts/build-vendor-runtime.mjs 从 node_modules 生成，见 public/vendor/MANIFEST.md
 * - 编译执行使用 new Function，沙箱 CSP 需开放 unsafe-eval（见 buildPreviewCsp）
 * - 编译/运行错误统一通过 window error 事件传播，走 SandboxFrame 标准错误桥接
 */

/**
 * React 平台运行时脚本（同源 vendor 路径）。
 * srcdoc 文档以宿主页面为 base URL，根绝对路径 /vendor/... 解析到宿主同源，
 * 由 buildPreviewCsp 的 selfOrigin 源表达式放行。
 * 文件挂载 window.React / window.ReactDOM（含 createRoot），与 18 UMD 全局形态兼容。
 */
export const REACT_VENDOR_RUNTIME_SCRIPT: string = '/vendor/react.vendor.js';

/**
 * Sucrase 编译器脚本（同源 vendor 路径，IIFE 构建，挂 globalThis.Sucrase）。
 * 实测结论（headless Chrome 端到端，历史）：
 * - sucrase 3.x 各版本均无 UMD 单文件（dist/sucrase.min.js 为 404）
 * - jsdelivr +esm 端点的 CJS 互操作有 bug（sourcemap-codec 缺失 named export encode），不可用
 * - 曾选用 esm.sh ESM 构建；因外网不可达改为本地 esbuild IIFE 打包
 */
export const SUCRASE_VENDOR_SCRIPT: string = '/vendor/sucrase.vendor.js';

/** React CDN 模式约定的挂载点 id */
export const REACT_ROOT_ID = 'root';

/**
 * 检测代码是否包含 JSX 语法
 * 启发式两条线：
 * 1. 大写开头的组件标签（<Counter>、</Item>）
 * 2. 小写标签的典型 JSX 形态（箭头函数返回标签、return 后直接跟标签）
 * 误报无害：纯 JS 交给 Sucrase 做 jsx transform 是语义不变的 no-op；
 * 漏报有害：裸 JSX 留在普通 script 里是语法错误。
 */
export function containsJsx(code: string): boolean {
  if (/<\/?\s*[A-Z][a-zA-Z0-9]*/.test(code)) return true;
  if (/=>\s*\(?\s*</.test(code)) return true;
  if (/return\s*\(?\s*</.test(code)) return true;
  return false;
}

/**
 * 生成 React + ReactDOM 本地运行时注入脚本
 * vendor 脚本挂载全局 window.React / window.ReactDOM，供编译后的代码引用；
 * 此处附挂载确认守卫：vendor 脚本缺失（部署产物不完整等）时给出明确错误而非静默白屏
 */
export function generateReactCdnRuntime(): string {
  return `<script src="${REACT_VENDOR_RUNTIME_SCRIPT}"></script>
<script>
  if (!window.React || !window.ReactDOM) {
    setTimeout(function() { throw new Error('React 运行时加载失败（${REACT_VENDOR_RUNTIME_SCRIPT}），请刷新重试'); }, 0);
  }
</script>`;
}

/**
 * 生成 Sucrase 编译器注入与执行辅助脚本
 *
 * 加载模型：Sucrase vendor 为经典 script 同步加载（IIFE，挂 globalThis.Sucrase），
 * 本注入脚本按 script 顺序在其后执行，就绪后立即处理编译队列。
 *
 * __compileAndRun(code, fileName)：
 * 1. Sucrase 将 JSX 编译为 React.createElement 调用（classic runtime，无需 import React）
 * 2. new Function 执行编译产物，注入 React / ReactDOM 全局
 * 3. 任何编译或运行错误异步重抛，由 window error 监听器捕获后经 postMessage 上报宿主
 */
export function generateSucraseRuntime(): string {
  return `<script src="${SUCRASE_VENDOR_SCRIPT}"></script>
<script>
(function() {
  function reportAndRethrow(err) {
    // 标记来源便于宿主区分编译错误与普通运行错误
    if (err instanceof Error && err.message.indexOf('[JSX]') !== 0) {
      err.message = '[JSX] ' + err.message;
    }
    // 异步抛出：走 window error 事件，由桥接脚本以标准协议上报
    setTimeout(function() { throw err; }, 0);
  }

  // 编译任务队列：保留历史形态（编译请求先入队，运行时按入队顺序 flush）
  window.__jsxQueue = window.__jsxQueue || [];

  window.__compileAndRun = function(code, fileName) {
    if (!window.__sucraseReady) {
      window.__jsxQueue.push([code, fileName]);
      return;
    }
    var compiled;
    try {
      compiled = window.__sucraseTransform(code, {
        transforms: ['jsx'],
        jsxRuntime: 'classic',
        jsxPragma: 'React.createElement',
        jsxFragmentPragma: 'React.Fragment',
        production: true
      });
    } catch (err) {
      reportAndRethrow(err);
      return;
    }
    try {
      if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        reportAndRethrow(new Error('React 运行时加载失败，请刷新重试'));
        return;
      }
      var fn = new Function('React', 'ReactDOM', compiled.code);
      return fn(window.React, window.ReactDOM);
    } catch (err) {
      reportAndRethrow(err);
    }
  };

  // vendor script（经典 script）按顺序先于本脚本执行完成；
  // 未就绪即产物缺失（部署不完整、路径被改），立即报错而非静默白屏
  window.__sucraseTransform = window.Sucrase && window.Sucrase.transform;
  window.__sucraseReady = typeof window.__sucraseTransform === 'function';
  if (!window.__sucraseReady) {
    reportAndRethrow(new Error('Sucrase 编译器加载失败（${SUCRASE_VENDOR_SCRIPT}），请刷新重试'));
    return;
  }
  // 就绪：按序 flush 编译队列
  var queue = window.__jsxQueue || [];
  window.__jsxQueue = [];
  for (var i = 0; i < queue.length; i++) {
    window.__compileAndRun(queue[i][0], queue[i][1]);
  }
})();
</script>`;
}

/**
 * 包装 JSX/JS 代码为浏览器内编译执行的脚本块
 * @param code 源码（含 JSX）
 * @param fileName 文件名，仅用于错误定位
 */
export function wrapJsxScript(code: string, fileName?: string): string {
  return `<script>
__compileAndRun(${JSON.stringify(code)}, ${JSON.stringify(fileName || 'inline-jsx')});
</script>`;
}

/**
 * 生成 React 应用挂载点与启动等待逻辑
 * 等待 React / Sucrase 就绪后再执行后续用户脚本（通过脚本顺序保证时序）
 */
export function generateReactAppBootstrap(): string {
  return `<div id="${REACT_ROOT_ID}"></div>`;
}

/**
 * 生成 React CDN 模式的代码示例（供工程师 Agent 提示词与文档引用）
 */
export function generateReactCdnCodeExample(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>React CDN 应用</title>
</head>
<body>
  <!-- 挂载点：id 固定为 root -->
  <div id="root"></div>

  <script>
    // CDN 模式约定：
    // 1. 直接使用 JSX 语法，无需 import React
    // 2. 全局 React / ReactDOM 由平台本地运行时（/vendor/react.vendor.js）注入
    // 3. 使用 ReactDOM.createRoot() 挂载

    function App() {
      var [count, setCount] = React.useState(0);
      return (
        <div className="app">
          <h1>计数器</h1>
          <button onClick={() => setCount(count + 1)}>点击 {count} 次</button>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;
}