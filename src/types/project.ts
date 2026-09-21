/**
 * 项目与虚拟文件系统类型定义。
 * Demo 阶段约定单文件应用：files 通常只含 ENTRY_FILE_PATH 一个节点，
 * 但结构保留多文件扩展能力（后续迭代可扩展 css/js 分离文件）。
 */

export type IsoDateTime = string; // ISO 8601 UTC 字符串，如 "2026-09-18T08:00:00.000Z"

export type FileLanguage = 'html' | 'css' | 'javascript' | 'json' | 'text';

/** 约定的应用入口文件路径 */
export const ENTRY_FILE_PATH = '/index.html';

/** 虚拟文件系统节点 */
export interface FileNode {
  /** 虚拟路径，约定以 "/" 开头，如 "/index.html" */
  path: string;
  /** 文件文本内容（UTF-8） */
  content: string;
  /** 语言标记，供编辑器高亮与组装器使用 */
  language: FileLanguage;
  /** 最近更新时间 */
  updatedAt: IsoDateTime;
}

export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'error';

/** 版本类型：初始版本 / 迭代版本 / 回滚版本 */
export type VersionType = 'initial' | 'iteration' | 'rollback';

/** 计划工件：分析师产出的结构化计划 */
export interface Plan {
  /** 计划 ID */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 版本号（用户编辑后自增） */
  version: number;
  /** 分析师产出的结构化计划（JSON 字符串） */
  content: string;
  /** 能力声明：需要沙箱开放的能力 */
  capabilities?: string[];
  /** 用户是否编辑过 */
  editedByUser?: boolean;
  /** 创建时间 */
  createdAt: IsoDateTime;
  /** 更新时间 */
  updatedAt: IsoDateTime;
}

/** 版本快照：每次 AI 生成完成后自动保存 */
export interface Version {
  /** 版本 ID */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 创建时间（ISO DateTime） */
  createdAt: IsoDateTime;
  /** 变更摘要 */
  summary: string;
  /** 版本类型 */
  type: VersionType;
  /** 文件快照 */
  files: Record<string, FileNode>;
  /** 回滚来源版本 ID（仅 type 为 rollback 时存在） */
  rollbackFrom?: string;
}

/** 项目目标框架：原生 HTML / React CDN（浏览器内 JSX 编译）/ Vue CDN */
export type ProjectFramework = 'html' | 'react-cdn' | 'vue-cdn';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** 消息文本。流式输出完成后才写入持久层，本字段不存在半截状态 */
  content: string;
  createdAt: IsoDateTime;
  /** assistant 消息可指向本次生成的代码快照 id，用于历史版本回看 */
  artifactId?: string;
}

/**
 * 额外授予沙箱的能力标志。默认空数组（仅 allow-scripts，见铁律 2）。
 * 允许集合被刻意收窄：凡是可能扩大同源能力或导航能力的标志一律不在类型里出现。
 */
export type SandboxAllowFlag = 'allow-forms' | 'allow-modals';

export interface PreviewConfig {
  /** 额外 sandbox 能力，需产品明确需求后才可写入 */
  extraSandboxFlags: SandboxAllowFlag[];
  /** 预览尺寸模式：跟随内容自适应高度，或固定设备视口 */
  sizeMode: 'autoHeight' | 'fixed';
  /** sizeMode 为 fixed 时生效 */
  fixedViewport?: { width: number; height: number };
}

export const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
  extraSandboxFlags: [],
  sizeMode: 'autoHeight',
};

/** 项目聚合根：元信息 + 虚拟文件 + 对话历史 + 预览配置 */
export interface Project {
  /** UUID v4，宿主生成 */
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  /** 生成代码的目标框架，默认 html；react-cdn 时沙箱注入 React/Sucrase 运行时 */
  framework?: ProjectFramework;
  /** path 到 FileNode 的映射。读取入口永远走 ENTRY_FILE_PATH */
  files: Record<string, FileNode>;
  /** 对话历史，按 createdAt 升序 */
  chat: ChatMessage[];
  preview: PreviewConfig;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 项目列表页使用的轻量摘要，持久化在索引 key 中，避免列表页反序列化全部项目 */
export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  /** 生成代码的目标框架，列表页展示框架标签用 */
  framework?: ProjectFramework;
  updatedAt: IsoDateTime;
  /** 入口文件字节数，用于列表页体积提示与 quota 预估 */
  entryBytes: number;
}

/** 项目偏好类型 */
export type PreferenceType = 'style' | 'tech' | 'correction' | 'preference';

/** 项目偏好记忆：记录用户对项目的偏好选择，用于后续生成时复用 */
export interface ProjectPreference {
  /** UUID v4 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 偏好类型 */
  type: PreferenceType;
  /** 偏好键名，如 "color-scheme", "framework" */
  key: string;
  /** 偏好值，如 "dark", "react" */
  value: string;
  /** 偏好来源说明（Why），记录用户原话或上下文 */
  reason?: string;
  /** 创建时间 */
  createdAt: IsoDateTime;
  /** 最后更新时间 */
  updatedAt: IsoDateTime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIsoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Project 结构守卫：迁移与读取路径统一用它验证数据形状 */
export function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.description !== 'string') return false;
  if (value.status !== 'draft' && value.status !== 'generating' && value.status !== 'ready' && value.status !== 'error') {
    return false;
  }
  if (!isRecord(value.files) || !isRecord(value.files[ENTRY_FILE_PATH])) return false;
  if (!Array.isArray(value.chat)) return false;
  if (!isRecord(value.preview)) return false;
  if (!isIsoDateTime(value.createdAt) || !isIsoDateTime(value.updatedAt)) return false;
  return true;
}