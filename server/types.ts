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