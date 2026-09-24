/**
 * 工程化结构确定性校验器（方案 §5.1，P1 规则集）
 *
 * 零 token，先于/独立于 LLM 审查执行：程序管"存在性与一致性"，
 * 模型管"合理性与品味"。
 *
 * P1 批次 2 变更（真实 import 切换）：
 * - 退役 E_NO_BARE_IMPORT（P0 过渡规则，按移除区设计整体删除）与
 *   E_GLOBAL_REG（§3.4：P1 切换后注册约定校验替换为 import 目标存在性）
 * - 新增 E_IMPORT_MISSING（本地 import resolve 后必须存在于 files 集合）
 * - 新增 E_PKG_DEPS（bare import ⊆ {react, react-dom} 且在 package.json
 *   dependencies 声明）
 *
 * 校验失败的修复路径（llm.ts 接线）：errors 非空 → 带错误清单复用
 * 格式重试通道自动重试一次；仍失败 → 降级交付不阻塞 done。
 */

export interface ValidationIssue {
  /** 规则代码：E_ENTRY / E_SCAFFOLD / E_CDN_DOMAIN / E_INLINE_VOLUME / E_IMPORT_MISSING / E_PKG_DEPS */
  code: string;
  /** 关联文件路径（规则级问题时为 '/'） */
  file: string;
  /** 人话描述（可进入重试提示与用户提示） */
  message: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type Framework = 'html' | 'react-cdn' | 'vue-cdn';

/** 校验输入的最小文件形状（与 FileNode/multiFileParser 产物结构兼容） */
export interface ValidatableFile {
  path: string;
  content: string;
}

/** react/vue 模式要求的三件套（E_SCAFFOLD） */
const SCAFFOLD_FULL = ['/README.md', '/DESIGN.md', '/package.json'] as const;
const SCAFFOLD_HTML = ['/README.md'] as const;

/** 外部资源白名单 CDN 域名（E_CDN_DOMAIN，D-8）：仅 jsdelivr 与 tailwindcss 官方 CDN */
const CDN_WHITELIST_HOSTS: ReadonlySet<string> = new Set(['cdn.jsdelivr.net', 'cdn.tailwindcss.com']);

/** 资源引用形态一：属性赋值 src="..." / href="..."（覆盖 script/link/img/iframe，
 *  以及运行时 el.src = "..." 注入；data-src 懒加载同样命中，运行时仍会请求该域） */
const ATTR_REF_RE = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
/** 资源引用形态二：CSS @import url("...") / @import "..."（字体与外部样式表） */
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?["']([^"')]+)["']/gi;

/** E_INLINE_VOLUME 行阈值（F1）：与 LLM 审查维度 8"单文件超 150 行为缺陷"对齐 */
const INLINE_VOLUME_LINE_LIMIT = 150;

/** E_INLINE_VOLUME 认可的拆分代码文件后缀（存在任一即视为已拆分，不再触发） */
const SPLIT_CODE_FILE_RE = /\.(css|mjs|jsx|ts|tsx|js)$/i;

/** E_IMPORT_MISSING / E_PKG_DEPS 的扫描范围：react-cdn /src 脚本文件 */
const REACT_SRC_SCRIPT_RE = /^\/src\/.+\.(jsx?|mjs|cjs)$/i;

/** E_PKG_DEPS bare 包白名单：与提示词 import 规则、scaffoldDocs 注入的 package.json 一致 */
const PKG_WHITELIST: ReadonlySet<string> = new Set(['react', 'react-dom']);

/** 行数统计：去掉末尾单个换行后按 \n 切分（trailing newline 不多算一行） */
function countLines(content: string): number {
  return content.replace(/\n$/, '').split('\n').length;
}

/**
 * 从资源引用值提取外部域名。
 * 仅认 http(s):// 与协议相对 //host 两种绝对地址形态；
 * 相对路径、锚点、data: URI 一律返回 null（不参与白名单检查）。
 */
function externalHostOf(ref: string): string | null {
  const value = ref.trim();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).hostname.toLowerCase();
    if (value.startsWith('//')) return new URL(`http:${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  return null;
}

/** 提取文件内容中所有非白名单的外部资源域名（每域名去重） */
function collectOffWhitelistHosts(content: string): string[] {
  const hosts = new Set<string>();
  for (const re of [ATTR_REF_RE, CSS_IMPORT_RE]) {
    re.lastIndex = 0; // 全局正则复用需重置游标
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const host = externalHostOf(m[1] ?? '');
      if (host && !CDN_WHITELIST_HOSTS.has(host)) hosts.add(host);
    }
  }
  return [...hosts];
}

// ═══ import 扫描与解析（对齐 src/services/sandbox/importScanner.ts 语义）═══
// 服务端独立实现（server 构建不依赖 src/），正则与候选扩展规则保持一致，
// 两端口径漂移时以 importScanner.ts 为准同步。

/** 保守剥离注释（块注释 + 行首注释），避免注释中的伪 import 参与校验（同 importScanner.stripComments） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)([ \t]*)\/\/[^\n]*/g, (_match, newline: string, indent: string) => `${newline}${indent}`);
}

/** 扫描全部模块说明符：import/from、副作用 import、export...from、动态 import()（同 importScanner.scanImportSpecifiers） */
function scanImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
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

/** 取模块路径的目录部分（'/src/a/App.jsx' -> '/src/a'）（同 importScanner.dirnameOf） */
function dirnameOf(modulePath: string): string {
  const idx = modulePath.lastIndexOf('/');
  return idx > 0 ? modulePath.substring(0, idx) : '';
}

/** 以 dir 为基准拼接说明符并归一化（处理 ./ 与 ../ 段），返回以 / 开头的路径（同 importScanner.normalizeJoin） */
function normalizeJoin(dir: string, specifier: string): string {
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

/** 扩展名候选推断（同 importScanner.expandCandidates：精确 -> .js -> .jsx -> /index.js -> /index.jsx，.js 改判 .jsx） */
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

type SpecResolution =
  | { kind: 'local'; path: string }
  | { kind: 'css' }
  | { kind: 'bare'; packageName: string }
  | { kind: 'missing'; resolved: string };

/**
 * 解析一条说明符（对齐 importScanner.resolveImportSpecifier 的四类结果；
 * bare 统一返回包名，白名单判断交给 E_PKG_DEPS）。
 */
function resolveSpecifier(specifier: string, fromModulePath: string, known: ReadonlySet<string>): SpecResolution {
  if (/\.css(\?.*)?$/i.test(specifier)) {
    // CSS 导入由前端模块运行时 no-op（哨兵模块），提示词层禁止但不算断链
    return { kind: 'css' };
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const base = normalizeJoin(dirnameOf(fromModulePath), specifier);
    const hit = expandCandidates(base, known);
    return hit ? { kind: 'local', path: hit } : { kind: 'missing', resolved: base };
  }
  if (specifier.startsWith('/')) {
    const hit = expandCandidates(specifier, known);
    return hit ? { kind: 'local', path: hit } : { kind: 'missing', resolved: normalizeJoin('', specifier) };
  }
  // bare（含 @scope/pkg 与子路径）：取包名段（'react-dom/client' -> 'react-dom'）
  const segments = specifier.startsWith('@') ? specifier.split('/').slice(0, 2) : specifier.split('/').slice(0, 1);
  return { kind: 'bare', packageName: segments.join('/') };
}

/** 校验作用域选项：注入保证类规则仅在 create 全量流水线强制（存量项目兼容） */
export interface ValidateOptions {
  /** 强制 E_SCAFFOLD（仅 create 全量流水线注入三件套，注入回归兜底才有意义） */
  enforceScaffold?: boolean;
  /** E_CDN_DOMAIN 扫描范围：仅检查这些路径；缺省扫描全部文件。
   *  迭代/修复场景应传入本次 LLM 实际产出的路径，避免存量项目的
   *  历史外部引用阻塞每次重试（误报面控制，D-8） */
  cdnScanPaths?: string[];
  /** 强制 E_INLINE_VOLUME（F1，html 单文件体量）：与 scaffold 同属注入保证类
   *  规则，仅 create 全量流水线强制；存量单文件项目 modify 不误报 */
  enforceInlineVolume?: boolean;
}

/**
 * 校验项目结构。
 * @param files 交付前的最终文件集合（create 流水线先注入三件套再校验）
 * @param framework 目标框架
 * @param options 规则作用域（缺省全开；modify/diff 场景由调用方关闭注入保证类规则，
 *                避免存量项目因无 README 被误报。E_IMPORT_MISSING / E_PKG_DEPS 恒开：
 *                P0 之前存量项目无 import，不会误报，而 diff 行级编辑恰是 import
 *                幻觉的高发入口）
 */
export function validateProject(
  files: Record<string, ValidatableFile>,
  framework: Framework,
  options?: ValidateOptions,
): ValidationResult {
  const enforceScaffold = options?.enforceScaffold ?? true;
  const enforceInlineVolume = options?.enforceInlineVolume ?? true;
  const cdnScanPaths = options?.cdnScanPaths;
  const errors: ValidationIssue[] = [];

  // E_ENTRY：入口存在且非空（parser 有兜底，此处双保险）
  const entry = files['/index.html'];
  if (!entry || !entry.content || entry.content.trim().length === 0) {
    errors.push({
      code: 'E_ENTRY',
      file: '/index.html',
      message: '缺少入口文件 /index.html 或内容为空',
    });
  }

  // E_SCAFFOLD：三件套存在且非空（服务端注入保证，此处兜底防注入回归）
  if (enforceScaffold) {
    const required = framework === 'html' ? SCAFFOLD_HTML : SCAFFOLD_FULL;
    for (const path of required) {
      const file = files[path];
      if (!file || !file.content || file.content.trim().length === 0) {
        errors.push({
          code: 'E_SCAFFOLD',
          file: path,
          message: `缺少平台注入文件 ${path} 或内容为空`,
        });
      }
    }
  }

  // E_CDN_DOMAIN：外部资源引用仅允许白名单 CDN（D-8，确定性零 token 兜底，
  // 弥补 LLM 审查在资源合规维度的盲区；违规走既有校验重试通道让模型换 jsdelivr）
  for (const [path, file] of Object.entries(files)) {
    if (cdnScanPaths && !cdnScanPaths.includes(path)) continue;
    for (const host of collectOffWhitelistHosts(file.content)) {
      errors.push({
        code: 'E_CDN_DOMAIN',
        file: path,
        message: `引用了非白名单 CDN 域名 ${host}（外部资源仅允许 cdn.jsdelivr.net 与 cdn.tailwindcss.com），请改用 jsdelivr 上的等价资源`,
      });
    }
  }

  // E_INLINE_VOLUME（F1）：html 入口单文件超行阈值且未拆分 → 确定性打回。
  // 与 LLM 审查维度 8（单文件超 150 行为缺陷）对齐，把最典型的"全部塞进
  // index.html"生成习惯在零 token 层拦截；真实事故样本：731 行单文件计算器。
  // 拆分指引：样式与脚本拆出为 /styles/main.css 与 /src/main.js，入口用
  // <link> / <script src> 引用，仅保留结构标记。已存在任一拆分代码文件时
  // 不触发（拆分形态由审查维度把关，此处只拦"零拆分"的极端形态）
  if (framework === 'html' && enforceInlineVolume && entry && entry.content.trim().length > 0) {
    const hasSplitCodeFile = Object.entries(files).some(
      ([path, file]) => path !== '/index.html' && SPLIT_CODE_FILE_RE.test(path) && file.content.trim().length > 0
    );
    const lineCount = countLines(entry.content);
    if (!hasSplitCodeFile && lineCount > INLINE_VOLUME_LINE_LIMIT) {
      errors.push({
        code: 'E_INLINE_VOLUME',
        file: '/index.html',
        message: `单文件 ${lineCount} 行超过 ${INLINE_VOLUME_LINE_LIMIT} 行且未拆分：请把样式与脚本拆出为 /styles/main.css 与 /src/main.js（index.html 用 <link> 与 <script src> 引用），入口仅保留结构标记`,
      });
    }
  }

  // E_IMPORT_MISSING + E_PKG_DEPS（P1，react-cdn 恒开）：
  // 真实 ESM import 的一致性校验——本地导入 resolve 后必须存在于 files 集合，
  // bare 导入仅允许白名单包且须在 package.json dependencies 声明。
  // 提示词要求"路径与生成文件路径完全一致（含扩展名）"，resolve 侧与前端
  // mini-bundler 同口径做扩展名候选兜底（写不完整路径能跑通预览，不误报）；
  // 拼错文件名/删除后悬空引用则确定性拦截，走既有校验重试通道自愈
  if (framework === 'react-cdn') {
    const known = new Set(Object.keys(files));
    const pkgJsonRaw = files['/package.json']?.content;
    let declaredDeps: ReadonlySet<string> = new Set();
    if (pkgJsonRaw) {
      try {
        const deps = JSON.parse(pkgJsonRaw)?.dependencies;
        declaredDeps = new Set(
          deps && typeof deps === 'object' && !Array.isArray(deps) ? Object.keys(deps) : []
        );
      } catch {
        // package.json 不可解析：E_SCAFFOLD/后续流程已兜底，此处按零声明处理
        declaredDeps = new Set();
      }
    }

    const importMissingFiles = new Set<string>();
    const pkgViolations = new Map<string, { file: string; reason: 'whitelist' | 'undeclared' }>();

    for (const [path, file] of Object.entries(files)) {
      if (!REACT_SRC_SCRIPT_RE.test(path)) continue;
      for (const spec of scanImportSpecifiers(file.content)) {
        const resolution = resolveSpecifier(spec, path, known);
        if (resolution.kind === 'local') continue;
        if (resolution.kind === 'css') continue;
        if (resolution.kind === 'missing') {
          importMissingFiles.add(path);
          errors.push({
            code: 'E_IMPORT_MISSING',
            file: path,
            message: `import 的本地模块 ${spec} 不存在（resolve 为 ${resolution.resolved}，不在项目文件中）。请检查 import 路径拼写：路径必须与生成文件路径完全一致（含扩展名）`,
          });
          continue;
        }
        // bare：白名单 + 声明检查（每包只报一次，取首次出现的文件定位）
        if (PKG_WHITELIST.has(resolution.packageName)) {
          if (!declaredDeps.has(resolution.packageName) && !pkgViolations.has(resolution.packageName)) {
            pkgViolations.set(resolution.packageName, { file: path, reason: 'undeclared' });
          }
        } else if (!pkgViolations.has(resolution.packageName)) {
          pkgViolations.set(resolution.packageName, { file: path, reason: 'whitelist' });
        }
      }
    }

    for (const [packageName, violation] of pkgViolations) {
      errors.push({
        code: 'E_PKG_DEPS',
        file: violation.file,
        message:
          violation.reason === 'whitelist'
            ? `import 了白名单外的包 ${packageName}（bare import 仅允许 react 与 react-dom；图表库等三方库经 index.html 的 CDN script 引入后用全局变量，禁止 import）`
            : `${packageName} 未在 /package.json 的 dependencies 中声明（bare import 必须与 dependencies 声明一致）`,
      });
    }
  }

  return { errors, warnings: [] };
}
