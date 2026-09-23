# WebContainer API 集成方案调研报告

> **调研日期**: 2024-09
> **调研目标**: 评估 WebContainer API 集成的技术可行性、实现方案与风险

---

## 1. 技术概述

### 1.1 WebContainer 是什么

WebContainer 是 StackBlitz 开发的浏览器内 Node.js 运行时，通过 Service Worker 和 Web Streams API 在浏览器中实现了 Node.js 环境的核心功能。

**核心能力**：
- 完整的文件系统 API（fs, path）
- Node.js 模块系统（require, import）
- npm 包安装（package.json + node_modules）
- 开发服务器（HTTP server）
- 网络请求拦截

**技术架构**：
```
┌─────────────────────────────────────┐
│         主线程（Main Thread）         │
│  ┌─────────────────────────────┐   │
│  │  WebContainer API Client    │   │
│  └──────────┬──────────────────┘   │
│             │ postMessage           │
└─────────────┼───────────────────────┘
              │
┌─────────────▼───────────────────────┐
│      Service Worker Thread          │
│  ┌─────────────────────────────┐   │
│  │  WebContainer Runtime       │   │
│  │  - Virtual File System      │   │
│  │  - Node.js Polyfills        │   │
│  │  - npm Package Manager      │   │
│  │  - HTTP Server              │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 1.2 与现有方案的对比

| 特性 | 现有 iframe sandbox | WebContainer |
|------|---------------------|--------------|
| 文件系统 | 单个 HTML（srcdoc） | 完整文件系统 |
| Node.js API | 无 | 支持核心 API |
| npm 包 | 仅 CDN 引入 | 真实 node_modules |
| 开发服务器 | 无 | 内置 HTTP server |
| 代码执行 | eval（不安全） | 沙箱隔离 |
| 跨域资源 | 受限 | 网络拦截支持 |
| 数据库 | 无 | 支持 SQLite（sql.js） |

---

## 2. 技术可行性分析

### 2.1 适用场景评估

**适合 WebContainer 的场景**：
- 用户生成 React/Vue 等 Node.js 项目
- 需要安装 npm 依赖
- 需要运行开发服务器
- 需要真实的文件系统操作
- 需要使用 Node.js API（path, fs, crypto）

**不适合的场景**：
- 简单静态页面（现有方案更轻量）
- 需要原生模块（如 sharp, canvas）
- 长时间运行的后端服务（内存限制）
- 需要数据库持久化（仅支持内存数据库）

**Litpp Demo 的需求匹配度**：

| 需求 | 匹配度 | 说明 |
|------|--------|------|
| 生成 React/Vue 应用 | ✅ 高 | WebContainer 天然支持 |
| 实时预览 | ✅ 高 | 内置 dev server |
| 文件系统操作 | ✅ 高 | 完整 fs API |
| npm 包安装 | ✅ 高 | 支持真实 npm |
| 数据持久化 | ⚠️ 中 | 需配合 localStorage |
| 跨浏览器支持 | ⚠️ 中 | 仅 Chromium |
| 性能与内存 | ⚠️ 中 | 受限浏览器资源 |

**结论**: 对于用户生成现代前端项目的场景，WebContainer 是**高度适用**的。

### 2.2 与 iframe sandbox 的集成

**现有架构**:
```
用户需求 → AI 生成代码 → 组装为单个 HTML → iframe sandbox（srcdoc）
```

**WebContainer 集成架构**:
```
用户需求 → AI 生成项目文件 → WebContainer 文件系统 → dev server → iframe 预览
```

**集成方式**:

**方案 A：替换现有沙箱**
```typescript
// 初始化 WebContainer
const container = await WebContainer.boot();

// 写入文件
await container.mount([
  { name: 'package.json', contents: packageJson },
  { name: 'src/index.tsx', contents: appCode },
]);

// 安装依赖
const exitCode = await container.spawn('npm', ['install']);

// 启动开发服务器
await container.spawn('npm', ['run', 'dev']);

// 监听 server ready
container.on('server-ready', (port, url) => {
  // 将 url 注入 iframe
  iframe.src = url;
});
```

**方案 B：混合模式**
- 简单静态页面 → 现有 iframe sandbox
- Node.js 项目 → WebContainer

```typescript
async function previewProject(files: ProjectFiles) {
  const hasNodeDeps = files['package.json']?.dependencies;

  if (hasNodeDeps) {
    // 使用 WebContainer
    return runInWebContainer(files);
  } else {
    // 使用现有 sandbox
    return runInSandbox(files);
  }
}
```

**推荐方案**: **混合模式**，按需选择运行环境。

---

## 3. 实现方案

### 3.1 核心依赖

```json
{
  "dependencies": {
    "@webcontainer/api": "^1.1.0"
  }
}
```

### 3.2 初始化 WebContainer

**关键要求**: 必须配置特定的 HTTP Headers

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

**初始化代码**:
```typescript
// src/services/webcontainer/index.ts
import { WebContainer } from '@webcontainer/api';

let container: WebContainer | null = null;

export async function getContainer(): Promise<WebContainer> {
  if (container) return container;

  container = await WebContainer.boot();
  console.log('WebContainer initialized');

  return container;
}

export async function disposeContainer() {
  if (container) {
    await container.teardown();
    container = null;
  }
}
```

### 3.3 文件系统操作

**类型定义**:
```typescript
// src/types/webcontainer.ts
export interface FileSystemTree {
  [name: string]: FileNode | DirectoryNode;
}

export interface FileNode {
  file: {
    contents: string | Uint8Array;
  };
}

export interface DirectoryNode {
  directory: FileSystemTree;
}

export interface ProjectFiles {
  [path: string]: string;
}
```

**写入文件**:
```typescript
// src/services/webcontainer/filesystem.ts
import { WebContainer } from '@webcontainer/api';
import type { ProjectFiles, FileSystemTree } from '@/types/webcontainer';

function buildFileSystemTree(files: ProjectFiles): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split('/');
    let current = tree;

    // 创建目录结构
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!current[dir]) {
        current[dir] = { directory: {} };
      }
      current = (current[dir] as DirectoryNode).directory;
    }

    // 创建文件
    const fileName = parts[parts.length - 1];
    current[fileName] = {
      file: { contents }
    };
  }

  return tree;
}

export async function writeFiles(
  container: WebContainer,
  files: ProjectFiles
): Promise<void> {
  const tree = buildFileSystemTree(files);
  await container.mount(tree);
}

export async function readFile(
  container: WebContainer,
  path: string
): Promise<string> {
  const file = await container.fs.readFile(path, 'utf-8');
  return file;
}

export async function deleteFile(
  container: WebContainer,
  path: string
): Promise<void> {
  await container.fs.rm(path);
}
```

### 3.4 运行开发服务器

```typescript
// src/services/webcontainer/server.ts
import { WebContainer } from '@webcontainer/api';

export interface DevServer {
  port: number;
  url: string;
  status: 'starting' | 'ready' | 'error';
}

export async function startDevServer(
  container: WebContainer,
  command: string = 'npm run dev'
): Promise<DevServer> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(' ');

    // 监听 server-ready 事件
    container.on('server-ready', (port, url) => {
      resolve({
        port,
        url,
        status: 'ready'
      });
    });

    // 监听错误
    container.on('error', (error) => {
      reject(new Error(`Dev server error: ${error.message}`));
    });

    // 启动进程
    container.spawn(cmd, args, {
      stderr: (data) => console.error('[stderr]', data),
      stdout: (data) => console.log('[stdout]', data),
    });
  });
}
```

### 3.5 npm 包安装

```typescript
// src/services/webcontainer/npm.ts
import { WebContainer } from '@webcontainer/api';

export interface InstallResult {
  success: boolean;
  output: string;
}

export async function installDependencies(
  container: WebContainer
): Promise<InstallResult> {
  return new Promise((resolve) => {
    let output = '';

    const process = container.spawn('npm', ['install'], {
      stdout: (data) => output += data,
      stderr: (data) => output += data,
    });

    process.then(({ exitCode }) => {
      resolve({
        success: exitCode === 0,
        output
      });
    });
  });
}
```

### 3.6 React/Vue 项目模板

**最小 React 项目**:
```json
// package.json
{
  "name": "generated-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0"
  }
}
```

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
});
```

### 3.7 预览集成

```typescript
// src/services/webcontainer/preview.ts
import type { DevServer } from './server';

export interface PreviewOptions {
  server: DevServer;
  containerId: string;
}

export function createPreviewUrl(server: DevServer): string {
  // WebContainer 会提供可访问的 URL
  return server.url;
}

export function injectPreview(
  iframe: HTMLIFrameElement,
  server: DevServer
): void {
  // 直接加载 WebContainer 提供的开发服务器 URL
  iframe.src = server.url;
}
```

---

## 4. 安全性分析

### 4.1 与现有方案的安全性对比

| 安全特性 | iframe sandbox | WebContainer |
|---------|---------------|--------------|
| 代码隔离 | ✅ 同源策略隔离 | ✅ Service Worker 隔离 |
| 文件系统访问 | ❌ 无 | ✅ 虚拟文件系统（受限） |
| 网络访问 | ⚠️ 受限 | ⚠️ 需配置 CORS |
| eval 使用 | ❌ 不安全 | ✅ 不使用 eval |
| 原生模块 | ❌ 不支持 | ❌ 不支持 |
| 进程隔离 | ❌ 无 | ⚠️ 同线程（受限） |

### 4.2 安全增强建议

**1. 文件系统隔离**
```typescript
// 每个项目独立 WebContainer 实例
const container = await WebContainer.boot({
  // 限制内存
  memory: 512 * 1024 * 1024, // 512MB
});
```

**2. 网络请求白名单**
```typescript
// 限制网络请求
container.on('request', (request) => {
  const url = new URL(request.url);

  // 只允许特定域名
  const allowedDomains = ['cdn.jsdelivr.net', 'unpkg.com'];
  if (!allowedDomains.some(d => url.hostname.endsWith(d))) {
    return new Response('Blocked', { status: 403 });
  }
});
```

**3. 资源限制**
```typescript
// 限制执行时间
const MAX_RUN_TIME = 30000; // 30 秒

const process = container.spawn('npm', ['run', 'dev']);

setTimeout(() => {
  if (!process.exited) {
    process.kill();
  }
}, MAX_RUN_TIME);
```

### 4.3 CSP 配置

```html
<!-- index.html -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:;
  worker-src 'self' blob:;
  connect-src 'self' https: wss:;
">
```

---

## 5. 限制与风险

### 5.1 浏览器兼容性

| 浏览器 | 支持情况 | 说明 |
|--------|---------|------|
| Chrome | ✅ 完全支持 | 推荐 v100+ |
| Edge | ✅ 完全支持 | Chromium 内核 |
| Firefox | ⚠️ 实验性 | 需启用标志 |
| Safari | ❌ 不支持 | WebKit 限制 |

**关键限制**:
- 需要启用 `Cross-Origin-Embedder-Policy` 头
- Safari 不支持 SharedArrayBuffer（WebContainer 依赖）
- Firefox 需手动启用 `dom.postMessage.sharedArrayBuffer.bypassCOOP_COEP.insecure.enabled`

**影响评估**:
- **Chrome/Edge 用户**: 无影响，完全支持
- **Firefox 用户**: 需提示用户使用 Chrome
- **Safari 用户**: 需降级到现有 sandbox 方案

### 5.2 性能与内存限制

**性能开销**:
- 首次加载: ~2-3MB（WebContainer runtime）
- 每个项目实例: ~50-100MB 基础内存
- npm install: 根据依赖数量，可能 10-100MB

**内存限制**:
- 浏览器内存限制: ~1-2GB（不同浏览器不同）
- 推荐同时运行项目数: 1-2 个
- 大型项目（如 Next.js）可能超出限制

**优化建议**:
```typescript
// 1. 单例模式，复用容器
let container: WebContainer | null = null;

export async function getContainer(): Promise<WebContainer> {
  if (container) return container;
  container = await WebContainer.boot();
  return container;
}

// 2. 清理旧项目文件
async function clearProject(container: WebContainer) {
  const files = await container.fs.readdir('/');
  for (const file of files) {
    if (file !== 'node_modules') {
      await container.fs.rm(file, { recursive: true });
    }
  }
}

// 3. 延迟加载
const WebContainer = await import('@webcontainer/api');
```

### 5.3 功能限制

**不支持的 Node.js API**:
- `child_process.spawn` 的原生进程
- `fs.watch` 的部分功能
- `crypto` 的部分原生加密
- `net` 模块的 TCP 连接

**不支持的原生模块**:
- `sharp`（图像处理）
- `canvas`（Canvas 绑定）
- `bcrypt`（加密）
- `better-sqlite3`（SQLite 绑定）

**替代方案**:
- `sharp` → `browser-image-compression`
- `canvas` → `canvas-api`（纯 JS 实现）
- `bcrypt` → `bcryptjs`（纯 JS 实现）
- `better-sqlite3` → `sql.js`（WebAssembly 实现）

### 5.4 开发体验限制

**热更新**:
- 支持 Vite/Webpack HMR
- 需配置开发服务器端口

**调试**:
- 无法使用 Node.js 调试器
- 依赖浏览器 DevTools
- console.log 输出需要转发

```typescript
// 转发 stdout/stderr
container.spawn('npm', ['run', 'dev'], {
  stdout: (data) => console.log('[container]', data),
  stderr: (data) => console.error('[container]', data),
});
```

---

## 6. 替代方案

### 6.1 Service Worker + Cache API

**优点**:
- 浏览器兼容性好
- 可实现虚拟文件系统
- 性能开销小

**缺点**:
- 无 Node.js 运行时
- 无法运行 npm 包
- 开发服务器需自行实现

**适用场景**: 简单静态项目、无需 npm 包的场景

### 6.2 OPFS（Origin Private File System）

**优点**:
- 浏览器原生文件系统 API
- 支持读写操作
- 性能较好

**缺点**:
- 无 Node.js API
- 无法运行 npm 包
- 浏览器兼容性要求高

**适用场景**: 需要真实文件系统持久化的场景

### 6.3 Pyodide（Python 运行时）

**优点**:
- 浏览器内 Python 运行时
- 支持 Python 包
- 科学生态丰富

**缺点**:
- 非 Node.js 生态
- 体积大（~10MB）
- 性能开销大

**适用场景**: Python 项目、数据科学场景

### 6.4 对比总结

| 方案 | Node.js 支持 | npm 包 | 文件系统 | 开发服务器 | 兼容性 |
|------|-------------|--------|---------|-----------|--------|
| WebContainer | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Service Worker | ❌ | ❌ | ⚠️ | ⚠️ | ✅ |
| OPFS | ❌ | ❌ | ✅ | ❌ | ⚠️ |
| Pyodide | ❌ (Python) | ✅ (PyPI) | ✅ | ⚠️ | ⚠️ |

**推荐**:
- **首选 WebContainer**（如果用户主要使用 Chrome/Edge）
- **降级方案**（Firefox/Safari 用户）使用现有 iframe sandbox

---

## 7. 实施计划

### 7.1 分阶段集成

**Phase 1: 基础集成（1-2 天）**
- [ ] 安装 @webcontainer/api 依赖
- [ ] 配置 HTTP Headers
- [ ] 实现容器初始化
- [ ] 实现文件系统操作

**Phase 2: React 项目支持（2-3 天）**
- [ ] 创建 React 项目模板
- [ ] 实现 npm install
- [ ] 实现开发服务器启动
- [ ] 集成到预览区

**Phase 3: Vue 项目支持（1-2 天）**
- [ ] 创建 Vue 项目模板
- [ ] 测试 Vue + Vite 工作流

**Phase 4: 优化与降级（2-3 天）**
- [ ] 实现浏览器检测
- [ ] 实现降级逻辑
- [ ] 性能优化
- [ ] 错误处理

### 7.2 风险缓解

**浏览器兼容性**:
```typescript
// 检测浏览器支持
function isWebContainerSupported(): boolean {
  const isChromium = /Chrome|Edge/.test(navigator.userAgent);
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  return isChromium && hasSharedArrayBuffer;
}

// 降级提示
if (!isWebContainerSupported()) {
  showNotification({
    title: '浏览器不支持',
    message: '当前浏览器不支持 Node.js 运行时，请使用 Chrome 或 Edge 获得完整体验',
    type: 'warning'
  });
}
```

**内存管理**:
```typescript
// 定期清理
setInterval(() => {
  if (container && Date.now() - lastActiveTime > 300000) { // 5 分钟无活动
    disposeContainer();
  }
}, 60000);
```

---

## 8. 推荐结论

### 8.1 是否推荐集成

**强烈推荐** ✅

**理由**:
1. **核心能力提升**: 从单文件 HTML 跃升到完整 Node.js 项目
2. **用户体验提升**: 支持真实 npm 包、开发服务器、热更新
3. **竞争力提升**: 对标 StackBlitz、CodeSandbox 的核心能力
4. **技术成熟度**: WebContainer 已被 StackBlitz 生产环境验证多年

### 8.2 集成建议

**推荐方案**: **混合模式**

```typescript
// 根据项目类型自动选择运行环境
async function previewProject(project: Project) {
  if (isNodeProject(project) && isWebContainerSupported()) {
    // 使用 WebContainer
    return runInWebContainer(project);
  } else {
    // 降级到现有 sandbox
    return runInSandbox(project);
  }
}

function isNodeProject(project: Project): boolean {
  return !!project.files['package.json'];
}
```

**降级策略**:
1. 检测浏览器兼容性
2. 不兼容时自动降级到 sandbox
3. 提供清晰的用户提示

### 8.3 预期收益

| 指标 | 现有方案 | 集成 WebContainer |
|------|---------|------------------|
| 项目类型 | 单文件 HTML | 完整 Node.js 项目 |
| npm 包 | 仅 CDN | 真实 node_modules |
| 开发体验 | 无 dev server | Vite/Webpack HMR |
| 用户覆盖 | 100% | ~70%（Chrome/Edge） |
| 竞争力 | 基础 | 高级 |

---

## 9. 参考资源

### 9.1 官方文档
- WebContainer 官网: https://webcontainers.io/
- API 文档: https://webcontainers.io/guides/quickstart
- GitHub: https://github.com/nativescript/webcontainer

### 9.2 示例项目
- StackBlitz: https://stackblitz.com/
- WebContainer 示例: https://github.com/nativescript/webcontainer-api-demo

### 9.3 社区资源
- Discord: https://discord.gg/stackblitz
- GitHub Issues: https://github.com/nativescript/webcontainer/issues

---

## 附录: 完整代码示例

### A. WebContainer 服务类

```typescript
// src/services/webcontainer/WebContainerService.ts
import { WebContainer } from '@webcontainer/api';
import type { ProjectFiles, FileSystemTree } from '@/types/webcontainer';

export class WebContainerService {
  private container: WebContainer | null = null;
  private server: DevServer | null = null;

  async initialize(): Promise<void> {
    if (this.container) return;

    this.container = await WebContainer.boot();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    this.container.on('server-ready', (port, url) => {
      this.server = { port, url, status: 'ready' };
    });

    this.container.on('error', (error) => {
      console.error('[WebContainer Error]', error);
    });
  }

  async writeFiles(files: ProjectFiles): Promise<void> {
    if (!this.container) throw new Error('Container not initialized');

    const tree = this.buildFileSystemTree(files);
    await this.container.mount(tree);
  }

  async installDependencies(): Promise<boolean> {
    if (!this.container) throw new Error('Container not initialized');

    const result = await this.container.spawn('npm', ['install']);
    return result.exitCode === 0;
  }

  async startDevServer(command: string = 'npm run dev'): Promise<DevServer> {
    if (!this.container) throw new Error('Container not initialized');

    const [cmd, ...args] = command.split(' ');
    this.container.spawn(cmd, args);

    // 等待 server-ready 事件
    return new Promise((resolve) => {
      const handler = (port: number, url: string) => {
        this.container!.off('server-ready', handler);
        resolve({ port, url, status: 'ready' });
      };
      this.container!.on('server-ready', handler);
    });
  }

  async dispose(): Promise<void> {
    if (this.container) {
      await this.container.teardown();
      this.container = null;
      this.server = null;
    }
  }

  getServer(): DevServer | null {
    return this.server;
  }

  private buildFileSystemTree(files: ProjectFiles): FileSystemTree {
    const tree: FileSystemTree = {};

    for (const [path, contents] of Object.entries(files)) {
      const parts = path.split('/');
      let current = tree;

      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i];
        if (!current[dir]) {
          current[dir] = { directory: {} };
        }
        current = (current[dir] as DirectoryNode).directory;
      }

      current[parts[parts.length - 1]] = {
        file: { contents }
      };
    }

    return tree;
  }
}

// 单例导出
export const webContainerService = new WebContainerService();
```

### B. React 项目模板

```typescript
// src/services/webcontainer/templates/react.ts
import type { ProjectFiles } from '@/types/webcontainer';

export const REACT_TEMPLATE: ProjectFiles = {
  'package.json': JSON.stringify({
    name: 'generated-react-app',
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite --port 5173',
      build: 'vite build'
    },
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0'
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.2.0',
      vite: '^5.0.0',
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0'
    }
  }, null, 2),

  'vite.config.js': `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
});
`,

  'index.html': `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`,

  'src/main.jsx': `
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,

  'src/App.jsx': `
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Hello, WebContainer!</h1>
      <button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </button>
    </div>
  );
}
`
};
```

### C. 预览组件集成

```typescript
// src/services/webcontainer/PreviewManager.ts
import { webContainerService } from './WebContainerService';
import { REACT_TEMPLATE } from './templates/react';

export class PreviewManager {
  private iframe: HTMLIFrameElement | null = null;

  setIframe(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;
  }

  async previewReactProject(code: string): Promise<void> {
    // 初始化容器
    await webContainerService.initialize();

    // 合并模板与用户代码
    const files = {
      ...REACT_TEMPLATE,
      'src/App.jsx': code // 用户生成的代码
    };

    // 写入文件
    await webContainerService.writeFiles(files);

    // 安装依赖
    const success = await webContainerService.installDependencies();
    if (!success) {
      throw new Error('Failed to install dependencies');
    }

    // 启动开发服务器
    const server = await webContainerService.startDevServer();

    // 注入 iframe
    if (this.iframe) {
      this.iframe.src = server.url;
    }
  }

  async dispose(): Promise<void> {
    await webContainerService.dispose();
  }
}

export const previewManager = new PreviewManager();
```

---

**文档版本**: v1.0
**最后更新**: 2024-09
**维护者**: Litpp Demo 后端架构师