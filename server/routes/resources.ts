/**
 * 项目知识库资源路由。
 * 全部要求登录，且只能操作自己 owner_id 下的资源（项目 ID 仅作归组键）。
 * GET    /api/projects/:id/resources             列表（id/name/content/size/created_at，含全文供条目查看）
 * POST   /api/projects/:id/resources             新增（限额：单条 16KB、名称 60 字符、单项目 20 条 / 32KB）
 * DELETE /api/projects/:id/resources/:resourceId 删除
 *
 * 供 LLM 生成注入：listProjectResources 被 routes/llm.ts 调用，
 * 资料以【项目参考资料】块拼入工程师可见的 prompt 尾部。
 */
import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import type { AppEnv } from '../types.js';

export const resourcesRouter = new Hono<AppEnv>();

// 全路由强制认证
resourcesRouter.use('*', requireAuth);

/** 资源表行结构 */
interface ResourceRow {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  content: string;
  created_at: number;
}

/** 生成注入用的资料条目（含 content） */
export interface ProjectResourceItem {
  id: string;
  name: string;
  content: string;
}

// 确保资源表存在（幂等，参考 ensureShareTable 模式）
function ensureResourcesTable() {
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='project_resources'
  `).get();

  if (!tableExists) {
    db.exec(`
      CREATE TABLE project_resources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_resources_project_owner
      ON project_resources(project_id, owner_id);
  `);
}

// 初始化表
ensureResourcesTable();

/** 资料名称长度上限：60 字符 */
const MAX_NAME_LENGTH = 60;

/** 单条资料内容大小上限：16KB（UTF-8 字节数） */
const MAX_CONTENT_BYTES = 16 * 1024;

/** 单项目资料条数上限：20 条 */
const MAX_RESOURCES_COUNT = 20;

/** 单项目资料总量上限：32KB（UTF-8 字节数） */
const MAX_TOTAL_BYTES = 32 * 1024;

/** UTF-8 字节数（KB 限额按字节计量，中文更严格更诚实） */
function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * GET /api/projects/:id/resources
 * 当前用户在该项目下的资料列表（含 content，供前端点击条目查看完整内容；
 * 单条 ≤16KB、单项目总量 ≤32KB，载荷可控；接口登录 + 本人项目，无泄露面）。
 * size 为 UTF-8 字节数。
 */
resourcesRouter.get('/:id/resources', (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  if (!user) {
    return c.json({ error: '未登录或会话已过期' }, 401);
  }

  const rows = db.prepare(`
    SELECT id, name, content, created_at
    FROM project_resources WHERE project_id = ? AND owner_id = ?
    ORDER BY created_at ASC
  `).all(projectId, user.id) as ResourceRow[];

  return c.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      content: row.content,
      size: utf8ByteLength(row.content),
      created_at: row.created_at,
    })),
  );
});

/**
 * POST body 结构。
 */
interface CreateResourceBody {
  name?: unknown;
  content?: unknown;
}

/**
 * POST /api/projects/:id/resources
 * 新增资料。限额超限返回 400 带中文错误信息。
 */
resourcesRouter.post('/:id/resources', async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  if (!user) {
    return c.json({ error: '未登录或会话已过期' }, 401);
  }

  const body = (await c.req.json().catch(() => ({}))) as CreateResourceBody;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    return c.json({ error: `资料名称必填，且不超过 ${MAX_NAME_LENGTH} 字符` }, 400);
  }
  if (typeof body.content !== 'string' || body.content.length === 0) {
    return c.json({ error: '资料内容不能为空' }, 400);
  }

  const contentBytes = utf8ByteLength(body.content);
  if (contentBytes > MAX_CONTENT_BYTES) {
    return c.json({ error: `单条资料内容超过大小上限（${MAX_CONTENT_BYTES / 1024}KB）` }, 400);
  }

  // 总量在应用层按 UTF-8 字节累加（SQLite LENGTH 对 TEXT 计字符数，不用于字节限额）
  const rows = db.prepare(
    'SELECT content FROM project_resources WHERE project_id = ? AND owner_id = ?',
  ).all(projectId, user.id) as { content: string }[];

  if (rows.length >= MAX_RESOURCES_COUNT) {
    return c.json({ error: `资料数量超过上限（每个项目最多 ${MAX_RESOURCES_COUNT} 条）` }, 400);
  }
  const totalBytes = rows.reduce((sum, row) => sum + utf8ByteLength(row.content), 0);
  if (totalBytes + contentBytes > MAX_TOTAL_BYTES) {
    return c.json({ error: `资料总大小超过上限（${MAX_TOTAL_BYTES / 1024}KB）` }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO project_resources (id, project_id, owner_id, name, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, user.id, name, body.content, createdAt);

  // 回显完整条目（含 content）：前端把 POST 响应直接插入列表，展开即可见全文
  return c.json(
    { id, name, content: body.content, size: contentBytes, created_at: createdAt },
    201,
  );
});

/**
 * DELETE /api/projects/:id/resources/:resourceId
 * 删除当前用户在该项目下的指定资料。
 */
resourcesRouter.delete('/:id/resources/:resourceId', (c) => {
  const projectId = c.req.param('id');
  const resourceId = c.req.param('resourceId');
  const user = c.get('user');
  if (!user) {
    return c.json({ error: '未登录或会话已过期' }, 401);
  }

  const result = db.prepare(
    'DELETE FROM project_resources WHERE id = ? AND project_id = ? AND owner_id = ?',
  ).run(resourceId, projectId, user.id);

  if (result.changes === 0) {
    return c.json({ error: '资料不存在' }, 404);
  }

  return c.json({ success: true });
});

/**
 * 读取项目资料全文（供生成注入使用，含 content）。
 * 仅返回该用户名下的资料，调用方（routes/llm.ts）负责拼接与截断。
 */
export function listProjectResources(projectId: string, ownerId: string): ProjectResourceItem[] {
  const rows = db.prepare(`
    SELECT id, name, content
    FROM project_resources WHERE project_id = ? AND owner_id = ?
    ORDER BY created_at ASC
  `).all(projectId, ownerId) as Array<{ id: string; name: string; content: string }>;

  return rows;
}
