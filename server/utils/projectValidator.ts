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
  /** 规则代码：E_ENTRY / E_SCAFFOLD / E_GLOBAL_REG / E_CDN_DOMAIN（P1 扩展） */
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

  return { errors, warnings: [] };
}

/** 从组件文件路径提取组件名（PascalCase.jsx → PascalCase） */
export function componentName(path: string): string {
  const base = path.split('/').pop() ?? path;
  const withoutExt = base.replace(/\.jsx$/, '');
  return withoutExt || 'Component';
}
