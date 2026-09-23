# Litpp Demo 持久化方案文档

本文档描述 Litpp Demo 的数据持久化架构，包括 localStorage 持久化、沙箱安全、导出/导入功能与数据迁移。

## 1. localStorage 持久化架构

### 1.1 存储布局

所有 localStorage key 遵循统一格式：

```
atoms:v1:{scope}:{id}
```

| Scope | 用途 | Key 示例 | 数据类型 |
|-------|------|----------|----------|
| `meta` | 元信息 | `atoms:v1:meta` | 版本、统计等 |
| `projects` | 项目索引 | `atoms:v1:projects` | `{ currentId, summaries }` |
| `projects` | 项目详情 | `atoms:v1:projects:{projectId}` | `StorageEnvelope<Project>` |
| `settings` | 用户设置 | `atoms:v1:settings` | `StorageEnvelope<Settings>` |
| `backup` | 隔离备份 | `atoms:v1:backup:{backupId}` | `QuarantineEntry` |
| `backup` | 备份索引 | `atoms:v1:backup:index` | `QuarantineMeta[]` |

### 1.2 信封格式

每个持久化值都包含信封结构：

```typescript
interface StorageEnvelope<T> {
  schemaVersion: number; // 当前版本：1
  savedAt: string;       // ISO 8601 时间戳
  data: T;               // 实际数据
}
```

**设计原因**：
- `schemaVersion`：支持数据迁移，未来版本升级时向后兼容
- `savedAt`：调试与清理依据，last-write-wins 冲突解决

### 1.3 双层持久化策略

项目数据采用双层持久化：

1. **索引层**（`atoms:v1:projects`）：
   - 存储 `currentId` 和 `summaries`
   - 用于项目列表页快速加载
   - 由 zustand persist 中间件自动处理

2. **详情层**（`atoms:v1:projects:{projectId}`）：
   - 每个项目单独存储完整数据
   - 避免列表页反序列化全部项目
   - 由 `persistProjectDetail()` 手动写入

**写入时机**：
- 创建项目
- 更新项目名称/状态
- 更新入口文件
- 添加消息
- store 订阅 `currentProject` 变化

## 2. 沙箱安全架构

### 2.1 CSP 策略

沙箱内的 CSP 策略（`buildPreviewCsp()`）：

```
default-src 'none';
script-src 'unsafe-inline' https://cdn.jsdelivr.net;
style-src 'unsafe-inline';
img-src data: blob: https:;
font-src data: https:;
connect-src 'none';
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none';
```

**安全特性**：
- `default-src 'none'`：默认禁止所有资源
- `script-src`：仅允许白名单 CDN（默认 jsdelivr）和内联脚本
- `connect-src 'none'`：禁止所有网络请求（防止数据外泄）
- 不含 `unsafe-eval`：禁用 `eval()`、`new Function()`

### 2.2 Sandbox 属性

沙箱属性由 `buildSandboxAttribute()` 生成：

```
sandbox="allow-scripts"
```

**安全铁律**：
- 默认仅 `allow-scripts`（最小化原则）
- **绝不与 `allow-same-origin` 同时使用**（否则沙箱可逃逸回同源）
- 禁止的标志（`FORBIDDEN_SANDBOX_FLAGS`）：
  - `allow-same-origin`
  - `allow-top-navigation`
  - `allow-popups-to-escape-sandbox`
  - `allow-downloads`

### 2.3 postMessage 协议

**协议版本**：`SANDBOX_PROTOCOL_VERSION = 1`

**消息结构**：

```typescript
interface SandboxMessageBase {
  protocol: 1;
  from: 'host' | 'guest';
  sessionId: string; // 预览会话 ID
  seq: number;       // 序列号
}
```

**消息类型**：

| Type | Direction | Payload | 用途 |
|------|-----------|---------|------|
| `ready` | guest→host | `{ documentHeight }` | 沙箱就绪 |
| `error` | guest→host | `{ level, message, source, lineno, colno, stack? }` | 错误上报 |
| `resize` | guest→host | `{ width, height }` | 视口尺寸变化 |
| `log` | guest→host | `{ level, text }` | console 桥接 |
| `readyAck` | host→guest | `{ autoResize }` | 确认就绪 |
| `reload` | host→guest | `{ reason }` | 重载指令 |

**安全校验**（`parseSandboxMessage()`）：
1. 协议版本匹配
2. 方向验证（`from` 字段）
3. 会话 ID 验证（`sessionId`）
4. 类型白名单
5. Payload 形状验证

**版本控制**：
- 协议版本号独立于 schema version
- 版本不匹配时静默丢弃消息
- 未来协议升级时保持向后兼容

### 2.4 localStorage 隔离

沙箱 iframe 无法访问主应用的 localStorage：

**原因**：
- 沙箱无 `allow-same-origin`，视为跨源
- `localStorage` 按源隔离，沙箱拥有独立的存储空间
- 沙箱刷新后存储被清空，无持久化能力

**验证方式**：
```javascript
// 在沙箱内尝试访问
console.log(localStorage); // SecurityError 或空存储
```

## 3. 导出/导入功能

### 3.1 导出格式

```typescript
interface ExportData {
  version: '1.0';
  exportedAt: string; // ISO timestamp
  projects: Project[]; // 完整项目数据
  settings?: { ... }; // 可选设置
}
```

**导出函数**：
- `exportAllProjects()`：导出所有项目
- `exportProject(projectId)`：导出单个项目
- `downloadExport(json, filename)`：触发浏览器下载

### 3.2 导入选项

```typescript
interface ImportOptions {
  merge: boolean;          // true = 合并，false = 覆盖
  skipDuplicates: boolean; // true = 跳过重复，false = 覆盖
  idPrefix?: string;       // ID 冲突时的前缀
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  importedIds: string[];
}
```

**边界情况处理**：
- JSON 解析失败：返回错误
- 版本不匹配：返回错误
- 项目结构无效：隔离备份
- ID 冲突：根据 `skipDuplicates` 跳过或生成新 ID
- 写入失败（quota 超限）：返回错误

### 3.3 验证函数

`validateExportFile(json)` 用于导入前预检：

```typescript
{
  valid: boolean;
  projectCount: number;
  version: string;
  errors: string[];
}
```

## 4. 数据迁移系统

### 4.1 迁移链

当前 schema version = 1，尚无历史版本需要迁移。

未来升级时添加迁移函数：

```typescript
const MIGRATIONS: MigrationTable = {
  1: (data: unknown) => {
    // v1 → v2
    return { ...data, newField: 'default' };
  },
};
```

**迁移流程**（`migrateProject()`）：
1. 解析 JSON，验证信封格式
2. 如果版本号 > 当前版本，拒绝（未来版本无法降级）
3. 如果版本号 < 当前版本，执行迁移链
4. 验证迁移后的数据结构
5. 更新 localStorage 中的信封

### 4.2 隔离备份机制

迁移失败时自动隔离备份：

```typescript
quarantineData(originalKey, rawData, reason);
```

**备份结构**：
```typescript
interface QuarantineEntry {
  originalKey: string;
  reason: string;
  quarantinedAt: string;
  rawData: string; // 原始数据
}
```

**管理函数**：
- `listQuarantines()`：列出所有备份
- `restoreQuarantine(backupId)`：恢复备份数据
- `cleanupOldQuarantines(keepCount)`：清理旧备份
- `clearAllQuarantines()`：清空所有备份

## 5. Quota 管理策略

**localStorage 限制**：
- 约 5MB（浏览器不同略有差异）
- 超限时写入抛出 `QuotaExceededError`

**当前策略**：
- 每个项目单独存储，删除时自动清理
- 写入失败静默降级（内存态仍可用）
- 隔离备份自动清理旧的备份

**未来扩展**：
- 导出/导入作为备份/恢复手段
- 可选 Supabase 云同步（无限容量）

## 6. 安全验证清单

- [x] 生成的代码必须在 iframe sandbox 中执行
- [x] sandbox 属性最小化（仅 `allow-scripts`）
- [x] CSP 策略限制脚本来源
- [x] postMessage 消息来源校验
- [x] 沙箱无法访问主应用 localStorage
- [x] 禁止 `eval()`、`new Function()`（CSP 不含 `unsafe-eval`）
- [x] CDN 主机白名单
- [x] 禁止沙箱发起网络请求（`connect-src 'none'`）

## 7. 文件清单

```
src/
├── types/
│   ├── project.ts      # Project、FileNode 等类型
│   ├── storage.ts      # StorageEnvelope、迁移类型
│   └── sandbox.ts      # postMessage 协议、CSP
├── stores/
│   └── projectStore.ts # 项目状态管理、双层持久化
└── services/storage/
    ├── types.ts        # ExportData、ImportOptions
    ├── migration.ts    # 迁移系统
    ├── quarantine.ts   # 隔离备份
    ├── export.ts       # 导出功能
    ├── import.ts       # 导入功能
    └── index.ts        # 统一导出
```