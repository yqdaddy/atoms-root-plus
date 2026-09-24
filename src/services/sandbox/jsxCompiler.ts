/**
 * JSX/TSX 浏览器内编译器。
 * 使用 Sucrase 在浏览器内将 JSX 编译为 JavaScript。
 *
 * 设计原则：
 * - Sucrase 与 React 均从 CDN（cdn.jsdelivr.net）加载，主应用零依赖
 * - 编译执行使用 new Function，沙箱 CSP 需开放 unsafe-eval（见 buildPreviewCsp）
 * - 编译/运行错误统一通过 window error 事件传播，走 SandboxFrame 标准错误桥接
 */

/** React UMD CDN 脚本地址（React 18，jsdelivr） */
export const REACT_CDN_SCRIPTS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js',
];

/** React CDN 模式额外需要的 ESM CDN 主机（需并入沙箱 CSP script-src 白名单） */
export const ESM_CDN_HOST: string = 'esm.sh';

/**
 * Sucrase CDN 地址（esm.sh ESM 构建）。
 * 实测结论（headless Chrome 端到端）：
 * - sucrase 3.x 各版本均无 UMD 单文件（dist/sucrase.min.js 为 404）
 * - jsdelivr +esm 端点的 CJS 互操作有 bug（sourcemap-codec 缺失 named export encode），不可用
 * - esm.sh 的产物依赖解析正确，渲染链路全通，故选用
 * 入口为完整 URL，其内部依赖按模块自身 URL 解析，opaque origin 的 srcdoc 下同样成立。
 */
export const SUCRASE_CDN_SCRIPT: string = 'https://esm.sh/sucrase@3.35.1';

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
 * 生成 React + ReactDOM CDN 注入脚本
 * UMD 全局暴露 React / ReactDOM，供编译后的代码引用
 */
export function generateReactCdnRuntime(): string {
  const scripts = REACT_CDN_SCRIPTS.map((src) => `<script crossorigin src="${src}"></script>`).join('\n');
  return `${scripts}
<script>
  window.React = window.React || React;
  window.ReactDOM = window.ReactDOM || ReactDOM;
</script>`;
}

/**
 * 生成 Sucrase 编译器注入与执行辅助脚本
 *
 * 加载模型：Sucrase 经 module script（+esm 端点）异步加载；
 * 用户脚本同步执行时调用 __compileAndRun 只会入队，
 * 模块就绪后按入队顺序 flush 编译执行。
 *
 * __compileAndRun(code, fileName)：
 * 1. Sucrase 将 JSX 编译为 React.createElement 调用（classic runtime，无需 import React）
 * 2. new Function 执行编译产物，注入 React / ReactDOM 全局
 * 3. 任何编译或运行错误异步重抛，由 window error 监听器捕获后经 postMessage 上报宿主
 */
export function generateSucraseRuntime(): string {
  return `<script>
(function() {
  function reportAndRethrow(err) {
    // 标记来源便于宿主区分编译错误与普通运行错误
    if (err instanceof Error && err.message.indexOf('[JSX]') !== 0) {
      err.message = '[JSX] ' + err.message;
    }
    // 异步抛出：走 window error 事件，由桥接脚本以标准协议上报
    setTimeout(function() { throw err; }, 0);
  }

  // 编译任务队列：module script 异步加载期间，用户同步脚本的编译请求先入队
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
        reportAndRethrow(new Error('React 运行时加载失败，请检查网络后刷新重试'));
        return;
      }
      var fn = new Function('React', 'ReactDOM', compiled.code);
      return fn(window.React, window.ReactDOM);
    } catch (err) {
      reportAndRethrow(err);
    }
  };

  // 超时兜底：Sucrase 加载失败（网络异常等）时给用户明确报错而非静默白屏
  setTimeout(function() {
    if (!window.__sucraseReady) {
      reportAndRethrow(new Error('Sucrase 编译器加载超时，请检查网络后刷新重试'));
    }
  }, 15000);
})();
</script>
<script type="module">
  import { transform as __sucraseTransform } from '${SUCRASE_CDN_SCRIPT}';
  window.__sucraseTransform = __sucraseTransform;
  window.__sucraseReady = true;
  // 模块就绪：按序 flush 编译队列
  var queue = window.__jsxQueue || [];
  window.__jsxQueue = [];
  for (var i = 0; i < queue.length; i++) {
    window.__compileAndRun(queue[i][0], queue[i][1]);
  }
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
    // 2. 全局 React / ReactDOM 由 CDN 注入
    // 3. 使用 ReactDOM.createRoot() 挂载（React 18 API）

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