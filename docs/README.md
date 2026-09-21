# Atoms Demo 文档索引

本目录包含项目的全部技术文档，按主题分类。

---

## 快速导航

| 主题 | 文档 | 说明 |
|---|---|---|
| **部署** | [server-setup.md](./server-setup.md) | 服务器配置完整指南 |
| | [deploy-guide.md](./deploy-guide.md) | GitHub Actions 自动部署 |
| **产品设计** | [PRD.md](./PRD.md) | 产品需求文档 |
| | [PRD-v2.md](./PRD-v2.md) | PRD 迭代版本 |
| | [PRD-Coverage.md](./PRD-Coverage.md) | PRD 功能覆盖率 |
| | [design-system.md](./design-system.md) | 设计系统规范 |
| **技术架构** | [backend-proxy-architecture.md](./backend-proxy-architecture.md) | 后端代理架构 |
| | [persistence.md](./persistence.md) | 数据持久化方案 |
| | [tech-sandbox.md](./tech-sandbox.md) | 沙箱预览技术方案 |
| **AI 能力** | [tech-ai-pipeline.md](./tech-ai-pipeline.md) | AI 生成管线设计 |
| | [intent-classification-design.md](./intent-classification-design.md) | 意图识别设计 |
| | [tech-prompt-optimizer.md](./tech-prompt-optimizer.md) | Prompt 优化器设计 |
| | [context-trimming.md](./context-trimming.md) | 上下文裁剪优化 |
| **功能实现** | [tech-multi-file-generation.md](./tech-multi-file-generation.md) | 多文件生成方案 |
| | [webcontainer-research.md](./webcontainer-research.md) | WebContainer 集成调研 |
| **性能** | [Performance-Analysis.md](./Performance-Analysis.md) | 性能分析报告 |

---

## 部署文档

### [server-setup.md](./server-setup.md) - 服务器配置指南

**适用场景**：首次部署、服务器迁移、配置问题排查

**内容概要**：
- 服务器要求（硬件、软件）
- 依赖安装（Node.js、Nginx、PM2）
- Nginx 完整配置（前端、API、用户项目子域）
- 环境变量清单与安全配置
- HTTPS 配置（Let's Encrypt）
- 监控与运维命令
- 部署前安全检查清单
- 常见问题解答

**重要安全要点**：
- DEPLOY_BASE_URL 必须配置为独立子域（跨源安全）
- 完整的安全检查清单与验证命令

### [deploy-guide.md](./deploy-guide.md) - 自动部署指南

**适用场景**：配置 CI/CD、自动化部署

**内容概要**：
- GitHub Actions 工作流
- GitHub Secrets 配置
- 部署架构图
- 用户项目静态托管

---

## 产品设计文档

### [PRD.md](./PRD.md) / [PRD-v2.md](./PRD-v2.md) - 产品需求文档

**核心需求**：
- 类 Atoms 的能力与 UI 交互体验
- 智能体驱动代码生成
- 真实交互 + 数据持久化
- LLM 流式输出

### [design-system.md](./design-system.md) - 设计系统

**核心规范**：
- 字体：Space Grotesk（禁 Inter）
- 配色：CSS 变量系统
- 组件：基础组件库
- 设计铁律：禁 AI 紫渐变、禁手撸 SVG

---

## 技术架构文档

### [backend-proxy-architecture.md](./backend-proxy-architecture.md) - 后端代理架构

**核心方案**：
- SSE 流式代理
- 错误降级处理
- 超时与重试机制

### [persistence.md](./persistence.md) - 持久化方案

**存储策略**：
- localStorage（游客模式）
- SQLite（服务端）
- Supabase（可选云同步）

### [tech-sandbox.md](./tech-sandbox.md) - 沙箱预览

**技术方案**：
- iframe sandbox 隔离
- srcdoc + postMessage 通信
- CSP 安全策略
- React/Vue CDN 运行时

---

## AI 能力文档

### [tech-ai-pipeline.md](./tech-ai-pipeline.md) - AI 生成管线

**四角色流水线**：
```
需求优化器 → 分析师 → 工程师 → 审查者
```

### [intent-classification-design.md](./intent-classification-design.md) - 意图识别

**四种意图**：
- create：创建应用
- modify：修改迭代
- analyze：功能分析
- diagnose：问题诊断

### [context-trimming.md](./context-trimming.md) - 上下文裁剪

**优化效果**：修改模式 token 节省 77-95%

---

## 功能实现文档

### [tech-multi-file-generation.md](./tech-multi-file-generation.md) - 多文件生成

**核心机制**：
- 文件分割策略
- 依赖关系处理
- 入口文件识别

### [webcontainer-research.md](./webcontainer-research.md) - WebContainer 调研

**调研结论**：强烈推荐集成

**核心价值**：
- 完整 Node.js 运行时
- npm 包支持
- 真实开发服务器

---

## 文档贡献指南

### 文档命名规范

| 前缀 | 说明 | 示例 |
|---|---|---|
| `PRD` | 产品需求文档 | PRD.md, PRD-v2.md |
| `tech-` | 技术方案文档 | tech-sandbox.md |
| 无前缀 | 通用文档 | deploy-guide.md |

### 文档更新流程

1. 修改或新增文档后，更新本索引文件
2. 确保文档包含：
   - 清晰的标题和目录
   - 适用场景说明
   - 代码示例（如适用）
   - 相关文档链接

---

## 相关链接

- [项目 README](../README.md)
- [CLAUDE.md](../.claude/CLAUDE.md) - Claude Code 开发指引
- [Agent 团队](../.claude/agents/) - Agent 定义文件