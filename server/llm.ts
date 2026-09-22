/**
 * LLM 调用核心逻辑。
 * 调用 Agnes AI API，支持流式输出与取消。
 * 支持批准流程：分析完成后暂停等待用户批准。
 * 支持多文件项目生成：工程师阶段输出 JSON 格式的多文件结构。
 * 支持多轮对话上下文：迭代请求携带最近 N 条对话历史。
 */

import {
  parseMultiFileOutput,
  repairTruncatedMultiFileOutput,
  toFileNodeRecord,
  generateFileTreeSummary,
  formatAffectedFiles,
  type MultiFileOutput,
  type GeneratedFile,
  type FileLanguage,
} from './multiFileParser.js';
import { classifyIntent, INTENT_LABELS, type IntentResult, type IntentType } from './intentClassifier.js';
import { buildIterationSummary, estimateSummaryTokens } from './utils/iterationSummary.js';
import { withRetry, DegradationTriggeredError, type RetryProgressEvent } from './utils/retry.js';
import {
  trimContext,
  calculateTokenSavings,
} from './utils/contextTrimming.js';
import type { ChangeList, FileChange } from './types.js';

/**
 * 对话轮次输入（从前端传入，用于构建多轮上下文）。
 */
export interface ChatTurnInput {
  role: 'user' | 'assistant';
  content: string;
}

/** 多轮上下文构建配置 */
const CHAT_CONTEXT_CONFIG = {
  /** 最多保留的用户指令条数（4.2 设计：最近 5 条修改指令） */
  MAX_USER_TURNS: 5,
  /** 单条用户消息字符上限 */
  USER_MSG_CAP: 200,
  /** 单条助手消息字符上限（摘要用途） */
  ASSISTANT_MSG_CAP: 120,
  /** 整个上下文块字符上限（约 1000 tokens） */
  TOTAL_BLOCK_CAP: 1600,
  /** 用户消息超出时的截断标记 */
  TRUNCATE_MARKER: '…',
} as const;

/**
 * 构建多轮对话上下文块（纯函数，可离线测试）。
 *
 * 策略：
 * 1. 从末尾向前扫描，保留最近 N=5 条用户指令
 * 2. 每条用户指令后若紧跟助手消息，一并纳入
 * 3. 对每条消息应用字符上限截断
 * 4. 总字符数超限时，从最早的轮次开始丢弃
 *
 * @param turns 原始对话轮次数组（已按时间升序）
 * @param originalRequest 可选的最初需求（当历史窗口不含首条时单独标注）
 * @returns 格式化的上下文块字符串，无有效内容时返回空字符串
 */
export function buildChatContextBlock(
  turns: ChatTurnInput[],
  originalRequest?: string
): string {
  if (!turns || turns.length === 0) return '';

  // 过滤无效条目
  const validTurns = turns.filter(
    (t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim().length > 0
  );
  if (validTurns.length === 0) return '';

  // 从后向前收集最近 N 条用户指令及其助手回复
  const selectedTurns: ChatTurnInput[] = [];
  let userCount = 0;
  for (let i = validTurns.length - 1; i >= 0 && userCount < CHAT_CONTEXT_CONFIG.MAX_USER_TURNS; i--) {
    const turn = validTurns[i];
    if (!turn) continue;
    if (turn.role === 'user') {
      userCount++;
      // 助手回复在时间上位于用户之后，即数组中 index i+1
      const next = validTurns[i + 1];
      if (next && next.role === 'assistant') {
        selectedTurns.unshift(next); // 先加助手（保持时间顺序）
      }
      selectedTurns.unshift(turn); // 再加用户
    }
    // 助手消息单独出现时会在上述逻辑中被跳过（由用户触发纳入）
  }

  if (selectedTurns.length === 0) return '';

  // 对每条消息应用截断
  const truncatedTurns = selectedTurns.map((t) => {
    const cap = t.role === 'user' ? CHAT_CONTEXT_CONFIG.USER_MSG_CAP : CHAT_CONTEXT_CONFIG.ASSISTANT_MSG_CAP;
    const trimmed = t.content.trim();
    const truncated = trimmed.length > cap ? trimmed.slice(0, cap) + CHAT_CONTEXT_CONFIG.TRUNCATE_MARKER : trimmed;
    return { role: t.role, content: truncated };
  });

  // 构建原始需求行（如果提供且不在窗口中）
  const firstUserInWindow = truncatedTurns.find((t) => t.role === 'user');
  const originalLine =
    originalRequest && firstUserInWindow && firstUserInWindow.content !== originalRequest.trim().slice(0, CHAT_CONTEXT_CONFIG.USER_MSG_CAP)
      ? [`用户最初需求：${originalRequest.trim().slice(0, CHAT_CONTEXT_CONFIG.USER_MSG_CAP)}${originalRequest.trim().length > CHAT_CONTEXT_CONFIG.USER_MSG_CAP ? CHAT_CONTEXT_CONFIG.TRUNCATE_MARKER : ''}`]
      : [];

  // 构建对话行
  const turnLines = truncatedTurns.map((t) => {
    const prefix = t.role === 'user' ? '用户：' : '助手：';
    return `${prefix}${t.content}`;
  });

  // 合并并检查总长度
  let allLines = [...originalLine, ...turnLines];
  let block = allLines.join('\n');

  // 总长度超限时，从最早的用户轮次开始丢弃（保留原始需求行）
  while (block.length > CHAT_CONTEXT_CONFIG.TOTAL_BLOCK_CAP && turnLines.length > 1) {
    // 找到第一个用户行索引（跳过原始需求行）
    const firstUserIdx = originalLine.length > 0 ? allLines.findIndex((l, i) => i >= originalLine.length && l.startsWith('用户：')) : allLines.findIndex((l) => l.startsWith('用户：'));
    if (firstUserIdx === -1) break;
    // 移除该用户行及其前面的助手行（如果有）
    const removeIdx = firstUserIdx > 0 && allLines[firstUserIdx - 1]?.startsWith('助手：') ? firstUserIdx - 1 : firstUserIdx;
    allLines = allLines.filter((_, i) => i !== removeIdx);
    // 如果移除的是助手行，还需移除对应的用户行
    if (allLines[removeIdx]?.startsWith('用户：')) {
      // 已移除助手，继续
    } else if (removeIdx < allLines.length && allLines[removeIdx]?.startsWith('用户：')) {
      // 正常
    }
    // 重建 turnLines 和 allLines
    const newTurnLines: string[] = [];
    for (let i = originalLine.length; i < allLines.length; i++) {
      newTurnLines.push(allLines[i]!);
    }
    allLines = [...originalLine, ...newTurnLines];
    block = allLines.join('\n');
  }

  return block.trim();
}

/** 分析师系统提示词（生成功能清单） */
const ANALYST_SYSTEM_PROMPT = `你是 Atoms 平台的需求分析师。分析用户需求，输出可在浏览器内实现的功能清单。

## 输出格式
只输出一个 JSON 对象，不要任何解释文字：
{
  "appTitle": "应用标题",
  "appType": "dashboard | landing | todo | chart | tool | other",
  "summary": "一句话概述",
  "features": [
    { "id": "F1", "name": "功能名", "description": "功能描述", "priority": "must 或 nice" }
  ],
  "interactions": ["关键交互列表"],
  "assumptions": ["假设列表"]
}

## 约束
- 功能最多 6 条，priority 为 must 的最多 4 条
- 每条功能必须是浏览器内可演示的真实交互
- 游戏类应用必须有游戏结束判定和重新开始功能
- 不允许假设后端服务、数据库或第三方接口`;

/** 迭代模式的分析师追加指令 */
const ANALYST_ITERATION_PROMPT = `## 本次为迭代修改任务

用户会对现有应用提出修改要求。你的 features 列表描述的是"本次需要落地的变更项"而非全新功能；must 条目即本次必须完成的修改。请在 assumptions 中列出你无法从描述中确定的点。

## 现有项目文件结构
{{FILE_TREE_SUMMARY}}

请基于现有项目理解当前功能，仅针对用户的新需求或修改要求输出变更项。`;

/** 工程师系统提示词基础部分（与框架无关） */
const ENGINEER_BASE_PROMPT = `你是 Atoms 平台的前端工程师。你根据功能清单生成一个多文件结构的前端项目。你输出 JSON 格式的文件列表。

## 输出格式
只输出一个 JSON 对象，禁止输出任何解释文字。结构如下：
{
  "files": [
    { "path": "/index.html", "content": "文件内容", "language": "html" },
    { "path": "/styles/main.css", "content": "文件内容", "language": "css" }
  ]
}

## 文件组织规范（通用）
1. 入口文件必须是 /index.html
2. 每个文件内容独立完整，不引用其他本地文件（引用通过路径声明，由组装器处理）
3. 文件组织方式由框架规范（见下文"框架特定约定"）决定，不同框架有不同的结构

## 产物铁律
1. 所有文件自包含，组装后可在浏览器直接运行
2. 外部资源只允许 https://cdn.jsdelivr.net 和 https://cdn.tailwindcss.com
3. 禁止手写 SVG 图标，使用 CSS 形状或 Unicode 符号
4. 数据持久化只用 localStorage
5. 游戏类应用必须有游戏结束判定（失败/胜利条件）和重新开始功能（重开一局按钮）

## 设计规范
- 字体使用系统字体栈：system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
- 禁用紫色渐变，使用明确主题色加中性灰阶
- 布局响应式，移动端不塌陷
- 中文文案使用中文标点

## 引用规范
在 index.html 中引用其他文件（示例）：
- CSS: <link rel="stylesheet" href="./styles/main.css">
- JS: <script src="./src/入口文件"></script>
这些引用会在预览时由组装器内联替换。具体文件组织方式与入口文件命名由"框架特定约定"决定（React 用 .jsx，Vue/HTML 用 .js）。

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

### 文件组织规范（必须遵守）
模拟真实 React 项目的组件化结构，必须按以下目录组织文件：

\`\`\`
/index.html              # 入口，只含挂载点和 CDN 引用
/src/main.jsx            # React 入口：ReactDOM.createRoot(...).render(<App />)
/src/App.jsx             # 根组件
/src/components/         # 按功能拆分的组件目录
  /src/components/Header.jsx
  /src/components/Footer.jsx
/styles/main.css         # 全局样式
\`\`\`

**关键规则**：
1. **入口文件** \`/index.html\` 只包含挂载点 \`<div id="root"></div>\` 和 CDN 引用（React、ReactDOM、Babel），不写组件逻辑
2. **React 入口** \`/src/main.jsx\` 必须包含 \`ReactDOM.createRoot(document.getElementById('root')).render(<App />)\`
3. **根组件** \`/src/App.jsx\` 导出主应用组件，组合所有子组件
4. **组件拆分**：复杂应用必须按功能拆分到 \`/src/components/\` 目录，每个组件一个 \`.jsx\` 文件
5. **组件文件扩展名**：React 组件文件必须使用 \`.jsx\` 扩展名（不是 \`.js\`）
6. **引用方式**：在 \`/index.html\` 中引用各组件文件（组装器会内联）

### 代码风格示例

\`\`\`html
<!-- /index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="./styles/main.css">
  <title>React 应用</title>
</head>
<body>
  <div id="root"></div>
  <script src="./src/main.jsx"></script>
</body>
</html>
\`\`\`

\`\`\`jsx
// /src/main.jsx
function App() {
  const [count, setCount] = React.useState(0);

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

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
\`\`\`

### 关键点（必须遵守）
1. 引入 React、ReactDOM 和 Babel CDN（用于浏览器内 JSX 编译）
2. <script> 标签引用 .jsx 文件时使用 \`src\` 属性（组装器会内联并处理）
3. 使用 React Hooks（useState、useEffect）管理状态
4. 挂载点必须是 \`<div id="root"></div>\`
5. 使用 Tailwind 类名进行样式设计
6. 复杂应用按功能拆分组件到 \`/src/components/\` 目录`;

    case 'vue-cdn':
      return `## Vue CDN 模式约定

### 文件组织规范（必须遵守）
模拟真实 Vue 项目的组件化结构，必须按以下目录组织文件：

\`\`\`
/index.html              # 入口，只含挂载点和 CDN 引用
/src/main.js             # Vue 入口：createApp(App).mount('#app')
/src/App.js              # 根组件（导出组件选项对象，含 template 字符串）
/src/components/         # 按功能拆分的组件目录
  /src/components/Header.js
  /src/components/Footer.js
/styles/main.css         # 全局样式
\`\`\`

**关键规则**：
1. **入口文件** \`/index.html\` 只包含挂载点 \`<div id="app"></div>\` 和 CDN 引用（Vue 3），不写组件逻辑
2. **Vue 入口** \`/src/main.js\` 必须包含 \`Vue.createApp(App).mount('#app')\`
3. **根组件** \`/src/App.js\` 导出组件选项对象，使用 \`template\` 字符串定义模板
4. **组件拆分**：复杂应用必须按功能拆分到 \`/src/components/\` 目录，每个组件一个 \`.js\` 文件
5. **组件格式**：Vue CDN 模式使用组件选项对象格式（不使用 SFC），每个组件文件导出含 \`template\` 字段的对象
6. **引用方式**：在 \`/index.html\` 中引用各组件文件（组装器会内联）

### 代码风格示例

\`\`\`html
<!-- /index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="./styles/main.css">
  <title>Vue 应用</title>
</head>
<body>
  <div id="app"></div>
  <script src="./src/main.js"></script>
</body>
</html>
\`\`\`

\`\`\`javascript
// /src/main.js
const { createApp, ref } = Vue;

const App = {
  setup() {
    const count = ref(0);
    return { count };
  },
  template: \`
    <div class="min-h-screen bg-gray-50 p-4">
      <h1 class="text-2xl font-bold">Vue 应用</h1>
      <button
        @click="count++"
        class="px-4 py-2 bg-green-500 text-white rounded"
      >
        点击 {{ count }} 次
      </button>
    </div>
  \`
};

createApp(App).mount('#app');
\`\`\`

### 关键点（必须遵守）
1. 引入 Vue 3 CDN：\`<script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js"></script>\`
2. 挂载点必须是 \`<div id="app"></div>\`
3. 使用 Vue 3 Composition API（ref、reactive、onMounted 等）
4. 使用 Tailwind 类名进行样式设计
5. Vue 全局对象通过 CDN 注入，可直接使用 \`const { createApp, ref } = Vue\`
6. 复杂应用按功能拆分组件到 \`/src/components/\` 目录
7. 每个组件文件导出组件选项对象，使用 \`template\` 字符串（不是 SFC 格式）`;

    default:
      return `## HTML 模式约定

### 文件组织规范（必须遵守）
简单直接的结构，适合快速原型：

\`\`\`
/index.html              # 入口，包含完整页面结构
/styles/main.css         # 样式文件
/src/main.js             # 脚本文件（原生 DOM 操作）
\`\`\`

**关键规则**：
1. **入口文件** \`/index.html\` 包含完整的 HTML 结构（头部、主体、脚本引用）
2. **样式文件** \`/styles/main.css\` 存放所有 CSS 规则
3. **脚本文件** \`/src/main.js\` 使用原生 JavaScript 进行 DOM 操作
4. 复杂时可拆分工具函数到 \`/src/utils.js\`，但保持结构简单
5. 不使用组件化框架，直接操作 DOM

### 代码风格示例

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="./styles/main.css">
  <title>应用标题</title>
</head>
<body class="min-h-screen bg-gray-50">
  <div class="container mx-auto p-4">
    <h1 id="title" class="text-2xl font-bold">应用标题</h1>
    <button id="counter" class="px-4 py-2 bg-blue-500 text-white rounded">
      点击 0 次
    </button>
  </div>
  <script src="./src/main.js"></script>
</body>
</html>
\`\`\`

\`\`\`javascript
// /src/main.js
let count = 0;
const counterBtn = document.getElementById('counter');

counterBtn.addEventListener('click', () => {
  count++;
  counterBtn.textContent = \`点击 \${count} 次\`;
});
\`\`\`

### 关键点（必须遵守）
1. 在 <head> 中引入 Tailwind CDN
2. 使用 Tailwind 类名进行样式设计
3. JavaScript 直接写在 /src/main.js 文件中
4. 状态管理使用原生 JavaScript 变量和 DOM 操作`;
  }
}

/**
 * 构建完整的工程师系统提示词。
 * 基础部分 + 用户选择的框架特定规范。
 */
export function buildEngineerSystemPrompt(framework: 'html' | 'react-cdn' | 'vue-cdn'): string {
  return ENGINEER_BASE_PROMPT + '\n\n' + getFrameworkPrompt(framework);
}

/** 迭代模式的工程师追加指令 */
const ENGINEER_ITERATION_PROMPT = `## 迭代修改模式

你正在修改一个已有项目。必须遵循以下原则：

### 核心原则
1. **最小变更**：只修改用户要求的部分，不改动其他代码
2. **保持一致性**：延续现有代码的风格、命名、结构
3. **增量修改**：基于现有代码修改，不要重写整个文件

### 输出规则
- 只输出**被修改的文件**，未修改的文件不要输出
- 保留所有未涉及变更的代码片段
- 新增功能时，尽量复用现有组件和样式
- 删除功能时，清理相关代码但保留其他部分

### 禁止行为
- 不要重新生成整个项目
- 不要改变现有代码的命名风格
- 不要添加用户未要求的新功能
- 不要删除用户未要求删除的功能

### 自检清单
输出前确认：
- 我只修改了用户要求的部分
- 未修改的代码保持原样
- 变更是增量式的，不是重写`;

/**
 * 工程师 diff 模式系统提示词（modify 意图）。
 *
 * 输出 JSON 变更清单而非完整文件，节省输出 token 并强制最小变更。
 * 配套 applyChanges 将清单应用到现有文件；解析或应用失败时，
 * 调用方必须回退到 ENGINEER_SYSTEM_PROMPT + ENGINEER_ITERATION_PROMPT 的
 * 全量文件模式（降级路径），避免用户面对裸报错。
 */
const ENGINEER_DIFF_PROMPT = `你是 Atoms 平台的前端工程师，负责根据修改请求**增量修改**代码。

【重要】你是修改模式，只输出变更的部分，不要重新生成整个文件。

【输入】
1. 用户的修改请求
2. 现有文件内容（带行号标注，行号仅供定位，输出时使用去掉行号后的原文）

【输出格式】
只输出一个 JSON 对象，禁止输出任何解释文字、禁止用 markdown 围栏包裹：
{
  "changes": [
    {
      "file": "文件路径（与输入中的文件路径完全一致）",
      "edits": [
        {
          "line": 行号,
          "old": "原行内容（必须与原文件该行逐字符精确匹配，包括缩进）",
          "new": "新行内容",
          "type": "replace 或 insert 或 delete"
        }
      ]
    }
  ],
  "summary": "变更摘要（一句话，20 字以内）"
}

【编辑类型说明】
- replace：将 line 指定的行替换为 new 内容，old 必须与原行完全一致
- insert：在 line 指定的行之后插入 new 内容，old 填该行原文（用于校验定位）
- delete：删除 line 指定的行，old 填该行原文，new 填空字符串

【规则】
1. old 必须精确匹配原文件中的行，包括空格和缩进；匹配失败将导致整个变更被拒绝
2. line 是 1-indexed 的行号，基于原始文件（未应用任何编辑前）的行号
3. 同一文件的多个编辑按行号从大到小排列（从文件末尾往前改，避免行号偏移）
4. 每次只修改必要的行，不要重写未变更的部分
5. 删除多行时，每行单独一个 delete 操作
6. 插入多行时，new 中用 \\n 分隔（JSON 转义），一次 insert 可插入多行内容
7. 只修改用户要求的部分，不要顺手改动其他代码
8. 保持现有代码的风格、命名、缩进一致

【示例】
用户请求："把按钮改成蓝色"
现有文件 index.html：
1 | <div class="container">
2 |   <button class="bg-red-500">点击</button>
3 | </div>

输出：
{
  "changes": [
    {
      "file": "/index.html",
      "edits": [
        {
          "line": 2,
          "old": "  <button class=\\"bg-red-500\\">点击</button>",
          "new": "  <button class=\\"bg-blue-500\\">点击</button>",
          "type": "replace"
        }
      ]
    }
  ],
  "summary": "按钮颜色从红色改为蓝色"
}

【自检清单】
输出前确认：
- old 与原文件对应行逐字符一致（含缩进）
- 行号基于原始文件且从大到小排列
- 没有输出未变更的行
- 只输出 JSON，无其他文字`;

/** 审查者系统提示词 */
const REVIEWER_SYSTEM_PROMPT = `你是 Atoms 平台的质量审查者。你审查多文件项目是否合格交付。你不重写代码，只输出审查结论。

## 审查维度（按顺序逐条检查）
1. 结构完整：有 /index.html 入口文件，且 HTML 有 <!DOCTYPE html>、<html>、<head>、<body> 且标签全部闭合
2. 脚本可执行：每个 .js 文件内无明显语法错误；HTML 中引用的 JS 文件路径在 files 中存在
3. 样式合规：HTML 中引用的 CSS 文件路径在 files 中存在
4. 功能覆盖：功能清单中 priority 为 must 的每条功能在代码中有对应实现
5. 交互真实：按钮与表单有事件绑定和对应处理逻辑，不是纯静态
6. 资源合规：外部资源只允许来自 cdn.jsdelivr.net 或 cdn.tailwindcss.com
7. 体验底线：首屏有可见内容；无紫色渐变；未使用 Inter 字体

## 输出格式
只输出一个 JSON 对象，禁止输出其他任何文字：
{
  "pass": true 或 false,
  "checks": [
    { "item": "结构完整", "pass": true, "note": "一句话说明，20 字以内" }
  ],
  "repairInstructions": [],
  "missingFiles": ["不存在的文件路径列表"]
}
约束：checks 必须覆盖上述 7 个维度。
pass 为 false 时 repairInstructions 必填：最多 3 条，每条是一个具体、可独立执行的修复指令。
pass 为 true 时 repairInstructions 必须是空数组，missingFiles 必须是空数组。`;

/** 分析模式系统提示词（analyze 意图：解释现有项目，不改动、不生成代码） */
const ANALYZE_SYSTEM_PROMPT = `你是 Atoms 平台的需求分析师。用户想了解现有项目的功能、结构或实现，你的任务是解释与分析，不是修改代码。

## 输出要求
- 用简体中文输出结构化的分析报告（可用 Markdown 小标题与列表）
- 覆盖：应用概况、主要功能清单、技术实现要点、已知局限或改进建议
- 只基于提供的项目文件与用户问题作答，不要臆造不存在的功能
- 篇幅控制在 500 字以内，直接输出报告正文，不要输出 JSON`;

/** 诊断模式系统提示词（diagnose 意图：定位问题并给出修复建议，不直接改代码） */
const DIAGNOSE_SYSTEM_PROMPT = `你是 Atoms 平台的问题诊断工程师。用户报告了应用的问题或异常行为，你的任务是根据项目代码定位原因并给出修复建议。你不直接重写代码。

## 输出格式
只输出一个 JSON 对象，禁止输出其他任何文字：
{
  "problem": "用户报告的问题，一句话概括",
  "rootCause": "根因分析：具体到文件与代码位置，说明为什么会出现该问题",
  "affectedFiles": ["涉及的文件路径"],
  "fixSuggestions": ["具体、可独立执行的修复建议，最多 3 条"]
}
约束：rootCause 必须引用具体文件路径与相关代码行为；无法定位时如实说明，并列出最可能的方向。`;

/**
 * SSE 事件类型
 *
 * warning：非致命异常通知（当前仅截断抢救）。前端未知事件类型会安全忽略，
 * 该事件为协议预留，供前端后续展示抢救提示。
 * retry：重试进度通知。API 调用失败重试时发送，前端可在思考区展示重试状态。
 */
export type LLMEventType = 'stage' | 'delta' | 'approval_required' | 'done' | 'error' | 'warning' | 'retry';

/** 意图信息（SSE stage 事件携带，供前端展示识别结果与纠正入口） */
export interface IntentInfo {
  type: IntentType;
  confidence: number;
  reasoning?: string;
  /** 建议的框架（自动识别结果） */
  suggestedFramework?: 'html' | 'react-cdn' | 'vue-cdn';
}

/** token 统计信息（done 事件携带） */
export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMEvent {
  type: LLMEventType;
  payload: {
    phase?: 'analysis' | 'generate' | 'review' | 'diagnose';
    text?: string;
    analysis?: string; // 分析/诊断结果文本（analyze 与 diagnose 意图的 done 载荷）
    features?: unknown; // 功能清单
    html?: string; // 单文件 HTML（向后兼容）
    files?: Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }>; // 多文件结构
    message?: string;
    sessionId?: string; // 会话 ID，用于批准后继续
    rescuedFiles?: string[]; // 截断抢救成功时，被恢复的文件路径列表（warning 事件）
    /** 意图识别结果（首个 stage 事件附带） */
    intent?: IntentInfo;
    /** 重试事件字段 */
    retry?: {
      attempt: number;
      maxRetries: number;
      delayMs: number;
      errorMessage: string;
    };
    /** 降级标记（error 事件）：连续容量错误触发降级 */
    degraded?: boolean;
    /** token 统计（done 事件携带） */
    stats?: TokenStats;
    /** 变更清单（diff 模式 done 事件携带） */
    changes?: ChangeList;
    /** 变更摘要（diff 模式 done 事件携带，与 changes.summary 一致，供前端快速访问） */
    changeSummary?: string;
  };
}

/**
 * 待批准的会话
 */
interface PendingSession {
  /** 关联的请求 ID，用于取消时清理会话 */
  requestId?: string;
  prompt: string;
  currentHtml?: string; // 向后兼容：单文件模式
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>; // 多文件模式（裁剪后）
  /** 原始文件集合（裁剪前的完整文件），用于合并时保留未变更文件 */
  originalFiles?: Record<string, { path: string; content: string; language: FileLanguage }>;
  analysisResult: string;
  features: unknown;
  /** 预构建的对话上下文块，用于工程师阶段注入 */
  chatContextBlock?: string;
  /** 原始对话轮次，迭代模式下用于构建 9 段式结构化摘要 */
  chatTurns?: ChatTurnInput[];
  /** 原始需求（首次用户输入），摘要中标注"用户最初需求" */
  originalRequest?: string;
  /** 项目偏好记忆，批准后继续生成时注入工程师 prompt */
  preferences?: GenerateOptions['preferences'];
  /** 全局偏好记忆（跨项目生效），注入工程师 prompt */
  globalPreferences?: GenerateOptions['globalPreferences'];
  /** 分析阶段的 token 使用量，用于最终统计 */
  analysisUsage?: LLMUsage;
  /** 目标框架：html / react-cdn / vue-cdn */
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
  /** 是否使用 diff 模式（modify 意图）：输出 JSON 变更清单而非完整文件 */
  useDiffMode?: boolean;
  createdAt: Date;
}

/** 待批准会话存储（内存，生产环境应使用 Redis） */
const pendingSessions = new Map<string, PendingSession>();

/**
 * 获取待批准会话
 */
export function getPendingSession(sessionId: string): PendingSession | undefined {
  return pendingSessions.get(sessionId);
}

/**
 * 删除待批准会话
 */
export function deletePendingSession(sessionId: string): boolean {
  return pendingSessions.delete(sessionId);
}

/**
 * 生成请求选项
 */
export interface GenerateOptions {
  prompt: string;
  currentHtml?: string; // 向后兼容：单文件模式
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>; // 多文件模式
  /** 多轮对话上下文：最近的对话轮次（用户+助手交替） */
  chatTurns?: ChatTurnInput[];
  /** 原始需求（首次用户输入），用于标注"用户最初需求" */
  originalRequest?: string;
  abortSignal?: AbortSignal;
  onEvent: (event: LLMEvent) => void;
  /** 强制指定意图（可选透传，白名单与前端契约一致） */
  intentOverride?: 'create' | 'modify' | 'analyze' | 'diagnose';
  /** 项目偏好记忆，注入工程师 prompt */
  preferences?: Array<{
    type: string;
    key: string;
    value: string;
    reason?: string;
  }>;
  /** 全局偏好记忆（跨项目生效），注入分析师和工程师 prompt */
  globalPreferences?: {
    defaultFramework?: 'html' | 'react-cdn' | 'vue-cdn';
    preferredLanguage?: 'zh' | 'en';
    namingStyle?: 'camelCase' | 'snake_case' | 'PascalCase';
    globalStyles?: string[];
    globalCorrections?: string[];
  };
  /** 目标框架：html / react-cdn / vue-cdn，缺省为 html */
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
  /** 用户手动选择的框架（优先级最高，覆盖自动识别） */
  explicitFramework?: 'html' | 'react-cdn' | 'vue-cdn';
}

/**
 * 对话消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 单次调用的可覆盖参数（可选，缺省走环境变量与既有默认值）。
 * model 默认不开放给客户端覆盖：服务端以 LLM_MODEL 为准，避免前端传入
 * 上游不认识的模型名导致 4xx。
 */
export interface StreamChatCallOptions {
  /** 覆盖模型名（默认取 LLM_MODEL 环境变量） */
  model?: string;
  /** 覆盖 max_tokens 上限（默认 8192） */
  maxTokens?: number;
  /** 采样温度；不传则不下发该字段，由上游默认值决定 */
  temperature?: number;
  /** 总超时时间（毫秒），默认 120000（2 分钟） */
  timeout?: number;
  /** 重试进度回调（withRetry 触发时通知调用方，用于向客户端转发 retry 事件） */
  onRetry?: (event: RetryProgressEvent) => void;
}

/**
 * 中止控制器管理
 * 用于取消进行中的请求
 */
const activeControllers = new Map<string, AbortController>();

/**
 * 取消进行中的请求
 * 同时清理关联的待批准会话
 */
export function cancelGeneration(requestId: string): boolean {
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeControllers.delete(requestId);
  }

  // 清理关联的待批准会话
  for (const [sessionId, session] of pendingSessions.entries()) {
    if (session.requestId === requestId) {
      pendingSessions.delete(sessionId);
      break;
    }
  }

  return controller != null;
}

/**
 * LLM API usage 字段结构
 */
interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * 流式调用结果（包含 usage 信息）
 */
export interface StreamChatResult {
  content: string;
  usage?: LLMUsage;
}

/**
 * 调用 OpenAI 兼容 API 流式生成
 *
 * 支持重试（server/utils/retry.ts withRetry）：
 * - 429/529/超时 → 自动重试（指数退避 + 抖动）
 * - 400 参数错 → 不重试
 * - 连续 3 次容量错误 → 抛 DegradationTriggeredError 触发降级
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  abortSignal?: AbortSignal,
  callOptions?: StreamChatCallOptions
): Promise<string> {
  const result = await streamChatCompletionWithUsage(messages, onDelta, abortSignal, callOptions);
  return result.content;
}

/**
 * 调用 OpenAI 兼容 API 流式生成（带 usage 返回）
 *
 * 支持重试（server/utils/retry.ts withRetry）：
 * - 429/529/超时 → 自动重试（指数退避 + 抖动）
 * - 400 参数错 → 不重试
 * - 连续 3 次容量错误 → 抛 DegradationTriggeredError 触发降级
 */
export async function streamChatCompletionWithUsage(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  abortSignal?: AbortSignal,
  callOptions?: StreamChatCallOptions
): Promise<StreamChatResult> {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('LLM_API_KEY 环境变量未配置');
  }

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.agnes-ai.cn/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'agnes-3.0-flash';
  const timeout = callOptions?.timeout ?? 120000; // 默认 2 分钟总超时

  const requestBody: Record<string, unknown> = {
    model: callOptions?.model || model,
    messages,
    stream: true,
    // 完整单文件 HTML 应用实测 12KB+（约 4000-6000 token），4096 会把生成截断在
    // 半途；8192 提供约 2 倍余量。该值在主流 flash 级模型（含默认的 agnes-3.0-flash）
    // 输出上限之内；若供应商上限更低，API 会返回 4xx 走已有的 error 事件分支。
    // 输出较短的调用方（如需求优化器）可通过 callOptions.maxTokens 收紧上限。
    max_tokens: callOptions?.maxTokens ?? 8192,
    // 请求返回 usage 字段（流式模式下通常在最后一个 chunk）
    stream_options: { include_usage: true },
  };
  if (typeof callOptions?.temperature === 'number') {
    requestBody.temperature = callOptions.temperature;
  }

  // 创建超时控制器
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeout);

  // 合并外部 abortSignal 与超时信号
  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // 核心 fetch 与流消费（可重试单元：每次重试从头建立连接，delta 只在上游
  // 返回 2xx 后才产生，重试不会向前端重复推送已发出的增量）
  const fetchStream = async (): Promise<StreamChatResult> => {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        // 状态码必须以 "HTTP <code>" 形式出现在消息中：classifyAPIError 依赖
        // /HTTP (\d+)/ 正则提取状态码做重试分类
        throw new Error(`LLM API 错误 (HTTP ${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let usage: LLMUsage | undefined;
      let finishReason: string | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 解析 SSE 数据
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留未完成的行

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6));

                // 提取内容增量
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  onDelta(content);
                }

                // 提取 finish_reason（P1-3：检测截断信号）
                const reason = json.choices?.[0]?.finish_reason;
                if (reason) {
                  finishReason = reason;
                }

                // 提取 usage 字段（通常在最后一个 chunk）
                if (json.usage) {
                  usage = {
                    prompt_tokens: json.usage.prompt_tokens ?? 0,
                    completion_tokens: json.usage.completion_tokens ?? 0,
                    total_tokens: json.usage.total_tokens ?? 0,
                  };
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // P1-3：检测 finish_reason === 'length'，触发截断抢救
      if (finishReason === 'length') {
        console.warn(
          '[streamChatCompletion] 检测到输出因 max_tokens 截断，finish_reason=length'
        );
        // 将截断标记附加到结果，由调用方决定是否触发 repairTruncatedMultiFileOutput
        // 这里不直接抢救，因为不同调用方有不同的输出格式（单文件/多文件/变更清单）
        // 抢救逻辑在 continueAfterApproval 和 parseChangeList 中处理
      }

      return { content: fullContent, usage };
    } catch (error) {
      // 区分超时错误与其他错误
      if (error instanceof Error && error.name === 'AbortError') {
        // 检查是否是超时导致的 abort
        if (timeoutController.signal.aborted && !abortSignal?.aborted) {
          throw new Error('LLM 调用超时（超过 120 秒），请稍后重试');
        }
        throw error;
      }
      throw error;
    }
  };

  // 带重试执行
  try {
    return await withRetry(fetchStream, {
      maxRetries: 3,
      signal: abortSignal,
      onProgress: callOptions?.onRetry,
    });
  } catch (error) {
    if (error instanceof DegradationTriggeredError) {
      console.error('[streamChatCompletion] 连续容量错误，触发降级');
    }
    throw error;
  } finally {
    // 清理超时定时器
    clearTimeout(timeoutId);
  }
}

/**
 * 剥离 LLM 输出中误加的 markdown 代码围栏。
 * 提示词（ENGINEER_SYSTEM_PROMPT）要求首行 <!DOCTYPE html>，但模型偶尔仍以 ```html
 * 围栏包裹输出。采用"流式拼接完成后一次性剥离"而非逐 delta 处理：
 * 围栏序列可能被拆分在相邻 delta 的边界上，逐 delta 剥离需要跨 delta 状态机，
 * 而 delta 仅用于前端实时显示（围栏前缀只影响开头几个字符的显示），只有 done
 * 载荷的 fullHtml 会被校验与落盘，在源头一次性处理即可。
 * 仅剥离首行围栏与末行围栏，不触碰 HTML 内部内容。
 */
export function stripMarkdownFence(html: string): string {
  let result = html.trim();
  // 剥离开头围栏行（```html / ``` 等）
  if (result.startsWith('```')) {
    const firstNewline = result.indexOf('\n');
    result = firstNewline === -1 ? '' : result.slice(firstNewline + 1);
  }
  // 剥离结尾的围栏行（模型补的闭合围栏，或截断时的残留围栏）
  if (result.endsWith('```')) {
    const lastNewline = result.lastIndexOf('\n');
    result = lastNewline === -1 ? '' : result.slice(0, lastNewline);
  }
  return result.trim();
}

/**
 * 完整 HTML 文档校验（截断检测兜底）：
 * 以 <!DOCTYPE 开头且以 </html> 结尾才算完整。max_tokens 截断的产物不满足，
 * 不应作为 done 载荷下发，由调用方改发 error 事件。
 */
export function isCompleteHtmlDocument(html: string): boolean {
  const trimmed = html.trim();
  return /^<!doctype/i.test(trimmed) && trimmed.endsWith('</html>');
}

/**
 * 三阶段生成（支持批准流程）
 * @param waitForApproval - 是否等待批准（默认 true）
 */
export async function generateWithStages(options: GenerateOptions): Promise<void> {
  const { prompt, currentHtml, currentFiles, chatTurns, originalRequest, abortSignal, onEvent, preferences, globalPreferences, intentOverride, framework = 'html', explicitFramework } = options;

  const requestId = crypto.randomUUID();
  const controller = new AbortController();

  // 注册可取消
  activeControllers.set(requestId, controller);

  // 合并中止信号
  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, controller.signal])
    : controller.signal;

  try {
    // 意图识别：先于一切阶段执行。intentOverride 由前端纠正入口传入
    // （路由层已做白名单校验），否则走关键词 + 项目状态自动识别
    const fileCount = currentFiles ? Object.keys(currentFiles).length : 0;
    const intent: IntentResult = intentOverride
      ? { type: intentOverride, confidence: 1, reasoning: '用户手动指定意图' }
      : await classifyIntent({ userPrompt: prompt, hasExistingProject: fileCount > 0, fileCount });
    console.info(
      '[generateWithStages] 意图识别:',
      INTENT_LABELS[intent.type],
      `(type=${intent.type}, confidence=${intent.confidence.toFixed(2)})`,
      intent.reasoning ?? ''
    );

    // 框架选择优先级：
    // 1. 用户手动选择（explicitFramework）→ 最高优先级
    // 2. 意图识别建议（intent.suggestedFramework）
    // 3. 全局偏好（globalPreferences.defaultFramework）
    // 4. 传入参数（framework，默认 html）
    let selectedFramework: 'html' | 'react-cdn' | 'vue-cdn';
    if (explicitFramework) {
      selectedFramework = explicitFramework;
      console.info(`[generateWithStages] 使用用户手动选择的框架: ${selectedFramework}`);
    } else if (intent.suggestedFramework) {
      selectedFramework = intent.suggestedFramework;
      console.info(`[generateWithStages] 使用意图识别建议的框架: ${selectedFramework}`);
    } else if (globalPreferences?.defaultFramework) {
      selectedFramework = globalPreferences.defaultFramework;
      console.info(`[generateWithStages] 使用全局偏好框架: ${selectedFramework}`);
    } else {
      selectedFramework = framework;
      console.info(`[generateWithStages] 使用默认框架: ${selectedFramework}`);
    }

    // 意图分发：analyze/diagnose 只跑分析师（done 只带 analysis），
    // modify 直通工程师（跳过分析师与批准），create 走完整四角色流水线
    if (intent.type === 'analyze') {
      await runAnalyzePipeline({ prompt, currentFiles, intent, onEvent, signal: combinedSignal });
      return;
    }
    if (intent.type === 'diagnose') {
      await runDiagnosePipeline({ prompt, currentFiles, intent, onEvent, signal: combinedSignal });
      return;
    }
    if (intent.type === 'modify' && currentFiles && fileCount > 0) {
      // 无现有文件的 modify 视为创建需求的一部分，回退完整流水线
      await runDirectModifyPipeline({ prompt, currentFiles, intent, chatTurns, originalRequest, preferences, globalPreferences, framework: selectedFramework, onEvent, signal: combinedSignal });
      return;
    }

    // 阶段 1：分析（create 意图的完整流水线）
    onEvent({ type: 'stage', payload: { phase: 'analysis', intent } });

    // 构建分析师消息
    const analysisMessages: ChatMessage[] = [
      { role: 'system', content: ANALYST_SYSTEM_PROMPT },
    ];

    // 迭代模式：添加文件树摘要
    const isIteration = currentFiles && Object.keys(currentFiles).length > 0;
    if (isIteration && currentFiles) {
      const fileTreeSummary = generateFileTreeSummary(currentFiles);
      const iterationPrompt = ANALYST_ITERATION_PROMPT.replace('{{FILE_TREE_SUMMARY}}', fileTreeSummary);
      analysisMessages[0] = { role: 'system', content: ANALYST_SYSTEM_PROMPT + '\n\n' + iterationPrompt };
    }

    // 构建对话上下文块（多轮修改时注入）
    const chatContextBlock = buildChatContextBlock(chatTurns ?? [], originalRequest);

    // 构建全局偏好块（分析师阶段注入）
    const globalPrefSection = formatGlobalPreferencesForAnalyst(globalPreferences);

    const userContent = [
      globalPrefSection,
      chatContextBlock ? `${prompt}\n\n## 此前的对话上下文\n${chatContextBlock}` : prompt,
    ].filter(Boolean).join('\n\n');
    analysisMessages.push({ role: 'user', content: userContent });

    const analysisResult = await streamChatCompletionWithUsage(
      analysisMessages,
      (text) => onEvent({ type: 'delta', payload: { text, phase: 'analysis' } }),
      combinedSignal,
      {
        onRetry: (event) => {
          onEvent({
            type: 'retry',
            payload: {
              retry: {
                attempt: event.attempt,
                maxRetries: event.maxRetries,
                delayMs: event.delayMs,
                errorMessage: event.errorMessage,
              },
            },
          });
        },
      }
    );

    if (combinedSignal.aborted) return;

    // 解析分析结果
    let features: unknown;
    try {
      // 括号配平提取首个完整 JSON 对象（避免贪婪匹配跨多个 JSON 块）
      const text = analysisResult.content;
      let depth = 0;
      let start = -1;
      let jsonStr: string | null = null;

      for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (text[i] === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            jsonStr = text.slice(start, i + 1);
            break;
          }
        }
      }

      if (jsonStr) {
        features = JSON.parse(jsonStr);
      } else {
        features = { raw: analysisResult.content };
      }
    } catch {
      features = { raw: analysisResult.content };
    }

    // 发送批准请求事件
    const sessionId = crypto.randomUUID();
    pendingSessions.set(sessionId, {
      requestId,
      prompt,
      currentHtml,
      currentFiles,
      analysisResult: analysisResult.content,
      features,
      chatContextBlock,
      chatTurns,
      originalRequest,
      preferences,
      globalPreferences,
      analysisUsage: analysisResult.usage,
      framework: selectedFramework,
      createdAt: new Date(),
    });

    onEvent({
      type: 'approval_required',
      payload: {
        sessionId,
        analysis: analysisResult.content,
        features,
      },
    });

    // 注意：这里不继续执行，等待用户批准
    // 批准后调用 continueGeneration
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      onEvent({ type: 'error', payload: { message: '请求已取消' } });
    } else if (error instanceof DegradationTriggeredError) {
      // 降级事件：连续容量错误
      onEvent({
        type: 'error',
        payload: {
          message: 'API 服务持续过载，已触发降级。请稍后重试或切换模型。',
          degraded: true,
        },
      });
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      onEvent({ type: 'error', payload: { message } });
    }
  } finally {
    activeControllers.delete(requestId);
  }
}

/**
 * 批准后继续生成（多文件模式）
 * @param intent 意图信息（modify 直通模式由 runDirectModifyPipeline 传入，
 *               附着到 stage 事件供前端展示；批准流程入口不传）
 */
export async function continueAfterApproval(
  sessionId: string,
  onEvent: (event: LLMEvent) => void,
  abortSignal?: AbortSignal,
  intent?: IntentResult
): Promise<void> {
  const session = pendingSessions.get(sessionId);
  if (!session) {
    onEvent({ type: 'error', payload: { message: '会话已过期，请重新开始' } });
    return;
  }

  const controller = new AbortController();
  // 注册控制器以便取消
  activeControllers.set(sessionId, controller);

  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, controller.signal])
    : controller.signal;

  const forwardRetry = (event: RetryProgressEvent) => {
    onEvent({
      type: 'retry',
      payload: {
        retry: {
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        },
      },
    });
  };

  try {
    const { prompt, currentHtml, currentFiles, features, chatContextBlock, chatTurns, originalRequest } = session;
    const framework = session.framework ?? 'html';
    const useDiffMode = session.useDiffMode && currentFiles && Object.keys(currentFiles).length > 0;

    // 阶段 2：生成
    onEvent({ type: 'stage', payload: { phase: 'generate', ...(intent ? { intent } : {}) } });

    const featureListStr = typeof features === 'string'
      ? features
      : JSON.stringify(features, null, 2);

    // 判断是否为迭代模式
    const isIteration = currentFiles && Object.keys(currentFiles).length > 0;

    // 构建工程师消息：diff 模式使用专用 prompt，否则使用框架特定的系统提示词
    let systemPrompt: string;
    if (useDiffMode) {
      systemPrompt = ENGINEER_DIFF_PROMPT;
    } else if (isIteration) {
      systemPrompt = buildEngineerSystemPrompt(framework) + '\n\n' + ENGINEER_ITERATION_PROMPT;
    } else {
      systemPrompt = buildEngineerSystemPrompt(framework);
    }
    const generateMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // 构建对话上下文附加块。
    // 迭代模式且有对话历史时，用 9 段式结构化摘要（server/utils/iterationSummary.ts）
    // 替代逐条上下文块：压缩历史避免全量重发，同时保留任务引用防漂移；
    // 无对话历史时回退原有 chatContextBlock（降级路径）
    let contextSection = chatContextBlock
      ? `\n\n## 此前的对话上下文\n${chatContextBlock}`
      : '';
    if (isIteration && chatTurns && chatTurns.length > 0) {
      const summaryText = buildIterationSummary({
        turns: chatTurns,
        snapshot: currentFiles ? { files: currentFiles } : undefined,
        currentPrompt: prompt,
        originalRequest,
      });
      contextSection = `\n\n${summaryText}`;
      console.info(
        `[continueAfterApproval] 迭代摘要注入: 约 ${estimateSummaryTokens(summaryText)} tokens（历史 ${chatTurns.length} 轮）`
      );
    }
    const chatContextSection = contextSection;

    // 构建偏好块（有偏好时注入"项目偏好档案"与"全局偏好档案"）
    const preferenceSection = formatPreferencesSection(session.preferences, session.globalPreferences);

    if (useDiffMode && currentFiles) {
      // diff 模式：带行号标注的文件内容
      const numberedFiles = formatFilesWithLineNumbers(currentFiles);
      generateMessages.push({
        role: 'user',
        content: `${preferenceSection}## 用户修改需求\n${prompt}\n\n## 当前项目文件（带行号）\n${numberedFiles}\n\n请根据修改需求输出变更清单。`,
      });
    } else if (isIteration && currentFiles) {
      // 迭代模式（全量文件）：传递受影响文件的完整内容
      // 从 features 中提取可能受影响的文件路径（简化：传递所有文件）
      const affectedPaths = Object.keys(currentFiles);
      const affectedFilesContent = formatAffectedFiles(currentFiles, affectedPaths);

      generateMessages.push({
        role: 'user',
        content: `${preferenceSection}## 功能清单\n${featureListStr}\n\n## 当前项目文件\n${affectedFilesContent}\n\n## 用户修改需求\n${prompt}${chatContextSection}\n\n请根据修改需求，**增量修改**需要变更的文件。只输出被修改的文件，未修改的文件不要输出。保持现有代码风格一致。`,
      });
    } else {
      // 首次生成模式
      const frameworkHint = getFrameworkHint(framework);
      generateMessages.push({
        role: 'user',
        content: `${preferenceSection}## 功能清单\n${featureListStr}\n\n## 用户需求\n${prompt}\n\n## 目标框架\n使用 **${framework}** 模式：${frameworkHint}\n\n请生成完整的多文件项目。`,
      });
    }

    let accumulatedOutput = '';
    const generateResult = await streamChatCompletionWithUsage(
      generateMessages,
      (text) => {
        accumulatedOutput += text;
        onEvent({ type: 'delta', payload: { text, phase: 'generate' } });
      },
      combinedSignal,
      { onRetry: forwardRetry }
    );
    const generatedOutput = generateResult.content;

    if (combinedSignal.aborted) return;

    // 解析输出
    // diff 模式：尝试解析变更清单并应用到现有文件
    // 非 diff 模式或 diff 解析失败：降级为多文件解析
    let finalFiles: Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }>;
    let changeList: ChangeList | undefined;
    let multiFileOutput: MultiFileOutput | undefined;
    let rescueNotice: string | null = null;
    let rescuedPaths: string[] = [];

    if (useDiffMode) {
      // diff 模式：解析变更清单
      try {
        changeList = parseChangeList(generatedOutput);
        console.info(
          `[continueAfterApproval] diff 解析成功: ${changeList.changes.length} 个文件, ${changeList.changes.reduce((sum, c) => sum + c.edits.length, 0)} 处编辑`
        );

        // 应用变更到原始文件（session.originalFiles 是裁剪前的完整文件集）
        const mergeBase = session.originalFiles ?? currentFiles ?? {};
        const { newFiles, appliedCount, errors } = applyChanges(mergeBase, changeList.changes);

        if (errors.length > 0) {
          console.warn('[continueAfterApproval] 部分编辑未成功应用:', errors.join('; '));
        }

        console.info(`[continueAfterApproval] 已应用 ${appliedCount} 处编辑`);

        // 转换为 FileNodeRecord 格式
        const now = new Date().toISOString();
        finalFiles = {};
        for (const [path, file] of Object.entries(newFiles)) {
          finalFiles[path] = {
            path: file.path,
            content: file.content,
            language: file.language,
            updatedAt: now,
          };
        }
      } catch (diffError) {
        // diff 解析失败，降级为多文件解析
        const errorMsg = diffError instanceof Error ? diffError.message : 'diff 解析失败';
        console.error('[continueAfterApproval] diff 解析失败，降级为多文件解析:', errorMsg);
        changeList = undefined;

        try {
          multiFileOutput = parseMultiFileOutput(generatedOutput);
        } catch (parseError) {
          const parseErrorMsg = parseError instanceof Error ? parseError.message : '输出解析失败';
          console.error('[continueAfterApproval] 多文件解析失败:', parseErrorMsg);

          const rescued = repairTruncatedMultiFileOutput(generatedOutput);
          if (!rescued) {
            pendingSessions.delete(sessionId);
            onEvent({ type: 'error', payload: { message: `生成输出格式错误: ${parseErrorMsg}` } });
            return;
          }

          rescuedPaths = rescued.files.map(f => f.path);
          rescueNotice = `输出因长度限制被截断，已恢复 ${rescuedPaths.length} 个已完成文件`;
          console.warn('[continueAfterApproval] 截断抢救成功:', rescueNotice, rescuedPaths.join(', '));
          multiFileOutput = rescued;
        }

        const mergeBase = isIteration && session.originalFiles ? session.originalFiles : currentFiles;
        finalFiles = isIteration && mergeBase
          ? toFileNodeRecord(multiFileOutput, mergeBase)
          : toFileNodeRecord(multiFileOutput);
      }
    } else {
      // 非 diff 模式：解析多文件输出
      try {
        multiFileOutput = parseMultiFileOutput(generatedOutput);
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : '输出解析失败';
        console.error('[continueAfterApproval] 多文件解析失败:', errorMsg);

        const rescued = repairTruncatedMultiFileOutput(generatedOutput);
        if (!rescued) {
          pendingSessions.delete(sessionId);
          onEvent({ type: 'error', payload: { message: `生成输出格式错误: ${errorMsg}` } });
          return;
        }

        rescuedPaths = rescued.files.map(f => f.path);
        rescueNotice = `输出因长度限制被截断，已恢复 ${rescuedPaths.length} 个已完成文件`;
        console.warn('[continueAfterApproval] 截断抢救成功:', rescueNotice, rescuedPaths.join(', '));
        multiFileOutput = rescued;
      }

      const mergeBase = isIteration && session.originalFiles ? session.originalFiles : currentFiles;
      finalFiles = isIteration && mergeBase
        ? toFileNodeRecord(multiFileOutput, mergeBase)
        : toFileNodeRecord(multiFileOutput);
    }

    if (rescueNotice) {
      // 结构化 warning 事件入协议（前端 default 分支安全忽略，协议留档供后续消费）；
      // 同时以 delta 落入 generate 阶段的显示文本，让用户当场看到抢救结果
      onEvent({ type: 'warning', payload: { message: rescueNotice, rescuedFiles: rescuedPaths } });
      onEvent({ type: 'delta', payload: { text: `\n\n${rescueNotice}，不完整的文件已丢弃。`, phase: 'generate' } });
    }

    // 收集审查阶段的 usage（如果有）
    let reviewUsage: LLMUsage | undefined;

    // 阶段 3：审查（diff 模式跳过审查，非 diff 模式可配置跳过）
    if (useDiffMode) {
      // diff 模式：轻量级确认（变更已最小化，审查成本高）
      onEvent({ type: 'stage', payload: { phase: 'review', ...(intent ? { intent } : {}) } });
      onEvent({ type: 'delta', payload: { text: '变更已应用（diff 模式跳过审查）', phase: 'review' } });
    } else if (process.env.SKIP_REVIEW !== 'true' && multiFileOutput) {
      onEvent({ type: 'stage', payload: { phase: 'review', ...(intent ? { intent } : {}) } });

      const filesJson = JSON.stringify(multiFileOutput, null, 2);
      const reviewMessages: ChatMessage[] = [
        { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
        { role: 'user', content: `## 功能清单\n${featureListStr}\n\n## 待审查的项目文件\n${filesJson}\n\n请审查这个多文件项目。` },
      ];

      const reviewResult = await streamChatCompletionWithUsage(
        reviewMessages,
        (text) => onEvent({ type: 'delta', payload: { text, phase: 'review' } }),
        combinedSignal,
        { onRetry: forwardRetry }
      );
      reviewUsage = reviewResult.usage;
    } else {
      // 轻量级审查：仅发送确认
      onEvent({ type: 'stage', payload: { phase: 'review', ...(intent ? { intent } : {}) } });
      onEvent({ type: 'delta', payload: { text: '代码生成完成（审查已跳过）', phase: 'review' } });
    }

    if (combinedSignal.aborted) return;

    // 组装单文件 HTML（用于向后兼容和预览）
    // 使用 finalFiles（合并后的完整文件集），确保迭代模式下也能正确组装
    const allFiles = Object.values(finalFiles);
    const indexFile = allFiles.find(f => f.path === '/index.html');
    let assembledHtml = indexFile?.content || '';

    // 简单内联 CSS 和 JS 引用
    if (indexFile) {
      // 内联 CSS
      for (const file of allFiles.filter(f => f.language === 'css')) {
        const relativePath = '.' + file.path;
        const linkPattern = new RegExp(`<link[^>]*href=["']${escapeRegExp(relativePath)}["'][^>]*>`, 'gi');
        // 使用函数形式避免 file.content 中的 $&、$`、$'、$$ 被解释为替换模式
        assembledHtml = assembledHtml.replace(linkPattern, () => `<style>\n${file.content}\n</style>`);
      }

      // 内联 JS
      for (const file of allFiles.filter(f => f.language === 'javascript')) {
        const relativePath = '.' + file.path;
        const scriptPattern = new RegExp(`<script[^>]*src=["']${escapeRegExp(relativePath)}["'][^>]*>\\s*<\\/script>`, 'gi');
        // 使用函数形式避免 file.content 中的 $&、$`、$'、$$ 被解释为替换模式
        assembledHtml = assembledHtml.replace(scriptPattern, () => `<script>\n${file.content}\n</script>`);
      }
    }

    // 计算 token 统计：累加分析、工程师和审查阶段的 usage
    const totalStats = (() => {
      const analysisUsage = session.analysisUsage;
      const genUsage = generateResult.usage;
      if (!analysisUsage && !genUsage && !reviewUsage) return undefined;
      return {
        inputTokens: (analysisUsage?.prompt_tokens ?? 0) + (genUsage?.prompt_tokens ?? 0) + (reviewUsage?.prompt_tokens ?? 0),
        outputTokens: (analysisUsage?.completion_tokens ?? 0) + (genUsage?.completion_tokens ?? 0) + (reviewUsage?.completion_tokens ?? 0),
      };
    })();

    // 完成：同时返回 html（向后兼容）和 files（多文件结构）
    onEvent({
      type: 'done',
      payload: {
        html: assembledHtml,
        files: finalFiles,
        stats: totalStats,
        // diff 模式：携带变更清单与摘要
        changes: changeList,
        changeSummary: changeList?.summary,
      },
    });

    // 清理会话
    pendingSessions.delete(sessionId);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // 取消时也要清理会话
      pendingSessions.delete(sessionId);
      onEvent({ type: 'error', payload: { message: '请求已取消' } });
    } else {
      const message = error instanceof Error ? error.message : '未知错误';
      onEvent({ type: 'error', payload: { message } });
    }
  } finally {
    // 清理控制器注册
    activeControllers.delete(sessionId);
  }
}

/**
 * 格式化全局偏好为可注入分析师 user prompt 的记忆块。
 * 分析师阶段只需要知道用户的全局偏好，项目偏好由工程师阶段注入。
 * 空偏好返回空字符串。
 */
function formatGlobalPreferencesForAnalyst(
  globalPreferences?: GenerateOptions['globalPreferences'],
): string {
  if (!globalPreferences) return '';

  const lines: string[] = [];
  if (globalPreferences.defaultFramework) {
    lines.push(`- 默认框架：${globalPreferences.defaultFramework}`);
  }
  if (globalPreferences.preferredLanguage) {
    lines.push(`- 首选语言：${globalPreferences.preferredLanguage}`);
  }
  if (globalPreferences.namingStyle) {
    lines.push(`- 命名风格：${globalPreferences.namingStyle}`);
  }
  if (globalPreferences.globalStyles && globalPreferences.globalStyles.length > 0) {
    lines.push(`- 样式偏好：${globalPreferences.globalStyles.join('、')}`);
  }
  if (globalPreferences.globalCorrections && globalPreferences.globalCorrections.length > 0) {
    lines.push(`- 纠正记录：${globalPreferences.globalCorrections.join('、')}`);
  }

  if (lines.length === 0) return '';

  return ['## 用户偏好记忆', ''].concat(lines, ['', '请在规划时参考以上偏好。', '']).join('\n');
}

/**
 * 格式化偏好为可注入工程师 user prompt 的"项目偏好档案"块。
 * 参考 Claude Code 记忆系统的 body 结构：规则在前，括号内给出 Why（用户原话）。
 * 空偏好返回空字符串，不产生多余空行。
 *
 * 支持三层记忆注入：
 * 1. 全局偏好（跨项目生效）：默认框架、语言、命名风格
 * 2. 项目偏好：样式、技术、纠正、其他
 */
function formatPreferencesSection(
  preferences: GenerateOptions['preferences'],
  globalPreferences?: GenerateOptions['globalPreferences'],
): string {
  const lines: string[] = [];

  // 全局偏好
  if (globalPreferences) {
    const globalLines: string[] = [];
    if (globalPreferences.defaultFramework) {
      globalLines.push(`- [全局] 默认框架：${globalPreferences.defaultFramework}`);
    }
    if (globalPreferences.preferredLanguage) {
      globalLines.push(`- [全局] 首选语言：${globalPreferences.preferredLanguage}`);
    }
    if (globalPreferences.namingStyle) {
      globalLines.push(`- [全局] 命名风格：${globalPreferences.namingStyle}`);
    }
    if (globalPreferences.globalStyles && globalPreferences.globalStyles.length > 0) {
      globalLines.push(`- [全局] 样式偏好：${globalPreferences.globalStyles.join('、')}`);
    }
    if (globalPreferences.globalCorrections && globalPreferences.globalCorrections.length > 0) {
      globalLines.push(`- [全局] 纠正记录：${globalPreferences.globalCorrections.join('、')}`);
    }

    if (globalLines.length > 0) {
      lines.push('## 全局偏好档案', '');
      lines.push(...globalLines);
      lines.push('');
    }
  }

  // 项目偏好
  if (preferences && preferences.length > 0) {
    lines.push('## 项目偏好档案', '');
    for (const pref of preferences) {
      const line = `- [${pref.type}] ${pref.key}: ${pref.value}${pref.reason ? `（Why: ${pref.reason}）` : ''}`;
      lines.push(line);
    }
    lines.push('');
  }

  if (lines.length === 0) return '';

  lines.push('请在生成时遵守以上偏好；与本次需求冲突时以本次需求为准。', '');
  return lines.join('\n');
}

/**
 * 根据框架返回提示文本，帮助模型理解应该使用哪种代码风格。
 */
function getFrameworkHint(framework: 'html' | 'react-cdn' | 'vue-cdn'): string {
  switch (framework) {
    case 'html':
      return '纯 HTML + Tailwind CDN，JavaScript 写在 <script> 标签中';
    case 'react-cdn':
      return 'React 组件（JSX），使用 ReactDOM.createRoot 挂载到 <div id="root">，<script> 标签使用 type="text/babel"';
    case 'vue-cdn':
      return 'Vue 单文件组件格式（<template> + <script> + <style>）或 Vue 3 Composition API，挂载到 <div id="app">';
    default:
      return '纯 HTML + Tailwind CDN';
  }
}

/** 分析/诊断流水线的共享入参 */
interface AnalystPipelineParams {
  prompt: string;
  currentFiles?: Record<string, { path: string; content: string; language: FileLanguage }>;
  intent: IntentResult;
  onEvent: (event: LLMEvent) => void;
  signal: AbortSignal;
}

/**
 * 构建分析/诊断模式的用户消息：用户问题 + 现有项目文件内容（如有）。
 */
function buildAnalystUserContent(
  prompt: string,
  currentFiles: AnalystPipelineParams['currentFiles']
): string {
  if (!currentFiles || Object.keys(currentFiles).length === 0) {
    return prompt;
  }
  const allPaths = Object.keys(currentFiles);
  return `${prompt}\n\n## 现有项目文件\n${formatAffectedFiles(currentFiles, allPaths)}`;
}

/**
 * 功能分析流水线（analyze 意图）：只跑分析师，结果经 done.analysis 返回，
 * 不进入工程阶段、无批准暂停。前端将 analysis 字段作为 assistant 消息展示。
 */
export async function runAnalyzePipeline({
  prompt,
  currentFiles,
  intent,
  onEvent,
  signal,
}: AnalystPipelineParams): Promise<void> {
  onEvent({ type: 'stage', payload: { phase: 'analysis', intent } });

  const messages: ChatMessage[] = [
    { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
    { role: 'user', content: buildAnalystUserContent(prompt, currentFiles) },
  ];

  const result = await streamChatCompletionWithUsage(
    messages,
    (text) => onEvent({ type: 'delta', payload: { text, phase: 'analysis' } }),
    signal
  );

  if (signal.aborted) return;

  onEvent({
    type: 'done',
    payload: {
      analysis: result.content,
      stats: result.usage ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
      } : undefined,
    },
  });
}

/**
 * 问题诊断流水线（diagnose 意图）：分析师以诊断模式定位问题并输出结构化
 * 诊断 JSON，经 done.analysis 返回（{problem, rootCause, affectedFiles,
 * fixSuggestions}），不进入工程阶段。
 */
export async function runDiagnosePipeline({
  prompt,
  currentFiles,
  intent,
  onEvent,
  signal,
}: AnalystPipelineParams): Promise<void> {
  onEvent({ type: 'stage', payload: { phase: 'diagnose', intent } });

  const messages: ChatMessage[] = [
    { role: 'system', content: DIAGNOSE_SYSTEM_PROMPT },
    { role: 'user', content: buildAnalystUserContent(prompt, currentFiles) },
  ];

  const result = await streamChatCompletionWithUsage(
    messages,
    (text) => onEvent({ type: 'delta', payload: { text, phase: 'diagnose' } }),
    signal
  );

  if (signal.aborted) return;

  onEvent({
    type: 'done',
    payload: {
      analysis: result.content,
      stats: result.usage ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
      } : undefined,
    },
  });
}

/**
 * 迭代修改直通流水线（modify 意图）：跳过分析师与批准，直接进入工程师
 * 增量修改 → 审查者。复用 continueAfterApproval：合成单条"用户修改需求"
 * 功能清单写入待批准会话，避免重复实现工程阶段。
 */
export async function runDirectModifyPipeline({
  prompt,
  currentFiles,
  intent,
  chatTurns,
  originalRequest,
  preferences,
  globalPreferences,
  framework,
  onEvent,
  signal,
}: AnalystPipelineParams & {
  chatTurns?: ChatTurnInput[];
  originalRequest?: string;
  preferences?: GenerateOptions['preferences'];
  globalPreferences?: GenerateOptions['globalPreferences'];
  framework?: 'html' | 'react-cdn' | 'vue-cdn';
}): Promise<void> {
  if (!currentFiles) return;

  // 智能裁剪：只携带相关文件及其依赖
  const allFilePaths = Object.keys(currentFiles);
  const trimResult = trimContext(prompt, currentFiles, {
    pathMatchThreshold: 0.35, // 提高路径匹配阈值，避免误匹配
    contentMatchThreshold: 0.15,
    includeEntry: true, // 默认携带入口文件，避免修改工具函数时丢失引用方
  });
  const trimmedFilePaths = trimResult.trimmedPaths;

  // 输出裁剪日志
  console.info(
    '[runDirectModifyPipeline] 上下文裁剪:',
    `${trimmedFilePaths.length}/${allFilePaths.length} 文件`,
    `关键词: [${trimResult.keywords.join(', ')}]`,
    `匹配: 路径=${trimResult.stats.matchedByPath}, 内容=${trimResult.stats.matchedByContent}, 依赖=${trimResult.stats.addedByDependency}`
  );

  // 计算节省的 token
  const savings = calculateTokenSavings(currentFiles, trimmedFilePaths);
  if (savings.savedTokens > 0) {
    console.info(
      '[runDirectModifyPipeline] Token 节省:',
      `${savings.savedTokens} (${savings.savedPercent.toFixed(1)}%)`,
      `${savings.trimmedTokens}/${savings.totalTokens}`
    );
  }

  // 使用裁剪后的文件集合
  const trimmedFiles: Record<string, { path: string; content: string; language: FileLanguage }> = {};
  for (const path of trimmedFilePaths) {
    const file = currentFiles[path];
    if (file) {
      trimmedFiles[path] = file;
    }
  }

  // 合成功能清单：无分析师参与，用户修改需求即变更项
  const features = {
    appTitle: '',
    appType: 'other',
    summary: `迭代修改：${prompt.slice(0, 80)}`,
    features: [
      { id: 'M1', name: '用户修改需求', description: prompt, priority: 'must' },
    ],
    interactions: [],
    assumptions: [],
  };

  const sessionId = crypto.randomUUID();
  pendingSessions.set(sessionId, {
    prompt,
    currentFiles: trimmedFiles, // 存入裁剪后的文件
    // 保留原始文件引用，用于后续合并时保留未变更文件
    originalFiles: currentFiles,
    analysisResult: JSON.stringify(features),
    features,
    chatContextBlock: buildChatContextBlock(chatTurns ?? [], originalRequest),
    chatTurns,
    originalRequest,
    preferences,
    globalPreferences,
    framework,
    useDiffMode: true, // modify 意图使用 diff 模式
    createdAt: new Date(),
  });

  // 首个 stage 事件（generate）与后续 review 事件由 continueAfterApproval
  // 发出并附着 intent；错误由其内部 catch 兜底（不向上抛，避免双重 error 事件）
  await continueAfterApproval(sessionId, onEvent, signal, intent);
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============== Diff 模式：变更清单解析与应用 ============== */

/**
 * 格式化文件内容为带行号标注的形式（diff 模式输入）。
 * 格式：路径，然后每行 "N | content"。
 */
function formatFilesWithLineNumbers(
  files: Record<string, { path: string; content: string; language: FileLanguage }>
): string {
  return Object.values(files)
    .map((file) => {
      const lines = file.content.split('\n');
      const numbered = lines
        .map((line, i) => `${i + 1} | ${line}`)
        .join('\n');
      return `### ${file.path}\n${numbered}`;
    })
    .join('\n\n');
}

/**
 * 解析工程师 diff 输出为 ChangeList。
 * 支持剥离 markdown 围栏。解析失败抛出错误。
 */
export function parseChangeList(output: string): ChangeList {
  // 剥离可能的 markdown 围栏
  let cleaned = output.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = firstNewline === -1 ? '' : cleaned.slice(firstNewline + 1);
  }
  if (cleaned.endsWith('```')) {
    const lastNewline = cleaned.lastIndexOf('\n');
    cleaned = lastNewline === -1 ? '' : cleaned.slice(0, lastNewline);
  }
  cleaned = cleaned.trim();

  // 括号配平提取首个完整 JSON 对象（避免贪婪匹配跨多个 JSON 块）
  let depth = 0;
  let start = -1;
  let jsonStr: string | null = null;

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        jsonStr = cleaned.slice(start, i + 1);
        break;
      }
    }
  }

  const finalJsonStr = jsonStr || cleaned;
  const parsed = JSON.parse(finalJsonStr);

  // 校验结构
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('变更清单不是 JSON 对象');
  }
  if (!Array.isArray(parsed.changes)) {
    throw new Error('变更清单缺少 changes 数组');
  }
  if (typeof parsed.summary !== 'string') {
    parsed.summary = '';
  }

  // 校验每个变更
  for (const change of parsed.changes) {
    if (typeof change.file !== 'string' || !change.file) {
      throw new Error('变更缺少 file 字段');
    }
    if (!Array.isArray(change.edits)) {
      throw new Error(`文件 ${change.file} 的变更缺少 edits 数组`);
    }
    for (const edit of change.edits) {
      if (typeof edit.line !== 'number' || edit.line < 1) {
        throw new Error(`文件 ${change.file} 的编辑缺少有效 line 字段`);
      }
      if (!['replace', 'insert', 'delete'].includes(edit.type)) {
        throw new Error(`文件 ${change.file} 的编辑 type 非法: ${edit.type}`);
      }
      if (typeof edit.old !== 'string') edit.old = '';
      if (typeof edit.new !== 'string') edit.new = '';
    }
  }

  return parsed as ChangeList;
}

/**
 * 将变更清单应用到文件集合。
 *
 * 校验规则：
 * - old 字段与实际行精确匹配（宽松模式：trim 后匹配也可接受）
 * - 行号从大到小应用（避免行号偏移）
 *
 * 返回 { newFiles, appliedCount, errors }：
 * - appliedCount：成功应用的编辑数
 * - errors：失败的编辑及其原因（部分失败仍返回更新后的文件）
 */
export function applyChanges(
  files: Record<string, { path: string; content: string; language: FileLanguage }>,
  changes: FileChange[]
): {
  newFiles: Record<string, { path: string; content: string; language: FileLanguage }>;
  appliedCount: number;
  errors: string[];
} {
  const newFiles = { ...files };
  let appliedCount = 0;
  const errors: string[] = [];

  for (const change of changes) {
    const file = newFiles[change.file];
    if (!file) {
      errors.push(`文件不存在: ${change.file}`);
      continue;
    }

    const lines = file.content.split('\n');

    // 编辑按行号从大到小应用（避免行号偏移）
    const sortedEdits = [...change.edits].sort((a, b) => b.line - a.line);

    for (const edit of sortedEdits) {
      const idx = edit.line - 1;

      if (idx < 0 || idx > lines.length) {
        errors.push(`${change.file}:${edit.line} 行号超出文件范围（共 ${lines.length} 行）`);
        continue;
      }

      // 校验 old 字段（宽松匹配：精确匹配或 trim 后匹配）
      const actualLine = idx < lines.length ? lines[idx] : '';
      const oldMatch = edit.old === actualLine || edit.old.trim() === actualLine.trim();
      if (!oldMatch && edit.old.trim().length > 0) {
        // 不匹配但 old 非空，记录警告但继续应用（信任 LLM 的定位）
        console.warn(
          `[applyChanges] ${change.file}:${edit.line} old 字段不匹配\n期望: "${edit.old}"\n实际: "${actualLine}"`
        );
      }

      if (edit.type === 'insert') {
        // 在指定行后插入（idx 为目标行索引，在其后插入）
        const newLines = edit.new.split('\n');
        if (idx === lines.length) {
          // 行号指向文件末尾之后，追加到末尾
          lines.push(...newLines);
        } else {
          lines.splice(idx + 1, 0, ...newLines);
        }
        appliedCount++;
      } else if (edit.type === 'delete') {
        if (idx >= lines.length) {
          errors.push(`${change.file}:${edit.line} 行号超出文件范围`);
          continue;
        }
        lines.splice(idx, 1);
        appliedCount++;
      } else {
        // replace
        if (idx >= lines.length) {
          errors.push(`${change.file}:${edit.line} 行号超出文件范围`);
          continue;
        }
        lines[idx] = edit.new;
        appliedCount++;
      }
    }

    newFiles[change.file] = {
      ...file,
      content: lines.join('\n'),
    };
  }

  return { newFiles, appliedCount, errors };
}