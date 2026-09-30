# 贡献指南

感谢你考虑为 Litpp 做贡献！

## 如何贡献

### 提交 Issue

如果你发现了 Bug 或有新功能建议，请先搜索现有的 Issue，确认没有重复后再提交。

提交 Issue 时请包含：
- **Bug 报告**：复现步骤、期望行为、实际行为、环境信息（操作系统、Node.js 版本）
- **功能建议**：使用场景、预期效果、替代方案

### 提交 Pull Request

1. Fork 本仓库
2. 创建分支：`git checkout -b feature/your-feature-name`
3. 进行修改
4. 运行测试：`npm test`
5. 提交代码：`git commit -m "feat: 简短描述"`
6. 推送分支：`git push origin feature/your-feature-name`
7. 创建 Pull Request

## 代码规范

### 提交信息格式

使用中文，格式：`类型: 简短描述`

| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| docs | 文档更新 |
| style | 代码格式（不影响功能） |
| refactor | 重构 |
| test | 测试相关 |
| chore | 构建/工具相关 |

### 代码风格

- TypeScript 严格模式
- 使用 Tailwind CSS 原子化样式
- 组件命名使用 PascalCase
- 函数命名使用 camelCase
- 禁止手撸 SVG 图标，统一使用 @iconify/react

### 测试要求

- 新功能需附带测试
- Bug 修复需附带回归测试
- 确保 `npm test` 通过

## 开发环境

```bash
# 安装依赖
npm install

# 启动前端开发服务器
npm run dev

# 启动后端开发服务器（另开终端）
npm run dev:server

# 运行测试
npm test

# 类型检查
npm run typecheck
```

## 行为准则

- 尊重所有贡献者
- 接受建设性批评
- 关注对社区最有利的事情