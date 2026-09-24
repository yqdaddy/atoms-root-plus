/**
 * dist 物化器（工程化生成计划决议 5，方案 B）：
 * ZIP 导出时由平台把浏览器端编译产物物化为 dist/index.html，
 * 与源码工程一并交付。产物定位：用户下载解压后，源码是工程起点，
 * dist/index.html 双击即可运行（无需任何构建步骤）。
 *
 * 物化规则（按框架）：
 * - html：同步组装产物（assembleFiles）
 * - react-cdn：优先 await assembleProjectFiles（mini-bundler 打包产物），
 *   该入口抛出时回退同步组装产物；两级都失败则向上抛错，
 *   由导出服务中止下载（宁可不给，不给坏的）
 * - vue-cdn：同步组装产物（assembleFiles）
 *
 * react-cdn 附加规则：产物中的根绝对 /vendor/ 引用改写为相对路径
 * （./vendor/...，file:// 协议下可解析），引用清单随结果返回，
 * 由导出服务把这些运行时文件打包进 ZIP 的 dist/vendor/ 目录（自包含交付）
 *
 * 设计文档：docs/engineering-grade-generation-plan.md 2.1 与文末决议 5
 */

import { assembleFiles, assembleProjectFiles } from '../sandbox/assembler';
import { ENTRY_FILE_PATH } from '../../types/project';
import type { FileNode, ProjectFramework } from '../../types/project';

/** dist 产物在 ZIP 内的固定路径（相对路径，无前导斜杠） */
export const DIST_INDEX_PATH = 'dist/index.html';

/** dist 产物内 vendor 运行时目录（相对 dist/index.html） */
export const DIST_VENDOR_DIR = 'vendor';

/** 物化采用的链路：async = mini-bundler 打包链路；sync = 同步逐文件链路 */
export type DistStrategy = 'async' | 'sync';

export interface DistMaterializeResult {
  /** 物化产物：自包含的单文件 HTML */
  html: string;
  /** 实际采用的链路（诊断用） */
  strategy: DistStrategy;
  /** 组装警告 */
  warnings: string[];
  /**
   * 产物引用的 vendor 运行时文件名（如 react.vendor.js，已改写为相对引用）。
   * html / vue-cdn 框架恒为空数组；导出服务据此把这些文件一并打入 ZIP 的
   * dist/vendor/ 目录，保证解压后双击 dist/index.html 离线可运行
   */
  vendorFiles: string[];
}

/**
 * 匹配 HTML 属性中的根绝对 vendor 引用（src="/vendor/xxx" 或 href="/vendor/xxx"）。
 * 仅改写属性上下文：脚本正文里的提示文案（如加载失败报错信息）保持原样，
 * 避免对用户内容产生误伤
 */
const VENDOR_ATTR_REF_PATTERN = /(src|href)(\s*=\s*)(["'])(\/vendor\/[^"']+)\3/g;

/** vendor 文件名合法性校验：仅允许字母数字点下划线连字符（防路径穿越，双保险） */
const VENDOR_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface VendorRewriteResult {
  /** 改写后的 HTML */
  html: string;
  /** 产物引用的 vendor 文件名（去重，按出现顺序） */
  vendorFiles: string[];
}

/**
 * 把产物中的根绝对 /vendor/... 引用改写为相对路径 ./vendor/...。
 *
 * 背景：沙箱 srcdoc 以宿主页面为 base URL，/vendor/... 解析到宿主同源；
 * 但 ZIP 导出的 dist/index.html 经 file:// 打开时，根绝对路径会解析到
 * 文件系统根目录，引用永远悬空。改为相对路径后引用 dist/vendor/ 下
 * 随 ZIP 交付的运行时文件，离线可运行。
 *
 * 仅 react-cdn 产物实际含此类引用（平台注入的 React/Sucrase 运行时）；
 * html / vue-cdn 产物无此引用，调用与否结果一致（保持行为不变）。
 */
export function rewriteVendorRefsToRelative(html: string): VendorRewriteResult {
  const vendorFiles: string[] = [];
  const seen = new Set<string>();

  const rewritten = html.replace(
    VENDOR_ATTR_REF_PATTERN,
    (_match, attr: string, eq: string, quote: string, ref: string) => {
      const fileName = ref.replace(/^\/vendor\//, '');
      if (!VENDOR_FILE_NAME_PATTERN.test(fileName) || fileName.includes('..')) {
        // 非法文件名不改写也不收集（产物来自平台受控注入，此分支仅为防御）
        return `${attr}${eq}${quote}${ref}${quote}`;
      }
      if (!seen.has(fileName)) {
        seen.add(fileName);
        vendorFiles.push(fileName);
      }
      return `${attr}${eq}${quote}./vendor/${fileName}${quote}`;
    }
  );

  return { html: rewritten, vendorFiles };
}

/**
 * 物化 dist/index.html。
 *
 * @param files 项目虚拟文件系统（path 到 FileNode）
 * @param framework 项目目标框架，默认 html
 * @throws 入口缺失等组装失败时抛出（AssemblerError）；react-cdn 打包链路
 *         抛出时已自动回退同步链路，仅同步链路也失败才向外抛
 */
export async function materializeDistIndex(
  files: Record<string, FileNode>,
  framework: ProjectFramework = 'html'
): Promise<DistMaterializeResult> {
  if (framework === 'react-cdn') {
    let result: DistMaterializeResult;
    try {
      const bundled = await assembleProjectFiles(files, ENTRY_FILE_PATH, framework);
      result = { html: bundled.html, strategy: 'async', warnings: bundled.warnings, vendorFiles: [] };
    } catch (error) {
      // 打包链路异常（Sucrase 加载失败等）：回退同步逐文件链路。
      // 同步链路再失败（入口缺失等）则不捕获，由导出服务中止导出
      console.warn('[distMaterializer] 打包链路失败，回退同步组装:', error);
      const sync = assembleFiles(files, ENTRY_FILE_PATH, framework);
      result = { html: sync.html, strategy: 'sync', warnings: sync.warnings, vendorFiles: [] };
    }
    // ZIP 交付场景（file:// 双击）：根绝对 /vendor/ 引用改写为相对路径，
    // 引用清单交由导出服务打包进 dist/vendor/
    const rewritten = rewriteVendorRefsToRelative(result.html);
    return { ...result, html: rewritten.html, vendorFiles: rewritten.vendorFiles };
  }

  const sync = assembleFiles(files, ENTRY_FILE_PATH, framework);
  return { html: sync.html, strategy: 'sync', warnings: sync.warnings, vendorFiles: [] };
}
