/**
 * 浏览器内 mini-bundler 核心（路线 B，见 docs/preview-runtime-assessment.md 3.2、
 * docs/engineering-grade-generation-plan.md 3.3 方案 C）。
 *
 * 编译链（S1 实测定型）：
 *   ESM 源码 -> Sucrase transforms ['jsx','imports']（classic JSX runtime）
 *   -> require 说明符改写为绝对路径（本地）/ CSS 哨兵 / bare 原文（shim 查表）
 *   -> __defineModule 注册（拓扑序，依赖在前）-> 入口 __requireModule 启动
 *
 * 全流程为纯字符串变换 + 逐模块语法校验，vitest 完整覆盖；
 * 任何失败都返回结构化错误（文案可直接喂给 AI 修复循环），不抛异常。
 */

import type { BundleModuleFile, BundleOptions, BundleResult, ModuleBundleError } from './bundlerTypes';
import { ModuleBundleErrorCode } from './bundlerTypes';
import { containsJsx } from './jsxCompiler';
import {
  containsImportMeta,
  resolveImportSpecifier,
  scanImportSpecifiers,
} from './importScanner';
import { BARE_IMPORT_SPECIFIERS, CSS_MODULE_SENTINEL } from './bareImportShims';
import { assembleBundleScript, generateModuleRuntimeScript } from './moduleRuntime';

/** Sucrase 编译器（npm 依赖，编译在父页面执行；动态加载避免进首屏 bundle） */
type SucraseTransform = typeof import('sucrase').transform;
let sucraseTransform: SucraseTransform | null = null;

async function loadSucraseTransform(): Promise<SucraseTransform> {
  if (!sucraseTransform) {
    const mod = await import('sucrase');
    sucraseTransform = mod.transform;
  }
  return sucraseTransform;
}

/** 已解析的单模块计划 */
interface ModulePlan {
  readonly path: string;
  /** 编译产物中 require 说明符改写表：原始说明符 -> 替换字面量 */
  readonly rewriteMap: ReadonlyMap<string, string>;
}

/** 构建单一模块：检测不支持语法 -> 注入 React -> Sucrase 编译 -> 说明符改写 -> 语法校验 */
async function buildModuleBody(
  plan: ModulePlan,
  files: ReadonlyMap<string, string>,
  transformCode: SucraseTransform
): Promise<{ body: string; reactInjected: boolean } | { error: ModuleBundleError }> {
  const source = files.get(plan.path) as string;

  if (containsImportMeta(source)) {
    return {
      error: {
        code: ModuleBundleErrorCode.UnsupportedSyntax,
        message: `不支持 import.meta 语法（浏览器内编译限制），文件: ${plan.path}。请移除对 import.meta 的使用。`,
        modulePath: plan.path,
      },
    };
  }

  const prepared = maybeInjectReactImport(plan.path, source);
  const reactInjected = prepared !== source;

  let compiled: string;
  try {
    compiled = transformCode(prepared, {
      transforms: ['jsx', 'imports'],
      jsxRuntime: 'classic',
      production: true,
      filePath: plan.path,
    }).code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        code: ModuleBundleErrorCode.TransformFailed,
        message: `模块编译失败: ${plan.path}（${message}）。请检查该文件语法是否正确。`,
        modulePath: plan.path,
      },
    };
  }

  const rewritten = rewriteRequireSpecifiers(compiled, plan.rewriteMap);

  // 语法校验：Sucrase 不改写顶层 await 等不兼容语法，留到运行时会让整个 bundle
  // 解析失败（全量白屏）。在构建期用 Function 构造器逐模块验证，把问题定位到单文件。
  try {
    new Function('module', 'exports', 'require', rewritten);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        code: ModuleBundleErrorCode.IncompatibleSyntax,
        message: `模块包含不兼容语法（如顶层 await，CJS 包装内不可用）: ${plan.path}（${message}）。请将顶层 await 改为 async 函数内的 await。`,
        modulePath: plan.path,
      },
    };
  }

  return { body: rewritten, reactInjected };
}

/**
 * 自动注入 import React（Vite 惯例）。
 * 跳过：已有 react import、本地声明 React 的文件。
 * 注入仅对含 JSX（启发式）或 .jsx 文件生效；多注入无害（unused require）。
 * 双保险：未注入的文件若 JSX 引用裸 React 标识符，classic runtime 回落全局 window.React。
 */
export function maybeInjectReactImport(path: string, content: string): string {
  const isJsxFile = /\.jsx$/i.test(path);
  if (!isJsxFile && !containsJsx(content)) {
    return content;
  }
  const hasReactImport = /\bimport\s+[^;\n]*\bfrom\s*["']react["']/.test(content)
    || /\bimport\s*\(\s*["']react["']/.test(content)
    || /\brequire\s*\(\s*["']react["']\)/.test(content);
  if (hasReactImport) {
    return content;
  }
  const hasLocalReact = /\b(?:const|let|var)\s+React\b/.test(content);
  if (hasLocalReact) {
    return content;
  }
  return `import React from 'react';\n${content}`;
}

/** 按改写表替换编译产物中的 require 调用说明符（仅命中扫描所得说明符，误伤面极小） */
export function rewriteRequireSpecifiers(compiled: string, rewriteMap: ReadonlyMap<string, string>): string {
  if (rewriteMap.size === 0) {
    return compiled;
  }
  return compiled.replace(/\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g, (match, _quote: string, spec: string) => {
    const replacement = rewriteMap.get(spec);
    return replacement !== undefined ? `require(${replacement})` : match;
  });
}

/** 从入口 DFS（后序：依赖在前）构建全部模块计划；环在此阶段不致命（CJS 惰性语义承接） */
function planDependencyGraph(
  entryPath: string,
  files: ReadonlyMap<string, string>
): { plans: ModulePlan[] } | { error: ModuleBundleError } {
  const knownFiles = Array.from(files.keys());
  const plans: ModulePlan[] = [];
  const planned = new Set<string>();
  const visiting = new Set<string>();

  function visit(path: string): ModuleBundleError | null {
    if (planned.has(path)) {
      return null;
    }
    if (visiting.has(path)) {
      return null;
    }
    visiting.add(path);
    const source = files.get(path) as string;
    const rewriteMap = new Map<string, string>();
    const specs = scanImportSpecifiers(source);

    for (const spec of specs) {
      const resolution = resolveImportSpecifier(spec, path, knownFiles);
      switch (resolution.kind) {
        case 'local':
          rewriteMap.set(spec, JSON.stringify(resolution.path));
          break;
        case 'css':
          rewriteMap.set(spec, JSON.stringify(CSS_MODULE_SENTINEL));
          break;
        case 'shim':
          // bare 原文保留，运行时查 shim 表
          break;
        case 'missing':
          return {
            code: ModuleBundleErrorCode.ModuleNotFound,
            message: `模块不存在: ${spec}（从 ${path} 解析）。检查 import 拼写与大小写，或先创建该文件。`,
            modulePath: path,
            specifier: spec,
          };
        case 'unknown-bare':
          return {
            code: ModuleBundleErrorCode.UnknownBareImport,
            message: `不支持的依赖: "${spec}"（在 ${path} 中 import）。当前沙箱仅支持以下依赖: ${BARE_IMPORT_SPECIFIERS.join(', ')}（经 CDN 全局提供）。请改用以上白名单依赖，或去掉该 import 自行实现。`,
            modulePath: path,
            specifier: spec,
          };
      }
    }

    for (const spec of specs) {
      const resolution = resolveImportSpecifier(spec, path, knownFiles);
      if (resolution.kind === 'local') {
        const depError = visit(resolution.path);
        if (depError) {
          return depError;
        }
      }
    }

    visiting.delete(path);
    planned.add(path);
    plans.push({ path, rewriteMap });
    return null;
  }

  const error = visit(entryPath);
  if (error) {
    return { error };
  }
  return { plans };
}

/**
 * 核心 bundler（可能返回错误，不抛业务异常；对外入口是 tryBundleModules）。
 */
export async function bundleModules(files: readonly BundleModuleFile[], entryPath: string, _options: BundleOptions = {}): Promise<BundleResult> {
  const transformCode = await loadSucraseTransform();

  const fileMap = new Map<string, string>();
  for (const file of files) {
    fileMap.set(file.path, file.content);
  }

  if (!fileMap.has(entryPath)) {
    const sample = Array.from(fileMap.keys()).slice(0, 8).join(', ');
    return {
      ok: false,
      error: {
        code: ModuleBundleErrorCode.EntryMissing,
        message: `入口文件不存在: ${entryPath}（项目文件: ${sample}${fileMap.size > 8 ? ' ...' : ''}）。请确认入口路径。`,
      },
    };
  }

  const graph = planDependencyGraph(entryPath, fileMap);
  if ('error' in graph) {
    return { ok: false, error: graph.error };
  }

  const warnings: string[] = [];
  const entries: { path: string; body: string }[] = [];
  for (const plan of graph.plans) {
    const result = await buildModuleBody(plan, fileMap, transformCode);
    if ('error' in result) {
      return { ok: false, error: result.error };
    }
    if (result.reactInjected) {
      warnings.push(`已自动注入 import React: ${plan.path}`);
    }
    entries.push({ path: plan.path, body: result.body });
  }

  const script = assembleBundleScript(generateModuleRuntimeScript(), entries, entryPath);
  return { ok: true, script, modulePaths: graph.plans.map((p) => p.path), warnings };
}

/**
 * 对外安全入口：任何异常（含 Sucrase 加载失败）都收敛为结构化错误，绝不抛出。
 */
export async function tryBundleModules(files: readonly BundleModuleFile[], entryPath: string, options: BundleOptions = {}): Promise<BundleResult> {
  try {
    return await bundleModules(files, entryPath, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: ModuleBundleErrorCode.Internal,
        message: `模块打包器内部错误: ${message}`,
      },
    };
  }
}
