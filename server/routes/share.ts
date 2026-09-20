/**
 * 分享功能路由
 * POST /api/share - 保存分享内容
 * GET /api/share/:id - 获取分享内容
 */
import { Hono } from 'hono';
import { db } from '../db.js';

export const shareRouter = new Hono();

/** 分享数据表结构 */
interface ShareRecord {
  id: string;
  html: string;
  project_name: string | null;
  created_at: number;
  expires_at: number;
}

// 确保分享表存在
function ensureShareTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      html TEXT NOT NULL,
      project_name TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  // 创建索引加速查询
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at)`);
}

// 初始化表
ensureShareTable();

/** 生成随机分享 ID */
function generateShareId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/** 清理过期分享 */
function cleanupExpiredShares() {
  const now = Date.now();
  db.prepare(`DELETE FROM shares WHERE expires_at < ?`).run(now);
}

/**
 * POST /api/share
 * 保存分享内容
 */
shareRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { html, projectName } = body;

    if (!html || typeof html !== 'string') {
      return c.json({ error: 'HTML 内容不能为空' }, 400);
    }

    // 清理过期数据
    cleanupExpiredShares();

    const id = generateShareId();
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 天后过期

    db.prepare(
      `INSERT INTO shares (id, html, project_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(id, html, projectName || null, now, expiresAt);

    return c.json({ id, expiresAt });
  } catch (error) {
    console.error('[share] 保存失败:', error);
    return c.json({ error: '保存分享内容失败' }, 500);
  }
});

/**
 * GET /api/share/:id
 * 获取分享内容
 */
shareRouter.get('/:id', (c) => {
  try {
    const id = c.req.param('id');

    if (!id || !/^[a-z0-9]{8}$/.test(id)) {
      return c.json({ error: '无效的分享 ID' }, 400);
    }

    const row = db.prepare(
      `SELECT id, html, project_name, created_at, expires_at FROM shares WHERE id = ?`
    ).get(id) as ShareRecord | undefined;

    if (!row) {
      return c.json({ error: '分享链接不存在或已过期' }, 404);
    }

    // 检查是否过期
    if (Date.now() > row.expires_at) {
      // 删除过期数据
      db.prepare(`DELETE FROM shares WHERE id = ?`).run(id);
      return c.json({ error: '分享链接已过期' }, 410);
    }

    return c.json({
      id: row.id,
      html: row.html,
      projectName: row.project_name,
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error('[share] 获取失败:', error);
    return c.json({ error: '获取分享内容失败' }, 500);
  }
});