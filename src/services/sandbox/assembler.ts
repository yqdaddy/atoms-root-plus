/**
 * 文件组装器：将多文件合成为单文件 HTML。
 *
 * 职责：
 * 1. 读取入口 HTML 文件
 * 2. 内联所有本地 CSS 引用（<link rel="stylesheet" href="./styles/...">）
 * 3. 内联所有本地 JS 引用（<script src="./src/...">）
 * 4. 验证无遗漏的外部引用
 * 5. React CDN 模式：注入 React/Sucrase 运行时，浏览器内编译执行 JSX
 *
 * 设计文档：docs/tech-multi-file-generation.md 第 5.3 节
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
    const entryNode = this.config.files[this.config.entryPath];
    if (!entryNode) {
      throw new AssemblerError(`入口文件不存在: ${this.config.entryPath}`);
    }

    let html = entryNode.content;

    // 2. 处理 CSS 引用
    const cssResult = this.inlineCssLinks(html, warnings);
    html = cssResult.html;
    inlinedCss = cssResult.count;

    // 3. 处理 JS 引用（React CDN 模式下 JSX 文件被包装为浏览器内编译执行）
    const framework = this.config.framework ?? 'html';
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
   * 内联 CSS link 标签
   * 匹配格式：<link rel="stylesheet" href="./styles/xxx.css"> 或 <link href="./styles/xxx.css" rel="stylesheet">
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

      // 提取 href 属性值（支持 "./xxx" 与 "../xxx" 两种相对前缀）
      const hrefMatch = attrs.match(/href\s*=\s*["'](\.{1,2}\/[^"']+)["']/i);
      const relativePath = hrefMatch?.[1];
      if (!relativePath) {
        // 外部链接或非本地路径，保持原样
        return match;
      }

      const absolutePath = this.resolvePath(relativePath);
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
   * 匹配格式：<script src="./src/xxx.js"></script> 或 <script src="../src/xxx.js"></script>
   * React CDN 模式下，含 JSX 语法的文件被包装为浏览器内编译执行脚本块
   */
  private inlineJsScripts(
    html: string,
    warnings: string[],
    framework: ProjectFramework = 'html'
  ): { html: string; count: number } {
    let count = 0;

    // 匹配带有 src 属性的 script 标签
    const scriptPattern = /<script\s+([^>]*?)>\s*<\/script>/gi;

    const result = html.replace(scriptPattern, (match, attrs: string) => {
      // 提取 src 属性值（支持 "./xxx" 与 "../xxx" 两种相对前缀）
      const srcMatch = attrs.match(/src\s*=\s*["'](\.{1,2}\/[^"']+)["']/i);
      const relativePath = srcMatch?.[1];
      if (!relativePath) {
        // 外部链接或非本地路径，保持原样
        return match;
      }

      const absolutePath = this.resolvePath(relativePath);
      const fileNode = this.config.files[absolutePath];

      if (!fileNode) {
        warnings.push(`JS 文件不存在: ${relativePath}（解析为 ${absolutePath}）`);
        return `<!-- 缺失: ${relativePath} -->`;
      }

      count++;

      // React CDN 模式：JSX 文件包装为编译执行脚本块
      if (framework === 'react-cdn' && containsJsx(fileNode.content)) {
        return wrapJsxScript(fileNode.content, relativePath);
      }

      return `<script>\n${fileNode.content}\n</script>`;
    });

    return { html: result, count };
  }

  /**
   * 注入 React CDN 运行时（React 18 UMD + Sucrase 编译器）
   * 同时处理无 src 的内联 <script> 中出现的 JSX 代码
   */
  injectReactRuntime(html: string, warnings: string[]): string {
    // 已包含 React 引用时尊重用户代码，跳过自动注入
    if (html.includes('react@') || html.includes('react-dom@') || html.includes('unpkg.com/react')) {
      warnings.push('HTML 已包含 React CDN 引用，跳过运行时自动注入');
      return this.processInlineJsxScripts(html);
    }

    const runtime = generateReactCdnRuntime() + '\n' + generateSucraseRuntime();
    const rootDiv = generateReactAppBootstrap();

    let finalHtml = html;

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

    // 注入运行时脚本：置于 <head> 最前，保证先于用户脚本执行
    if (finalHtml.includes('<head>')) {
      finalHtml = finalHtml.replace('<head>', `<head>${runtime}`);
    } else if (finalHtml.includes('<html>')) {
      finalHtml = finalHtml.replace('<html>', `<html><head>${runtime}</head>`);
    } else {
      finalHtml = `<!DOCTYPE html><html><head>${runtime}</head><body>${finalHtml}</body></html>`;
    }

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
    // 已包含 Vue 引用时尊重用户代码，跳过自动注入
    if (html.includes('vue@') || html.includes('unpkg.com/vue') || html.includes('cdn.jsdelivr.net/npm/vue')) {
      warnings.push('HTML 已包含 Vue CDN 引用，跳过运行时自动注入');
      return this.processInlineVueScripts(html);
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

    // 注入运行时脚本：置于 <head> 最前，保证先于用户脚本执行
    if (finalHtml.includes('<head>')) {
      finalHtml = finalHtml.replace('<head>', `<head>${runtime}`);
    } else if (finalHtml.includes('<html>')) {
      finalHtml = finalHtml.replace('<html>', `<html><head>${runtime}</head>`);
    } else {
      finalHtml = `<!DOCTYPE html><html><head>${runtime}</head><body>${finalHtml}</body></html>`;
    }

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