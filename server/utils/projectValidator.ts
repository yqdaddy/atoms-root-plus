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
  /** 规则代码：E_ENTRY / E_SCAFFOLD / E_GLOBAL_REG（P1 扩展） */
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

/** 校验作用域选项：注入保证类规则仅在 create 全量流水线强制（存量项目兼容） */
export interface ValidateOptions {
  /** 强制 E_SCAFFOLD（仅 create 全量流水线注入三件套，注入回归兜底才有意义） */
  enforceScaffold?: boolean;
  /** 强制 E_GLOBAL_REG（存量 react 项目无注册约定，仅对新 create 项目强制） */
  enforceGlobalReg?: boolean;
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

  return { errors, warnings: [] };
}

/** 从组件文件路径提取组件名（PascalCase.jsx → PascalCase） */
export function componentName(path: string): string {
  const base = path.split('/').pop() ?? path;
  const withoutExt = base.replace(/\.jsx$/, '');
  return withoutExt || 'Component';
}
