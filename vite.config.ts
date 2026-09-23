import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { execSync } from 'child_process';

// 构建时获取 Git SHA（短格式）
function getGitSha(): string {
  try {
    // 优先使用环境变量（CI/CD 注入）
    if (process.env.GIT_SHA) {
      return process.env.GIT_SHA.substring(0, 7);
    }
    // 回退到 git 命令
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

const gitSha = getGitSha();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname ?? '.', './src'),
    },
  },
  // 注入 Git SHA 环境变量
  define: {
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
  },
  // Vitest 配置
  test: {
    exclude: [
      'node_modules/**',
      'dist/**',
      'dist-server/**',
      // E2E 测试归 Playwright 运行（npm run test:e2e），不归 vitest
      'tests/e2e/**',
    ],
  },
  build: {
    rolldownOptions: {
      // 生产构建移除 console.log / console.debug 调试日志；
      // console.warn / console.error 保留用于错误上报
      treeshake: {
        manualPureFunctions: ['console.log', 'console.debug'],
      },
      output: {
        // Rolldown manualChunks 必须是函数形式
        manualChunks(id) {
          // React 核心框架
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/')) {
            return 'vendor-react';
          }
          // Markdown 渲染器
          if (id.includes('node_modules/react-markdown/')) {
            return 'vendor-markdown';
          }
          // 图标库
          if (id.includes('node_modules/@iconify/')) {
            return 'vendor-icons';
          }
          // 不再自动归类其他 node_modules，让动态导入自然拆分
          return undefined;
        },
      },
    },
  },
  server: {
    host: true, // 监听 0.0.0.0，允许局域网访问
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // SSE 防缓冲：确保流式响应逐块转发
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
});