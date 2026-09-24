/**
 * mini-bundler 对外类型（moduleBundler 消费，批次 2 assembler 集成时复用）。
 */

/** 打包器错误码（结构化，供上层区分降级策略与 AI 修复循环提示） */
export enum ModuleBundleErrorCode {
  /** 入口文件不在文件集中 */
  EntryMissing = 'ENTRY_MISSING',
  /** 相对说明符无法解析到项目文件 */
  ModuleNotFound = 'MODULE_NOT_FOUND',
  /** bare 说明符不在 shim 白名单 */
  UnknownBareImport = 'UNKNOWN_BARE_IMPORT',
  /** Sucrase 编译失败（语法错误等） */
  TransformFailed = 'TRANSFORM_FAILED',
  /** 编译产物含 CJS 包装不兼容语法（顶层 await 等） */
  IncompatibleSyntax = 'INCOMPATIBLE_SYNTAX',
  /** import.meta 等不支持的语法 */
  UnsupportedSyntax = 'UNSUPPORTED_SYNTAX',
  /** 打包器未预期异常 */
  Internal = 'INTERNAL',
}

/** 打包输入：项目内单个源码文件 */
export interface BundleModuleFile {
  readonly path: string;
  readonly content: string;
}

/** 打包选项（当前为 classic JSX runtime 固定，保留扩展位） */
export interface BundleOptions {
  /** react-cdn 平台运行时是否可用（window.React 等全局），默认 true */
  readonly platformRuntimeAvailable?: boolean;
}

/** 结构化打包错误（message 可直接喂给 AI 修复循环） */
export interface ModuleBundleError {
  readonly code: ModuleBundleErrorCode;
  readonly message: string;
  /** 出错模块路径（已知时） */
  readonly modulePath?: string;
  /** 出错的 import 说明符（已知时） */
  readonly specifier?: string;
}

/** 打包成功：自包含可执行脚本 + 模块清单（拓扑序，依赖在前） */
export interface BundleSuccess {
  readonly ok: true;
  readonly script: string;
  readonly modulePaths: readonly string[];
  readonly warnings: readonly string[];
}

/** 打包失败 */
export interface BundleFailure {
  readonly ok: false;
  readonly error: ModuleBundleError;
}

export type BundleResult = BundleSuccess | BundleFailure;
