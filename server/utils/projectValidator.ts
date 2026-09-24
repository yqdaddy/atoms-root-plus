/**
 * 工程化结构确定性校验器（方案 §5.1，P0 三规则子集）
 *
 * 零 token，先于/独立于 LLM 审查执行：程序管"存在性与一致性"，
 * 模型管"合理性与品味"。P1 扩展 import 断链、依赖一致性等规则。
 *
 * 校验失败的修复路径（llm.ts 接线）：errors 非空 → 带错误清单复用
 * 格式重试通道自动重试一次；仍失败 → 降级交付不阻塞 done。
 */

export interface ValidationIssue {
  /** 规则代码：E_ENTRY / E_SCAFFOLD / E_GLOBAL_REG / E_CDN_DOMAIN / E_INLINE_VOLUME / E_NO_BARE_IMPORT（P1 扩展） */
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

/** 校验作用域选项：注入保证类规则仅在 create 全量流水线强制（存量项目兼容） */
export interface ValidateOptions {
  /** 强制 E_SCAFFOLD（仅 create 全量流水线注入三件套，注入回归兜底才有意义） */
  enforceScaffold?: boolean;
  /** 强制 E_GLOBAL_REG（存量 react 项目无注册约定，仅对新 create 项目强制） */
  enforceGlobalReg?: boolean;
  /** E_CDN_DOMAIN 扫描范围：仅检查这些路径；缺省扫描全部文件。
   *  迭代/修复场景应传入本次 LLM 实际产出的路径，避免存量项目的
   *  历史外部引用阻塞每次重试（误报面控制，D-8） */
  cdnScanPaths?: string[];
  /** 强制 E_INLINE_VOLUME（F1，html 单文件体量）：与 scaffold 同属注入保证类
   *  规则，仅 create 全量流水线强制；存量单文件项目 modify 不误报 */
  enforceInlineVolume?: boolean;
}

// ═══ E_NO_BARE_IMPORT（P0 过渡规则，一键移除区开始）═══
//
// 【存在理由】CDN 直行模式没有打包器，浏览器无法解析裸 ESM import/export；
// P0 约定是全局挂载（组件 window.__components.组件名 = 组件名，工具函数
// window.__hooks.xxx / window.__utils.xxx）。模型幻觉出 import/export 时
// 必须确定性打回（LLM 审查对这类硬伤不稳定），走既有校验重试通道自愈。
//
// 【作用域论证（为何不挂 enforceP0、diff 路径纳入）】
// 1. P0 过渡期内所有平台生成项目（含 modify 的存量项目）均无 import——
//    平台从未产出过带 import 的项目，常开无误报面；
// 2. diff 行级编辑恰是 import 幻觉的高发入口（模型按 npm 习惯补 import），
//    不纳入就漏掉最主要的违规面；
// 3. 恒开让"一键移除"语义最干净：无需在调用方维护作用域开关字段。
//
// 【移除方式（P1 批次 2 切真实 ESM / importmap 后）】
// 删除下方 validateNoBareImport 函数与 validateProject 内的调用块即可，
// 无选项字段残留、无调用方改动。
//
// ═══ E_NO_BARE_IMPORT（一键移除区结束）═══

/** 裸 ESM import/export 语句（行首，允许缩进；CDN 直行模式不可用） */
const BARE_IMPORT_EXPORT_RE = /^[ \t]*(?:import|export)[ \t]/m;

/** react-cdn /src 脚本文件（.js/.jsx/.mjs/.cjs） */
const REACT_SRC_SCRIPT_RE = /^\/src\/.+\.(jsx?|mjs|cjs)$/i;

/**
 * 校验 react-cdn /src 脚本文件不含裸 import/export（P0 过渡规则，见上方移除区注释）。
 */
export function validateNoBareImport(files: Record<string, ValidatableFile>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [path, file] of Object.entries(files)) {
    if (!REACT_SRC_SCRIPT_RE.test(path)) continue;
    if (BARE_IMPORT_EXPORT_RE.test(file.content)) {
      issues.push({
        code: 'E_NO_BARE_IMPORT',
        file: path,
        message:
          '使用了 import/export 语句（CDN 直行模式无打包器，浏览器无法解析）。请改为全局挂载：组件在文件末尾用 window.__components.组件名 = 组件名 注册，工具函数用 window.__utils.函数名 = 函数名 或 window.__hooks.xxx = xxx 暴露，调用方直接引用全局',
      });
    }
  }
  return issues;
}

/**
 * 校验项目结构。
 * @param files 交付前的最终文件集合（create 流水线先注入三件套再校验）
 * @param framework 目标框架
 * @param options 规则作用域（缺省全开；modify/diff 场景由调用方关闭注入保证类规则，
 *                避免 P0 之前的存量项目因无 README/注册约定被误报）
 */
export function validateProject(
  files: Record<string, ValidatableFile>,
  framework: Framework,
  options?: ValidateOptions,
): ValidationResult {
  const enforceScaffold = options?.enforceScaffold ?? true;
  const enforceGlobalReg = options?.enforceGlobalReg ?? true;
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

  // E_GLOBAL_REG：react 组件文件必须含 window.__components 注册（P0 过渡约定，P1 移除）
  if (framework === 'react-cdn' && enforceGlobalReg) {
    for (const [path, file] of Object.entries(files)) {
      // 入口 main.jsx 是注册的使用方而非组件，不要求注册
      const isComponentFile = path.endsWith('.jsx') && path !== '/src/main.jsx';
      if (isComponentFile && !file.content.includes('window.__components')) {
        errors.push({
          code: 'E_GLOBAL_REG',
          file: path,
          message: `组件文件 ${path} 缺少 window.__components 注册（文件末尾须含 window.__components.${componentName(path)} = ${componentName(path)};）`,
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

  // ═══ E_NO_BARE_IMPORT（P0 过渡规则，一键移除区开始）═══
  // react-cdn 恒开（不挂 enforceP0，含 diff 路径）：作用域论证见
  // validateNoBareImport 上方注释块。P1 批次 2 切真实 ESM 后删除本调用块。
  if (framework === 'react-cdn') {
    errors.push(...validateNoBareImport(files));
  }
  // ═══ E_NO_BARE_IMPORT（一键移除区结束）═══

  return { errors, warnings: [] };
}

/** 从组件文件路径提取组件名（PascalCase.jsx → PascalCase） */
export function componentName(path: string): string {
  const base = path.split('/').pop() ?? path;
  const withoutExt = base.replace(/\.jsx$/, '');
  return withoutExt || 'Component';
}
