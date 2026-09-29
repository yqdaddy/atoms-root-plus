/**
 * 作品广场路由。
 * POST   /api/gallery        发布项目快照（登录；同一项目重复发布则更新快照）
 * GET    /api/gallery        公开列表（sort=latest|forks，limit/offset 数值钳制）
 * GET    /api/gallery/:id    公开快照详情（含 files/html，供广场只读预览）
 * DELETE /api/gallery/:id    取消发布（登录，仅作者可删）
 * POST   /api/gallery/:id/fork  把快照复刻为当前用户的新项目（登录）
 *
 * 快照语义：发布时从 projects 表复制文件内容到 gallery 表，
 * 之后项目继续迭代不影响已发布快照（简单且安全）。
 */
import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { createProject, db } from '../db.js';
import { ENTRY_FILE_PATH } from '../types.js';
import type { AppEnv, FileLanguage, FileNode, Project, ProjectFramework } from '../types.js';

export const galleryRouter = new Hono<AppEnv>();

/** gallery 表行结构 */
interface GalleryRow {
  id: string;
  project_id: string;
  owner_id: string;
  owner_name: string;
  project_name: string;
  description: string | null;
  files: string; // JSON 格式存储快照 files（Record<path, FileNode>）
  html: string; // 入口文件内容快照
  framework: string | null;
  fork_count: number;
  created_at: number;
}

/** 列表查询行（不含 files/html 大字段） */
interface GalleryListItemRow {
  id: string;
  project_name: string;
  owner_name: string;
  description: string | null;
  fork_count: number;
  created_at: number;
}

// 确保广场表存在（幂等，参考 ensureShareTable 模式）
function ensureGalleryTable() {
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='gallery'
  `).get();

  if (!tableExists) {
    db.exec(`
      CREATE TABLE gallery (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        description TEXT,
        files TEXT NOT NULL,
        html TEXT NOT NULL,
        framework TEXT,
        fork_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gallery_created_at ON gallery(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_fork_count ON gallery(fork_count DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_project_owner ON gallery(project_id, owner_id);
  `);
}

// 初始化表
ensureGalleryTable();

/** 简介长度上限：200 字符 */
const MAX_DESCRIPTION_LENGTH = 200;

/** 列表分页默认值与钳制边界 */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_OFFSET = 1_000_000;

/** framework 白名单（与 ProjectFramework 对齐，fork 恢复快照框架时校验） */
const FRAMEWORK_VALUES: readonly string[] = ['html', 'react-cdn', 'vue-cdn'];

/**
 * 解析并钳制整数查询参数。
 * 非数值返回 fallback；数值收敛到 [min, max]（客户端输入不可信）。
 */
function parseClampedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 归一化发布简介：undefined → null（简介可为空）；
 * 字符串 trim 后超长报错，空串归一为 null；非字符串报错。
 * @returns 归一化结果；非法时返回错误消息
 */
function normalizeDescription(value: unknown): { description: string | null } | { error: string } {
  if (value === undefined || value === null) {
    return { description: null };
  }
  if (typeof value !== 'string') {
    return { error: 'description 必须为字符串' };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return { error: `简介长度超过上限（最多 ${MAX_DESCRIPTION_LENGTH} 字符）` };
  }
  return { description: trimmed === '' ? null : trimmed };
}

/** 解析快照 files JSON；损坏时返回 null（fork 路径据此回退单文件） */
function parseSnapshotFiles(raw: string): Record<string, FileNode> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, FileNode>;
  } catch {
    return null;
  }
}

/** 恢复快照 framework：白名单外（含 null）返回 undefined，缺省语义 */
function parseSnapshotFramework(value: string | null): ProjectFramework | undefined {
  if (value === null) return undefined;
  return FRAMEWORK_VALUES.includes(value) ? (value as ProjectFramework) : undefined;
}

/**
 * POST body 结构。
 */
interface PublishBody {
  projectId?: unknown;
  description?: unknown;
}

/**
 * POST /api/gallery
 * 发布项目快照（登录）。同一项目（project_id + owner_id）重复发布则更新快照。
 */
galleryRouter.post('/', requireAuth, async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as PublishBody;
    const user = c.get('user');
    if (!user) {
      return c.json({ error: '未登录或会话已过期' }, 401);
    }

    if (typeof body.projectId !== 'string' || !body.projectId) {
      return c.json({ error: 'projectId 为必填字段' }, 400);
    }

    const normalized = normalizeDescription(body.description);
    if ('error' in normalized) {
      return c.json({ error: normalized.error }, 400);
    }

    // 只能发布自己的项目（按 userId 隔离，非本人项目与不存在同样返回 404，不泄露存在性）
    const project = getOwnedProjectSnapshot(body.projectId, user.id);
    if (!project) {
      return c.json({ error: '项目不存在或无权发布' }, 404);
    }

    const filesJson = JSON.stringify(project.files);
    const entryHtml = project.files[ENTRY_FILE_PATH]?.content ?? '';
    const framework = project.framework ?? null;

    const existing = db.prepare(
      'SELECT id FROM gallery WHERE project_id = ? AND owner_id = ?',
    ).get(body.projectId, user.id) as { id: string } | undefined;

    if (existing) {
      // 重复发布：更新快照内容与元信息，保留原 id、created_at 与 fork_count
      db.prepare(`
        UPDATE gallery
        SET files = ?, html = ?, project_name = ?, description = ?, framework = ?
        WHERE id = ?
      `).run(filesJson, entryHtml, project.name, normalized.description, framework, existing.id);
      return c.json({ id: existing.id, updated: true });
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO gallery (id, project_id, owner_id, owner_name, project_name, description, files, html, framework, fork_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      body.projectId,
      user.id,
      user.username,
      project.name,
      normalized.description,
      filesJson,
      entryHtml,
      framework,
      Date.now(),
    );

    return c.json({ id, updated: false }, 201);
  } catch (error) {
    console.error('[gallery] 发布失败:', error);
    return c.json({ error: '发布作品失败' }, 500);
  }
});

/**
 * GET /api/gallery?sort=latest|forks&limit=&offset=
 * 公开列表（不要求登录）。返回列表与总数，不携带 files/html 大字段。
 */
galleryRouter.get('/', (c) => {
  const sort = c.req.query('sort') === 'forks' ? 'forks' : 'latest';
  const limit = parseClampedInt(c.req.query('limit'), DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const offset = parseClampedInt(c.req.query('offset'), 0, 0, MAX_OFFSET);

  // 排序字段来自白名单拼接，不存在注入面
  const orderBy = sort === 'forks' ? 'fork_count DESC, created_at DESC' : 'created_at DESC';

  const totalRow = db.prepare('SELECT COUNT(*) AS cnt FROM gallery').get() as { cnt: number };
  const rows = db.prepare(`
    SELECT id, project_name, owner_name, description, fork_count, created_at
    FROM gallery ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(limit, offset) as GalleryListItemRow[];

  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      project_name: row.project_name,
      owner_name: row.owner_name,
      description: row.description,
      fork_count: row.fork_count,
      created_at: row.created_at,
    })),
    total: totalRow.cnt,
  });
});

/**
 * GET /api/gallery/:id
 * 公开快照详情（含 files/html），供广场只读预览。
 */
galleryRouter.get('/:id', (c) => {
  const id = c.req.param('id');

  const row = db.prepare(`
    SELECT id, project_id, owner_name, project_name, description, files, html, framework, fork_count, created_at
    FROM gallery WHERE id = ?
  `).get(id) as GalleryRow | undefined;

  if (!row) {
    return c.json({ error: '作品不存在' }, 404);
  }

  return c.json({
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    owner_name: row.owner_name,
    description: row.description,
    framework: parseSnapshotFramework(row.framework),
    files: parseSnapshotFiles(row.files),
    html: row.html,
    fork_count: row.fork_count,
    created_at: row.created_at,
  });
});

/**
 * DELETE /api/gallery/:id
 * 取消发布（登录，仅作者可删）。
 */
galleryRouter.delete('/:id', requireAuth, (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  if (!user) {
    return c.json({ error: '未登录或会话已过期' }, 401);
  }

  const row = db.prepare('SELECT owner_id FROM gallery WHERE id = ?').get(id) as
    | { owner_id: string }
    | undefined;

  if (!row) {
    return c.json({ error: '作品不存在' }, 404);
  }
  if (row.owner_id !== user.id) {
    return c.json({ error: '仅作者可删除该作品' }, 403);
  }

  db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
  return c.json({ success: true });
});

/**
 * POST /api/gallery/:id/fork
 * 把快照复制为当前用户的新项目（复用 projects 创建逻辑），fork_count +1。
 * 名称加"（复刻）"后缀；快照 files 损坏时回退为单入口文件（html 内容）。
 */
galleryRouter.post('/:id/fork', requireAuth, (c) => {
  try {
    const id = c.req.param('id');
    const user = c.get('user');
    if (!user) {
      return c.json({ error: '未登录或会话已过期' }, 401);
    }

    const row = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id) as GalleryRow | undefined;
    if (!row) {
      return c.json({ error: '作品不存在' }, 404);
    }

    const now = new Date().toISOString();
    const snapshotFiles = parseSnapshotFiles(row.files);
    const files: Record<string, FileNode> = snapshotFiles ?? {
      [ENTRY_FILE_PATH]: {
        path: ENTRY_FILE_PATH,
        content: row.html,
        language: 'html' as FileLanguage,
        updatedAt: now,
      },
    };

    const forked: Project = {
      id: crypto.randomUUID(),
      name: `${row.project_name}（复刻）`,
      description: row.description ?? '',
      status: 'ready',
      framework: parseSnapshotFramework(row.framework),
      files,
      chat: [],
      preview: { extraSandboxFlags: [], sizeMode: 'autoHeight' },
      createdAt: now,
      updatedAt: now,
    };

    createProject(forked, user.id);

    db.prepare('UPDATE gallery SET fork_count = fork_count + 1 WHERE id = ?').run(id);

    return c.json({ projectId: forked.id }, 201);
  } catch (error) {
    console.error('[gallery] 复刻失败:', error);
    return c.json({ error: '复刻作品失败' }, 500);
  }
});

/**
 * 按 owner 读取项目（信封格式），发布快照前校验归属。
 * 独立小封装避免在本文件展开完整的信封解析逻辑。
 */
function getOwnedProjectSnapshot(projectId: string, ownerId: string): Project | null {
  const row = db.prepare('SELECT data FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, ownerId) as { data: string } | undefined;
  if (!row) return null;
  try {
    const envelope = JSON.parse(row.data) as { data?: Project };
    if (envelope && typeof envelope.data === 'object' && envelope.data !== null) {
      return envelope.data;
    }
    return null;
  } catch {
    return null;
  }
}
