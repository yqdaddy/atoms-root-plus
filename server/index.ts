/**
 * 轻量化服务端入口。
 * 纯 API 服务：Hono + SQLite。
 * 前端托管不在本服务职责内：开发由 Vite dev server 承担（反向代理 /api），
 * 生产由 nginx 托管 dist 静态产物并反向代理 /api 到本服务（见 docs/deploy-guide.md）。
 */
import './env.js'; // 确保最先加载 .env

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { healthHandler } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { llmRouter } from './routes/llm.js';
import { authRouter } from './routes/auth.js';
import { shareRouter } from './routes/share.js';
import { deployRouter } from './routes/deploy.js';
import { closeDatabase } from './db.js';

const app = new Hono();

// CORS 配置
const isProduction = process.env.NODE_ENV === 'production';
app.use(
  '*',
  cors({
    origin: isProduction
      ? [] // 生产同源
      : [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'http://localhost:5176',
          'http://localhost:3000',
        ], // 开发允许前端 dev server
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  }),
);

// API 路由
app.route('/api/health', new Hono().get('/', healthHandler));
app.route('/api/auth', authRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/llm', llmRouter);
app.route('/api/share', shareRouter);
app.route('/api/deploy', deployRouter);

// 优雅关闭
process.on('SIGINT', () => {
  console.log('Shutting down...');
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  closeDatabase();
  process.exit(0);
});

// 启动服务器
const port = Number(process.env.PORT) || 3000;

console.log(`Server starting on port ${port}...`);
console.log(`API: http://localhost:${port}/api`);
// 安全的环境变量摘要（不打印密钥值）
const hasApiKey = process.env.LLM_API_KEY ? '已配置' : '未配置';
const baseUrl = process.env.LLM_BASE_URL || 'https://api.agnes-ai.cn/v1';
const model = process.env.LLM_MODEL || 'agnes-3.0-flash';
const hasAuthSecret = process.env.AUTH_SESSION_SECRET ? '已配置' : '未配置';
console.log(
  `[env] LLM_API_KEY=${hasApiKey} LLM_BASE_URL=${baseUrl} LLM_MODEL=${model} AUTH_SESSION_SECRET=${hasAuthSecret}`,
);

serve({
  fetch: app.fetch,
  port,
  hostname: '127.0.0.1', // 仅监听本机回环：开发由 Vite 代理转发，生产由 nginx 反代，不直接对外
});

console.log(`Server running on http://localhost:${port}`);

// 通知 pm2 服务已就绪（配合 ecosystem.config.js 的 wait_ready）
if (process.send) {
  setTimeout(() => process.send!('ready'), 100);
}