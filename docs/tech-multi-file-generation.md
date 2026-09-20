# 多文件项目生成技术设计文档

> Owner：dev-atoms-ai-engineer
> 版本：v1
> 日期：2026-09-20
> 状态：设计草案

## 1. 需求背景

### 1.1 当前限制

当前 Atoms Demo 只生成单文件 HTML 应用，存在以下限制：

1. **代码组织困难**：复杂应用的 HTML/CSS/JS 全部混在一个文件，难以维护
2. **无法体现工程化**：用户看不到真实项目的文件结构
3. **迭代效率低**：修改需求导致全量重新生成，无法增量修改单个文件
4. **学习价值有限**：用户无法学习现代前端项目的标准结构

### 1.2 目标

1. 支持生成真实的多文件项目结构（`src/`, `components/`, `styles/`, `utils/` 等）
2. 支持增量修改：只修改受影响的具体文件，其他文件保持不变
3. 在 iframe sandbox 中正确预览多文件项目
4. 提供文件树 UI 展示项目结构

### 1.3 约束

1. 最终预览仍需在 iframe sandbox 中运行（srcdoc 模式）
2. 需要在浏览器端组装多文件为可执行的单文件
3. 后端存储需要支持多文件结构的持久化
4. 多轮对话时的上下文管理需要考虑 token 限制

---

## 2. 整体架构设计

### 2.1 核心思路

```
用户需求 → LLM 输出多文件结构 → 文件树存储 → 组装器合成预览 HTML → iframe sandbox
```

关键设计决策：

1. **LLM 输出结构化 JSON**：工程师阶段输出 JSON 格式的文件列表，而非单个 HTML
2. **组装器（Assembler）**：在预览前将多文件合成为单文件 HTML
3. **增量修改提示词**：通过文件映射告知 LLM 当前各文件内容，引导其只输出需要变更的文件

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              生成阶段                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户需求 ──→ 分析师 ──→ 功能清单 ──→ 工程师 ──→ 多文件 JSON            │
│              (JSON)     (features)  (多文件输出)                        │
│                                                                         │
│  多文件 JSON 示例:                                                       │
│  {                                                                      │
│    "files": [                                                           │
│      { "path": "/index.html", "content": "...", "language": "html" },   │
│      { "path": "/styles/main.css", "content": "...", "language": "css" }│
│    ]                                                                    │
│  }                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              存储阶段                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Project {                                                              │
│    files: {                                                             │
│      "/index.html": FileNode,                                           │
│      "/src/main.js": FileNode,                                          │
│      "/styles/main.css": FileNode,                                      │
│    }                                                                    │
│  }                                                                      │
│                                                                         │
│  FileNode { path, content, language, updatedAt }                        │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              预览阶段                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  组装器(Assembler):                                                      │
│  1. 读取入口文件 /index.html                                            │
│  2. 处理 <link rel="stylesheet" href="./styles/...">                    │
│  3. 处理 <script src="./src/...">                                       │
│  4. 内联所有外部引用                                                     │
│  5. 注入 CSP + 消息桥接                                                  │
│  6. 输出完整单文件 HTML ──→ iframe srcdoc                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 增量修改流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           迭代修改阶段                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户修改需求                                                            │
│       │                                                                 │
│       ▼                                                                 │
│  分析师阶段:                                                             │
│  - 输入: 需求 + 当前文件树摘要                                           │
│  - 输出: 变更计划（哪些文件需要改、怎么改）                                │
│       │                                                                 │
│       ▼                                                                 │
│  工程师阶段:                                                             │
│  - 输入: 变更计划 + 受影响文件的完整内容                                   │
│  - 输出: 只输出需要变更的文件（全量内容，非 diff）                         │
│       │                                                                 │
│       ▼                                                                 │
│  合并阶段:                                                               │
│  - 未变更文件保持原样                                                     │
│  - 用新内容覆盖变更文件                                                   │
│  - 更新 updatedAt 时间戳                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. LLM Prompt 改造方案

### 3.1 分析师 Prompt 扩展

新增迭代模式的上下文传递：

```typescript
export const ANALYST_ITERATION_CONTEXT_BLOCK = `## 现有项目文件结构

{{FILE_TREE_SUMMARY}}

请基于现有项目理解当前功能，仅针对用户的新需求或修改要求输出变更项。`;
```

文件树摘要格式（用于节省 token）：

```
/index.html - 主入口，包含页面骨架和组件引用
/src/components/Header.js - 顶部导航组件
/src/components/TodoList.js - 待办列表组件
/src/components/TodoItem.js - 单条待办组件
/src/utils/storage.js - localStorage 工具函数
/styles/main.css - 全局样式
```

### 3.2 工程师 Prompt 改造

#### 3.2.1 首次生成 Prompt

```typescript
export const ENGINEER_MULTI_FILE_SYSTEM_PROMPT = `你是 Atoms 平台的前端工程师。你根据功能清单生成一个多文件结构的前端项目。你输出 JSON 格式的文件列表。

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

## 设计规范
- 字体使用系统字体栈：system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
- 禁用紫色渐变，使用明确主题色加中性灰阶
- 布局响应式，移动端不塌陷

## 引用规范
在 index.html 中引用其他文件：
- CSS: <link rel="stylesheet" href="./styles/main.css">
- JS: <script src="./src/main.js"></script>
这些引用会在预览时由组装器内联替换。`;
```

#### 3.2.2 增量修改 Prompt

```typescript
export const ENGINEER_INCREMENTAL_USER_PROMPT_TEMPLATE = `## 当前项目文件

{{AFFECTED_FILES}}

## 用户修改需求
{{USER_PROMPT}}

## 变更计划
{{CHANGE_PLAN}}

请只输出需要修改的文件（全量内容），未修改的文件不需要输出。仍使用 JSON 格式：
{
  "files": [
    { "path": "/src/components/Header.js", "content": "完整新内容", "language": "javascript" }
  ]
}`;
```

受影响文件内容格式（仅传递需要参考的文件）：

```
=== /src/components/Header.js ===
// Header component
export function Header() { ... }

=== /styles/main.css ===
.header { ... }
```

### 3.3 审查者 Prompt 扩展

```typescript
export const REVIEWER_MULTI_FILE_SYSTEM_PROMPT = `你是 Atoms 平台的质量审查者。你审查多文件项目是否合格交付。

## 审查维度
1. 结构完整：index.html 存在且有效，所有引用的文件都存在
2. 脚本可执行：每个 JS 文件无语法错误，引用的函数/变量在对应文件中存在
3. 功能覆盖：功能清单中 priority 为 must 的功能有对应实现
4. 引用合规：所有 href/src 引用的路径都在 files 中存在
5. 资源合规：外部资源只允许来自 cdn.jsdelivr.net
6. 体验底线：首屏有可见内容；无紫色渐变；未使用 Inter 字体

## 输出格式
{
  "pass": true 或 false,
  "checks": [
    { "item": "结构完整", "pass": true, "note": "一句话说明" }
  ],
  "repairInstructions": [],
  "missingFiles": ["不存在的文件路径列表"]
}`;
```

---

## 4. 数据结构设计

### 4.1 文件类型扩展

```typescript
// src/types/project.ts

export type FileLanguage = 'html' | 'css' | 'javascript' | 'json' | 'text' | 'markdown';

/** 文件类型：文件或目录 */
export type FileType = 'file' | 'directory';

/** 虚拟文件系统节点 */
export interface FileNode {
  /** 虚拟路径，以 "/" 开头，如 "/src/components/Header.js" */
  path: string;
  /** 文件文本内容 */
  content: string;
  /** 语言标记，供编辑器高亮 */
  language: FileLanguage;
  /** 最近更新时间 */
  updatedAt: IsoDateTime;
}

/** 目录节点（用于前端展示，不持久化） */
export interface DirectoryNode {
  path: string;
  type: 'directory';
  children: (FileNode | DirectoryNode)[];
  expanded?: boolean; // UI 状态
}

/** 文件树（用于展示） */
export type FileTreeNode = FileNode | DirectoryNode;

/** LLM 输出的文件结构 */
export interface GeneratedFile {
  path: string;
  content: string;
  language: FileLanguage;
}

/** LLM 输出的多文件结果 */
export interface MultiFileOutput {
  files: GeneratedFile[];
}
```

### 4.2 Project 结构扩展

```typescript
/** 项目聚合根 */
export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;

  /** 文件系统：path → FileNode */
  files: Record<string, FileNode>;

  /** 入口文件路径，默认 /index.html */
  entryFile: string;

  /** 对话历史 */
  chat: ChatMessage[];

  /** 预览配置 */
  preview: PreviewConfig;

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 默认入口文件 */
export const DEFAULT_ENTRY_FILE = '/index.html';
```

### 4.3 变更计划类型

```typescript
/** 文件变更类型 */
export type ChangeType = 'create' | 'modify' | 'delete';

/** 单个文件的变更计划 */
export interface FileChangePlan {
  path: string;
  changeType: ChangeType;
  reason: string; // 为什么需要改
  dependencies?: string[]; // 依赖哪些其他文件
}

/** 分析师输出的变更计划 */
export interface ChangePlan {
  summary: string; // 一句话总结本次变更
  changes: FileChangePlan[];
}
```

### 4.4 组装器输入

```typescript
/** 组装器配置 */
export interface AssemblerConfig {
  /** 入口文件路径 */
  entryPath: string;
  /** 文件系统 */
  files: Record<string, FileNode>;
  /** CDN 白名单 */
  cdnHosts: readonly string[];
  /** 是否压缩 */
  minify?: boolean;
}

/** 组装结果 */
export interface AssembledResult {
  /** 组装后的完整 HTML */
  html: string;
  /** 组装过程中的警告 */
  warnings: string[];
  /** 组装统计 */
  stats: {
    totalFiles: number;
    inlinedCss: number;
    inlinedJs: number;
  };
}
```

---

## 5. 前端改造点

### 5.1 文件树组件

```
src/components/FileTree/
├── FileTree.tsx         # 文件树主组件
├── FileTreeNode.tsx     # 单个节点（文件/目录）
├── FileTreeActions.tsx  # 操作按钮（新建、删除、重命名）
└── fileTreeUtils.ts     # 工具函数（路径解析、树构建）
```

文件树 UI 交互：

1. **展示**：可折叠的树形结构，图标区分文件类型
2. **选择**：点击文件名切换编辑器内容
3. **操作**：右键菜单或按钮提供新建/删除/重命名（需要用户确认）
4. **状态**：修改过的文件显示标记

### 5.2 代码编辑器改造

当前 `CodeViewer` 需要升级为 `CodeEditor`：

```typescript
interface CodeEditorProps {
  /** 当前文件路径 */
  filePath: string;
  /** 当前文件内容 */
  content: string;
  /** 语言 */
  language: FileLanguage;
  /** 是否只读（生成完成后可编辑） */
  readOnly?: boolean;
  /** 内容变更回调 */
  onChange?: (content: string) => void;
}
```

功能：

1. 语法高亮（使用 Monaco 或 CodeMirror）
2. 行号显示
3. 只读模式（生成中不可编辑）
4. 修改标记

### 5.3 组装器实现

```typescript
// src/services/sandbox/assembler.ts

/**
 * 文件组装器：将多文件合成为单文件 HTML
 */
export class Assembler {
  constructor(private config: AssemblerConfig) {}

  /**
   * 组装入口文件及其依赖
   */
  assemble(): AssembledResult {
    const warnings: string[] = [];
    let inlinedCss = 0;
    let inlinedJs = 0;

    // 1. 获取入口 HTML
    const entryNode = this.config.files[this.config.entryPath];
    if (!entryNode) {
      throw new Error(`入口文件不存在: ${this.config.entryPath}`);
    }

    let html = entryNode.content;

    // 2. 处理 CSS 引用
    // <link rel="stylesheet" href="./styles/main.css">
    html = this.inlineCssLinks(html, warnings);
    inlinedCss = warnings.filter(w => w.includes('CSS')).length;

    // 3. 处理 JS 引用
    // <script src="./src/main.js"></script>
    html = this.inlineJsScripts(html, warnings);
    inlinedJs = warnings.filter(w => w.includes('JS')).length;

    // 4. 验证无外部引用遗漏
    this.validateNoExternalRefs(html, warnings);

    return {
      html,
      warnings,
      stats: {
        totalFiles: Object.keys(this.config.files).length,
        inlinedCss,
        inlinedJs,
      },
    };
  }

  /**
   * 内联 CSS link 标签
   */
  private inlineCssLinks(html: string, warnings: string[]): string {
    const linkPattern = /<link\s+[^>]*href=["']\.\/([^"']+\.css)["'][^>]*>/gi;

    return html.replace(linkPattern, (match, relativePath: string) => {
      const absolutePath = this.resolvePath(relativePath);
      const fileNode = this.config.files[absolutePath];

      if (!fileNode) {
        warnings.push(`CSS 文件不存在: ${relativePath}`);
        return `<!-- 缺失: ${relativePath} -->`;
      }

      return `<style>\n${fileNode.content}\n</style>`;
    });
  }

  /**
   * 内联 JS script 标签
   */
  private inlineJsScripts(html: string, warnings: string[]): string {
    const scriptPattern = /<script\s+[^>]*src=["']\.\/([^"']+\.js)["'][^>]*>\s*<\/script>/gi;

    return html.replace(scriptPattern, (match, relativePath: string) => {
      const absolutePath = this.resolvePath(relativePath);
      const fileNode = this.config.files[absolutePath];

      if (!fileNode) {
        warnings.push(`JS 文件不存在: ${relativePath}`);
        return `<!-- 缺失: ${relativePath} -->`;
      }

      return `<script>\n${fileNode.content}\n</script>`;
    });
  }

  /**
   * 解析相对路径为绝对路径
   */
  private resolvePath(relativePath: string): string {
    const entryDir = this.config.entryPath.substring(0, this.config.entryPath.lastIndexOf('/'));
    const parts = entryDir.split('/').filter(Boolean);
    const segments = relativePath.split('/');

    for (const seg of segments) {
      if (seg === '..') {
        parts.pop();
      } else if (seg !== '.') {
        parts.push(seg);
      }
    }

    return '/' + parts.join('/');
  }

  /**
   * 验证无遗漏的外部引用
   */
  private validateNoExternalRefs(html: string, warnings: string[]): void {
    // 检查遗留的 href="./xxx" 或 src="./xxx"
    const localRefPattern = /(href|src)=["']\.\/[^"']+["']/g;
    const matches = html.match(localRefPattern);
    if (matches) {
      warnings.push(`存在未处理的本地引用: ${matches.join(', ')}`);
    }
  }
}
```

### 5.4 SandboxFrame 改造

```typescript
// src/components/SandboxFrame.tsx

interface SandboxFrameProps {
  /** 多文件系统 */
  files: Record<string, FileNode>;
  /** 入口文件路径 */
  entryPath: string;
  /** 其他现有 props... */
}

export default function SandboxFrame({ files, entryPath, ...props }: SandboxFrameProps) {
  // 组装多文件为单文件
  const assembledHtml = useMemo(() => {
    const assembler = new Assembler({
      entryPath,
      files,
      cdnHosts: DEFAULT_CDN_HOSTS,
    });
    const result = assembler.assemble();

    // 警告处理
    if (result.warnings.length > 0) {
      console.warn('组装警告:', result.warnings);
    }

    return result.html;
  }, [files, entryPath]);

  // 其余逻辑不变，使用 assembledHtml 作为预览内容
  return <iframe srcDoc={assemblePreviewHtml(assembledHtml, ...)} />;
}
```

### 5.5 流式输出解析改造

```typescript
// src/services/ai/multiFileParser.ts

/**
 * 解析 LLM 输出的多文件 JSON
 * 支持流式累积 + 最终解析
 */
export class MultiFileParser {
  private buffer = '';

  /**
   * 追加流式文本
   */
  append(text: string): void {
    this.buffer += text;
  }

  /**
   * 尝试解析当前缓冲区
   * 返回 null 表示 JSON 不完整
   */
  tryParse(): MultiFileOutput | null {
    const trimmed = this.buffer.trim();

    // 尝试提取 JSON
    const jsonMatch = trimmed.match(/\{[\s\S]*"files"[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.files)) {
        return parsed;
      }
    } catch {
      // JSON 不完整或格式错误
    }

    return null;
  }

  /**
   * 重置缓冲区
   */
  reset(): void {
    this.buffer = '';
  }
}
```

---

## 6. 后端改造点

### 6.1 数据库 Schema（Supabase 可选）

```sql
-- 项目表
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  entry_file TEXT DEFAULT '/index.html',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 文件表
CREATE TABLE project_files (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, path)
);

-- 索引
CREATE INDEX idx_files_project ON project_files(project_id);
```

### 6.2 API 扩展

```typescript
// GET /api/projects/:id/files
// 返回项目的文件树

// PUT /api/projects/:id/files/:path
// 更新单个文件

// DELETE /api/projects/:id/files/:path
// 删除单个文件
```

---

## 7. Token 预算与上下文管理

### 7.1 Token 估算

| 内容 | 估算 |
|---|---|
| 分析师 prompt (首次) | ~500 tokens |
| 分析师 prompt (迭代，含文件树摘要) | ~1000 tokens |
| 功能清单输出 | ~300 tokens |
| 工程师 prompt (首次) | ~600 tokens |
| 工程师 prompt (迭代，含受影响文件) | ~3000-8000 tokens |
| 多文件输出 (首次，中等项目) | ~5000-15000 tokens |
| 多文件输出 (迭代，单文件) | ~1000-3000 tokens |
| 审查者 prompt + 输出 | ~1000 tokens |

### 7.2 上下文裁剪策略

1. **文件树摘要**：只传路径和简短描述，不传内容（~100 tokens）
2. **受影响文件选择**：只传递与当前修改相关的文件，按依赖关系筛选
3. **历史对话压缩**：旧对话用摘要替代原文
4. **大文件截断**：超大文件（>2000 行）只传前 500 行 + 结构说明

```typescript
interface ContextStrategy {
  /** 文件树摘要的最大文件数 */
  maxFilesInSummary: number; // 20

  /** 受影响文件的最大总 token 数 */
  maxAffectedFilesTokens: number; // 6000

  /** 历史对话的压缩阈值 */
  historyCompressionThreshold: number; // 10 条消息后开始压缩
}
```

---

## 8. 实现优先级建议

### Phase 1：基础设施（P0）

1. **数据结构扩展**：`FileNode`、`Project.files` 类型定义
2. **组装器实现**：将多文件合成为单文件 HTML
3. **SandboxFrame 改造**：支持多文件输入

**验收标准**：手动创建多文件项目，能在沙箱中正确预览

### Phase 2：LLM 输出改造（P0）

1. **工程师 Prompt 改造**：输出多文件 JSON 格式
2. **流式解析器**：`MultiFileParser` 实现
3. **文件存储逻辑**：将 LLM 输出的文件写入 `Project.files`

**验收标准**：输入需求，LLM 输出多文件结构，前端正确解析并存储

### Phase 3：文件树 UI（P1）

1. **FileTree 组件**：树形展示、文件图标、折叠展开
2. **文件切换**：点击文件切换编辑器内容
3. **CodeEditor 升级**：语法高亮、行号

**验收标准**：用户能看到项目结构，点击切换不同文件

### Phase 4：增量修改（P1）

1. **分析师增量模式**：输出变更计划
2. **工程师增量模式**：只输出变更文件
3. **合并逻辑**：新旧文件合并

**验收标准**：修改需求只更新受影响的文件

### Phase 5：后端存储（P2）

1. **数据库 Schema**：`projects` + `project_files` 表
2. **API 扩展**：文件 CRUD 接口
3. **同步逻辑**：本地优先，云端可选同步

**验收标准**：项目可跨设备访问

---

## 9. 风险与降级

### 9.1 风险矩阵

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| LLM 输出 JSON 格式错误 | 解析失败 | 重试 + 回退单文件模式 |
| 组装器找不到引用文件 | 预览失败 | 内联缺失标记 + 警告提示 |
| 文件过多导致 token 超限 | 生成失败 | 文件数量上限 + 智能裁剪 |
| 增量修改上下文丢失 | 改错文件 | 变更计划人工确认 |

### 9.2 降级路径

```
多文件生成失败 → 重试（明确要求 JSON 格式）
              → 再次失败 → 回退单文件模式
              → 单文件失败 → 演示模式兜底
```

---

## 10. 测试用例

### 10.1 单元测试

1. **Assembler 测试**
   - 简单 CSS 内联
   - 简单 JS 内联
   - 嵌套路径解析 (`../../styles/main.css`)
   - 多文件相互引用
   - 缺失文件警告

2. **MultiFileParser 测试**
   - 完整 JSON 解析
   - 不完整 JSON 拒绝
   - 围栏剥离
   - 空文件列表

### 10.2 集成测试

1. **生成流程**
   - 首次生成 Todo 应用 → 多文件结构
   - 迭代修改 → 只更新 TodoItem.js
   - 添加新功能 → 新建文件

2. **预览流程**
   - 多文件正确组装
   - 预览功能正常
   - 控制台无错误

---

## 11. 附录

### 11.1 文件命名规范

- 目录名：小写 + 短横线 (`components`, `utils`, `styles`)
- 组件文件：PascalCase (`Header.js`, `TodoList.js`)
- 工具文件：camelCase (`storage.js`, `helpers.js`)
- 样式文件：小写 + 短横线 (`main.css`, `todo-item.css`)

### 11.2 引用路径约定

- HTML 引用 CSS：`./styles/main.css`（相对路径）
- HTML 引用 JS：`./src/main.js`（相对路径）
- JS 模块化：v1 不支持 ES Module，所有 JS 内联后按顺序执行

### 11.3 与单文件模式的兼容

```typescript
interface GenerationMode {
  type: 'single-file' | 'multi-file';
}

// 检测是否应该用多文件模式
function shouldUseMultiFile(features: FeatureList): boolean {
  // 功能数 > 3 或复杂类型用多文件
  const complexTypes = ['dashboard', 'tool'];
  return features.features.length > 3 || complexTypes.includes(features.appType);
}
```