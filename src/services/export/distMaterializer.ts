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
 * 设计文档：docs/engineering-grade-generation-plan.md 2.1 与文末决议 5
 */

import { assembleFiles, assembleProjectFiles } from '../sandbox/assembler';
import { ENTRY_FILE_PATH } from '../../types/project';
import type { FileNode, ProjectFramework } from '../../types/project';

/** dist 产物在 ZIP 内的固定路径（相对路径，无前导斜杠） */
export const DIST_INDEX_PATH = 'dist/index.html';

/** 物化采用的链路：async = mini-bundler 打包链路；sync = 同步逐文件链路 */
export type DistStrategy = 'async' | 'sync';

export interface DistMaterializeResult {
  /** 物化产物：自包含的单文件 HTML */
  html: string;
  /** 实际采用的链路（诊断用） */
  strategy: DistStrategy;
  /** 组装警告 */
  warnings: string[];
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
    try {
      const bundled = await assembleProjectFiles(files, ENTRY_FILE_PATH, framework);
      return { html: bundled.html, strategy: 'async', warnings: bundled.warnings };
    } catch (error) {
      // 打包链路异常（Sucrase 加载失败等）：回退同步逐文件链路。
      // 同步链路再失败（入口缺失等）则不捕获，由导出服务中止导出
      console.warn('[distMaterializer] 打包链路失败，回退同步组装:', error);
      const sync = assembleFiles(files, ENTRY_FILE_PATH, framework);
      return { html: sync.html, strategy: 'sync', warnings: sync.warnings };
    }
  }

  const sync = assembleFiles(files, ENTRY_FILE_PATH, framework);
  return { html: sync.html, strategy: 'sync', warnings: sync.warnings };
}
