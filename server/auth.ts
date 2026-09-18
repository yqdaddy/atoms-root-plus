/**
 * 用户认证模块。
 * 密码哈希（scrypt + pepper）、会话管理、Hono 中间件。
 */
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import * as db from './db.js';
import type { AppEnv, SessionUser } from './types.js';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8; // block size
const SCRYPT_P = 1; // parallelization
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
export const SESSION_COOKIE = 'atoms_session';

/**
 * 获取 pepper（从 AUTH_SESSION_SECRET 派生）。
 * 若未配置，使用固定值并打印警告（仅限开发）。
 */
let pepper: Buffer | null = null;
let pepperWarned = false;

function getPepper(): Buffer {
  if (pepper) return pepper;
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    if (!pepperWarned) {
      console.warn(
        '[auth] AUTH_SESSION_SECRET 未配置，使用默认值（仅限开发环境）',
      );
      pepperWarned = true;
    }
    pepper = createHash('sha256').update('atoms-demo-dev-pepper').digest();
    return pepper;
  }
  pepper = createHash('sha256').update(secret).digest();
  return pepper;
}

/**
 * 哈希密码（scrypt + HMAC-SHA256 pepper）。
 * 存储格式：scrypt$N$r$p$saltB64$hashB64
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  const stored = createHmac('sha256', getPepper()).update(key).digest();
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${stored.toString('base64')}`;
}

/**
 * 校验密码。
 * 常量时间比较，防时序攻击。
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$');
  // 格式校验
  if (
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    typeof parts[1] !== 'string' ||
    typeof parts[2] !== 'string' ||
    typeof parts[3] !== 'string' ||
    typeof parts[4] !== 'string' ||
    typeof parts[5] !== 'string'
  ) {
    return false;
  }

  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);

  // 参数边界：防止恶意存储值导致资源耗尽
  if (
    !Number.isFinite(n) ||
    !Number.isFinite(r) ||
    !Number.isFinite(p) ||
    n < 16384 ||
    n > 2 ** 21 ||
    r < 1 ||
    r > 64 ||
    p < 1 ||
    p > 8
  ) {
    return false;
  }

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');

  // HMAC-SHA256 输出固定 32 字节
  if (expected.length !== 32) {
    return false;
  }

  try {
    // scrypt 密钥长度必须与注册时一致（64 字节），之后再做 HMAC
    const key = await scrypt(password, salt, KEY_LENGTH);
    const actual = createHmac('sha256', getPepper()).update(key).digest();

    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * 计算会话令牌哈希（SHA-256，hex）。
 * 数据库存储哈希而非原始令牌，降低泄露风险。
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 创建会话，返回原始令牌。
 */
export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  db.createSession({
    tokenHash: hashToken(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return token;
}

/**
 * 从上下文获取当前会话用户。
 */
export function getSessionUser(c: Context<AppEnv>): SessionUser | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const row = db.getValidSessionByTokenHash(
    hashToken(token),
    new Date().toISOString(),
  );
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
  };
}

/**
 * 销毁会话（删除数据库记录并清除 cookie）。
 */
export function destroySession(c: Context<AppEnv>): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    db.deleteSessionByTokenHash(hashToken(token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/**
 * 设置会话 cookie。
 */
export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * 可选认证中间件。
 * 若有有效会话，设置 c.set('user', user)；否则设置为 null。
 */
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', getSessionUser(c));
  await next();
});

/**
 * 强制认证中间件。
 * 未登录返回 401。
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = getSessionUser(c);
  if (!user) {
    return c.json({ error: '未登录或会话已过期' }, 401);
  }
  c.set('user', user);
  await next();
});

/**
 * 预计算一个用于抗时序攻击的 dummy 哈希。
 * 用于登录时用户不存在的场景（避免通过响应时间枚举用户名）。
 */
const DUMMY_PASSWORD = 'dummy-password-for-timing';
let DUMMY_HASH: string | null = null;

async function getDummyHash(): Promise<string> {
  if (!DUMMY_HASH) {
    DUMMY_HASH = await hashPassword(DUMMY_PASSWORD);
  }
  return DUMMY_HASH;
}

/**
 * 执行一次 dummy 密码验证（耗时可与真实验证接近）。
 */
export async function verifyDummyPassword(): Promise<boolean> {
  return verifyPassword(DUMMY_PASSWORD, await getDummyHash());
}