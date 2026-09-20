# Atoms Demo

> AI Agent 驱动的代码生成平台，对标 atoms.dev

## 项目介绍

Atoms Demo 是一个 AI App Builder：用户用一段自然语言描述需求，由角色化 Agent 流水线（需求分析、用户批准、代码生成、代码审查）生成自包含的单文件 HTML 应用，在 iframe 沙箱中实时预览，并通过多轮对话持续迭代。前后端分离：React SPA 负责界面与本地持久化，Hono 后端负责会话认证、项目存储与 LLM 流式代理，LLM 密钥由服务端持有，前端零密钥。

## 功能特性

- **自然语言生成应用**：输入需求描述，或从模板芯片（待办清单、数据看板、落地页、控制面板）一键快速启动
- **批准流程（human-in-the-loop）**：需求分析完成后暂停，向用户展示功能清单，批准后才继续代码生成与审查
- **流式输出**：基于 SSE 的逐字流式返回，覆盖分析、生成、审查各阶段，生成中可手动停止
- **沙箱预览**：生成的应用在 iframe sandbox（sandbox + srcdoc）中隔离执行，postMessage 双向校验，meta CSP 限制外部资源来源
- **对话迭代**：多轮修改携带当前 HTML 上下文，修改作用于当前版本而非推倒重来
- **用户系统**：注册、登录、登出（HttpOnly 会话 cookie），项目数据按用户隔离存储于服务端 SQLite
- **本地优先持久化**：localStorage 信封结构（schemaVersion 版本迁移、损坏数据隔离备份），后端不可用时降级为纯本地模式
- **演示模式**：后端不可用时自动回退内置 demoEngine（本地模板与剧本），无需密钥即可完整体验核心闭环
- **项目管理**：项目库页面（打开、删除）、代码查看面板（语法高亮、复制）、导出单文件 HTML、项目 JSON 导入导出

## 快速开始

前置要求：Node.js 22.9+（`npm start` 依赖 `--env-file-if-exists` 参数）、npm。

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少填写：
#   LLM_API_KEY         LLM 服务密钥（由后端持有，前端无需配置）
#   AUTH_SESSION_SECRET 会话签名密钥（生产环境必须替换为强随机值）

# 3. 启动后端（端口 3000）
npm run dev:server

# 4. 另开一个终端，启动前端（端口 5176，/api 由 Vite 代理到 3000）
npm run dev
```

访问 http://localhost:5176 。注册账号并登录后进入工作台；后端未启动时前端自动切换演示模式。

### 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动前端开发服务器（端口 5176） |
| `npm run dev:server` | 启动后端开发服务器（tsx watch，端口 3000） |
| `npm run build` | 构建前端，产物输出到 `dist/` |
| `npm run build:server` | 编译后端，产物输出到 `dist-server/` |
| `npm start` | 运行编译后的后端（自动加载 `.env`） |
| `npm run preview` | 本地预览前端构建产物 |
| `npm run typecheck` | TypeScript 类型检查 |

## 技术栈

| 层 | 选型 | 说明 |
|---|------|------|
| 前端框架 | React 19 + Vite 8 + TypeScript 7 | 严格模式（strict） |
| 样式 | Tailwind CSS 4 | 原子化样式 |
| 状态 | Zustand 5 | 按领域拆分 store |
| 路由 | react-router-dom 7 | SPA 路由与登录守卫 |
| 后端 | Hono 4 + @hono/node-server | 轻量 API 服务 |
| 数据库 | better-sqlite3 12 | WAL 模式，单文件 `data/atoms.db` |
| 流式传输 | SSE（Hono streamSSE） | LLM 生成过程流式代理 |
| 持久化 | localStorage + SQLite | 本地优先，登录后数据归服务端账号 |
| 沙箱 | iframe sandbox + srcdoc | 生成代码隔离执行 |
| 图标 | @iconify/react | lucide 图标集 |
| 字体 | Space Grotesk、JetBrains Mono | @fontsource 本地引入 |

## 架构简述

```
浏览器（React SPA）
  ├── 路由：/ 落地页，/login、/register 登录注册，/workspace 工作台，/projects 项目库
  │        （工作台与项目库需要登录，未登录自动跳转登录页）
  │
  ├── /api/* ── Vite 代理 ──▶ Hono 后端（127.0.0.1:3000）
  │        ├── POST /api/auth/*        注册、登录、登出、当前用户（HttpOnly 会话 cookie）
  │        ├── /api/projects/*         项目增删改查（按用户隔离）
  │        ├── POST /api/llm/generate  生成流水线入口（SSE）
  │        ├── POST /api/llm/approve   批准后继续生成（SSE）
  │        └── GET  /api/health        健康检查
  │
  └── SQLite（better-sqlite3，WAL 模式）：users、sessions、projects 表

后端 ── OpenAI 兼容流式接口 ──▶ LLM 服务（密钥在服务端环境变量）
```

SSE 事件协议：`stage`（阶段切换）、`delta`（流式文本）、`approval_required`（等待批准，携带 sessionId）、`done`（产出 HTML）、`error`（可重试错误）。

生成产物限定为单文件 HTML（外部资源仅允许 cdn.jsdelivr.net），经 meta CSP 与 iframe sandbox 双重约束后进入预览区；主应用与沙箱仅通过 postMessage 通信，双向做来源与结构校验。

## 项目结构

```
├── .github/workflows/deploy.yml   # GitHub Actions 自动部署
├── ecosystem.config.cjs           # pm2 进程配置（内存限制、优雅启动）
├── vite.config.ts                 # 前端构建配置（端口 5176，/api 代理）
├── docs/                          # 项目文档（见下文文档索引）
├── server/                        # 后端（Hono + better-sqlite3）
│   ├── index.ts                   # 入口：CORS、路由挂载、优雅关闭
│   ├── auth.ts                    # 会话创建与校验、密码哈希、requireAuth
│   ├── db.ts                      # SQLite 初始化（WAL）与查询封装
│   ├── env.ts                     # .env 加载
│   ├── llm.ts                     # LLM 调用核心：三阶段流水线、批准会话管理
│   ├── types.ts                   # 服务端类型定义
│   └── routes/
│       ├── auth.ts                # /api/auth 注册、登录、登出、当前用户
│       ├── health.ts              # /api/health
│       ├── llm.ts                 # /api/llm/generate、/api/llm/approve（SSE）
│       └── projects.ts            # /api/projects 项目管理
└── src/                           # 前端
    ├── App.tsx                    # 路由与登录守卫
    ├── main.tsx / index.css
    ├── pages/
    │   ├── HomePage.tsx           # 工作台：对话、批准流程、预览、文件面板
    │   ├── AuthPage.tsx           # 登录 / 注册页
    │   └── ProjectsPage.tsx       # 项目库：历史项目查看、打开、删除
    ├── components/
    │   ├── SandboxFrame.tsx       # 沙箱预览容器（唯一 iframe 创建入口）
    │   ├── CodeViewer.tsx         # 代码查看面板（高亮、复制、导出）
    │   ├── MessageRenderer.tsx    # 对话消息渲染
    │   ├── AuthControls.tsx       # 登录态控件（登录按钮 / 用户菜单）
    │   ├── DataImportPanel.tsx    # 数据导入面板
    │   ├── SettingsPanel.tsx      # 设置面板
    │   ├── Modal.tsx / Toast.tsx  # 通用组件
    │   └── landing/               # 落地页（LandingPage、Hero、Features、Demo 等）
    ├── services/
    │   ├── apiClient.ts           # fetch 封装（401 会话过期拦截）
    │   ├── auth.ts                # /api/auth 客户端
    │   ├── ai/                    # AI 服务：liveEngine（后端代理）、demoEngine（演示模式）、
    │   │                          #   prompts、htmlValidator、activeRun、demoTemplates
    │   ├── storage/               # 持久化：本地读写、迁移、隔离备份、导入导出、apiSync
    │   └── data/                  # CSV / JSON 数据解析
    ├── stores/                    # Zustand：authStore、projectStore、chatStore、settingsStore
    ├── types/                     # project、sandbox、storage 类型定义
    └── lib/icons.ts               # 图标配置
```

## 使用流程

核心流程：

```
输入需求 → 需求分析（流式） → 用户批准 → 代码生成（流式） → 代码审查 → 沙箱预览 → 对话迭代
```

1. **注册登录**：未登录访问工作台或项目库会跳转登录页，注册后自动登录
2. **发起生成**：在工作台输入需求描述，或点击模板芯片快速启动
3. **批准计划**：需求分析完成后生成暂停，界面展示功能清单，用户批准后继续（human-in-the-loop）
4. **预览应用**：生成与审查完成后，右侧沙箱预览区渲染出真实可交互的应用
5. **对话迭代**：继续发送修改要求（如换主题色、增删模块），修改作用于当前版本
6. **查看与导出**：打开代码面板查看源码，支持一键复制与导出单文件 HTML；项目支持 JSON 导入导出
7. **管理项目**：在项目库页查看历史项目，打开或删除

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/PRD.md](docs/PRD.md) | 产品需求文档 v1（用户故事、功能清单、验收标准） |
| [docs/prd/auth-and-app-ownership.md](docs/prd/auth-and-app-ownership.md) | 认证与应用归属 PRD |
| [docs/PRD-Coverage.md](docs/PRD-Coverage.md) | PRD 功能覆盖率报告 |
| [docs/architecture/auth-review.md](docs/architecture/auth-review.md) | 认证架构审查报告 |
| [docs/backend-proxy-architecture.md](docs/backend-proxy-architecture.md) | 后端 LLM 代理模式架构设计 |
| [docs/tech-ai-pipeline.md](docs/tech-ai-pipeline.md) | LLM 集成与生成流水线技术方案（v1 历史方案，现为后端代理架构） |
| [docs/tech-sandbox.md](docs/tech-sandbox.md) | 沙箱与持久化技术方案 |
| [docs/persistence.md](docs/persistence.md) | 数据持久化方案 |
| [docs/design-system.md](docs/design-system.md) | 设计规范 |
| [docs/design/landing-page-spec.md](docs/design/landing-page-spec.md) | 落地页设计规范 |
| [docs/deploy.md](docs/deploy.md) | 服务端本地运行与 Docker 部署 |
| [docs/deploy-guide.md](docs/deploy-guide.md) | GitHub Actions 自动部署指南 |
| [docs/server-setup.md](docs/server-setup.md) | 服务器准备与 nginx 配置 |
| [docs/Performance-Analysis.md](docs/Performance-Analysis.md) | 构建产物性能分析报告 |
| [docs/iterations/state.md](docs/iterations/state.md) | 自升级迭代状态记录 |

## 部署

### GitHub Actions 自动部署

`.github/workflows/deploy.yml` 在 push 到 master 分支时自动执行：安装依赖、构建前端与后端、通过 SSH + rsync 同步到服务器（前端 `dist/` 由 nginx 托管，后端 `dist-server/` 由 pm2 守护），并在服务器上重编译 better-sqlite3 原生模块后重启 pm2 进程。

需要在仓库 Secrets 中配置 5 个变量：`SERVER_HOST`、`SERVER_USER`、`SSH_PRIVATE_KEY`、`FRONTEND_PATH`、`BACKEND_PATH`。详细步骤见 [docs/deploy-guide.md](docs/deploy-guide.md) 与 [docs/server-setup.md](docs/server-setup.md)。

### 手动构建与运行

```bash
npm run build        # 构建前端到 dist/
npm run build:server # 编译后端到 dist-server/
npm start            # 运行 dist-server/index.js（自动加载 .env）
```

生产环境由 nginx 托管 `dist/` 静态产物并反向代理 `/api` 到后端（默认端口 3000，仅监听 127.0.0.1）。pm2 守护配置见 `ecosystem.config.cjs`（堆内存限制 128MB、wait_ready 就绪握手、异常自动重启）。Docker 部署方式见 [docs/deploy.md](docs/deploy.md)。

### 环境变量

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | LLM 服务密钥（必填，仅服务端持有） |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 |
| `LLM_MODEL` | 模型名称 |
| `AUTH_SESSION_SECRET` | 会话签名密钥（生产必须替换） |
| `COOKIE_SECURE` | HTTPS 部署时设为 `true` |
| `PORT` | 服务端口（默认 3000） |
| `SKIP_REVIEW` | 低内存模式跳过审查阶段（设为 `true` 启用） |

完整清单见 `.env.example`。

## 设计铁律

- 禁止使用 Inter 字体
- 禁止使用 AI 紫渐变
- 禁止手撸 SVG 图标，统一使用 iconify（经 iconify-local 下载到本地引用）
- 禁止使用 Em-dash（—），中文文案使用中文标点

## 安全机制

- 生成的应用代码只在 `sandbox="allow-scripts"` 的 iframe 中经 srcdoc 执行，绝不与 allow-same-origin 同用
- 沙箱与主应用仅通过 postMessage 通信，双向校验协议版本、会话 id 与消息结构
- 生成代码的 CDN 引用经静态扫描与 meta CSP 双重限制
- 用户密码加盐哈希存储，会话以 HttpOnly cookie 承载，服务端按用户隔离项目数据
- LLM API Key 仅存于服务端环境变量，不进入前端代码与日志

## 开发团队

Atoms Demo 由多 Agent 团队协作开发：

- **产品经理**：需求规划、优先级排序
- **前端开发者**：UI 与交互实现
- **后端架构师**：持久化、沙箱方案
- **AI 工程师**：LLM 集成、智能体编排
- **UX 设计师**：交互体验、视觉规范
- **数据工程师**：图表模板、数据导入导出
- **现实检验者**：独立验证、PRD 覆盖率

## 许可证

ISC
