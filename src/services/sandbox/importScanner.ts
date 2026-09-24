/**
 * 模块导入扫描与说明符解析（mini-bundler 地基，路线 B）。
 *
 * 职责：
 * - 从源码中扫描全部模块说明符（import / re-export / 动态 import）
 * - 将说明符解析为四类目标：本地模块 / bare shim / CSS no-op / 缺失
 * - 检测 import.meta 等浏览器内编译不支持的语法
 *
 * 全部为纯字符串变换，vitest 可完整覆盖。
 * 说明：正则扫描对"注释中的伪 import"做保守剥离（行首注释与块注释），
 * 字符串字面量中的伪 import 存在误报可能，代价是多余依赖边，不影响正确性。
 */

import { getBareShimBody } from './bareImportShims';

/** 说明符解析结果 */
export type SpecifierResolution =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'shim'; readonly specifier: string }
  | { readonly kind: 'css' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unknown-bare' };

/**
 * 保守剥离注释（块注释 + 行首注释），避免注释中的伪 import 参与依赖扫描。
 * 不处理"代码后跟行注释"的形态（const a = 1; // import x from 'y'），
 * 该形态中注释若含 import 会产生多余依赖边，属可接受的误报方向。
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)([ \t]*)\/\/[^\n]*/g, (_match, newline: string, indent: string) => `${newline}${indent}`);
}

/**
 * 扫描源码中全部模块说明符（去重，保持出现顺序）。
 * 覆盖：import ... from、副作用 import、export ... from、动态 import('...')。
 */
export function scanImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  // 关键字前不能是引号/标识符/属性访问（规避字符串字面量中的伪 import）；
  // from 前的间隔不得跨越引号或分号（防止吞并后续语句、误吃字符串里的 from）
  const patterns: RegExp[] = [
    /(?<!["'`$.])\bimport\b(?:[^;'"]*?\bfrom\b)?\s*["']([^"'\n]+)["']/g,
    /(?<!["'`$.])\bexport\b[^;'"]*?\bfrom\b\s*["']([^"'\n]+)["']/g,
    /(?<!["'`$.])\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) {
      const spec = m[1];
      if (spec && !seen.has(spec)) {
        seen.add(spec);
        result.push(spec);
      }
    }
  }
  return result;
}

/** 检测 import.meta 语法（imports transform 不支持，会原样保留导致运行时语法错误） */
export function containsImportMeta(source: string): boolean {
  return /(?<!["'`$.])\bimport\s*\.\s*meta\b/.test(stripComments(source));
}

/** 取模块路径的目录部分（'/src/a/App.jsx' -> '/src/a'） */
export function dirnameOf(modulePath: string): string {
  const idx = modulePath.lastIndexOf('/');
  return idx > 0 ? modulePath.substring(0, idx) : '';
}

/** 以 dir 为基准目录拼接说明符并归一化（处理 ./ 与 ../ 段），返回以 / 开头的路径 */
export function normalizeJoin(dir: string, specifier: string): string {
  const parts = dir.split('/').filter(Boolean);
  for (const seg of specifier.split('/')) {
    if (seg === '..') {
      parts.pop();
    } else if (seg !== '.' && seg !== '') {
      parts.push(seg);
    }
  }
  return '/' + parts.join('/');
}

/**
 * 扩展名候选推断（对齐 bundler 惯例）：
 * 精确路径 -> +.js -> +.jsx -> .js 后缀改判 .jsx -> /index.js -> /index.jsx
 */
function expandCandidates(base: string, known: ReadonlySet<string>): string | null {
  const candidates: string[] = [base, `${base}.js`, `${base}.jsx`, base + '/index.js', base + '/index.jsx'];
  if (/\.js$/i.test(base)) {
    candidates.push(base.slice(0, -3) + '.jsx');
  }
  for (const candidate of candidates) {
    if (known.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * 解析一条模块说明符。
 * @param specifier 原始说明符（如 './utils/math'、'react'、'/src/App.jsx'）
 * @param fromModulePath 发起 import 的模块绝对路径（相对说明符以其所在目录为基准）
 * @param knownFiles 项目全部文件绝对路径集合
 */
export function resolveImportSpecifier(
  specifier: string,
  fromModulePath: string,
  knownFiles: readonly string[]
): SpecifierResolution {
  if (/\.css(\?.*)?$/i.test(specifier)) {
    return { kind: 'css' };
  }
  const known = new Set(knownFiles);
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const base = normalizeJoin(dirnameOf(fromModulePath), specifier);
    const hit = expandCandidates(base, known);
    return hit ? { kind: 'local', path: hit } : { kind: 'missing' };
  }
  if (specifier.startsWith('/')) {
    const hit = expandCandidates(specifier, known);
    return hit ? { kind: 'local', path: hit } : { kind: 'missing' };
  }
  if (getBareShimBody(specifier) !== null) {
    return { kind: 'shim', specifier };
  }
  return { kind: 'unknown-bare' };
}
