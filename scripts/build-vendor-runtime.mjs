#!/usr/bin/env node
/**
 * 构建 react-cdn 平台运行时的本地 vendor 产物（零外网依赖）。
 *
 * 背景：生成应用此前从 jsdelivr / esm.sh 加载 React 18 UMD 与 Sucrase，
 * 部署环境外网不可达导致 iframe 每次重挂载超时 90-134 秒（M1 验证结论）。
 * 本脚本从 node_modules 内既有产物生成 public/vendor/ 下的本地运行时：
 *
 * 1. public/vendor/react.vendor.js
 *    - 来源（仅本地拷贝，逐字节保留 CJS 源码，外层为手写 CommonJS 微加载器）：
 *      react@{V}/cjs/react.production.js            -> 模块 'react'
 *      scheduler@{S}/cjs/scheduler.production.js    -> 模块 'scheduler'
 *      react-dom@{V}/cjs/react-dom.production.js    -> 模块 'react-dom'
 *      react-dom@{V}/cjs/react-dom-client.production.js -> 模块 'react-dom/client'
 *    - 挂载 window.React 与 window.ReactDOM（含 createRoot / hydrateRoot），
 *      与 react 18 UMD 的全局形态兼容，shim 表与生成约定无需变化。
 *    - 说明：本机 node_modules 为 react 19（React 19 起不再发布 UMD 构建），
 *      故以官方 CJS 构建 + 微加载器等效替代 UMD。
 *
 * 2. public/vendor/sucrase.vendor.js
 *    - esbuild 将本地 sucrase 包打包为 IIFE，挂 globalThis.Sucrase
 *      （替代 jsxCompiler 此前的 esm.sh ESM 引入）。
 *
 * 3. public/vendor/MANIFEST.md（来源与体积清单，随构建重新生成）
 *
 * 用法：node scripts/build-vendor-runtime.mjs
 * 产物提交入库，仅当依赖版本变化时需要重跑。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'vendor');

function pkgVersion(name) {
  return JSON.parse(readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
}

const REACT_VERSION = pkgVersion('react');
const REACT_DOM_VERSION = pkgVersion('react-dom');
const SCHEDULER_VERSION = pkgVersion('scheduler');
const SUCRASE_VERSION = pkgVersion('sucrase');

/** 读取 node_modules 内 CJS 源码（逐字节拷贝，不修改源码内容） */
function readCjs(pkgPath) {
  return readFileSync(path.join(ROOT, 'node_modules', pkgPath), 'utf8');
}

/* ---------------- 1. react.vendor.js ---------------- */

const REACT_MODULES = [
  { id: 'react', source: `react/cjs/react.production.js`, pkg: `react@${REACT_VERSION}` },
  { id: 'scheduler', source: `scheduler/cjs/scheduler.production.js`, pkg: `scheduler@${SCHEDULER_VERSION}` },
  { id: 'react-dom', source: `react-dom/cjs/react-dom.production.js`, pkg: `react-dom@${REACT_DOM_VERSION}` },
  { id: 'react-dom/client', source: `react-dom/cjs/react-dom-client.production.js`, pkg: `react-dom@${REACT_DOM_VERSION}` },
];

function buildReactVendor() {
  const factories = REACT_MODULES.map((m) => {
    const body = readCjs(m.source);
    return `__defineModule(${JSON.stringify(m.id)}, function (module, exports, require) {
${body}
});`;
  }).join('\n\n');

  return `/**
 * react-cdn 平台运行时（本地 vendor 构建，零外网依赖）。
 *
 * 来源（node_modules 逐字节拷贝 + 手写 CommonJS 微加载器，生成脚本
 * scripts/build-vendor-runtime.mjs，重跑即可复现）：
${REACT_MODULES.map((m) => ` * - ${m.pkg} ${m.source}`).join('\n')}
 *
 * 全局形态与 react 18 UMD 兼容：window.React、window.ReactDOM
 * （createRoot / hydrateRoot 取自 react-dom/client 官方构建）。
 * 仅限在 iframe 沙箱内由平台运行时注入使用。
 */
(function () {
  'use strict';
  var __registry = Object.create(null);
  function __require(id) {
    if (!(id in __registry)) {
      throw new Error('[vendor-react] 未注册的模块: ' + id);
    }
    return __registry[id];
  }
  function __defineModule(id, factory) {
    var module = { exports: {} };
    factory.call(void 0, module, module.exports, __require);
    __registry[id] = module.exports;
  }
  // 防御性 process 形态：React 构建内仅在环境探测分支引用（typeof process）
  var process = { env: { NODE_ENV: 'production' } };

${factories}

  window.React = __registry['react'];
  var ReactDOM = __registry['react-dom'];
  var ReactDOMClient = __registry['react-dom/client'];
  var globalReactDOM = Object.assign({}, ReactDOM, ReactDOMClient);
  globalReactDOM.version = ReactDOMClient.version || ReactDOM.version;
  window.ReactDOM = globalReactDOM;
})();
`;
}

/* ---------------- 2. sucrase.vendor.js ---------------- */

function buildSucraseVendor() {
  const entryPath = path.join(ROOT, 'scripts', 'vendor', 'sucrase-global-entry.cjs');
  const outfile = path.join(OUT_DIR, 'sucrase.vendor.js');
  execFileSync(
    path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
    [
      entryPath,
      '--bundle',
      '--minify',
      '--format=iife',
      `--define:process.env.NODE_ENV="production"`,
      `--outfile=${outfile}`,
      '--log-level=warning',
    ],
    { stdio: 'inherit' },
  );
  return readFileSync(outfile, 'utf8');
}

/* ---------------- 3. MANIFEST.md ---------------- */

function buildManifest(sizes) {
  return `# public/vendor 运行时清单

react-cdn 模式生成应用的本地运行时（零外网依赖）。产物由
\`node scripts/build-vendor-runtime.mjs\` 从仓库内 node_modules 生成，
**严禁从外网下载任何文件**。仅当相关依赖版本变化时需要重跑并提交。

| 产物 | 来源包@版本 | 包内路径 | 生成方式 | 体积 |
|---|---|---|---|---|
| react.vendor.js | react@${REACT_VERSION} | react/cjs/react.production.js | CJS 逐字节拷贝 + 微加载器（本脚本） | ${sizes.react} |
| react.vendor.js | scheduler@${SCHEDULER_VERSION} | scheduler/cjs/scheduler.production.js | 同上（模块 scheduler） | - |
| react.vendor.js | react-dom@${REACT_DOM_VERSION} | react-dom/cjs/react-dom.production.js | 同上（模块 react-dom） | - |
| react.vendor.js | react-dom@${REACT_DOM_VERSION} | react-dom/cjs/react-dom-client.production.js | 同上（模块 react-dom/client，提供 createRoot） | - |
| sucrase.vendor.js | sucrase@${SUCRASE_VERSION} | sucrase/dist/index.js | esbuild IIFE 打包（入口 scripts/vendor/sucrase-global-entry.cjs） | ${sizes.sucrase} |

## 引用方

- \`src/services/sandbox/jsxCompiler.ts\`：REACT_VENDOR_RUNTIME_SCRIPT / SUCRASE_VENDOR_SCRIPT
- \`server/prompts-v2.ts\`：react-cdn 模板对生成应用的运行时说明

## 未 vendor 化的依赖（本机无产物，严禁外网下载）

- chart.js / echarts：node_modules 未安装，生成应用的图表 script 仍指向
  cdn.jsdelivr.net（提示词要求 defer，离线时页面可渲染、仅图表区空）
- vue@3 / @vue/compiler-sfc：node_modules 未安装，vue-cdn 平台运行时仍走 jsdelivr
- Tailwind Play CDN：tailwindcss@4 npm 包不含 Play CDN 脚本，生成指引已切换为手写 CSS
`;
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

/* ---------------- main ---------------- */

mkdirSync(OUT_DIR, { recursive: true });

const reactVendor = buildReactVendor();
writeFileSync(path.join(OUT_DIR, 'react.vendor.js'), reactVendor);

const sucraseVendor = buildSucraseVendor();

const manifest = buildManifest({
  react: humanSize(statSync(path.join(OUT_DIR, 'react.vendor.js')).size),
  sucrase: humanSize(statSync(path.join(OUT_DIR, 'sucrase.vendor.js')).size),
});
writeFileSync(path.join(OUT_DIR, 'MANIFEST.md'), manifest);

console.log('[vendor] react.vendor.js:', humanSize(reactVendor.length));
console.log('[vendor] sucrase.vendor.js:', humanSize(sucraseVendor.length));
console.log('[vendor] MANIFEST.md 已生成');
