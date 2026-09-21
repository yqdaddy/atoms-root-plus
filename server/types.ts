/**
 * 服务端类型定义。
 * 与前端 types 共享概念，独立声明以避免构建循环依赖。
 */

export type IsoDateTime = string;

export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'error';

export type FileLanguage = 'html' | 'css' | 'javascript' | 'json' | 'text';

export const ENTRY_FILE_PATH = '/index.html';

export interface FileNode {
  path: string;
  content: string;
  language: FileLanguage;
  updatedAt: IsoDateTime;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: IsoDateTime;
  artifactId?: string;
}

export interface PreviewConfig {
  extraSandboxFlags: ('allow-forms' | 'allow-modals')[];
  sizeMode: 'autoHeight' | 'fixed';
  fixedViewport?: { width: number; height: number };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  files: Record<string, FileNode>;
  chat: ChatMessage[];
  preview: PreviewConfig;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  updatedAt: IsoDateTime;
  entryBytes: number;
}

/**
 * 存储信封格式，与前端一致。
 */
export interface StorageEnvelope<T> {
  schemaVersion: number;
  savedAt: IsoDateTime;
  data: T;
}

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * UUID 格式校验（8-4-4-4-12 十六进制，不限版本位，大小写不敏感）。
 * 客户端上送的 id 必须匹配才被服务端采用，防止任意字符串进入主键。
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 用户表结构
 */
export interface User {
  id: string;
  username: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * 会话用户公开信息（不含敏感字段）
 */
export type SessionUser = Pick<User, 'id' | 'username' | 'createdAt'>;

/**
 * 项目 ID 格式校验（仅字母、数字、连字符，1-64 位）。
 * 部署目录以 projectId 命名，进入文件系统路径前必须通过该校验，
 * 防止路径穿越（../）与特殊字符注入。
 */
export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

/**
 * 单行编辑操作
 */
export interface FileEdit {
  /** 行号（1-indexed） */
  line: number;
  /** 原行内容（必须精确匹配，包括缩进） */
  old: string;
  /** 新行内容 */
  new: string;
  /** 操作类型 */
  type: 'replace' | 'insert' | 'delete';
}

/**
 * 单个文件的变更集合
 */
export interface FileChange {
  /** 文件路径 */
  file: string;
  /** 编辑操作列表 */
  edits: FileEdit[];
}

/**
 * 变更清单（工程师 diff 输出格式）
 */
export interface ChangeList {
  /** 变更列表 */
  changes: FileChange[];
  /** 变更摘要 */
  summary: string;
}

/**
 * 部署记录（对应 SQLite deployments 表）。
 */
export interface DeploymentRecord {
  id: string;
  projectId: string;
  deployUrl: string;
  deployedAt: IsoDateTime;
  fileCount: number;
  totalSize: number;
}

/**
 * Hono 上下文变量类型
 */
export interface AppEnv {
  Variables: {
    user: SessionUser | null;
  };
}

/**
 * SQLite 会话行
 */
export interface SessionRow {
  tokenHash: string;
  userId: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}