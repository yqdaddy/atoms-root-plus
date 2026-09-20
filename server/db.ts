/**
 * SQLite 数据库初始化与查询封装。
 * WAL 模式提升并发性能，单文件 data/atoms.db 持久化。
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Project,
  ProjectSummary,
  StorageEnvelope,
  IsoDateTime,
  SessionUser,
} from './types.js';
import { ENTRY_FILE_PATH, CURRENT_SCHEMA_VERSION } from './types.js';

// 确定 data 目录路径
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'atoms.db');

// 确保 data 目录存在
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库（WAL 模式）
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ============ 表结构 ============

// 初始建表（新数据库）
// 注意：CREATE TABLE IF NOT EXISTS 对已存在的表不做修改
// projects 表定义中包含 user_id，但旧数据库没有该列，后续通过迁移添加
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// 索引不依赖 user_id 的先创建
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);

// ============ 迁移：为已有 projects 表添加 user_id 列 ============

function getTableColumns(table: string): string[] {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

if (!getTableColumns('projects').includes('user_id')) {
  console.log('[db] 迁移：为 projects 表添加 user_id 列');
  db.exec('ALTER TABLE projects ADD COLUMN user_id TEXT');
  console.log('[db] 迁移完成');
}

// 迁移后再创建依赖 user_id 的索引
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
`);

// 清理过期会话
const now = new Date().toISOString();
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

// ============ 工具函数 ============

function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

function parseProject(data: string): Project | null {
  try {
    const envelope = JSON.parse(data) as StorageEnvelope<Project>;
    if (envelope && typeof envelope.data === 'object') {
      return envelope.data;
    }
    return null;
  } catch {
    return null;
  }
}

function toSummary(project: Project): ProjectSummary {
  const entryContent = project.files[ENTRY_FILE_PATH]?.content ?? '';
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    updatedAt: project.updatedAt,
    entryBytes: new Blob([entryContent]).size,
  };
}

/**
 * 构造用户隔离条件。
 * userId 为 null 表示游客模式（查询 user_id IS NULL 的记录）。
 */
function ownerCondition(
  userId: string | null,
): { sql: string; params: string[] } {
  if (userId === null) {
    return { sql: 'user_id IS NULL', params: [] };
  }
  return { sql: 'user_id = ?', params: [userId] };
}

// ============ 项目 CRUD（支持用户隔离） ============

/**
 * 获取项目摘要列表（按用户隔离）。
 */
export function listProjectSummaries(userId: string | null): ProjectSummary[] {
  const { sql, params } = ownerCondition(userId);
  const rows = db
    .prepare(
      `SELECT data FROM projects WHERE ${sql} ORDER BY updated_at DESC`,
    )
    .all(...params) as { data: string }[];

  const summaries: ProjectSummary[] = [];
  for (const row of rows) {
    const project = parseProject(row.data);
    if (project) {
      summaries.push(toSummary(project));
    }
  }
  return summaries;
}

/**
 * 获取单个项目详情（信封格式，按用户隔离）。
 */
export function getProject(
  id: string,
  userId: string | null,
): StorageEnvelope<Project> | null {
  const { sql, params } = ownerCondition(userId);
  const row = db
    .prepare(`SELECT data FROM projects WHERE id = ? AND ${sql}`)
    .get(id, ...params) as { data: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.data) as StorageEnvelope<Project>;
  } catch {
    return null;
  }
}

/**
 * 创建项目（支持用户隔离）。
 */
export function createProject(
  project: Project,
  userId: string | null,
): string {
  const envelope: StorageEnvelope<Project> = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: nowIso(),
    data: project,
  };

  db.prepare(`
    INSERT OR IGNORE INTO projects (id, data, created_at, updated_at, user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    project.id,
    JSON.stringify(envelope),
    project.createdAt,
    project.updatedAt,
    userId,
  );

  return project.id;
}

/**
 * 更新项目（按用户隔离）。
 */
export function updateProject(
  id: string,
  project: Project,
  userId: string | null,
): boolean {
  const envelope: StorageEnvelope<Project> = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: nowIso(),
    data: project,
  };

  const { sql, params } = ownerCondition(userId);
  const result = db
    .prepare(
      `UPDATE projects SET data = ?, updated_at = ? WHERE id = ? AND ${sql}`,
    )
    .run(JSON.stringify(envelope), project.updatedAt, id, ...params);

  return result.changes > 0;
}

/**
 * 删除项目（按用户隔离）。
 */
export function deleteProject(id: string, userId: string | null): boolean {
  const { sql, params } = ownerCondition(userId);
  const result = db
    .prepare(`DELETE FROM projects WHERE id = ? AND ${sql}`)
    .run(id, ...params);

  return result.changes > 0;
}

/**
 * 批量导入项目（支持指定用户）。
 */
export function importProjects(
  projects: Project[],
  userId: string | null,
): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO projects (id, data, created_at, updated_at, user_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const project of projects) {
      const envelope: StorageEnvelope<Project> = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: nowIso(),
        data: project,
      };
      insert.run(
        project.id,
        JSON.stringify(envelope),
        project.createdAt,
        project.updatedAt,
        userId,
      );
    }
  });

  transaction();
  return projects.length;
}

// ============ 用户相关数据库操作 ============

export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export function createUser(params: {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}): void {
  db.prepare(
    'INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    params.id,
    params.username,
    params.passwordHash,
    params.createdAt,
    params.updatedAt,
  );
}

export function getUserByUsername(username: string): UserRow | null {
  const row = db
    .prepare('SELECT id, username, password_hash, created_at, updated_at FROM users WHERE username = ?')
    .get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserById(id: string): UserRow | null {
  const row = db
    .prepare('SELECT id, username, password_hash, created_at, updated_at FROM users WHERE id = ?')
    .get(id) as
    | {
        id: string;
        username: string;
        password_hash: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ 会话相关数据库操作 ============

export interface SessionRowInput {
  tokenHash: string;
  userId: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export function createSession(params: SessionRowInput): void {
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(params.tokenHash, params.userId, params.createdAt, params.expiresAt);
}

export function getValidSessionByTokenHash(
  tokenHash: string,
  nowIso: IsoDateTime,
): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash, nowIso) as
    | { id: string; username: string; created_at: string }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
  };
}

export function deleteSessionByTokenHash(tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

// ============ 其他 ============

/**
 * 关闭数据库连接（用于优雅关闭）。
 */
export function closeDatabase(): void {
  db.close();
}