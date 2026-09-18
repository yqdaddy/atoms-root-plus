/**
 * 用户认证路由。
 * 注册、登录、登出、获取当前用户。
 */
import { Hono } from 'hono';
import {
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyDummyPassword,
  verifyPassword,
} from '../auth.js';
import * as db from '../db.js';
import type { AppEnv, IsoDateTime } from '../types.js';

export const authRouter = new Hono<AppEnv>();

/**
 * 用户名格式：3-32 字符，字母数字下划线及 CJK 基本区汉字。
 */
const USERNAME_PATTERN = /^[A-Za-z0-9_一-龥]{3,32}$/u;

function validateUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim();
  if (!USERNAME_PATTERN.test(name)) return null;
  return name;
}

function validatePassword(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length < 6 || v.length > 128) return null;
  return v;
}

/**
 * POST /api/auth/register
 * Body: { username: string, password: string }
 * 返回: { user: { id, username, createdAt } }
 */
authRouter.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);

  if (!username) {
    return c.json({ error: '用户名需为 3-32 位字母、数字、下划线或汉字' }, 400);
  }
  if (!password) {
    return c.json({ error: '密码需为 6-128 位' }, 400);
  }

  const id = crypto.randomUUID();
  const now: IsoDateTime = new Date().toISOString();

  const passwordHash = await hashPassword(password);

  try {
    db.createUser({
      id,
      username,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return c.json({ error: '用户名已被占用' }, 409);
    }
    throw err;
  }

  const token = createSession(id);
  setSessionCookie(c, token);

  return c.json(
    {
      user: {
        id,
        username,
        createdAt: now,
      },
    },
    201,
  );
});

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * 返回: { user: { id, username, createdAt } }
 */
authRouter.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);

  if (!username || !password) {
    // 仍执行 dummy 验证以恒定时间
    await verifyDummyPassword();
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const row = db.getUserByUsername(username);
  if (!row) {
    await verifyDummyPassword();
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const token = createSession(row.id);
  setSessionCookie(c, token);

  return c.json({
    user: {
      id: row.id,
      username: row.username,
      createdAt: row.createdAt,
    },
  });
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (c) => {
  destroySession(c);
  return c.json({ success: true });
});

/**
 * GET /api/auth/me
 * 返回当前登录用户信息
 */
authRouter.get('/me', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ user });
});

/**
 * 判断是否为唯一约束冲突错误。
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (!('code' in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE';
}