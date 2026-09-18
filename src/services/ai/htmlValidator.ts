/**
 * 程序化 HTML 硬校验（确定性，先于 LLM 审查执行）。
 * 规则来源：docs/tech-ai-pipeline.md 1.4 与第 5 节：DOCTYPE / html / body 完整、
 * script 与 style 闭合、内联脚本可编译、长度边界、CDN 白名单。
 * 校验不通过时产出的 issues 直接作为工程师修复轮的 repairInstructions 使用，
 * 因此 message 一律写成「指明改哪里、怎么改」的中文修复指令。
 */
import { DEFAULT_CDN_HOSTS } from '../../types/sandbox';

export interface HtmlValidationIssue {
  /** 校验项标识：structure / script / style / syntax / length / cdn / chart / responsive */
  check: 'structure' | 'script' | 'style' | 'syntax' | 'length' | 'cdn' | 'chart' | 'responsive';
  /** 面向工程师的中文修复指令 */
  message: string;
}

export interface HtmlValidationResult {
  ok: boolean;
  issues: HtmlValidationIssue[];
}

const MIN_HTML_LENGTH = 500;
const MAX_HTML_LENGTH = 400_000;

const CDN_HOST_HINT = DEFAULT_CDN_HOSTS.join('、');

/** 允许生成代码引用的绝对地址主机白名单，与沙箱预览 CSP 共用同一真源 */
export const ALLOWED_CDN_HOSTS: readonly string[] = DEFAULT_CDN_HOSTS;

export function validateGeneratedHtml(html: string): HtmlValidationResult {
  const issues: HtmlValidationIssue[] = [];
  const push = (check: HtmlValidationIssue['check'], message: string): void => {
    issues.push({ check, message });
  };

  const trimmed = html.trim();

  if (trimmed.length < MIN_HTML_LENGTH) {
    push('length', `HTML 内容过短（不足 ${MIN_HTML_LENGTH} 字符），疑似未完整生成，请输出完整应用`);
  }
  if (trimmed.length > MAX_HTML_LENGTH) {
    push('length', `HTML 超出长度上限（${MAX_HTML_LENGTH} 字符），请精简样式与脚本后重新输出`);
  }
  if (!/^<!doctype html>/i.test(trimmed)) {
    push('structure', '第一行必须是 <!DOCTYPE html> 声明，请在其前不要输出任何其他文字');
  }
  if (!/<html[\s>]/i.test(trimmed)) {
    push('structure', '缺少 <html> 起始标签，请补全文档结构');
  }
  if (!/<\/html>\s*$/i.test(trimmed)) {
    push('structure', '文档必须以 </html> 结尾，当前结尾异常，内容可能被截断，请完整重新输出');
  }
  if (!/<head[\s>]/i.test(trimmed)) {
    push('structure', '缺少 <head> 标签，请补全文档结构');
  }
  if (!/<body[\s>]/i.test(trimmed) || !/<\/body>/i.test(trimmed)) {
    push('structure', '缺少完整的 <body></body> 标签，请补全文档结构');
  }

  const openScriptCount = countMatches(trimmed, /<script\b/gi);
  const closeScriptCount = countMatches(trimmed, /<\/script>/gi);
  if (openScriptCount === 0) {
    push('script', '未发现任何 <script> 脚本，应用将没有交互，请为功能清单中的 must 功能补充脚本实现');
  }
  if (openScriptCount !== closeScriptCount) {
    push('script', `<script> 标签未闭合：出现 ${openScriptCount} 个起始标签、${closeScriptCount} 个闭合标签，请逐一检查补全 </script>`);
  }

  const openStyleCount = countMatches(trimmed, /<style\b/gi);
  const closeStyleCount = countMatches(trimmed, /<\/style>/gi);
  if (openStyleCount !== closeStyleCount) {
    push('style', `<style> 标签未闭合：出现 ${openStyleCount} 个起始标签、${closeStyleCount} 个闭合标签，请补全 </style>`);
  }

  validateCdnWhitelist(trimmed, push);

  validateInlineScripts(trimmed, push);

  validateChartSetup(trimmed, push);

  validateResponsiveLayout(trimmed, push);

  return { ok: issues.length === 0, issues };
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function validateCdnWhitelist(
  html: string,
  push: (check: HtmlValidationIssue['check'], message: string) => void,
): void {
  const offenders = new Set<string>();
  const attrPattern = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(attrPattern)) {
    const url = match[1] ?? match[2] ?? '';
    collectOffendingHost(url, offenders);
  }
  // CSS @import 的两种写法：@import url(...) 与 @import "..."
  const importUrlPattern = /@import\s+url\(\s*['"]?([^'")]+)/gi;
  for (const match of html.matchAll(importUrlPattern)) {
    collectOffendingHost(match[1] ?? '', offenders);
  }
  const importPlainPattern = /@import\s+(['"])([^'"]+)\1/gi;
  for (const match of html.matchAll(importPlainPattern)) {
    collectOffendingHost(match[2] ?? '', offenders);
  }
  if (offenders.size > 0) {
    push(
      'cdn',
      `引用了白名单外的外部资源：${[...offenders].join('、')}。白名单仅允许 ${CDN_HOST_HINT}，请移除或改为内联`,
    );
  }
}

function collectOffendingHost(rawUrl: string, offenders: Set<string>): void {
  const url = rawUrl.trim();
  if (!/^(?:https?:)?\/\//i.test(url)) {
    return; // 相对路径与内联 data 地址不受白名单约束
  }
  const normalized = /^(?:https?:)?\/\//i.test(url) && url.startsWith('//') ? `https:${url}` : url;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    if (!ALLOWED_CDN_HOSTS.includes(host)) {
      offenders.add(host);
    }
  } catch {
    offenders.add(url.slice(0, 60));
  }
}

/** 抽取内联 <script>（无 src 属性）内容，逐段做语法编译检查（不执行） */
function validateInlineScripts(
  html: string,
  push: (check: HtmlValidationIssue['check'], message: string) => void,
): void {
  const scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let index = 0;
  for (const match of html.matchAll(scriptPattern)) {
    index += 1;
    const attrs = match[1] ?? '';
    const code = match[2] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) {
      continue;
    }
    if (code.trim().length === 0) {
      continue;
    }
    try {
      // 仅编译不执行：捕获语法错误，引用不存在的 DOM 交给 LLM 审查兜底
      new Function(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      push('syntax', `第 ${index} 段内联脚本存在语法错误（${message}），请修正后重新输出完整 HTML`);
    }
  }
}

/**
 * 校验 Chart.js / ECharts 引用格式：
 * 1. 必须从 cdn.jsdelivr.net 引入库文件
 * 2. 如果使用了 new Chart() 或 echarts.init()，必须有对应的 <canvas> 元素
 */
function validateChartSetup(
  html: string,
  push: (check: HtmlValidationIssue['check'], message: string) => void,
): void {
  const hasChartJs = /new\s+Chart\s*\(/gi.test(html);
  const hasECharts = /echarts\s*\.\s*init\s*\(/gi.test(html);

  if (!hasChartJs && !hasECharts) {
    return; // 没有图表代码，无需校验
  }

  // 检查是否有对应的库引入
  const hasChartJsCdn = /cdn\.jsdelivr\.net\/npm\/chart\.js/gi.test(html);
  const hasEChartsCdn = /cdn\.jsdelivr\.net\/npm\/echarts/gi.test(html);

  if (hasChartJs && !hasChartJsCdn) {
    push('chart', '使用了 Chart.js 但未从 cdn.jsdelivr.net 引入库文件。请在 <head> 中添加：<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>');
  }

  if (hasECharts && !hasEChartsCdn) {
    push('chart', '使用了 ECharts 但未从 cdn.jsdelivr.net 引入库文件。请在 <head> 中添加：<script src="https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js"></script>');
  }

  // 检查是否有 canvas 元素
  const hasCanvas = /<canvas\b[^>]*>/gi.test(html);
  if (hasChartJs && !hasCanvas) {
    push('chart', 'Chart.js 需要 <canvas> 元素渲染图表。请在 HTML 中添加：<canvas id="myChart"></canvas>，并在脚本中通过 getElementById 获取');
  }

  // ECharts 需要一个容器元素（通常是 div）
  if (hasECharts) {
    const hasContainer = /<div\b[^>]*id\s*=\s*["'][^"']+["']/gi.test(html);
    if (!hasContainer) {
      push('chart', 'ECharts 需要一个带 id 的容器元素。请在 HTML 中添加：<div id="chart" style="width: 600px; height: 400px;"></div>');
    }
  }
}

/**
 * 校验响应式布局：
 * 1. 检查是否有 viewport meta 标签
 * 2. 检查是否使用了响应式单位或 media query
 */
function validateResponsiveLayout(
  html: string,
  push: (check: HtmlValidationIssue['check'], message: string) => void,
): void {
  // 检查 viewport meta
  const hasViewport = /<meta\s+name\s*=\s*["']viewport["'][^>]*>/gi.test(html);
  if (!hasViewport) {
    push('responsive', '缺少 viewport meta 标签。请在 <head> 中添加：<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }

  // 检查是否使用了响应式单位（rem、vw、vh、%）或 media query
  const hasResponsiveUnits = /\b(?:rem|vw|vh|%\s*(?:width|height))\b/gi.test(html);
  const hasMediaQuery = /@media\b/gi.test(html);
  const hasFlexOrGrid = /\b(?:flex|grid)\b/gi.test(html);
  const hasMaxWidth = /max-width\s*:/gi.test(html);

  // 如果没有响应式特征，发出警告（不是错误，因为某些简单应用不需要）
  if (!hasResponsiveUnits && !hasMediaQuery && !hasFlexOrGrid && !hasMaxWidth) {
    push('responsive', '布局可能不是响应式的。建议使用 flex/grid 布局、响应式单位（rem/vw/vh）或 @media 查询，确保在移动端也能正常显示');
  }
}
