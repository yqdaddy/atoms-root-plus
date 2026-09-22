/**
 * 健康检查路由。
 */
import type { Context } from 'hono';

export function healthHandler(c: Context) {
  const gitSha = process.env.GIT_SHA_SHORT || 'dev';
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: gitSha,
  });
}