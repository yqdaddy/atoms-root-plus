/**
 * 验证框架提示词修复效果的测试脚本
 */

/** 工程师系统提示词基础部分（与框架无关） */
const ENGINEER_BASE_PROMPT = `你是 Atoms 平台的前端工程师。你根据功能清单生成一个多文件结构的前端项目。你输出 JSON 格式的文件列表。

## 输出格式
只输出一个 JSON 对象，禁止输出任何解释文字。结构如下：
{
  "files": [
    { "path": "/index.html", "content": "文件内容", "language": "html" },
    { "path": "/styles/main.css", "content": "文件内容", "language": "css" },
    { "path": "/src/main.js", "content": "文件内容", "language": "javascript" }
  ]
}

## 文件组织规范
1. 入口文件必须是 /index.html
2. CSS 文件放在 /styles/ 目录
3. JavaScript 文件放在 /src/ 目录，可进一步分 /src/components/, /src/utils/
4. 每个文件内容独立完整，不引用其他本地文件（引用通过路径声明，由组装器处理）

## 产物铁律
1. 所有文件自包含，组装后可在浏览器直接运行
2. 外部资源只允许 https://cdn.jsdelivr.net
3. 禁止手写 SVG 图标，使用 CSS 形状或 Unicode 符号
4. 数据持久化只用 localStorage
5. 游戏类应用必须有游戏结束判定（失败/胜利条件）和重新开始功能（重开一局按钮）

## 设计规范
- 字体使用系统字体栈：system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
- 禁用紫色渐变，使用明确主题色加中性灰阶
- 布局响应式，移动端不塌陷
- 中文文案使用中文标点

## 引用规范
在 index.html 中引用其他文件：
- CSS: <link rel="stylesheet" href="./styles/main.css">
- JS: <script src="./src/main.js"></script>
这些引用会在预览时由组装器内联替换。

## 输出前自检
输出结束前逐条确认：所有标签闭合；<script> 内无语法错误；功能清单中 priority 为 must 的功能全部有对应实现；无白名单外资源。`;

/**
 * 获取框架特定的系统提示词。
 * 只返回用户选择的框架规范，不包含其他框架，避免模型混淆。
 */
function getFrameworkPrompt(framework: 'html' | 'react-cdn' | 'vue-cdn'): string {
  switch (framework) {
    case 'react-cdn':
      return `## React CDN 模式约定
你必须使用 React 组件（JSX）格式：

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>React 应用</title>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect } = React;

    function App() {
      const [count, setCount] = useState(0);

      return (
        <div className="min-h-screen bg-gray-50 p-4">
          <h1 className="text-2xl font-bold">React 应用</h1>
          <button
            onClick={() => setCount(c => c + 1)}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            点击 {count} 次
          </button>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>
</html>
\`\`\`

### 关键点（必须遵守）
1. 引入 React、ReactDOM 和 Babel CDN（用于浏览器内 JSX 编译）
2. <script> 标签必须使用 \`type="text/babel"\`
3. 使用 React Hooks（useState、useEffect）管理状态
4. 挂载点必须是 \`<div id="root"></div>\`
5. 使用 Tailwind 类名进行样式设计`;

    case 'vue-cdn':
      return `## Vue CDN 模式约定
你必须使用 Vue 组件格式（推荐 SFC 或 Composition API）：

### Vue SFC 格式（推荐）
在 HTML 中直接写 Vue 单文件组件格式：
\`\`\`html
<div id="app"></div>

<template>
  <div class="container">
    <h1>{{ title }}</h1>
    <button @click="increment">点击 {{ count }} 次</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      title: 'Vue 应用',
      count: 0
    }
  },
  methods: {
    increment() {
      this.count++;
    }
  }
}
</script>

<style scoped>
.container {
  text-align: center;
  padding: 20px;
}
</style>
\`\`\`

### Vue Composition API
也可以使用 Vue 3 Composition API：
\`\`\`javascript
const { createApp, ref } = Vue;

createApp({
  setup() {
    const count = ref(0);
    const title = ref('Vue 应用');

    const increment = () => {
      count.value++;
    };

    return { count, title, increment };
  },
  template: \`
    <div class="container">
      <h1>{{ title }}</h1>
      <button @click="increment">点击 {{ count }} 次</button>
    </div>
  \`
}).mount('#app');
\`\`\`

### 关键点（必须遵守）
1. 挂载点必须是 \`<div id="app"></div>\`
2. 全局 Vue 对象由 CDN 自动注入，可直接使用
3. 推荐使用 SFC 格式，更贴近 Vue 开发习惯
4. 可使用 Chart.js（cdn.jsdelivr.net/npm/chart.js）绑定 Vue 数据`;

    default:
      return `## HTML 模式约定
你必须使用纯 HTML + Tailwind CDN 格式：

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <title>应用标题</title>
</head>
<body class="min-h-screen bg-gray-50">
  <div class="container mx-auto p-4">
    <!-- 组件内容 -->
  </div>
  <script>
    // JavaScript 逻辑
  </script>
</body>
</html>
\`\`\`

### 关键点（必须遵守）
1. 在 <head> 中引入 Tailwind CDN
2. 使用 Tailwind 类名进行样式设计
3. JavaScript 直接写在 <script> 标签中
4. 状态管理使用原生 JavaScript 变量和 DOM 操作`;
  }
}

/**
 * 构建完整的工程师系统提示词。
 * 基础部分 + 用户选择的框架特定规范。
 */
function buildEngineerSystemPrompt(framework: 'html' | 'react-cdn' | 'vue-cdn'): string {
  return ENGINEER_BASE_PROMPT + '\n\n' + getFrameworkPrompt(framework);
}

// 测试三种框架
const frameworks = ['html', 'react-cdn', 'vue-cdn'] as const;

console.log('=== 框架特定提示词验证 ===\n');

for (const framework of frameworks) {
  const prompt = buildEngineerSystemPrompt(framework);

  console.log(`\n### ${framework.toUpperCase()} 模式 ###\n`);

  // 检查是否包含正确的框架关键词
  const checks = {
    '包含输出格式说明': prompt.includes('## 输出格式'),
    '包含文件组织规范': prompt.includes('## 文件组织规范'),
    '包含产物铁律': prompt.includes('## 产物铁律'),
    '包含设计规范': prompt.includes('## 设计规范'),
    '包含框架约定': prompt.includes('##') && (prompt.includes('HTML 模式约定') || prompt.includes('React CDN 模式约定') || prompt.includes('Vue CDN 模式约定')),
  };

  // 框架特定检查
  if (framework === 'html') {
    checks['包含 Tailwind CDN'] = prompt.includes('cdn.tailwindcss.com');
    checks['不包含 React CDN'] = !prompt.includes('react@18');
    checks['不包含 Vue CDN'] = !prompt.includes('Vue SFC');
  } else if (framework === 'react-cdn') {
    checks['包含 React CDN'] = prompt.includes('react@18');
    checks['包含 Babel CDN'] = prompt.includes('babel.min.js');
    checks['不包含 HTML 模式约定'] = !prompt.includes('## HTML 模式约定');
    checks['不包含 Vue CDN'] = !prompt.includes('Vue SFC');
  } else if (framework === 'vue-cdn') {
    checks['包含 Vue SFC'] = prompt.includes('Vue SFC');
    checks['不包含 HTML 模式约定'] = !prompt.includes('## HTML 模式约定');
    checks['不包含 React CDN'] = !prompt.includes('react@18');
  }

  console.log('检查结果:');
  for (const [check, passed] of Object.entries(checks)) {
    console.log(`  ${passed ? '✓' : '✗'} ${check}`);
  }

  console.log(`\n提示词长度: ${prompt.length} 字符`);

  // 显示框架约定部分的前几行
  const frameworkSection = prompt.match(/## (HTML|React CDN|Vue CDN) 模式约定/);
  if (frameworkSection) {
    const startIdx = prompt.indexOf(frameworkSection[0]);
    const preview = prompt.slice(startIdx, startIdx + 200);
    console.log(`\n框架约定预览:\n${preview}...`);
  }
}

console.log('\n=== 验证完成 ===');