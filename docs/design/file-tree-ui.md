# 文件树 UI 设计文档

## 1. 概述

### 1.1 背景

当前生成的项目为单文件（index.html），但系统架构预留了多文件扩展能力（见 `src/types/project.ts` 的 `FileNode` 结构）。本设计将文件树 UI 从"生成状态展示"升级为"项目文件管理器"，支持：

- 展示多文件结构（目录 + 文件）
- 点击切换查看不同文件代码
- 目录展开/收起
- 当前文件高亮
- 文件状态指示（生成中/已完成/错误）

### 1.2 目标用户

- AI 辅助编程用户：需要在预览区快速切换查看生成的多个文件
- 代码审查用户：需要逐文件检查生成的代码

---

## 2. 设计 Token 表

### 2.1 色彩 Token（文件树专用）

| Token 名称 | 值 | 用途 |
|-----------|-----|------|
| `--filetree-bg` | `var(--color-bg-surface)` | 文件树背景 |
| `--filetree-item-hover` | `var(--color-bg-elevated)` | 项目 hover 背景 |
| `--filetree-item-active` | `var(--color-accent)/10` | 当前选中文件背景 |
| `--filetree-text-default` | `var(--color-text-secondary)` | 默认文字颜色 |
| `--filetree-text-active` | `var(--color-accent)` | 当前文件文字颜色 |
| `--filetree-text-tertiary` | `var(--color-text-tertiary)` | 辅助信息颜色 |
| `--filetree-icon-folder` | `var(--color-warning)` | 目录图标颜色 |
| `--filetree-icon-file` | `var(--color-text-tertiary)` | 文件图标颜色 |
| `--filetree-border` | `var(--color-border-default)` | 边框颜色 |

### 2.2 间距 Token

| Token 名称 | 值 | 用途 |
|-----------|-----|------|
| `--filetree-padding` | `8px` | 文件树内边距 |
| `--filetree-item-gap` | `4px` | 项目间距 |
| `--filetree-indent` | `16px` | 目录缩进层级 |
| `--filetree-icon-gap` | `6px` | 图标与文字间距 |

### 2.3 字体 Token

| Token 名称 | 值 | 用途 |
|-----------|-----|------|
| `--filetree-font` | `var(--font-sans)` | 文件名/目录名 |
| `--filetree-font-size` | `13px` | 文件名大小 |
| `--filetree-font-size-sm` | `11px` | 辅助信息大小 |

### 2.4 圆角 Token

| Token 名称 | 值 | 用途 |
|-----------|-----|------|
| `--filetree-radius` | `6px` | 项目圆角 |
| `--filetree-radius-lg` | `10px` | 面板圆角 |

### 2.5 动效 Token

| Token 名称 | 值 | 用途 |
|-----------|-----|------|
| `--filetree-transition` | `140ms ease-out` | hover/选中过渡 |
| `--filetree-expand-duration` | `180ms ease-out` | 展开/收起动画 |

**注意**：遵循 `prefers-reduced-motion` 媒体查询，当用户偏好减少动效时，禁用所有动画。

---

## 3. 组件结构设计

### 3.1 组件层级

```
FileTreePanel（面板容器）
├── FileTreeHeader（头部）
│   ├── 标题 "项目文件"
│   └── 文件计数 "3 文件"
├── FileTreeList（文件列表）
│   ├── FileTreeFolder（目录节点）
│   │   ├── FolderHeader（可点击头部）
│   │   │   ├── ChevronIcon（展开/收起指示）
│   │   │   ├── FolderIcon
│   │   │   └── 目录名
│   │   └── FileTreeList（子文件列表，条件渲染）
│   └── FileTreeItem（文件节点）
│       ├── FileStatusIcon（状态指示）
│       ├── FileIcon（文件类型图标）
│       ├── 文件名
│       └── FileMeta（可选：文件大小/行数）
└── FileTreeEmpty（空状态）
```

### 3.2 类型定义

```typescript
/** 文件类型 */
type FileType = 'html' | 'css' | 'javascript' | 'typescript' | 'json' | 'text' | 'tsx';

/** 文件状态 */
type FileStatus = 'pending' | 'generating' | 'completed' | 'error';

/** 文件节点 */
interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file';
  fileType: FileType;
  status: FileStatus;
  size?: number;      // 字节数
  lines?: number;     // 行数
}

/** 目录节点 */
interface FolderNode {
  id: string;
  name: string;
  path: string;
  type: 'folder';
  expanded: boolean;
  children: TreeNode[];
}

/** 树节点联合类型 */
type TreeNode = FileNode | FolderNode;

/** Props */
interface FileTreePanelProps {
  /** 文件树数据 */
  tree: TreeNode[];
  /** 当前选中的文件路径 */
  activeFilePath: string | null;
  /** 点击文件回调 */
  onFileSelect: (path: string) => void;
  /** 展开/收起目录回调 */
  onFolderToggle: (path: string) => void;
  /** 面板是否显示 */
  isVisible?: boolean;
}
```

### 3.3 组件伪代码

#### FileTreePanel（主组件）

```tsx
function FileTreePanel({
  tree,
  activeFilePath,
  onFileSelect,
  onFolderToggle,
  isVisible = true,
}: FileTreePanelProps) {
  const fileCount = countFiles(tree);

  if (!isVisible) return null;

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-border-default)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2">
          <Icon icon="lucide:folder" width={14} height={14} className="text-amber-500" />
          <span className="text-[12px] font-medium text-[var(--color-text-primary)]">项目文件</span>
        </div>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{fileCount} 文件</span>
      </div>

      {/* Tree List */}
      <div className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <FileTreeEmpty />
        ) : (
          <FileTreeList
            nodes={tree}
            level={0}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onFolderToggle={onFolderToggle}
          />
        )}
      </div>
    </div>
  );
}
```

#### FileTreeList（列表渲染）

```tsx
function FileTreeList({
  nodes,
  level,
  activeFilePath,
  onFileSelect,
  onFolderToggle,
}: {
  nodes: TreeNode[];
  level: number;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
  onFolderToggle: (path: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) =>
        node.type === 'folder' ? (
          <FileTreeFolder
            key={node.id}
            node={node}
            level={level}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onFolderToggle={onFolderToggle}
          />
        ) : (
          <FileTreeItem
            key={node.id}
            node={node}
            level={level}
            isActive={activeFilePath === node.path}
            onSelect={onFileSelect}
          />
        )
      )}
    </div>
  );
}
```

#### FileTreeFolder（目录节点）

```tsx
function FileTreeFolder({
  node,
  level,
  activeFilePath,
  onFileSelect,
  onFolderToggle,
}: {
  node: FolderNode;
  level: number;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
  onFolderToggle: (path: string) => void;
}) {
  return (
    <div>
      {/* Folder Header */}
      <button
        onClick={() => onFolderToggle(node.path)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        aria-expanded={node.expanded}
        aria-label={`${node.expanded ? '收起' : '展开'} ${node.name}`}
      >
        {/* Chevron */}
        <Icon
          icon="lucide:chevron-right"
          width={14}
          height={14}
          className={`text-[var(--color-text-tertiary)] transition-transform ${
            node.expanded ? 'rotate-90' : ''
          }`}
        />
        {/* Folder Icon */}
        <Icon
          icon={node.expanded ? 'lucide:folder-open' : 'lucide:folder'}
          width={14}
          height={14}
          className="text-amber-500"
        />
        <span className="flex-1 text-left truncate">{node.name}</span>
      </button>

      {/* Children */}
      <div
        className={cn(
          'overflow-hidden transition-all',
          node.expanded ? 'max-h-[1000px]' : 'max-h-0'
        )}
      >
        <FileTreeList
          nodes={node.children}
          level={level + 1}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          onFolderToggle={onFolderToggle}
        />
      </div>
    </div>
  );
}
```

#### FileTreeItem（文件节点）

```tsx
function FileTreeItem({
  node,
  level,
  isActive,
  onSelect,
}: {
  node: FileNode;
  level: number;
  isActive: boolean;
  onSelect: (path: string) => void;
}) {
  const statusIcon = useStatusIcon(node.status);
  const fileIcon = useFileIcon(node.fileType);

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors',
        isActive
          ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      aria-current={isActive ? 'page' : undefined}
    >
      {/* Status Icon */}
      {statusIcon}

      {/* File Type Icon */}
      <Icon icon={fileIcon} width={14} height={14} className={isActive ? 'text-[var(--color-accent)]' : ''} />

      {/* File Name */}
      <span className="flex-1 text-left truncate">{node.name}</span>

      {/* Meta Info */}
      {node.status === 'completed' && node.size && (
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          {(node.size / 1024).toFixed(1)}KB
        </span>
      )}
    </button>
  );
}
```

#### FileTreeEmpty（空状态）

```tsx
function FileTreeEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-10 h-10 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center mb-3">
        <Icon icon="lucide:folder-open" width={20} height={20} className="text-[var(--color-text-tertiary)]" />
      </div>
      <p className="text-[13px] text-[var(--color-text-tertiary)]">暂无文件</p>
      <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">描述你的需求开始生成</p>
    </div>
  );
}
```

---

## 4. 交互流程设计

### 4.1 文件切换流程

```
用户点击文件项
    ↓
onFileSelect(path) 触发
    ↓
父组件更新 activeFilePath 状态
    ↓
FileTreeItem 重新渲染，isActive 变为 true
    ↓
- 背景：变更为 accent/10
- 文字：变更为 accent 颜色
- 图标：变更为 accent 颜色
    ↓
CodeViewer 组件接收新路径，加载对应文件内容
```

**异常分支**：

1. 文件正在生成中：
   - 点击生效，但 CodeViewer 显示"正在生成..."占位
   - 文件项显示 loading 图标（lucide:loader-circle 旋转）

2. 文件生成失败：
   - 点击生效，CodeViewer 显示错误信息
   - 文件项显示错误图标（lucide:alert-circle）

### 4.2 目录展开/收起流程

```
用户点击目录头部
    ↓
onFolderToggle(path) 触发
    ↓
父组件更新 tree 中对应节点的 expanded 状态
    ↓
FileTreeFolder 重新渲染
    ↓
展开动画：
- Chevron 图标旋转 90 度（transition-transform）
- 子列表 max-height 从 0 过渡到实际高度
- Folder 图标从 folder 变为 folder-open
```

**动效约束**：
- 遵循 `prefers-reduced-motion`，禁用动画时直接切换显示/隐藏
- 展开动画时长 180ms，使用 ease-out 缓动

### 4.3 文件状态流转

```
pending（等待生成）
    ↓ [AI 开始生成该文件]
generating（正在生成）
    - 显示 lucide:loader-circle 旋转图标
    - 文件大小实时更新
    ↓ [生成完成]
completed（已完成）
    - 显示 lucide:check 绿色图标
    - 显示最终文件大小
    ↓ [生成失败]
error（错误）
    - 显示 lucide:alert-circle 红色图标
    - hover 显示错误提示
```

---

## 5. 四态设计

### 5.1 Loading 态

**触发场景**：首次加载项目文件列表

**表现**：
```tsx
<div className="space-y-2 p-2">
  {[1, 2, 3].map((i) => (
    <div key={i} className="animate-pulse flex items-center gap-2 px-2 py-1.5">
      <div className="w-3.5 h-3.5 rounded bg-[var(--color-bg-elevated)]" />
      <div className="w-20 h-3.5 rounded bg-[var(--color-bg-elevated)]" />
    </div>
  ))}
</div>
```

### 5.2 生成中态

**触发场景**：AI 正在生成代码

**表现**：
- 文件项右侧显示 lucide:loader-circle 旋转图标
- 文件大小实时更新（如"正在生成... 2.3KB"）
- 当前生成文件自动选中并滚动到可见区域

**文案**：
- 状态提示："正在生成..."
- 阶段提示：显示当前生成阶段（"分析需求" / "生成代码" / "审查代码"）

### 5.3 错误态

**触发场景**：文件生成失败

**表现**：
```tsx
<button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px]">
  <Icon icon="lucide:alert-circle" width={14} height={14} className="text-red-500" />
  <Icon icon="lucide:file-code" width={14} height={14} />
  <span className="flex-1 truncate">{fileName}</span>
  <span className="text-[11px] text-red-400">生成失败</span>
</button>
```

**交互**：
- hover 显示错误详情 tooltip
- 点击可查看错误代码（如部分代码已生成）

### 5.4 空态

**触发场景**：项目无文件（新会话或清空）

**表现**：见 `FileTreeEmpty` 组件设计

---

## 6. 与 CodeViewer 集成

### 6.1 布局方案

**方案 B：右侧面板内嵌文件树 + 代码区**

```
┌─────────────────────────────────────────────────────────┐
│  预览 / 代码                                             │
├──────────┬──────────────────────────────────────────────┤
│          │                                               │
│ 文件树    │              代码内容                         │
│          │                                               │
│ ▼ src    │   1 │ <!DOCTYPE html>                        │
│   App.tsx│   2 │ <html>                                  │
│   index │   3 │   <head>                                │
│ ▼ styles │   4 │     <title>...</title>                  │
│   main.css│  5 │   </head>                               │
│          │   6 │ </html>                                 │
│          │                                               │
└──────────┴──────────────────────────────────────────────┘
```

**布局代码**：
```tsx
<div className="flex-1 flex overflow-hidden">
  {/* 文件树 */}
  <div className="w-48 shrink-0 border-r border-[var(--color-border-default)]">
    <FileTreePanel
      tree={fileTree}
      activeFilePath={activeFilePath}
      onFileSelect={setActiveFilePath}
      onFolderToggle={handleFolderToggle}
    />
  </div>

  {/* 代码区 */}
  <div className="flex-1 overflow-auto">
    <CodePane file={activeFile} />
  </div>
</div>
```

### 6.2 状态同步

```typescript
// 父组件状态
const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

// 当前文件内容
const activeFile = useMemo(() => {
  if (!activeFilePath) return null;
  return findFileByPath(project.files, activeFilePath);
}, [project.files, activeFilePath]);

// 点击文件时
const handleFileSelect = useCallback((path: string) => {
  setActiveFilePath(path);
  // 可选：更新 URL hash 支持书签
  window.location.hash = `file=${encodeURIComponent(path)}`;
}, []);
```

### 6.3 语法高亮扩展

当前 CodeViewer 仅支持 HTML 高亮，需要扩展：

```typescript
/** 语言 -> 高亮函数映射 */
const HIGHLIGHTERS: Record<FileType, (code: string) => string> = {
  html: highlightHtml,
  css: highlightCss,
  javascript: highlightJavaScript,
  typescript: highlightTypeScript,
  tsx: highlightTsx,
  json: highlightJson,
  text: (code) => escapeHtml(code),
};

/** 根据文件类型获取高亮函数 */
function getHighlighter(fileType: FileType) {
  return HIGHLIGHTERS[fileType] ?? HIGHLIGHTERS.text;
}
```

---

## 7. 图标规范

### 7.1 文件类型图标映射

| 文件类型 | lucide 图标 | 颜色 |
|---------|-------------|------|
| html | `lucide:file-code` | 默认 |
| css | `lucide:palette` | `#3b82f6` (蓝色) |
| javascript | `lucide:file-json` | `#fbbf24` (黄色) |
| typescript | `lucide:file-type` | `#3178c6` (TS 蓝) |
| tsx | `lucide:file-code-2` | `#3178c6` |
| json | `lucide:file-json` | `#fbbf24` |
| text | `lucide:file-text` | 默认 |

### 7.2 状态图标映射

| 状态 | lucide 图标 | 颜色 | 动画 |
|------|-------------|------|------|
| pending | `○` (空心圆，无图标) | `text-tertiary` | 无 |
| generating | `lucide:loader-circle` | `accent` | 旋转 1s linear infinite |
| completed | `lucide:check` | `green-500` | 无 |
| error | `lucide:alert-circle` | `red-500` | 无 |

### 7.3 目录图标

| 状态 | lucide 图标 | 颜色 |
|------|-------------|------|
| 收起 | `lucide:folder` | `amber-500` |
| 展开 | `lucide:folder-open` | `amber-500` |
| 展开指示 | `lucide:chevron-right` | `text-tertiary` |

**注意**：所有图标已本地化到 `assets/icons/lucide/`，需先通过 iconify-local skill 下载缺失图标。

---

## 8. 可测验收点

### 8.1 功能验收

- [ ] 文件树正确渲染传入的树形结构
- [ ] 点击文件项触发 `onFileSelect` 回调，参数为文件路径
- [ ] 当前选中文件高亮显示（背景 accent/10，文字 accent）
- [ ] 点击目录头部触发 `onFolderToggle` 回调
- [ ] 目录展开时 Chevron 旋转 90 度，子文件列表可见
- [ ] 目录收起时 Chevron 恢复，子文件列表不可见
- [ ] 文件状态图标正确显示（pending/generating/completed/error）
- [ ] 空状态正确显示"暂无文件"提示

### 8.2 可访问性验收

- [ ] 所有文件项和目录头部可键盘聚焦（Tab 导航）
- [ ] 聚焦时有明显的 focus-visible 样式
- [ ] 目录按钮有 `aria-expanded` 属性
- [ ] 当前选中文件有 `aria-current="page"` 属性
- [ ] 图标有 `aria-hidden="true"`（纯装饰性）

### 8.3 动效验收

- [ ] hover 过渡动画时长 140ms，缓动函数 ease-out
- [ ] 目录展开动画时长 180ms
- [ ] `prefers-reduced-motion: reduce` 时禁用所有动画
- [ ] 加载中图标旋转动画（lucide:loader-circle）

### 8.4 样式验收

- [ ] 使用 Space Grotesk 字体，非 Inter
- [ ] 无 AI 紫渐变（紫色渐变背景）
- [ ] 所有图标来自 lucide 图标集，无手撸 SVG
- [ ] 暗色模式下对比度达标（正文 4.5:1 以上）

---

## 9. 缺失图标清单

需要通过 `iconify-local skill` 下载以下图标：

| 图标名 | 用途 |
|--------|------|
| `lucide:chevron-right` | 目录展开指示 |
| `lucide:folder-open` | 展开的目录 |
| `lucide:file-text` | 文本文件 |
| `lucide:file-type` | TypeScript 文件 |
| `lucide:file-code-2` | TSX 文件 |
| `lucide:palette` | CSS 文件 |
| `lucide:alert-circle` | 错误状态 |
| `lucide:loader-circle` | 加载中（已有 loader-2，需确认） |

**下载命令**：
```bash
# 在项目根目录执行
iconify-local fetch lucide:chevron-right lucide:folder-open lucide:file-text lucide:file-type lucide:file-code-2 lucide:palette lucide:alert-circle
```

---

## 10. 变更日志

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-09-20 | v1.0 | 初版设计文档 |