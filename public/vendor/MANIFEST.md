# public/vendor 运行时清单

react-cdn 模式生成应用的本地运行时（零外网依赖）。产物由
`node scripts/build-vendor-runtime.mjs` 从仓库内 node_modules 生成，
**严禁从外网下载任何文件**。仅当相关依赖版本变化时需要重跑并提交。

| 产物 | 来源包@版本 | 包内路径 | 生成方式 | 体积 |
|---|---|---|---|---|
| react.vendor.js | react@19.3.0 | react/cjs/react.production.js | CJS 逐字节拷贝 + 微加载器（本脚本） | 647 KB |
| react.vendor.js | scheduler@0.28.0 | scheduler/cjs/scheduler.production.js | 同上（模块 scheduler） | - |
| react.vendor.js | react-dom@19.3.0 | react-dom/cjs/react-dom.production.js | 同上（模块 react-dom） | - |
| react.vendor.js | react-dom@19.3.0 | react-dom/cjs/react-dom-client.production.js | 同上（模块 react-dom/client，提供 createRoot） | - |
| sucrase.vendor.js | sucrase@3.35.1 | sucrase/dist/index.js | esbuild IIFE 打包（入口 scripts/vendor/sucrase-global-entry.cjs） | 289 KB |

## 引用方

- `src/services/sandbox/jsxCompiler.ts`：REACT_VENDOR_RUNTIME_SCRIPT / SUCRASE_VENDOR_SCRIPT
- `server/prompts-v2.ts`：react-cdn 模板对生成应用的运行时说明

## 未 vendor 化的依赖（本机无产物，严禁外网下载）

- chart.js / echarts：node_modules 未安装，生成应用的图表 script 仍指向
  cdn.jsdelivr.net（提示词要求 defer，离线时页面可渲染、仅图表区空）
- vue@3 / @vue/compiler-sfc：node_modules 未安装，vue-cdn 平台运行时仍走 jsdelivr
- Tailwind Play CDN：tailwindcss@4 npm 包不含 Play CDN 脚本，生成指引已切换为手写 CSS
