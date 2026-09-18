/**
 * 轻量化服务端入口。
 * Hono + SQLite + 静态文件托管，单进程部署。
 */
import './env.js'; // 确保最先加载 .env

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { healthHandler } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { llmRouter } from './routes/llm.js';
import { authRouter } from './routes/auth.js';
import { closeDatabase } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

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

// 静态文件托管（前端构建产物）
app.get('/assets/*', (c) => {
  const path = c.req.path;
  const filePath = join(DIST_DIR, path);

  if (!existsSync(filePath)) {
    return c.text('Not found', 404);
  }

  const content = readFileSync(filePath);
  const ext = path.split('.').pop() || 'js';

  const mimeTypes: Record<string, string> = {
    js: 'application/javascript',
    css: 'text/css',
    html: 'text/html',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    svg: 'image/svg+xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };

  return c.body(content, 200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
});

// SPA fallback：所有未匹配路由返回 index.html
app.get('*', (c) => {
  const indexPath = join(DIST_DIR, 'index.html');

  if (!existsSync(indexPath)) {
    return c.html(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atoms Demo</title>
</head>
<body>
  <div id="root"></div>
  <p style="padding: 2rem; color: #666;">
    前端构建产物未找到。请先运行 <code>npm run build</code>
  </p>
</body>
</html>
    `);
  }

  const html = readFileSync(indexPath, 'utf-8');
  return c.html(html);
});

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
console.log(`Static files: ${DIST_DIR}`);
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
});

console.log(`Server running on http://localhost:${port}`);