/**
 * bare import shim 表（mini-bundler，路线 B）。
 *
 * 生成的应用代码以 ESM 语法 import 第三方库（如 react、chart.js），
 * 沙箱内这些库以全局变量提供（window.React 经同源 /vendor 平台运行时注入，
 * window.Chart 等图表库经生成的入口 HTML 的 jsdelivr UMD script 提供）。
 * 本表把 bare 说明符映射到互操作工厂：require(spec) 返回带
 * __esModule 标记的命名空间对象，供 Sucrase imports transform 的
 * _interopRequireDefault / _interopRequireWildcard 正确消费。
 *
 * 表是闭集：表外 bare 说明符在构建期报明确错误（文案可喂给 AI 修复循环）。
 */

/** CSS 导入的运行时 no-op 模块键（模块运行时对该键直接返回空对象） */
export const CSS_MODULE_SENTINEL = '__css_module__';

/** 单条 shim 工厂函数体：在沙箱内执行，返回该说明符的模块导出对象 */
type ShimFactoryBody = string;

/**
 * shim 表：bare 说明符 -> 工厂函数体源码。
 * window.React / window.ReactDOM 由 react-cdn 平台运行时注入（同源 /vendor/react.vendor.js）；
 * window.Chart / window.echarts 由生成的入口 HTML 的图表 script 标签提供（jsdelivr UMD 构建）。
 */
export const BARE_IMPORT_SHIMS: Readonly<Record<string, ShimFactoryBody>> = {
  react: `
      var R = window.React;
      if (!R) { throw new Error('window.React 未加载（React CDN 运行时缺失），无法解析 import "react"'); }
      var m = { __esModule: true, default: R };
      for (var k in R) { if (Object.prototype.hasOwnProperty.call(R, k) && !(k in m)) { m[k] = R[k]; } }
      return m;`,
  'react-dom': `
      var RD = window.ReactDOM;
      if (!RD) { throw new Error('window.ReactDOM 未加载（React CDN 运行时缺失），无法解析 import "react-dom"'); }
      var m = { __esModule: true, default: RD };
      for (var k in RD) { if (Object.prototype.hasOwnProperty.call(RD, k) && !(k in m)) { m[k] = RD[k]; } }
      return m;`,
  'react-dom/client': `
      var RD = window.ReactDOM;
      if (!RD || typeof RD.createRoot !== 'function') { throw new Error('window.ReactDOM 未加载或缺少 createRoot（React CDN 运行时缺失），无法解析 import "react-dom/client"'); }
      var client = {
        createRoot: function () { return RD.createRoot.apply(RD, arguments); },
        hydrateRoot: typeof RD.hydrateRoot === 'function' ? function () { return RD.hydrateRoot.apply(RD, arguments); } : undefined
      };
      client.default = client;
      client.__esModule = true;
      return client;`,
  // 防御性别名：本 bundler 采用 classic JSX runtime，正常不产生该说明符；
  // 若模型显式 import react/jsx-runtime 也可正确工作而非白屏
  'react/jsx-runtime': `
      var R = window.React;
      if (!R) { throw new Error('window.React 未加载（React CDN 运行时缺失），无法解析 import "react/jsx-runtime"'); }
      function jsx(type, props, key) {
        var children = props.children;
        var cfg = {};
        for (var pk in props) { if (pk !== 'children' && Object.prototype.hasOwnProperty.call(props, pk)) { cfg[pk] = props[pk]; } }
        if (key !== undefined && key !== null) { cfg.key = key; }
        return R.createElement(type, cfg, children);
      }
      return { __esModule: true, jsx: jsx, jsxs: jsx, Fragment: R.Fragment, default: { jsx: jsx, jsxs: jsx, Fragment: R.Fragment } };`,
  'react/jsx-dev-runtime': `
      var R = window.React;
      if (!R) { throw new Error('window.React 未加载（React CDN 运行时缺失），无法解析 import "react/jsx-dev-runtime"'); }
      function jsx(type, props, key) {
        var children = props.children;
        var cfg = {};
        for (var pk in props) { if (pk !== 'children' && Object.prototype.hasOwnProperty.call(props, pk)) { cfg[pk] = props[pk]; } }
        if (key !== undefined && key !== null) { cfg.key = key; }
        return R.createElement(type, cfg, children);
      }
      return { __esModule: true, jsx: jsx, jsxs: jsx, jsxDEV: jsx, Fragment: R.Fragment, default: { jsx: jsx, jsxs: jsx, jsxDEV: jsx, Fragment: R.Fragment } };`,
  'chart.js': `
      var C = window.Chart;
      if (!C) { throw new Error('window.Chart 未加载：chart.js 需在入口 HTML 通过 script 标签引入（jsdelivr UMD 构建，须带 defer）'); }
      var m = { __esModule: true, default: C, Chart: C };
      for (var k in C) { if (Object.prototype.hasOwnProperty.call(C, k) && !(k in m)) { m[k] = C[k]; } }
      return m;`,
  echarts: `
      var E = window.echarts;
      if (!E) { throw new Error('window.echarts 未加载：echarts 需在入口 HTML 通过 script 标签引入（jsdelivr UMD 构建，须带 defer）'); }
      var m = { __esModule: true, default: E };
      for (var k in E) { if (Object.prototype.hasOwnProperty.call(E, k) && !(k in m)) { m[k] = E[k]; } }
      return m;`,
};

/** shim 表覆盖的全部 bare 说明符（构建期白名单校验用） */
export const BARE_IMPORT_SPECIFIERS: readonly string[] = Object.keys(BARE_IMPORT_SHIMS);

/** 查询 shim 工厂函数体；表外说明符返回 null */
export function getBareShimBody(specifier: string): ShimFactoryBody | null {
  if (!Object.prototype.hasOwnProperty.call(BARE_IMPORT_SHIMS, specifier)) {
    return null;
  }
  return BARE_IMPORT_SHIMS[specifier] ?? null;
}

/**
 * 生成 bare 模块加载器源码（嵌入模块运行时）。
 * 提供 __loadBareModule(spec)：命中 shim 表则执行工厂并缓存，未命中抛可读错误。
 * 错误文案面向 AI 修复循环：列出全部可用依赖。
 */
export function generateBareShimLoader(): string {
  const cases = BARE_IMPORT_SPECIFIERS.map((spec) => {
    const body = BARE_IMPORT_SHIMS[spec];
    return `      case ${JSON.stringify(spec)}: {
        exportsValue = (function () {
${body}
        })();
        break;
      }`;
  }).join('\n');
  return `  var __bareShimCache = Object.create(null);
  function __loadBareModule(spec) {
    if (spec === ${JSON.stringify(CSS_MODULE_SENTINEL)}) { return {}; }
    if (Object.prototype.hasOwnProperty.call(__bareShimCache, spec)) { return __bareShimCache[spec]; }
    var exportsValue;
    switch (spec) {
${cases}
      default:
        throw new Error('不支持的依赖: "' + spec + '"。当前沙箱仅支持以下依赖: ${BARE_IMPORT_SPECIFIERS.join(', ')}（经 CDN 全局提供）。如需其他库请改用以上白名单依赖或自行实现。');
    }
    __bareShimCache[spec] = exportsValue;
    return exportsValue;
  }`;
}
