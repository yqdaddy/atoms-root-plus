/**
 * 部署路由：把生成的项目文件写入服务器本地目录，经 Nginx 静态托管。
 *
 * POST   /api/deploy          部署（覆盖式，幂等）
 * GET    /api/deploy/:projectId  查询最近一次部署记录
 * DELETE /api/deploy/:projectId  下线并清理部署目录与记录
 *
 * 安全设计：
 * - 强制登录（requireAuth）：写服务器文件系统属于特权操作，不允许游客调用
 * - projectId 白名单校验（仅字母数字连字符），目录路径再经 resolve 前缀二次校验
 * - 文件路径逐段校验：拒绝绝对路径、..、反斜杠、隐藏段；扩展名白名单
 * - 单文件 10MB、单项目总量 50MB、文件数 500 上限
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { requireAuth } from '../auth.js';
import * as db from '../db.js';
import type { AppEnv } from '../types.js';
import { PROJECT_ID_PATTERN } from '../types.js';

export const deployRouter = new Hono<AppEnv>();

// ============ 配置 ============

/** 部署根目录（Nginx alias 指向此处） */
const DEPLOY_DIR = process.env.DEPLOY_DIR || '/var/www/atoms-projects';

/** 部署 URL 前缀，需与 Nginx 的 location/alias 配置对应 */
const DEPLOY_BASE_URL = process.env.DEPLOY_BASE_URL || '/projects';

/** 单文件大小上限：10MB（以 UTF-8 字节数计） */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 单项目总大小上限：50MB */
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

/** 单项目文件数上限 */
const MAX_FILE_COUNT = 500;

/**
 * 静态资源扩展名白名单。
 * 仅收文本类静态资源：请求体是 JSON 字符串，二进制格式经 JSON 传输会损坏。
 */
const ALLOWED_EXTENSIONS = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'json',
  'map',
  'svg',
  'txt',
  'csv',
  'md',
  'xml',
  'webmanifest',
]);

// ============ 校验工具 ============

/** 请求体结构 */
interface DeployBody {
  projectId?: unknown;
  projectName?: unknown;
  files?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 校验并规范化单个文件路径。
 * 返回去掉开头斜杠的相对路径；不合法返回 null。
 *
 * 规则：
 * - 仅接受 POSIX 风格相对路径（/index.html 视为 index.html）
 * - 拒绝 .. 段、. 开头的隐藏段、空段、反斜杠
 * - 扩展名必须在白名单内
 */
function normalizeRelativePath(rawPath: string): string | null {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
  if (rawPath.includes('\\')) return null;
  if (rawPath.includes('\0')) return null;

  const trimmed = rawPath.replace(/^\/+/, '');
  if (trimmed.length === 0) return null;

  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment.length === 0) return null; // 连续斜杠
    if (segment === '.' || segment === '..') return null; // 目录穿越
    if (segment.startsWith('.')) return null; // 隐藏文件/目录
  }

  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) return null;
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) return null; // 无扩展名或 .gitignore 式文件
  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;

  return segments.join('/');
}

/**
 * 计算项目部署目录，并做 resolve 后的前缀二次校验。
 * PROJECT_ID_PATTERN 已保证 projectId 不含路径分隔符，此处校验兜底。
 */
function resolveProjectDir(projectId: string): string | null {
  const root = resolve(DEPLOY_DIR);
  const projectDir = resolve(root, projectId);
  // 防御性兜底：确保最终目录仍位于部署根目录之内
  if (projectDir !== root && !projectDir.startsWith(root + sep)) {
    return null;
  }
  return projectDir;
}

/**
 * 部署文件写入目录（先清空旧内容，再写入新文件，保证幂等且无残留）。
 * 任一步骤失败抛错，由调用方回滚记录（记录在写盘成功后才入库）。
 */
function writeProjectFiles(
  projectDir: string,
  files: Map<string, string>,
): void {
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });

  for (const [relativePath, content] of files) {
    const filePath = resolve(projectDir, relativePath);
    // 最终防线：写入路径必须仍在项目目录内
    if (!filePath.startsWith(projectDir + sep)) {
      throw new Error(`文件路径越界：${relativePath}`);
    }
    const fileDir = dirname(filePath);
    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }
    writeFileSync(filePath, content, 'utf-8');
  }
}

/** 构造部署 URL（优先 DEPLOY_BASE_URL 环境变量，缺省相对当前请求来源） */
function buildDeployUrl(c: { req: { url: string } }, projectId: string): string {
  const base = DEPLOY_BASE_URL.startsWith('http')
    ? DEPLOY_BASE_URL
    : `${new URL(c.req.url).origin}${DEPLOY_BASE_URL}`;
  return `${base.replace(/\/+$/, '')}/${projectId}/`;
}

// ============ 路由 ============

// 全路由强制认证：写文件系统是特权操作
deployRouter.use('*', requireAuth);

/**
 * POST /api/deploy
 * 请求体：{ projectId, projectName?, files: Record<string, string> }
 * 响应：{ deployUrl, deployedAt, fileCount, totalSize }
 */
deployRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as DeployBody;

  // 1. projectId 校验（路径安全第一道闸）
  if (typeof body.projectId !== 'string' || !PROJECT_ID_PATTERN.test(body.projectId)) {
    return c.json(
      { error: 'projectId 不合法：仅允许字母、数字和连字符（1-64 位）' },
      400,
    );
  }
  const projectId = body.projectId;

  const projectDir = resolveProjectDir(projectId);
  if (!projectDir) {
    return c.json({ error: 'projectId 解析后的路径越界' }, 400);
  }

  // 2. files 校验
  if (!isObject(body.files) || Object.keys(body.files).length === 0) {
    return c.json({ error: 'files 不能为空' }, 400);
  }
  if (Object.keys(body.files).length > MAX_FILE_COUNT) {
    return c.json({ error: `文件数超过上限（${MAX_FILE_COUNT}）` }, 400);
  }

  const normalizedFiles = new Map<string, string>();
  let totalSize = 0;
  for (const [rawPath, content] of Object.entries(body.files)) {
    if (typeof content !== 'string') {
      return c.json({ error: `文件内容必须为字符串：${rawPath}` }, 400);
    }
    const relativePath = normalizeRelativePath(rawPath);
    if (!relativePath) {
      return c.json(
        { error: `文件路径或类型不合法：${rawPath}（仅允许 html/css/js/json/svg 等文本静态资源）` },
        400,
      );
    }
    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > MAX_FILE_SIZE) {
      return c.json({ error: `单文件超过 10MB 上限：${rawPath}` }, 400);
    }
    totalSize += byteLength;
    if (totalSize > MAX_TOTAL_SIZE) {
      return c.json({ error: '项目总大小超过 50MB 上限' }, 400);
    }
    normalizedFiles.set(relativePath, content);
  }

  // 3. 静态站点入口要求：Nginx index 指向 index.html
  if (!normalizedFiles.has('index.html')) {
    return c.json({ error: '缺少入口文件 index.html' }, 400);
  }

  // 4. 写盘（幂等：整目录重建）
  try {
    writeProjectFiles(projectDir, normalizedFiles);
  } catch (error) {
    console.error(`[deploy] 写入部署目录失败 (${projectId}):`, error);
    return c.json(
      { error: '写入部署目录失败，请检查服务器 DEPLOY_DIR 权限' },
      500,
    );
  }

  // 5. 记录入库
  const deployedAt = new Date().toISOString();
  const deployUrl = buildDeployUrl(c, projectId);
  try {
    db.createDeployment({
      id: randomUUID(),
      projectId,
      deployUrl,
      deployedAt,
      fileCount: normalizedFiles.size,
      totalSize,
    });
  } catch (error) {
    // 文件已写成功，记录失败不阻断部署结果，仅告警
    console.error(`[deploy] 部署记录入库失败 (${projectId}):`, error);
  }

  return c.json({ deployUrl, deployedAt, fileCount: normalizedFiles.size, totalSize }, 201);
});

/**
 * GET /api/deploy/:projectId
 * 查询项目最近一次部署记录。
 */
deployRouter.get('/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return c.json({ error: 'projectId 不合法' }, 400);
  }
  const record = db.getLatestDeploymentByProjectId(projectId);
  if (!record) {
    return c.json({ error: '该项目尚未部署' }, 404);
  }
  return c.json(record);
});

/**
 * DELETE /api/deploy/:projectId
 * 下线项目：删除部署目录与部署记录。
 */
deployRouter.delete('/:projectId', (c) => {
  const projectId = c.req.param('projectId');
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return c.json({ error: 'projectId 不合法' }, 400);
  }

  const projectDir = resolveProjectDir(projectId);
  if (projectDir && existsSync(projectDir)) {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`[deploy] 清理部署目录失败 (${projectId}):`, error);
      return c.json({ error: '清理部署目录失败' }, 500);
    }
  }

  db.deleteDeploymentsByProjectId(projectId);
  return c.json({ success: true });
});

/**
 * 项目删除时的部署清理（供 projects 路由调用）。
 * 尽力而为：失败仅告警，不影响项目删除主流程。
 */
export function cleanupProjectDeployment(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) return;
  try {
    const projectDir = resolveProjectDir(projectId);
    if (projectDir && existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    db.deleteDeploymentsByProjectId(projectId);
  } catch (error) {
    console.error(`[deploy] 项目删除时的部署清理失败 (${projectId}):`, error);
  }
}
