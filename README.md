# Atoms Demo

> AI Agent 驱动的代码生成平台，对标 atoms.dev

## 项目介绍

Atoms Demo 是一个 AI App Builder，让用户通过自然语言描述需求，由多 Agent 团队协作生成自包含的单文件 HTML 应用，并在隔离沙箱中实时预览。支持多轮对话迭代，生成结果自动保存到本地。

**核心特性**：
- 自然语言描述需求，一键生成可交互应用
- 多 Agent 流水线协作（产品经理、架构师、工程师、审查者）
- 流式输出实时反馈
- iframe 沙箱隔离预览
- 多项目管理与版本历史
- 模板库快速启动（待办清单、数据看板、落地页、控制面板）
- 支持图表场景（Chart.js）
- 数据导入导出
- localStorage 本地持久化，游客模式零门槛

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173

### 构建生产版本

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### 类型检查

```bash
npm run typecheck
```

### 预览生产版本

```bash
npm run preview
```

## 技术栈

| 层 | 选型 | 说明 |
|---|------|------|
| 框架 | React 19 + Vite 8 + TypeScript 7 | 现代前端技术栈，严格模式 |
| 样式 | Tailwind CSS 4 | 原子化样式 |
| 状态 | Zustand 5 | 轻量状态管理 |
| 路由 | react-router-dom 7 | SPA 路由 |
| 持久化 | localStorage | 本地存储 |
| 沙箱 | iframe sandbox + srcdoc | 隔离执行 |
| 图标 | @iconify/react | Lucide 图标集 |
| 字体 | Space Grotesk + JetBrains Mono | 现代技术风格 |

## 项目结构

```
src/
├── components/          # UI 组件
│   ├── ChatPanel.tsx        # 对话面板
│   ├── DataImportPanel.tsx  # 数据导入面板
│   ├── MessageRenderer.tsx  # 消息渲染器
│   ├── Modal.tsx            # 模态框
│   ├── ProjectSidebar.tsx   # 项目侧栏
│   ├── SandboxFrame.tsx     # 沙箱预览
│   ├── SettingsPanel.tsx    # 设置面板
│   └── Toast.tsx            # Toast 通知
├── pages/               # 页面
│   ├── HomePage.tsx         # 首页
│   └── WorkspacePage.tsx    # 工作台
├── services/            # 服务层
│   ├── ai/                  # AI 服务
│   │   ├── demoEngine.ts        # 演示引擎
│   │   ├── liveEngine.ts        # 真实 LLM 引擎
│   │   ├── prompts.ts           # 提示词模板
│   │   ├── htmlValidator.ts     # HTML 校验
│   │   └── demoTemplates/       # 内置模板
│   ├── data/                # 数据服务
│   │   ├── csvParser.ts         # CSV 解析
│   │   ├── jsonParser.ts        # JSON 解析
│   │   └── types.ts             # 类型定义
│   └── storage/             # 存储服务
│       ├── index.ts             # 存储接口
│       ├── export.ts            # 导出服务
│       ├── import.ts            # 导入服务
│       ├── migration.ts         # 数据迁移
│       └── quarantine.ts        # 隔离存储
├── stores/              # Zustand 状态
│   ├── chatStore.ts         # 对话状态
│   ├── projectStore.ts      # 项目状态
│   └── settingsStore.ts     # 设置状态
├── types/               # 类型定义
│   ├── project.ts           # 项目类型
│   ├── sandbox.ts           # 沙箱类型
│   └── storage.ts           # 存储类型
├── lib/                 # 工具库
│   └── icons.ts             # 图标配置
├── App.tsx              # 应用根组件
└── main.tsx             # 入口文件
```

## 使用说明

### 首页输入

1. 打开应用，在首页输入框描述你的需求
2. 或点击模板芯片快速启动（待办清单、数据看板等）
3. 点击发送按钮或按 Enter 提交
4. 等待 AI 团队生成完成，自动跳转工作台

### 工作台使用

**对话面板**：
- 在输入框输入修改需求
- 发送后流式显示 AI 响应
- 查看多 Agent 协作过程

**预览面板**：
- 实时预览生成的应用
- 点击设备切换按钮（桌面/平板/手机）
- 点击刷新按钮重新加载预览
- 点击全屏按钮全屏查看

**项目侧栏**：
- 查看项目列表
- 新建/切换/删除项目
- 查看版本历史

**顶部栏**：
- 编辑项目名称
- 导出 HTML 文件
- 返回首页新建项目

### 设置

点击工作台左下角设置按钮：
- API Key 配置（支持 OpenAI 兼容 API）
- Base URL 配置
- 连接测试

未配置 API Key 时自动使用演示模式。

## 核心流程

```
用户输入需求 → AI Agent 团队规划 → 生成单文件 HTML → 沙箱预览 → 多轮迭代
```

## 设计铁律

- 禁止使用 Inter 字体
- 禁止使用 AI 紫渐变
- 禁止手撸 SVG 图标，统一使用 @iconify/react
- 禁止使用 Em-dash（—），中文使用中文标点

## 安全机制

- 生成的应用代码在 iframe sandbox 中隔离执行
- 沙箱与主应用仅通过 postMessage 通信
- 消息来源校验防止伪造

## 浏览器支持

- Chrome 90+
- Firefox 90+
- Safari 14+
- Edge 90+

## 开发团队

Atoms Demo 由多 Agent 团队协作开发：

- **产品经理**：需求规划、优先级排序
- **前端开发者**：UI/交互实现
- **后端架构师**：持久化、沙箱方案
- **AI 工程师**：LLM 集成、智能体编排
- **UX 设计师**：交互体验、视觉规范
- **数据工程师**：图表模板、数据导入导出
- **现实检验者**：独立验证、PRD 覆盖率

## 许可证

ISC