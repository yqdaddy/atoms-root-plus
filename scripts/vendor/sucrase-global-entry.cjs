/**
 * sucrase.vendor.js 的 esbuild 打包入口（见 scripts/build-vendor-runtime.mjs）。
 * 目的：把 npm sucrase 包暴露为沙箱内可用的全局 globalThis.Sucrase，
 * 替代 jsxCompiler 此前的 esm.sh ESM 引入（部署环境外网不可达）。
 */
const sucrase = require('sucrase');
globalThis.Sucrase = sucrase;
