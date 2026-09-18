# CLAUDE.md

本文件为 Atoms Demo 项目的项目级开发指引。在此仓库中工作时，请遵循以下规范。

## 1. 项目概述

**Atoms Demo**：AI Agent 驱动的代码生成平台（ROOT AI Native 全栈工程师笔试项目），对标 atoms.dev。

核心流程：

```
用户描述需求 → Agent 团队规划 → 生成代码 → iframe 沙箱实时预览
```

核心产品要求：

- 类 Atoms 的能力与 UI 交互体验：左侧 AI 对话 + 右侧实时预览
- 智能体驱动代码生成，生成的应用以可视化网页展示
- 真实交互（非静态展示）+ 数据持久化
- 覆盖基本使用流程（初始化 / 注册 / 核心主流程）+ 至少一个延展能力
- LLM 流式输出

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|------|------|
| 框架 | React 18 + Vite + TypeScript | TypeScript 必须开启严格模式（strict） |
| 样式 | Tailwind CSS | 原子化样式，禁止全局 CSS 滥用 |
| 状态 | Zustand | 轻量状态管理，按领域拆分 store |
| 持久化 | localStorage 优先 | 游客模式本地持久化；可选 Supabase 云同步 |
| 沙箱 | iframe sandbox + srcdoc + postMessage | 生成的应用代码在沙箱中执行与预览 |
| 图标 | iconify | 禁止手撸 SVG 图标 |

## 3. Agent 团队

本项目采用多智能体协作开发，主 agent 负责协调，专业工作分派给专业 agent：

| Agent | 角色 | 职责 |
|-------|------|------|
| dev-atoms-product-manager | 产品经理 | PRD、用户故事、优先级 |
| dev-atoms-frontend-developer | 前端开发者 | UI/交互实现 |
| dev-atoms-backend-architect | 后端架构师 | 持久化、沙箱方案 |
| dev-atoms-ai-engineer | AI 工程师 | LLM 集成、智能体编排 |
| dev-atoms-ux-designer | UX 设计师 | 交互体验、视觉规范 |
| dev-atoms-reality-checker | 现实检验者 | 独立验证、PRD 覆盖率 |
| dev-atoms-data-engineer | 数据工程师 | 图表模板、数据导入导出 |

## 4. 协调方式

- 触发方式：使用 `/dev-atoms` 或对主 agent 说"用 dev-atoms 协调 XXX"
- 主 agent 只做协调，不亲自写实现代码；专业的事情交给专业的 agent
- 执行者与验证者分离：实现 agent 完成工作后，由 dev-atoms-reality-checker 独立验证，不允许自己验证自己的产出
- 任务分派时给 agent 明确的目标、边界与验收标准，避免职责重叠

## 5. 开发规范

### 设计铁律

- 禁 Inter 字体
- 禁 AI 紫渐变
- 禁手撸 SVG 图标，统一使用 iconify
- 项目 UI 图标一律经 iconify-local skill 下载到本地后引用（lucide 集优先），已下载图标清单见 `assets/icons/index.json`
- 禁 Em-dash（—），中文文案使用中文标点

### 安全铁律

- 生成的应用代码必须在 iframe sandbox 中执行（sandbox 属性 + srcdoc），与主应用隔离
- 沙箱与主应用之间只能通过 postMessage 通信，并对消息来源做校验

### 验证铁律

- 没有新鲜的验证证据（实际运行、实际截图、实际输出），禁止宣称完成
- 执行者与验证者分离，验证结论必须来自验证 agent 的独立检查

### Git 提交规范

- 提交信息使用中文，格式：`类型: 简短描述`
- 类型前缀：feat / fix / chore / docs / refactor / test
- 禁止添加 Co-authored-by 标记

## 6. 项目结构（预期）

```
src/
├── components/     # UI 组件
├── stores/         # Zustand 状态
├── services/       # LLM 集成、持久化
├── sandbox/        # 沙箱预览相关
└── types/          # 类型定义
```
