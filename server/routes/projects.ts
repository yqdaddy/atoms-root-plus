/**
 * 项目 CRUD 路由。
 * 数据格式与前端 localStorage 层一致（StorageEnvelope），便于直接消费。
 * 支持可选认证：有会话 → 用户数据；无会话 → 游客数据（user_id IS NULL）。
 */
import { Hono } from 'hono';
import { optionalAuth } from '../auth.js';
import * as db from '../db.js';
import { cleanupProjectDeployment } from './deploy.js';
import type { Project, ProjectStatus, ProjectFramework, AppEnv } from '../types.js';
import { ENTRY_FILE_PATH, UUID_PATTERN, FRAMEWORK_VALUES } from '../types.js';

export const projectsRouter = new Hono<AppEnv>();

// 全路由可选认证
projectsRouter.use('*', optionalAuth);

/**
 * GET /api/projects
 * 返回当前用户（或游客）的项目摘要列表。
 */
projectsRouter.get('/', (c) => {
  const user = c.get('user');
  const userId = user?.id ?? null;
  const summaries = db.listProjectSummaries(userId);
  return c.json(summaries);
});

/**
 * GET /api/projects/:id
 * 返回项目详情（信封格式）。
 * 按 userId 隔离：只能访问自己或游客的项目。
 */
projectsRouter.get('/:id', (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const userId = user?.id ?? null;

  const envelope = db.getProject(id, userId);

  if (!envelope) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json(envelope);
});

/**
 * POST body 结构。
 */
interface CreateProjectBody {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  framework?: unknown;
}

/**
 * 归一化 framework 入参（FINAL-1）：
 * - 未提供（undefined）→ undefined：不写入字段，保持存量缺省语义（前端按 html 处理）
 * - 合法值（html | react-cdn | vue-cdn）→ 原样保留
 * - 非法值 → 防御性回退 'html'，不报错（framework 字段异常不应阻塞整包同步）
 */
function normalizeFramework(v: unknown): ProjectFramework | undefined {
  if (v === undefined) {
    return undefined;
  }
  return (FRAMEWORK_VALUES as readonly string[]).includes(v as string)
    ? (v as ProjectFramework)
    : 'html';
}

const STATUS_VALUES: readonly ProjectStatus[] = [
  'draft',
  'generating',
  'ready',
  'error',
];

/**
 * POST /api/projects
 * 创建新项目。
 * 有会话 → 关联到该用户；无会话 → 游客项目（user_id NULL）。
 */
projectsRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as CreateProjectBody;

  // id 类型校验
  if (body.id !== undefined && typeof body.id !== 'string') {
    return c.json({ error: 'id 字段必须为字符串' }, 400);
  }

  const id =
    typeof body.id === 'string' && UUID_PATTERN.test(body.id)
      ? body.id
      : crypto.randomUUID();
  const now = new Date().toISOString();
  const user = c.get('user');
  const userId = user?.id ?? null;

  const project: Project = {
    id,
    name:
      typeof body.name === 'string' && body.name
        ? body.name
        : '未命名项目',
    description:
      typeof body.description === 'string' ? body.description : '',
    status: 'draft',
    framework: normalizeFramework(body.framework),
    files: {
      [ENTRY_FILE_PATH]: {
        path: ENTRY_FILE_PATH,
        content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>新应用</title>
</head>
<body>
  <p>开始描述你的应用...</p>
</body>
</html>`,
        language: 'html',
        updatedAt: now,
      },
    },
    chat: [],
    preview: {
      extraSandboxFlags: [],
      sizeMode: 'autoHeight',
    },
    createdAt: now,
    updatedAt: now,
  };

  db.createProject(project, userId);

  return c.json({ id }, 201);
});

/**
 * PUT body 结构（部分更新）。
 */
interface UpdateProjectBody {
  name?: unknown;
  description?: unknown;
  status?: unknown;
  framework?: unknown;
  files?: unknown;
  chat?: unknown;
  preview?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 校验 files 字段格式。
 * files 必须是 Record<string, FileNode>，每个 FileNode 必须包含必需字段。
 */
function isValidFiles(v: unknown): v is Record<string, { path: string; content: string; language: string; updatedAt: string }> {
  if (!isObject(v)) {
    return false;
  }

  for (const [key, file] of Object.entries(v)) {
    if (!isObject(file)) {
      return false;
    }

    // 检查必需字段
    if (typeof file.path !== 'string') {
      return false;
    }
    if (typeof file.content !== 'string') {
      return false;
    }
    if (typeof file.language !== 'string') {
      return false;
    }
    if (typeof file.updatedAt !== 'string') {
      return false;
    }

    // key 应该与 file.path 一致
    if (key !== file.path) {
      return false;
    }
  }

  return true;
}

/**
 * PUT /api/projects/:id
 * 更新项目（部分更新）。
 * 按 userId 隔离：只能更新自己的项目。
 */
projectsRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const userId = user?.id ?? null;

  const existing = db.getProject(id, userId);

  if (!existing) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as UpdateProjectBody;
  const current = existing.data;

  // files 字段格式校验
  if (body.files !== undefined && !isValidFiles(body.files)) {
    return c.json({ error: 'files 字段格式错误：必须是 Record<string, FileNode>，每个 FileNode 包含 path、content、language、updatedAt 字段，且 key 与 path 一致' }, 400);
  }

  const updated: Project = {
    ...current,
    name:
      typeof body.name === 'string' ? body.name : current.name,
    description:
      typeof body.description === 'string'
        ? body.description
        : current.description,
    status:
      typeof body.status === 'string' &&
      (STATUS_VALUES as readonly string[]).includes(body.status)
        ? (body.status as ProjectStatus)
        : current.status,
    // framework：请求未携带时保持库内现值（存量项目可能无该字段）；携带时经归一化（非法回退 html）
    framework:
      body.framework === undefined
        ? current.framework
        : normalizeFramework(body.framework),
    files: body.files !== undefined
      ? (body.files as Project['files'])
      : current.files,
    chat: Array.isArray(body.chat) ? body.chat : current.chat,
    preview: isObject(body.preview)
      ? (body.preview as unknown as Project['preview'])
      : current.preview,
    updatedAt: new Date().toISOString(),
  };

  const success = db.updateProject(id, updated, userId);

  return c.json({ success });
});

/**
 * DELETE /api/projects/:id
 * 删除项目。
 * 按 userId 隔离：只能删除自己的项目。
 */
projectsRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const userId = user?.id ?? null;

  const success = db.deleteProject(id, userId);

  if (!success) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // 项目已删除，尽力清理其部署目录与部署记录（失败不影响删除主流程）
  cleanupProjectDeployment(id);

  return c.json({ success: true });
});