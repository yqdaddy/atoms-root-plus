# Playwright E2E 测试配置说明

## 概述

本项目已成功配置 Playwright E2E 测试框架，用于 Smoke Test（冒烟测试）。

## 安装的依赖

- `@playwright/test` - Playwright 测试框架

## 创建/修改的文件

1. `playwright.config.ts` - Playwright 配置文件
2. `tests/e2e/smoke.spec.ts` - Smoke Test 测试文件
3. `package.json` - 添加了 E2E 测试脚本

## 配置要点

### 浏览器配置

由于 macOS 12 不支持 Playwright 最新版的内置 Chromium，配置使用系统已安装的 Chrome 浏览器：

```typescript
{
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome', // 使用系统 Chrome
  },
}
```

### 测试目录

- 测试目录：`tests/e2e/`
- 测试文件：`*.spec.ts`

### 开发服务器

配置自动启动开发服务器：
- 命令：`npm run dev`
- URL：`http://localhost:5177`

## 可用的测试脚本

```bash
# 运行所有 E2E 测试
npm run test:e2e

# 以 UI 模式运行测试（交互式调试）
npm run test:e2e:ui
```

## Smoke Test 测试用例

### 1. 页面基础渲染

- **应该正确加载首页并显示关键元素**
  - 验证页面标题包含 "Atoms Demo"
  - 验证页面有可见内容
  - 验证无关键 console 错误

- **应该正确渲染落地页**
  - 验证有 CTA 按钮
  - 验证有标题或描述文字

- **应该能够导航到登录页**
  - 验证登录页有登录表单
  - 验证有提交按钮

### 2. 生成功能可用性

- **工作台应该有输入区域**
  - 验证访问工作台会重定向到登录页（未登录）
  - 验证登录页有输入框

### 3. 响应式设计

- **应该在移动端正常显示**
  - 验证移动端视口下页面加载成功
  - 验证无关键错误

### 4. 性能检查

- **页面应该在合理时间内加载**
  - 验证页面在 5 秒内加载完成

## 测试结果

```
Running 6 tests using 2 workers

  6 passed (38.3s)
```

所有测试用例均通过。

## 注意事项

1. **浏览器兼容性**：由于 macOS 12 不支持 Playwright 最新版的内置浏览器，测试使用系统已安装的 Chrome 浏览器。

2. **Console 错误过滤**：测试会过滤以下非关键错误：
   - React 警告
   - DevTools 提示
   - HMR 热更新提示
   - 401 未授权错误（正常 API 调用）
   - 资源加载失败（可能是正常的 API 调用）

3. **TypeScript 严格模式**：所有测试代码遵循项目 TypeScript 严格模式要求。

4. **不破坏现有配置**：E2E 测试与现有 vitest 单元测试共存，互不影响。

## 后续扩展建议

1. **添加更多浏览器**：如果需要，可以在 `playwright.config.ts` 中启用 Firefox 和 WebKit 项目。

2. **添加认证测试**：如果需要测试需要登录的功能，可以使用 Playwright 的 storage state 功能。

3. **集成到 CI/CD**：将 `npm run test:e2e` 添加到 CI 流程中，确保每次提交都运行 E2E 测试。

4. **添加截图对比**：对于关键页面，可以添加视觉回归测试。

## 故障排除

### 问题：找不到 Chrome 浏览器

**解决方案**：确保系统已安装 Google Chrome 浏览器。如果没有安装，请从 https://www.google.com/chrome/ 下载安装。

### 问题：测试超时

**解决方案**：
1. 检查开发服务器是否能正常启动
2. 增加 `playwright.config.ts` 中的 `timeout` 配置
3. 检查网络连接

### 问题：端口被占用

**解决方案**：
1. 确保没有其他进程占用 5177 端口
2. 或者修改 `playwright.config.ts` 中的 `webServer.url` 配置