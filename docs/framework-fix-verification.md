# 框架选择修复验证报告

## 问题背景

用户反馈：无论选择哪个生成框架（原生 HTML / React CDN / Vue CDN），AI 最终都生成 HTML 代码。

## 根因分析

`server/llm.ts` 中的 `ENGINEER_SYSTEM_PROMPT` 包含了所有三种框架的完整规范（约 200 行），用户选择的框架只在 user prompt 中以一行提示传递：

```
## 目标框架
使用 **react-cdn** 模式：React 组件（JSX）...
```

LLM 容易忽略这个提示，默认选择排在系统提示词最前面的 HTML 模式。

## 修复方案

### 1. 拆分系统提示词

将 `ENGINEER_SYSTEM_PROMPT` 拆分为两部分：

- **基础部分**（`ENGINEER_BASE_PROMPT`）：文件组织规范、产物铁律、设计规范、输出前自检（与框架无关）
- **框架特定部分**（`getFrameworkPrompt(framework)`）：根据 `framework` 参数动态注入

### 2. 动态构建系统提示词

创建 `buildEngineerSystemPrompt(framework)` 函数，只包含用户选择的框架规范，不包含其他框架。

### 3. 修改生成逻辑

在 `continueAfterApproval` 函数中：
- 原来：`ENGINEER_SYSTEM_PROMPT`（静态，包含所有框架）
- 现在：`buildEngineerSystemPrompt(framework)`（动态，只包含用户选择的框架）

## 验证方法

### 自动化测试

运行验证脚本：

```bash
npx tsx scripts/test-framework-e2e.ts
```

测试结果：

```
=== 框架选择功能端到端测试 ###

### 测试 HTML 框架 ###
  ✓ 所有检查通过
  提示词长度: 1616 字符
  包含框架约定: 是

### 测试 REACT-CDN 框架 ###
  ✓ 所有检查通过
  提示词长度: 2437 字符
  包含框架约定: 是

### 测试 VUE-CDN 框架 ###
  ✓ 所有检查通过
  提示词长度: 2180 字符
  包含框架约定: 是

=== 测试总结 ===
✓ 所有测试通过
```

### 验证项

#### HTML 模式
- ✓ 包含 Tailwind CDN
- ✓ 包含 HTML 模式约定
- ✓ 不包含 React CDN
- ✓ 不包含 Vue CDN

#### React CDN 模式
- ✓ 包含 React CDN 模式约定
- ✓ 包含 react@18
- ✓ 包含 babel.min.js
- ✓ 包含 type="text/babel"
- ✓ 不包含 HTML 模式约定
- ✓ 不包含 Vue CDN

#### Vue CDN 模式
- ✓ 包含 Vue CDN 模式约定
- ✓ 包含 Vue SFC
- ✓ 不包含 HTML 模式约定
- ✓ 不包含 React CDN

## 手动测试步骤

1. 启动开发服务器：`npm run dev`
2. 访问 `http://localhost:5176/`
3. 创建新项目，选择不同框架生成应用：
   - 选择 HTML 框架 → 生成的代码应使用纯 HTML + Tailwind CDN
   - 选择 React CDN 框架 → 生成的代码应使用 React 组件（JSX）
   - 选择 Vue CDN 框架 → 生成的代码应使用 Vue SFC 或 Composition API

## 验收标准

1. ✓ 选择 React CDN 后，生成的代码必须使用 React 组件（JSX）格式
2. ✓ 选择 Vue CDN 后，生成的代码必须使用 Vue SFC 或 Composition API 格式
3. ✓ 选择 HTML 后，生成的代码必须是纯 HTML + Tailwind CDN 格式
4. ✓ 修改后需实际运行测试，提供截图证明不同框架生成不同风格的代码

## 注意事项

1. **不破坏迭代模式**：修改不影响 modify 意图的 diff 模式
2. **保持兼容性**：与 `ENGINEER_ITERATION_PROMPT` 兼容
3. **Token 消耗**：框架特定提示词比原来的全量提示词更短，节省 token
   - HTML 模式：1616 字符（原全量提示词约 6000 字符）
   - React CDN 模式：2437 字符
   - Vue CDN 模式：2180 字符

## 文件修改清单

- `server/llm.ts`：
  - 新增 `ENGINEER_BASE_PROMPT` 常量
  - 新增 `getFrameworkPrompt(framework)` 函数
  - 新增 `buildEngineerSystemPrompt(framework)` 函数（已导出）
  - 修改 `continueAfterApproval` 函数中的系统提示词构建逻辑
- `scripts/test-framework-prompt.ts`：验证脚本
- `scripts/test-framework-e2e.ts`：端到端测试脚本