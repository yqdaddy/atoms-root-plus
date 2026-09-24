/**
 * 文件组装器：将多文件合成为单文件 HTML。
 *
 * 职责：
 * 1. 读取入口 HTML 文件
 * 2. 内联所有本地 CSS 引用（href 支持 "./xxx"、"../xxx" 与根相对 "/xxx"）
 * 3. 内联所有本地 JS 引用（src 支持 "./xxx"、"../xxx" 与根相对 "/xxx"）
 * 4. 验证无遗漏的外部引用
 * 5. React CDN 模式：注入 React/Sucrase 运行时，浏览器内编译执行 JSX
 * 6. React CDN 模式（P1 批次 2）：真实 import 项目走 mini-bundler 打包为
 *    单一脚本注入（assembleProjectFiles），打包失败或项目不符合打包条件时
 *    逐字节回退到上述逐文件链路（回退产物与现状完全一致）
 * 7. React CDN 模式（FINAL-2）：剥离模型 index.html 自带的 react / react-dom /
 *    babel 冗余外链 script（平台 /vendor/ 运行时已提供等价能力，且外网不可达时
 *    defer 外链阻塞 DOMContentLoaded 拖慢 ready 握手）；chart.js 等其他白名单
 *    外链不受影响，html / vue-cdn 产物不含剥离逻辑
 *
 * 设计文档：docs/tech-multi-file-generation.md 第 5.3 节、
 * docs/engineering-grade-generation-plan.md 3.3 与 7、
 * docs/preview-runtime-assessment.md 3.2（路线 B）
 */

import type { FileNode, ProjectFramework } from '../../types/project';
import {
  containsJsx,
  generateReactCdnRuntime,
  generateSucraseRuntime,
  generateReactAppBootstrap,
  wrapJsxScript,
} from './jsxCompiler';
import {
  containsVueSfc,
  containsVueCode,
  generateVueCdnRuntime,
  generateVueSfcCompilerRuntime,
  generateVueAppBootstrap,
  wrapVueSfc,
} from './vueCompiler';
import { tryBundleModules } from './moduleBundler';
import type { BundleModuleFile, BundleSuccess } from './bundlerTypes';
import { scanImportSpecifiers } from './importScanner';

/**
 * react-cdn mini-bundler 固定入口（工程化文件清单约定，
 * 见 docs/engineering-grade-generation-plan.md 2.2）
 */
const SRC_MODULE_ENTRY_PATH = '/src/main.jsx';

/** /src 下参与模块打包的源码文件（.js/.jsx） */
const SRC_MODULE_FILE_PATTERN = /^\/src\/.+\.(js|jsx)$/i;

/**
 * react-cdn 冗余外链剥离（FINAL-2）。
 *
 * 机理：模型生成的 index.html 常自带指向 react / react-dom / babel 的外链
 * script（模板规则已禁止但模型不守规，校验器白名单也放行 jsdelivr）。平台
 * 组装时已注入同源 /vendor/ 运行时（React/ReactDOM/Sucrase 等价能力），
 * 这些外链纯冗余；外网不可达时 defer 外链会阻塞 DOMContentLoaded 达 17-20 秒，
 * 拖慢沙箱 ready 握手，加载遮罩顶住已挂载的应用。
 *
 * 剥离按 script src 指向的库精确判定，只限 react-cdn 框架产物（在
 * injectReactRuntime 内执行，html / vue-cdn 产物不含此逻辑）；
 * chart.js 等其他白名单外链不匹配，原样保留。
 */

/** 冗余外链 src 判定模式：URL 路径指向 react / react-dom / babel 库 */
const REDUNDANT_REACT_CDN_SRC_PATTERNS: readonly RegExp[] = [
  // 包名路径段：react@18 / react-dom@18 / babel-standalone@6（jsdelivr、unpkg、esm.sh 形态）
  // 不匹配 react-router-dom、react-redux 等衍生包（要求 react 后紧跟 @、/、?、# 或结尾）
  /(?:^|\/)(?:npm\/)?(?:react|react-dom|babel-standalone)(?:@[\w.-]+)?(?:[/?#]|$)/i,
  // 作用域包：@babel/standalone 等
  /(?:^|\/)@babel\/[\w.-]+(?:@[\w.-]+)?(?:[/?#]|$)/i,
  // cdnjs 形态：/ajax/libs/react/<ver>/、/ajax/libs/babel-standalone/<ver>/
  /(?:^|\/)ajax\/libs\/(?:react|react-dom|babel-standalone)(?:[/?#]|$)/i,
  // 文件名兜底：react.production.min.js / react-dom.development.js（镜像路径形态）
  /(?:^|\/)react(?:-dom)?\.(?:development|production)(?:\.min)?\.js(?:[?#].*)?$/i,
  // babel 文件名：babel.min.js / babel.js / babel-standalone.js
  /(?:^|\/)babel(?:-standalone|\.min)?\.js(?:[?#].*)?$/i,
];

/**
 * 判定 script src 是否指向 react / react-dom / babel（平台运行时已提供等价能力的冗余外链）
 * 仅外部 URL（http/https/协议相对）参与判定；本地路径由内联链路处理，不在此列
 */
export function isRedundantReactCdnScriptSrc(src: string): boolean {
  if (!/^(?:https?:)?\/\//i.test(src)) {
    return false;
  }
  return REDUNDANT_REACT_CDN_SRC_PATTERNS.some((pattern) => pattern.test(src));
}

/** 组装器配置 */
export interface AssemblerConfig {
  /** 入口文件路径，默认 /index.html */
  entryPath: string;
  /** 文件系统：path → FileNode */
  files: Record<string, FileNode>;
  /** 目标框架，默认 html */
  framework?: ProjectFramework;
}

/** 组装结果 */
export interface AssembledResult {
  /** 组装后的完整 HTML */
  html: string;
  /** 组装过程中的警告 */
  warnings: string[];
  /** 组装统计 */
  stats: {
    totalFiles: number;
    inlinedCss: number;
    inlinedJs: number;
  };
}

/** 组装错误 */
export class AssemblerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblerError';
  }
}

/** 打包脚本注入状态（inlineJsScripts 与 assembleBundled 之间传递） */
interface BundleInjectionState {
  /** 打包脚本是否已进入产物 HTML（槽位注入或 body 末尾追加） */
  placed: boolean;
  /** 是否已占用一个 script 槽位（多个槽位只注入一次，其余替换为注释） */
  slotUsed: boolean;
}

/** inlineJsScripts 的打包注入参数 */
interface BundleInjection {
  /** mini-bundler 产物（自包含 IIFE，可直接放入 script 标签） */
  script: string;
  /** 打包覆盖的模块路径集合 */
  bundledPaths: ReadonlySet<string>;
  /** 注入状态（跨多个 script 标签共享） */
  injectionState: BundleInjectionState;
}

/**
 * 文件组装器：将多文件合成为单文件 HTML
 */
export class Assembler {
  constructor(private config: AssemblerConfig) {}

  /**
   * 组装入口文件及其依赖
   * @throws AssemblerError 入口文件不存在时抛出
   */
  assemble(): AssembledResult {
    const warnings: string[] = [];
    let inlinedCss = 0;
    let inlinedJs = 0;

    // 1. 获取入口 HTML
    let html = this.readEntryHtml();
    const framework = this.config.framework ?? 'html';

    // react-cdn 组件注册（window.__components）依赖入口 HTML 按序引用源码文件，
    // 必须在内联发生前检查原始引用完整性，内联后引用标签已被替换
    if (framework === 'react-cdn') {
      this.warnUnreferencedSourceFiles(html, warnings);
    }

    // 2. 处理 CSS 引用
    const cssResult = this.inlineCssLinks(html, warnings);
    html = cssResult.html;
    inlinedCss = cssResult.count;

    // 3. 处理 JS 引用（React CDN 模式下 JSX 文件被包装为浏览器内编译执行）
    const jsResult = this.inlineJsScripts(html, warnings, framework);
    html = jsResult.html;
    inlinedJs = jsResult.count;

    // 4. 验证无外部引用遗漏
    this.validateNoExternalRefs(html, warnings);

    // 5. React CDN 模式：注入运行时并处理内联 JSX
    if (framework === 'react-cdn') {
      html = this.injectReactRuntime(html, warnings);
    }

    // 6. Vue CDN 模式：注入运行时并处理 Vue SFC
    if (framework === 'vue-cdn') {
      html = this.injectVueRuntime(html, warnings);
    }

    return {
      html,
      warnings,
      stats: {
        totalFiles: Object.keys(this.config.files).length,
        inlinedCss,
        inlinedJs,
      },
    };
  }

  /**
   * P1 批次 2：react-cdn 框架 mini-bundler 集成组装（异步）。
   *
   * 决策链（回退链路行为不变是硬要求）：
   * 1. /src 下无 .js/.jsx 文件，或全部源码不含 import 说明符（P0 组件注册
   *    约定项目）→ 直接走同步逐文件链路，行为与现状逐字节一致
   * 2. tryBundleModules 打包失败（入口缺失、模块断链、白名单外依赖等）→
   *    走同步逐文件链路 + 一条打包失败警告（html 与现状一致）
   * 3. 打包成功但入口 HTML 引用的 /src 文件不在依赖图中（P0/ESM 混合项目，
   *    依赖图不会执行它们）→ 回退逐文件链路，保证这些文件的执行语义不变
   * 4. 打包成功且覆盖完整 → 打包脚本作为单一内联 script 注入，替代这些
   *    文件的逐文件 __compileAndRun 包装
   *
   * @throws AssemblerError 入口文件不存在时抛出
   */
  async assembleWithModuleBundle(): Promise<AssembledResult> {
    const moduleFiles = this.collectSrcModuleFiles();
    const hasImportSpecifier = moduleFiles.some((file) => scanImportSpecifiers(file.content).length > 0);
    if (moduleFiles.length === 0 || !hasImportSpecifier) {
      // 无模块文件或 P0 注册约定项目：mini-bundler 无收益，走现状链路
      return this.assemble();
    }

    const bundle = await tryBundleModules(moduleFiles, SRC_MODULE_ENTRY_PATH);
    if (!bundle.ok) {
      const result = this.assemble();
      result.warnings.unshift(
        `模块打包失败（${bundle.error.code}），已回退逐文件顺序内联: ${bundle.error.message}`
      );
      return result;
    }

    // 覆盖性检查：现状链路会执行入口 HTML 引用的每个 /src 文件，
    // 打包链路只执行依赖图可达文件。引用文件若不在依赖图中（只能来自
    // HTML script 标签而非 import），回退才能保住其执行语义
    const referenced = this.collectReferencedPaths(this.readEntryHtml());
    const uncovered = Array.from(referenced).filter(
      (path) => SRC_MODULE_FILE_PATTERN.test(path) && !bundle.modulePaths.includes(path)
    );
    if (uncovered.length > 0) {
      const result = this.assemble();
      result.warnings.unshift(
        `以下入口 HTML 引用的源码文件不在 import 依赖图中，已回退逐文件顺序内联以保证其执行: ${uncovered.join(', ')}`
      );
      return result;
    }

    return this.assembleBundled(bundle, moduleFiles);
  }

  /**
   * 打包成功路径：bundle 脚本作为单一内联 script 注入。
   * 注入位置取入口 HTML 中第一个引用打包模块的 script 槽位
   * （模块 require 为惰性语义，槽位顺序不影响正确性），
   * 其余打包模块的槽位替换为注释；HTML 无打包模块引用时追加到 body 末尾。
   */
  private assembleBundled(bundle: BundleSuccess, moduleFiles: readonly BundleModuleFile[]): AssembledResult {
    const warnings: string[] = [...bundle.warnings];
    const bundledPaths = new Set<string>(bundle.modulePaths);
    const injectionState: BundleInjectionState = { placed: false, slotUsed: false };

    let html = this.readEntryHtml();

    // CSS 引用处理与现状一致（CSS 不参与模块系统，import css 已被 bundler
    // 改写为运行时 no-op 哨兵，样式仍靠入口 HTML 的 link 内联）
    const cssResult = this.inlineCssLinks(html, warnings);
    html = cssResult.html;
    const inlinedCss = cssResult.count;

    const jsResult = this.inlineJsScripts(html, warnings, 'react-cdn', {
      script: bundle.script,
      bundledPaths,
      injectionState,
    });
    html = jsResult.html;
    let inlinedJs = jsResult.count;

    // 兜底：入口 HTML 没有引用任何打包模块的 script 槽位（import 驱动项目），
    // 追加到 body 末尾，保证入口仍被执行
    if (!injectionState.placed) {
      const bundleTag = `<script>\n${bundle.script}\n</script>`;
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${bundleTag}\n</body>`);
      } else {
        html = `${html}\n${bundleTag}`;
      }
      injectionState.placed = true;
      inlinedJs += 1;
    }

    this.validateNoExternalRefs(html, warnings);

    // React CDN 运行时注入逻辑保持不变：React UMD 在 head 先于 body 中的
    // bundle 脚本执行，require('react') shim 依赖的 window.React 保证就绪
    html = this.injectReactRuntime(html, warnings);

    // 未执行文件告警改用依赖图判据：打包链路的执行集 = modulePaths，
    // 依赖图可达但未被 HTML 直接引用的文件（如组件）已正常执行，不再误报；
    // 依赖图之外且无 HTML 引用的文件与现状一样不会执行，仍需告警
    const unexecuted = moduleFiles
      .map((file) => file.path)
      .filter((path) => path !== SRC_MODULE_ENTRY_PATH && !bundledPaths.has(path));
    if (unexecuted.length > 0) {
      warnings.push(
        `以下源码文件未被引用（不在入口 ${SRC_MODULE_ENTRY_PATH} 的 import 依赖图中），将不会执行: ${unexecuted.join(', ')}`
      );
    }

    return {
      html,
      warnings,
      stats: {
        totalFiles: Object.keys(this.config.files).length,
        inlinedCss,
        inlinedJs,
      },
    };
  }

  /**
   * 读取入口 HTML 内容
   * @throws AssemblerError 入口文件不存在时抛出
   */
  private readEntryHtml(): string {
    const entryNode = this.config.files[this.config.entryPath];
    if (!entryNode) {
      throw new AssemblerError(`入口文件不存在: ${this.config.entryPath}`);
    }
    return entryNode.content;
  }

  /**
   * 收集 /src 下的 .js/.jsx 模块文件（路径升序，保证打包输入确定）
   */
  private collectSrcModuleFiles(): BundleModuleFile[] {
    return Object.keys(this.config.files)
      .filter((path) => SRC_MODULE_FILE_PATTERN.test(path))
      .sort()
      .map((path) => {
        const fileNode = this.config.files[path];
        return { path, content: fileNode?.content ?? '' };
      });
  }

  /**
   * 内联 CSS link 标签
   * 匹配格式：<link rel="stylesheet" href="./styles/xxx.css">、<link href="../styles/xxx.css">
   * 或根相对 <link href="/styles/xxx.css">（模型两种引用形态都出现，D-10）
   */
  private inlineCssLinks(html: string, warnings: string[]): { html: string; count: number } {
    let count = 0;

    // 匹配包含 rel="stylesheet" 的 link 标签，并提取 href 中的本地路径
    const linkPattern = /<link\s+([^>]*?)>/gi;

    const result = html.replace(linkPattern, (match, attrs: string) => {
      // 检查是否有 rel="stylesheet"
      if (!/rel\s*=\s*["']stylesheet["']/i.test(attrs)) {
        return match;
      }

      // 提取 href 属性值：支持 "./xxx"、"../xxx" 与根相对 "/xxx"（排除协议相对 "//host/xxx"）
      const hrefMatch = attrs.match(/href\s*=\s*["']((?:\.{1,2}\/|\/(?!\/))[^"']+)["']/i);
      const relativePath = hrefMatch?.[1];
      if (!relativePath) {
        // 外部链接或非本地路径，保持原样
        return match;
      }

      const absolutePath = this.resolvePath(relativePath);

      // 防循环：入口 HTML 自身被引用为脚本/样式时跳过内联，避免自嵌套
      if (absolutePath === this.config.entryPath) {
        warnings.push(`入口文件自身引用，跳过内联: ${relativePath}`);
        return match;
      }

      const fileNode = this.config.files[absolutePath];

      if (!fileNode) {
        warnings.push(`CSS 文件不存在: ${relativePath}（解析为 ${absolutePath}）`);
        return `<!-- 缺失: ${relativePath} -->`;
      }

      count++;
      return `<style>\n${fileNode.content}\n</style>`;
    });

    return { html: result, count };
  }

  /**
   * 内联 JS script 标签
   * 匹配格式：<script src="./src/xxx.js"></script>、<script src="../src/xxx.js"></script>
   * 或根相对 <script src="/src/xxx.js"></script>（模型两种引用形态都出现，D-10）
   * React CDN 模式下，含 JSX 语法的文件被包装为浏览器内编译执行脚本块；
   * 传入 bundle 时，打包覆盖的模块槽位改为注入单一打包脚本（P1 批次 2）
   */
  private inlineJsScripts(
    html: string,
    warnings: string[],
    framework: ProjectFramework = 'html',
    bundle?: BundleInjection
  ): { html: string; count: number } {
    let count = 0;

    // 匹配带有 src 属性的 script 标签
    const scriptPattern = /<script\s+([^>]*?)>\s*<\/script>/gi;

    const result = html.replace(scriptPattern, (match, attrs: string) => {
      // 提取 src 属性值：支持 "./xxx"、"../xxx" 与根相对 "/xxx"（排除协议相对 "//host/xxx"）
      const srcMatch = attrs.match(/src\s*=\s*["']((?:\.{1,2}\/|\/(?!\/))[^"']+)["']/i);
      const relativePath = srcMatch?.[1];
      if (!relativePath) {
        // 外部链接或非本地路径，保持原样
        return match;
      }

      const absolutePath = this.resolvePath(relativePath);

      // 防循环：入口 HTML 自身被引用为脚本/样式时跳过内联，避免自嵌套
      if (absolutePath === this.config.entryPath) {
        warnings.push(`入口文件自身引用，跳过内联: ${relativePath}`);
        return match;
      }

      const fileNode = this.config.files[absolutePath];

      if (!fileNode) {
        warnings.push(`JS 文件不存在: ${relativePath}（解析为 ${absolutePath}）`);
        return `<!-- 缺失: ${relativePath} -->`;
      }

      count++;

      // 打包路径：命中打包覆盖的模块时，首个槽位注入单一打包脚本，
      // 其余槽位替换为注释（模块已在打包脚本内，逐文件加载被整体替代）
      if (
        framework === 'react-cdn' &&
        bundle &&
        SRC_MODULE_FILE_PATTERN.test(absolutePath) &&
        bundle.bundledPaths.has(absolutePath)
      ) {
        bundle.injectionState.placed = true;
        if (!bundle.injectionState.slotUsed) {
          bundle.injectionState.slotUsed = true;
          return `<script>\n${bundle.script}\n</script>`;
        }
        return `<!-- 已并入模块打包脚本: ${relativePath} -->`;
      }

      // React CDN 模式：JSX 文件包装为编译执行脚本块
      // .jsx 扩展名直接视为 JSX（启发式 containsJsx 对 return ( 换行标签等形态可能漏判，
      // 漏报代价是裸 JSX 在普通 script 里语法错误、组件整文件失效）
      const isJsxFile = relativePath.toLowerCase().endsWith('.jsx');
      if (framework === 'react-cdn' && (isJsxFile || containsJsx(fileNode.content))) {
        return wrapJsxScript(fileNode.content, relativePath);
      }

      return `<script>\n${fileNode.content}\n</script>`;
    });

    return { html: result, count };
  }

  /**
   * 将运行时脚本注入 <head> 最前，保证先于用户脚本执行
   */
  private injectHead(html: string, snippet: string): string {
    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${snippet}`);
    }
    if (html.includes('<html>')) {
      return html.replace('<html>', `<html><head>${snippet}</head>`);
    }
    return `<!DOCTYPE html><html><head>${snippet}</head><body>${html}</body></html>`;
  }

  /**
   * 剥离模型 index.html 中指向 react / react-dom / babel 的外链 script 标签（FINAL-2）。
   * 剥离对象仅限外部 URL 且按库精确判定（isRedundantReactCdnScriptSrc），
   * chart.js 等其他白名单外链原样保留；剥离处替换为注释留痕，并汇总一条组装警告
   * （warnings 走 console 通道，不产生用户可见错误）
   */
  private stripRedundantReactCdnScripts(html: string, warnings: string[]): string {
    const strippedUrls: string[] = [];
    const result = html.replace(
      /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,
      (match, src: string) => {
        if (!isRedundantReactCdnScriptSrc(src)) {
          return match;
        }
        strippedUrls.push(src);
        return `<!-- 平台已剥离冗余 React 外链（/vendor/ 运行时已提供等价能力）: ${src} -->`;
      }
    );
    if (strippedUrls.length > 0) {
      warnings.push(
        `已剥离冗余 React/ReactDOM/Babel 外链 script（平台 /vendor/ 运行时已提供等价能力）: ${strippedUrls.join(', ')}`
      );
    }
    return result;
  }

  /**
   * 注入 React CDN 运行时（同源 vendor 的 React/ReactDOM + Sucrase 编译器）
   * 同时处理无 src 的内联 <script> 中出现的 JSX 代码
   *
   * 无论用户 HTML 是否自带 React 引用都注入平台运行时：
   * 沙箱 CSP 只放行白名单 CDN 与同源 /vendor/ 路径（docs/tech-sandbox.md 铁律 4），
   * 模型自带的外域引用（如 unpkg.com）会被浏览器拦截导致白屏，
   * 平台运行时固定走本地 vendor（/vendor/react.vendor.js，零外网依赖），
   * 保证 React/ReactDOM/Sucrase 可用。
   */
  injectReactRuntime(html: string, warnings: string[]): string {
    // 并存告警按原始 HTML 判定（既有语义不变）；剥离在其后执行
    if (html.includes('react@') || html.includes('react-dom@') || html.includes('unpkg.com/react') || html.includes('cdn.jsdelivr.net/npm/react')) {
      warnings.push('HTML 已包含 React 引用，与平台运行时并存（白名单外的引用会被 CSP 拦截）');
    }

    // FINAL-2：剥离模型自带的冗余 React/ReactDOM/Babel 外链 script。
    // 平台组装时已注入同源 /vendor/ 运行时（等价能力），模型不守规带出的外链
    // 纯冗余；外网不可达时 defer 外链阻塞 DOMContentLoaded 17-20 秒，拖慢 ready 握手。
    // 剥离只发生在 react-cdn 运行时注入内（html / vue-cdn 产物不含此逻辑）
    let finalHtml = this.stripRedundantReactCdnScripts(html, warnings);

    const runtime = generateReactCdnRuntime() + '\n' + generateSucraseRuntime();
    const rootDiv = generateReactAppBootstrap();

    // 确保 React 挂载点存在（id 固定为 root）
    if (!/id=["']root["']/.test(finalHtml)) {
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${rootDiv}\n</body>`);
      } else if (finalHtml.includes('<body>')) {
        finalHtml = finalHtml.replace('<body>', `<body>${rootDiv}`);
      } else {
        finalHtml = `${rootDiv}\n${finalHtml}`;
      }
    }

    // 注入运行时脚本（置于 head 最前，先于用户脚本执行）
    finalHtml = this.injectHead(finalHtml, runtime);

    // 处理内联 JSX 脚本（<script> 无 src 但包含 JSX）
    finalHtml = this.processInlineJsxScripts(finalHtml);

    return finalHtml;
  }

  /**
   * 处理内联 JSX 脚本：将含 JSX 语法的无 src <script> 包装为编译执行块
   */
  private processInlineJsxScripts(html: string): string {
    const scriptPattern = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;

    return html.replace(scriptPattern, (match, attrs: string, content: string) => {
      if (!content.trim()) return match;
      // 带 type 标记的模块脚本（如 type="module"）不在 CDN 运行时支持范围
      if (/type\s*=\s*["']module["']/i.test(attrs)) {
        return match;
      }
      // 跳过已包装的代码（防止嵌套包装）
      // inlineJsScripts 可能已将 JSX 文件包装为 __compileAndRun("...", "./src/main.jsx")
      // 此检测避免对已包装内容再次包装，产生 __compileAndRun("\n__compileAndRun(...") 嵌套错误
      if (content.includes('__compileAndRun(')) {
        return match;
      }
      if (containsJsx(content)) {
        return `<script${attrs}>__compileAndRun(${JSON.stringify(content)}, "inline-jsx");</script>`;
      }
      return match;
    });
  }

  /**
   * 注入 Vue CDN 运行时（Vue 3 UMD + SFC 编译器）
   * 同时处理无 src 的内联 <script> 中出现的 Vue SFC 代码
   */
  injectVueRuntime(html: string, warnings: string[]): string {
    // 同 React：无论用户 HTML 是否自带 Vue 引用都注入平台运行时（Vue 运行时暂仍走白名单内 jsdelivr）
    if (html.includes('vue@') || html.includes('unpkg.com/vue') || html.includes('cdn.jsdelivr.net/npm/vue')) {
      warnings.push('HTML 已包含 Vue 引用，与平台运行时并存（白名单外的引用会被 CSP 拦截）');
    }

    const runtime = generateVueCdnRuntime() + '\n' + generateVueSfcCompilerRuntime();
    const rootDiv = generateVueAppBootstrap();

    let finalHtml = html;

    // 确保 Vue 挂载点存在（id 固定为 app）
    if (!/id=["']app["']/.test(finalHtml)) {
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${rootDiv}\n</body>`);
      } else if (finalHtml.includes('<body>')) {
        finalHtml = finalHtml.replace('<body>', `<body>${rootDiv}`);
      } else {
        finalHtml = `${rootDiv}\n${finalHtml}`;
      }
    }

    // 注入运行时脚本（置于 head 最前，先于用户脚本执行）
    finalHtml = this.injectHead(finalHtml, runtime);

    // 处理内联 Vue 脚本（<script> 无 src 但包含 Vue SFC/API）
    finalHtml = this.processInlineVueScripts(finalHtml);

    return finalHtml;
  }

  /**
   * 处理内联 Vue 脚本：将含 Vue SFC/API 的无 src <script> 包装为编译执行块
   */
  private processInlineVueScripts(html: string): string {
    const scriptPattern = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;

    return html.replace(scriptPattern, (match, attrs: string, content: string) => {
      if (!content.trim()) return match;
      // 带 type 标记的模块脚本不在 CDN 运行时支持范围
      if (/type\s*=\s*["']module["']/i.test(attrs)) {
        return match;
      }
      // Vue SFC 格式：包含 <template> 标签
      if (containsVueSfc(content)) {
        return wrapVueSfc(content, 'inline-vue-sfc');
      }
      // Vue API 调用：包含 createApp 等
      if (containsVueCode(content)) {
        // Vue API 代码可以直接执行，但需要确保 Vue 全局对象存在
        return `<script${attrs}>\n// Vue CDN 模式：Vue 全局对象已注入\n${content}\n</script>`;
      }
      return match;
    });
  }

  /**
   * 解析相对路径为绝对路径
   * @param relativePath 相对路径，如 "./styles/main.css" 或 "../styles/main.css"
   * @returns 绝对路径，如 "/styles/main.css"
   */
  resolvePath(relativePath: string): string {
    // 获取入口文件所在目录
    const lastSlashIndex = this.config.entryPath.lastIndexOf('/');
    const entryDir = lastSlashIndex > 0 ? this.config.entryPath.substring(0, lastSlashIndex) : '';

    // 分解路径段
    const dirParts = entryDir.split('/').filter(Boolean);
    const segments = relativePath.split('/');

    for (const seg of segments) {
      if (seg === '..') {
        dirParts.pop();
      } else if (seg !== '.' && seg !== '') {
        dirParts.push(seg);
      }
    }

    return '/' + dirParts.join('/');
  }

  /**
   * 收集入口 HTML 引用的本地路径集合（src/href 属性，经 resolvePath 归一）
   * 供未引用告警（现状链路）与打包覆盖性检查（打包链路）共用
   */
  private collectReferencedPaths(html: string): Set<string> {
    const referenced = new Set<string>();
    for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (m[1]) referenced.add(this.resolvePath(m[1]));
    }
    return referenced;
  }

  /**
   * 检查 react-cdn 模式下 /src 源码文件是否被入口 HTML 引用
   * 组件注册约定（window.__components）依赖脚本按序加载，漏引用会导致运行时读取 undefined
   * 仅用于现状逐文件链路；打包链路的执行集由依赖图决定，见 assembleBundled
   */
  private warnUnreferencedSourceFiles(html: string, warnings: string[]): void {
    const referenced = this.collectReferencedPaths(html);
    const unreferenced = Object.keys(this.config.files).filter(
      (p) => /^\/src\/.+\.(jsx|js)$/.test(p) && p !== '/src/main.jsx' && !referenced.has(p)
    );
    if (unreferenced.length > 0) {
      warnings.push(
        `以下源码文件未被入口 HTML 引用，将不会执行（react-cdn 组件注册依赖脚本加载顺序）: ${unreferenced.join(', ')}`
      );
    }
  }

  /**
   * 验证无遗漏的外部引用
   * 检查 HTML 中是否还有未处理的本地引用（href="./xxx" 或 src="./xxx"）
   */
  private validateNoExternalRefs(html: string, warnings: string[]): void {
    // 检查遗留的本地引用（以 ./ 或 ../ 开头）
    const localRefPattern = /(href|src)\s*=\s*["']\.{1,2}\/[^"']+["']/gi;
    const matches = html.match(localRefPattern);

    if (matches && matches.length > 0) {
      // 豁免静态资源：图片、字体、媒体缺失只影响体验，不属组装器职责
      const exemptExtensions = new Set([
        'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif',
        'woff', 'woff2', 'ttf', 'eot', 'otf',
        'mp4', 'webm', 'mp3', 'wav', 'ogg',
      ]);
      const unresolvedRefs = matches.filter((ref) => {
        const pathMatch = ref.match(/\.{1,2}\/([^"']+)/);
        if (!pathMatch?.[1]) return false;
        const ext = pathMatch[1].split('.').pop()?.toLowerCase() ?? '';
        return !exemptExtensions.has(ext);
      });

      if (unresolvedRefs.length > 0) {
        warnings.push(`存在未处理的本地引用: ${unresolvedRefs.join(', ')}`);
      }
    }
  }
}

/**
 * 便捷函数：组装多文件为单文件 HTML
 */
export function assembleFiles(
  files: Record<string, FileNode>,
  entryPath: string = '/index.html',
  framework: ProjectFramework = 'html'
): AssembledResult {
  const assembler = new Assembler({ entryPath, files, framework });
  return assembler.assemble();
}

/**
 * 便捷函数（P1 批次 2）：mini-bundler 集成的项目组装（异步）。
 *
 * 与 assembleFiles 的关系：
 * - html / vue-cdn 框架：内部直接走 assembleFiles 同步链路，行为完全一致
 * - react-cdn 框架：真实 import 项目打包为单一脚本注入（见
 *   Assembler.assembleWithModuleBundle 的决策链）；任何打包失败或
 *   覆盖性不满足都逐字节回退到 assembleFiles 的产物
 *
 * 接入说明：SandboxFrame 当前在 useMemo 中同步调用 assembleFiles（本批次
 * 边界内不改该文件），切换到本函数即启用打包链路；因 tryBundleModules
 * 动态加载 Sucrase，本函数必须被 await。
 */
export async function assembleProjectFiles(
  files: Record<string, FileNode>,
  entryPath: string = '/index.html',
  framework: ProjectFramework = 'html'
): Promise<AssembledResult> {
  const assembler = new Assembler({ entryPath, files, framework });
  if (framework !== 'react-cdn') {
    return assembler.assemble();
  }
  return assembler.assembleWithModuleBundle();
}

/**
 * 便捷函数：为单文件 HTML 注入 React CDN 运行时
 * 用于 react-cdn 框架的单文件模式（含内联 JSX 的自动包装）
 */
export function injectReactRuntime(html: string): string {
  const assembler = new Assembler({
    entryPath: '/index.html',
    files: {},
    framework: 'react-cdn',
  });
  const warnings: string[] = [];
  const result = assembler.injectReactRuntime(html, warnings);
  if (warnings.length > 0) {
    console.warn('[assembler] React 运行时注入警告:', warnings);
  }
  return result;
}

/**
 * 便捷函数：为单文件 HTML 注入 Vue CDN 运行时
 * 用于 vue-cdn 框架的单文件模式（含内联 Vue SFC 的自动包装）
 */
export function injectVueRuntime(html: string): string {
  const assembler = new Assembler({
    entryPath: '/index.html',
    files: {},
    framework: 'vue-cdn',
  });
  const warnings: string[] = [];
  const result = assembler.injectVueRuntime(html, warnings);
  if (warnings.length > 0) {
    console.warn('[assembler] Vue 运行时注入警告:', warnings);
  }
  return result;
}