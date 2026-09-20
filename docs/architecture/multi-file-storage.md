# 多文件项目存储方案设计

> 版本：v1
> 作者：后端架构师
> 日期：2026-09-20

## 1. 背景与目标

### 1.1 当前状态

- `Project.files` 类型：`Record<string, FileNode>`
- 实际只存储一个入口文件 `/index.html`
- AI 生成引擎输出单文件 HTML
- 沙箱通过 srcdoc 注入单个 HTML 字符串

### 1.2 目标

- 支持多文件项目结构（src/App.jsx, src/components/Button.jsx, src/styles/main.css 等）
- 多轮修改时能增量更新单个文件
- 保持与现有 localStorage 存储的兼容
- 为未来支持 React/Vue 等框架项目做数据层准备

## 2. 数据模型设计

### 2.1 核心类型扩展

```typescript
// src/types/project.ts

/** 文件语言类型扩展 */
export type FileLanguage =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'markdown'
  | 'text';

/** 文件类型：代码文件或目录 */
export type FileNodeType = 'file' | 'directory';

/** 虚拟文件系统节点（扩展） */
export interface FileNode {
  /** 虚拟路径，约定以 "/" 开头，如 "/src/App.jsx" */
  path: string;
  /** 文件类型 */
  type: FileNodeType;
  /** 文件文本内容（UTF-8）。目录节点为 undefined */
  content?: string;
  /** 语言标记，供编辑器高亮与组装器使用 */
  language: FileLanguage;
  /** 最近更新时间 */
  updatedAt: IsoDateTime;
  /** 文件字节大小（缓存值，避免重复计算） */
  byteSize?: number;
  /** 子节点路径列表（仅目录节点使用） */
  children?: string[];
}

/** 项目类型：单文件 HTML 或多文件框架项目 */
export type ProjectType = 'single-html' | 'multi-file';

/** 项目聚合根（扩展） */
export interface Project {
  /** UUID v4，宿主生成 */
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  /** 项目类型 */
  projectType: ProjectType;
  /** path 到 FileNode 的映射 */
  files: Record<string, FileNode>;
  /** 对话历史，按 createdAt 升序 */
  chat: ChatMessage[];
  preview: PreviewConfig;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** 版本历史引用（可选） */
  versionHistoryRef?: VersionHistoryRef;
}

/** 版本历史引用：指向版本存储的 key */
export interface VersionHistoryRef {
  /** 当前版本号（从 1 开始） */
  currentVersion: number;
  /** 最早保留版本（默认保留最近 10 版本） */
  oldestVersion: number;
}

/** 版本快照 */
export interface VersionSnapshot {
  /** 版本号 */
  version: number;
  /** 创建时间 */
  createdAt: IsoDateTime;
  /** 触发此版本的消息 ID */
  triggerMessageId: string;
  /** 变更描述（来自用户请求或 AI 摘要） */
  changeDescription: string;
  /** 变更类型 */
  changeType: 'initial' | 'generation' | 'iteration' | 'repair';
  /** 文件变更列表 */
  fileChanges: FileChange[];
}

/** 单文件变更记录 */
export interface FileChange {
  /** 文件路径 */
  path: string;
  /** 变更类型 */
  changeType: 'created' | 'modified' | 'deleted';
  /** diff 内容（统一格式）。新增文件为完整内容 */
  diff?: string;
  /** 该文件在变更前的内容（用于回滚） */
  previousContent?: string;
}
```

### 2.2 文件路径约定

```
项目根目录
├── /index.html          # 入口文件（单文件 HTML 项目）
├── /package.json        # 项目配置（多文件项目）
├── /src/
│   ├── /src/main.jsx    # 入口脚本
│   ├── /src/App.jsx     # 根组件
│   └── /src/components/
│       └── /src/components/Button.jsx
├── /src/styles/
│   └── /src/styles/main.css
└── /public/
    └── /public/favicon.ico
```

**路径规则**：
1. 所有路径以 `/` 开头，表示项目根目录
2. 目录节点本身也存储在 `files` 中，`type: 'directory'`
3. 目录的 `children` 存储子节点的完整路径（非相对路径）

### 2.3 兼容性策略

**向后兼容**：
- 现有单文件项目保持 `projectType: 'single-html'`
- `files` 中只有 `/index.html` 一个文件节点
- 新字段 `projectType` 默认值 `'single-html'`

**迁移函数**（v1 -> v2）：
```typescript
function migrateV1ToV2(data: unknown): unknown {
  if (!isProjectV1(data)) return data;
  // 添加新字段，保持现有数据不变
  return {
    ...data,
    projectType: 'single-html',
    // versionHistoryRef 不存在表示无历史版本
  };
}
```

## 3. 文件树操作 API

### 3.1 文件树工具函数

```typescript
// src/services/storage/fileTree.ts

/** 从扁平 Record 构建目录树结构 */
export function buildFileTree(files: Record<string, FileNode>): FileTreeNode[] {
  // 实现略
}

/** 获取目录下所有文件（递归） */
export function listFilesInDir(
  files: Record<string, FileNode>,
  dirPath: string
): string[] {
  // 实现略
}

/** 创建目录（自动创建父目录） */
export function ensureDirectory(
  files: Record<string, FileNode>,
  dirPath: string,
  timestamp: IsoDateTime
): Record<string, FileNode> {
  // 实现略
}

/** 更新单个文件（增量更新） */
export function updateFile(
  project: Project,
  path: string,
  content: string,
  language: FileLanguage
): Project {
  // 实现略
}

/** 删除文件（及其父目录如果为空） */
export function deleteFile(
  files: Record<string, FileNode>,
  path: string
): Record<string, FileNode> {
  // 实现略
}
```

### 3.2 FileTreeNode（UI 树形结构）

```typescript
/** UI 使用的树形节点 */
export interface FileTreeNode {
  path: string;
  name: string;
  type: FileNodeType;
  language?: FileLanguage;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}
```

## 4. 版本历史存储

### 4.1 存储策略

**原则**：
- 版本历史与项目数据分离存储
- 使用 diff 格式减少存储占用
- 默认保留最近 10 个版本
- 版本快照存储在独立的 localStorage key

**存储 Key**：
```
atoms:v1:versions:{projectId}
```

**存储结构**：
```typescript
interface ProjectVersionStorage {
  projectId: string;
  versions: VersionSnapshot[];
  schemaVersion: number;
  savedAt: IsoDateTime;
}
```

### 4.2 Diff 格式

采用统一 diff 格式（Unified Diff）：

```diff
--- /src/App.jsx
+++ /src/App.jsx
@@ -1,5 +1,6 @@
 function App() {
-  return <div>Hello</div>;
+  const [count, setCount] = useState(0);
+  return <div onClick={() => setCount(c => c + 1)}>{count}</div>;
 }
```

**diff 库选择**：
- 推荐使用 `fast-diff`（轻量、零依赖）
- 或 `diff` 库（功能更全，体积稍大）

### 4.3 版本快照生成时机

| 时机 | changeType | 触发条件 |
|------|------------|----------|
| 初次生成 | `initial` | 首次 AI 生成完成 |
| 迭代修改 | `iteration` | 用户提出修改需求 |
| 修复 | `repair` | Reviewer 发现问题后修复 |

### 4.4 版本回滚

```typescript
/** 回滚到指定版本 */
async function rollbackToVersion(
  project: Project,
  targetVersion: number
): Promise<Project> {
  // 1. 从版本历史加载快照链
  // 2. 从当前版本反向应用 diff
  // 3. 更新项目 files
  // 4. 创建新的版本快照记录回滚操作
}
```

## 5. 序列化与反序列化

### 5.1 导出格式

```typescript
// 单个项目导出
interface ProjectExport extends ExportData {
  projects: Project[];
  // 包含版本历史
  versionHistory?: Record<string, ProjectVersionStorage>;
}
```

### 5.2 存储大小估算

**单文件项目**：
- `/index.html`：约 5-50 KB
- 版本快照：每个约 2-10 KB（diff 压缩后）

**多文件项目**：
- 平均每个文件：1-20 KB
- 典型项目：10-30 个文件，总 50-300 KB
- 版本快照：每个约 10-50 KB

**localStorage quota**：
- 约 5 MB
- 保留 10 版本 + 活跃项目，预计占用 1-2 MB
- 超限时清理最旧版本

## 6. 组装器（Assembler）

### 6.1 单文件 HTML 组装

现有逻辑保持不变，直接使用 `/index.html` 内容。

### 6.2 多文件项目组装（预研）

**方案 A：Service Worker 拦截**
- 沙箱 iframe 注入 Service Worker
- 拦截 import 请求，返回虚拟文件内容
- 复杂度高，兼容性需验证

**方案 B：打包到单文件**
- 在主线程打包所有文件
- 注入 srcdoc
- 需要引入 esbuild/rollup 等打包器

**方案 C：Blob URL + import map**
- 为每个文件创建 Blob URL
- 使用 import map 映射模块路径
- 简单但可能有内存泄漏风险

```typescript
// 方案 C 示例
function assembleMultiFileProject(project: Project): string {
  const blobUrls: Record<string, string> = {};

  // 为每个文件创建 Blob URL
  for (const [path, node] of Object.entries(project.files)) {
    if (node.type === 'file' && node.content) {
      const blob = new Blob([node.content], { type: getMimeType(node.language) });
      blobUrls[path] = URL.createObjectURL(blob);
    }
  }

  // 生成入口 HTML，注入 import map
  return generateEntryHtml(blobUrls);
}
```

## 7. 安全考虑

### 7.1 文件路径校验

```typescript
/** 校验路径安全性 */
function isValidPath(path: string): boolean {
  // 禁止路径遍历攻击
  if (path.includes('..')) return false;
  // 禁止绝对路径逃逸
  if (!path.startsWith('/')) return false;
  // 禁止特殊字符
  if (/[<>:"|?*\x00-\x1f]/.test(path)) return false;
  return true;
}
```

### 7.2 文件大小限制

```typescript
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_PROJECT_SIZE = 5 * 1024 * 1024; // 5 MB

function validateFileSize(content: string): boolean {
  return new Blob([content]).size <= MAX_FILE_SIZE;
}
```

## 8. 迁移计划

### 8.1 schemaVersion 升级

| 版本 | 变更 |
|------|------|
| v1 | 当前版本，单文件存储 |
| v2 | 添加 projectType、versionHistoryRef 字段 |
| v3（未来） | 支持 React/Vue 项目元数据 |

### 8.2 迁移函数链

```typescript
const MIGRATION_TABLE: MigrationTable = {
  1: migrateV1ToV2,
  // 未来: 2: migrateV2ToV3,
};

export function migrateProject(raw: string): MigrationResult<Project> {
  // 现有迁移逻辑，查表逐级升级
}
```

## 9. 实施步骤

### 阶段一：类型定义（不影响运行时）

1. 扩展 `FileNode` 类型
2. 添加 `ProjectType`、`VersionHistoryRef` 类型
3. 更新 `isProject` 类型守卫
4. 添加 v1->v2 迁移函数

### 阶段二：版本历史存储

1. 实现 `VersionSnapshot` 存储逻辑
2. 实现 diff 生成与应用
3. 实现版本回滚

### 阶段三：多文件操作 API

1. 实现文件树工具函数
2. 实现增量更新逻辑
3. 更新 projectStore 支持多文件操作

### 阶段四：组装器（依赖框架支持决策）

1. 确定多文件项目组装方案
2. 实现组装器
3. 更新沙箱组件支持多文件项目

## 10. 附录

### A. 完整类型定义文件

见 `src/types/project.ts`（待更新）

### B. 存储布局表

| Key | 用途 | 大小预估 | 清理策略 |
|-----|------|----------|----------|
| `atoms:v1:projects` | 项目摘要列表 | < 10 KB | 用户删除项目时清理 |
| `atoms:v1:projects:{id}` | 项目详情 | 50-300 KB | 删除项目时清理 |
| `atoms:v1:versions:{id}` | 版本历史 | 100-500 KB | 超限时清理最旧版本 |

### C. 与 AI 生成引擎的协作

当前 AI 只生成单文件 HTML。未来多文件支持需要：

1. 更新 `ENGINEER_SYSTEM_PROMPT` 支持多文件输出格式
2. 定义 AI 输出多文件的协议（JSON 格式或特定分隔符）
3. 实现解析器将 AI 输出转换为 `files` Record

**示例协议（JSON 格式）**：
```json
{
  "files": [
    { "path": "/src/App.jsx", "content": "..." },
    { "path": "/src/components/Button.jsx", "content": "..." },
    { "path": "/src/styles/main.css", "content": "..." }
  ]
}
```