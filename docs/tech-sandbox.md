# Litpp Demo 沙箱与持久化技术方案 v1

| 项 | 内容 |
|---|---|
| 版本 | v1（Iteration 1 地基轮） |
| 作者 | dev-litpp-backend-architect |
| 日期 | 2026-09-18 |
| 状态 | 待 dev-litpp-reality-checker 独立验证 |
| 配套代码落点 | `src/types/project.ts`、`src/types/sandbox.ts`、`src/types/storage.ts`、`src/sandbox/`、`src/services/storage/` |

## 0. 方案概述与范围

本文回答两个问题：生成的单文件 HTML 应用如何安全地跑起来（沙箱），以及项目数据如何可靠地存下来（持久化）。

范围：iframe sandbox 配置与组装器、postMessage 通信协议、localStorage 布局与 quota 策略、schemaVersion 迁移链、安全威胁分析。
不在本版本范围：Supabase 云同步表结构（仅在 7.2 节预留接口约定）、Web Worker 隔离执行（见 7.4 展望）。

设计原则（与安全铁律一一对应，逐条落实见第 6 节）：

1. 生成代码只能在 `sandbox="allow-scripts"` 的 iframe 中经 `srcdoc` 执行，绝不与 `allow-same-origin` 同用。
2. 沙箱内外只走 postMessage，双向都有身份与结构校验。
3. 主文档不 eval、不 new Function、不把生成内容拼进主文档 DOM。
4. 生成代码的外部资源走 CDN 白名单，白名单由 CSP 在浏览器层强制，不依赖自觉。

---

## 1. TypeScript 类型定义（可直接复制进 src/types/）

对外类型统一从 `src/types/` 导出，前端、AI 层一律 import，禁止重复声明。全部类型无 `any`，strict 模式可直接编译。

### 1.1 `src/types/project.ts`

```typescript
/**
 * 项目与虚拟文件系统类型定义。
 * Demo 阶段约定单文件应用：files 通常只含 ENTRY_FILE_PATH 一个节点，
 * 但结构保留多文件扩展能力（后续迭代可扩展 css/js 分离文件）。
 */

export type IsoDateTime = string; // ISO 8601 UTC 字符串，如 "2026-09-18T08:00:00.000Z"

export type FileLanguage = 'html' | 'css' | 'javascript' | 'json' | 'text';

/** 约定的应用入口文件路径 */
export const ENTRY_FILE_PATH = '/index.html';

/** 虚拟文件系统节点 */
export interface FileNode {
  /** 虚拟路径，约定以 "/" 开头，如 "/index.html" */
  path: string;
  /** 文件文本内容（UTF-8） */
  content: string;
  /** 语言标记，供编辑器高亮与组装器使用 */
  language: FileLanguage;
  /** 最近更新时间 */
  updatedAt: IsoDateTime;
}

export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'error';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** 消息文本。流式输出完成后才写入持久层，本字段不存在半截状态 */
  content: string;
  createdAt: IsoDateTime;
  /** assistant 消息可指向本次生成的代码快照 id，用于历史版本回看 */
  artifactId?: string;
}

/**
 * 额外授予沙箱的能力标志。默认空数组（仅 allow-scripts，见铁律 2）。
 * 允许集合被刻意收窄：凡是可能扩大同源能力或导航能力的标志一律不在类型里出现。
 */
export type SandboxAllowFlag = 'allow-forms' | 'allow-modals';

export interface PreviewConfig {
  /** 额外 sandbox 能力，需产品明确需求后才可写入 */
  extraSandboxFlags: SandboxAllowFlag[];
  /** 预览尺寸模式：跟随内容自适应高度，或固定设备视口 */
  sizeMode: 'autoHeight' | 'fixed';
  /** sizeMode 为 fixed 时生效 */
  fixedViewport?: { width: number; height: number };
}

export const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
  extraSandboxFlags: [],
  sizeMode: 'autoHeight',
};

/** 项目聚合根：元信息 + 虚拟文件 + 对话历史 + 预览配置 */
export interface Project {
  /** UUID v4，宿主生成 */
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  /** path 到 FileNode 的映射。读取入口永远走 ENTRY_FILE_PATH */
  files: Record<string, FileNode>;
  /** 对话历史，按 createdAt 升序 */
  chat: ChatMessage[];
  preview: PreviewConfig;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 项目列表页使用的轻量摘要，持久化在索引 key 中，避免列表页反序列化全部项目 */
export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  updatedAt: IsoDateTime;
  /** 入口文件字节数，用于列表页体积提示与 quota 预估 */
  entryBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIsoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Project 结构守卫：迁移与读取路径统一用它验证数据形状 */
export function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.description !== 'string') return false;
  if (value.status !== 'draft' && value.status !== 'generating' && value.status !== 'ready' && value.status !== 'error') {
    return false;
  }
  if (!isRecord(value.files) || !isRecord(value.files[ENTRY_FILE_PATH])) return false;
  if (!Array.isArray(value.chat)) return false;
  if (!isRecord(value.preview)) return false;
  if (!isIsoDateTime(value.createdAt) || !isIsoDateTime(value.updatedAt)) return false;
  return true;
}
```

### 1.2 `src/types/sandbox.ts`

```typescript
/**
 * 沙箱配置、postMessage 协议与消息校验。
 * 协议版本号：收发双方不一致时直接丢弃消息。
 */
import type { SandboxAllowFlag } from './project';

export const SANDBOX_PROTOCOL_VERSION = 1;

/** 允许生成代码引用的 CDN 主机白名单（铁律 4）。默认只放 jsdelivr，扩充需评审。 */
export const DEFAULT_CDN_HOSTS: readonly string[] = ['cdn.jsdelivr.net'];

/**
 * 绝对禁止的 sandbox 标志。allow-same-origin 与 allow-scripts 同用时
 * 浏览器按 HTML 规范视作未沙箱化，等于完全逃逸，代码层直接抛错兜底。
 */
export const FORBIDDEN_SANDBOX_FLAGS: readonly string[] = [
  'allow-same-origin',
  'allow-top-navigation',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
];

/** 组装 sandbox 属性值。默认仅 allow-scripts，最小化原则在此强制。 */
export function buildSandboxAttribute(flags: readonly SandboxAllowFlag[]): string {
  const all: string[] = ['allow-scripts', ...flags];
  const forbidden = all.filter((flag) => FORBIDDEN_SANDBOX_FLAGS.includes(flag));
  if (forbidden.length > 0) {
    throw new Error(`禁止的 sandbox 标志: ${forbidden.join(', ')}`);
  }
  return all.join(' ');
}

export type SandboxMessageSource = 'host' | 'guest';

export interface SandboxMessageBase {
  protocol: typeof SANDBOX_PROTOCOL_VERSION;
  /** 发送方自报身份，仅用于调试；真正的方向判定以接收方解析器为准 */
  from: SandboxMessageSource;
  /** 预览会话 id。宿主每次重装 srcdoc 时重新生成，用于丢弃旧会话的迟到消息 */
  sessionId: string;
  /** 发送方内单调递增序号，用于去重与排序 */
  seq: number;
}

/* ---------------- guest 发给 host 的消息 ---------------- */

export interface ReadyMessage extends SandboxMessageBase {
  type: 'ready';
  payload: { documentHeight: number };
}

export interface ErrorMessage extends SandboxMessageBase {
  type: 'error';
  payload: {
    level: 'error' | 'unhandledrejection';
    message: string;
    source: string;
    lineno: number;
    colno: number;
    stack?: string;
  };
}

export interface ResizeMessage extends SandboxMessageBase {
  type: 'resize';
  payload: { width: number; height: number };
}

/** 访客 console 桥接，驱动预览面板的控制台视图 */
export interface LogMessage extends SandboxMessageBase {
  type: 'log';
  payload: { level: 'log' | 'info' | 'warn' | 'error'; text: string };
}

/* ---------------- host 发给 guest 的消息 ---------------- */

export interface ReadyAckMessage extends SandboxMessageBase {
  type: 'readyAck';
  payload: { autoResize: boolean };
}

export interface ReloadMessage extends SandboxMessageBase {
  type: 'reload';
  payload: { reason: 'manual' | 'codeUpdate' };
}

export type GuestToHostMessage = ReadyMessage | ErrorMessage | ResizeMessage | LogMessage;
export type HostToGuestMessage = ReadyAckMessage | ReloadMessage;
export type SandboxMessage = GuestToHostMessage | HostToGuestMessage;

export type MessageDirection = 'guestToHost' | 'hostToGuest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 唯一的入站消息解析入口。校验顺序：协议版本、方向、会话 id、类型白名单、payload 形状。
 * 任何一项不满足即返回 null（静默丢弃），绝不把未校验数据透传给 UI 层。
 */
export function parseSandboxMessage(
  data: unknown,
  expectedSessionId: string,
  direction: MessageDirection,
): GuestToHostMessage | HostToGuestMessage | null {
  if (!isRecord(data)) return null;
  if (data.protocol !== SANDBOX_PROTOCOL_VERSION) return null;
  if (data.from !== (direction === 'guestToHost' ? 'guest' : 'host')) return null;
  if (data.sessionId !== expectedSessionId) return null;
  if (!isStr(data.type) || !isRecord(data.payload) || !isFiniteNum(data.seq)) return null;

  const type = data.type;
  const payload = data.payload;
  const seq = data.seq;
  const base = { protocol: SANDBOX_PROTOCOL_VERSION, from: data.from as SandboxMessageSource, sessionId: expectedSessionId, seq };

  if (direction === 'guestToHost') {
    switch (type) {
      case 'ready':
        return isFiniteNum(payload.documentHeight) && payload.documentHeight >= 0
          ? { ...base, type: 'ready', payload: { documentHeight: payload.documentHeight } }
          : null;
      case 'resize':
        return isFiniteNum(payload.width) && isFiniteNum(payload.height) && payload.width >= 0 && payload.height >= 0
          ? { ...base, type: 'resize', payload: { width: payload.width, height: payload.height } }
          : null;
      case 'error': {
        if (!isStr(payload.message) || !isStr(payload.source)) return null;
        if (payload.level !== 'error' && payload.level !== 'unhandledrejection') return null;
        if (!isFiniteNum(payload.lineno) || !isFiniteNum(payload.colno)) return null;
        if (payload.stack !== undefined && !isStr(payload.stack)) return null;
        return {
          ...base,
          type: 'error',
          payload: {
            level: payload.level,
            message: payload.message,
            source: payload.source,
            lineno: payload.lineno,
            colno: payload.colno,
            stack: payload.stack,
          },
        };
      }
      case 'log': {
        if (!isStr(payload.text)) return null;
        if (payload.level !== 'log' && payload.level !== 'info' && payload.level !== 'warn' && payload.level !== 'error') {
          return null;
        }
        return { ...base, type: 'log', payload: { level: payload.level, text: payload.text } };
      }
      default:
        return null;
    }
  }

  switch (type) {
    case 'readyAck':
      return typeof payload.autoResize === 'boolean'
        ? { ...base, type: 'readyAck', payload: { autoResize: payload.autoResize } }
        : null;
    case 'reload':
      return payload.reason === 'manual' || payload.reason === 'codeUpdate'
        ? { ...base, type: 'reload', payload: { reason: payload.reason } }
        : null;
    default:
      return null;
  }
}

/** 从 preview CSP 构造 meta 标签内容。注意不含 unsafe-eval，等于在访客内也禁了 eval。 */
export function buildPreviewCsp(cdnHosts: readonly string[]): string {
  const scriptSrc = ["'unsafe-inline'", ...cdnHosts.map((host) => `https://${host}`)].join(' ');
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob: https:',
    'font-src data: https:',
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
```

### 1.3 `src/types/storage.ts`

```typescript
/**
 * localStorage 存储信封、key 布局与迁移链类型。
 */

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * 存储信封：每个 localStorage key 的值都是这个结构。
 * schemaVersion 只存在于信封一层，payload 类型不自报版本，避免双份真源。
 */
export interface StorageEnvelope<T> {
  schemaVersion: number;
  /** 本次写入时间，ISO 8601 */
  savedAt: string;
  data: T;
}

export function isStorageEnvelope(value: unknown): value is StorageEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number'
    && Number.isInteger(v.schemaVersion)
    && v.schemaVersion >= 1
    && typeof v.savedAt === 'string'
    && 'data' in v
  );
}

/** 迁移函数：输入上一版本 payload，输出下一版本 payload。失败时抛错，由调用方隔离处理 */
export type MigrationFn = (data: unknown) => unknown;
/** 键为源版本号，值为升级到 (源版本号 + 1) 的函数 */
export type MigrationTable = Readonly<Record<number, MigrationFn>>;

export interface MigrationResult<T> {
  ok: boolean;
  envelope?: StorageEnvelope<T>;
  /** 失败原因，用于隔离备份的元数据 */
  reason?: 'chain-gap' | 'step-threw' | 'validate-failed' | 'future-version';
}

/** 存储作用域，对应 localStorage key 的第三段 */
export type StorageScope = 'meta' | 'projects' | 'settings' | 'backup';

const APP_PREFIX = 'atoms';
/** key 中的格式代际。仅当值形态无法用数据变换表达时才 bump，正常演进走 schemaVersion */
const KEY_GENERATION = 'v1';

export function storageKey(scope: StorageScope, id?: string): string {
  return id ? `${APP_PREFIX}:${KEY_GENERATION}:${scope}:${id}` : `${APP_PREFIX}:${KEY_GENERATION}:${scope}`;
}

/** 隔离备份 key 的元信息 */
export interface QuarantineMeta {
  originalKey: string;
  reason: string;
  quarantinedAt: string;
}
```

### 1.4 类型清单（对外契约盘点）

| 文件路径 | 导出项 |
|---|---|
| `src/types/project.ts` | `IsoDateTime`、`FileLanguage`、`ENTRY_FILE_PATH`、`FileNode`、`ProjectStatus`、`ChatRole`、`ChatMessage`、`SandboxAllowFlag`、`PreviewConfig`、`DEFAULT_PREVIEW_CONFIG`、`Project`、`ProjectSummary`、`isProject` |
| `src/types/sandbox.ts` | `SANDBOX_PROTOCOL_VERSION`、`DEFAULT_CDN_HOSTS`、`FORBIDDEN_SANDBOX_FLAGS`、`buildSandboxAttribute`、`SandboxMessageSource`、`SandboxMessageBase`、`ReadyMessage`、`ErrorMessage`、`ResizeMessage`、`LogMessage`、`ReadyAckMessage`、`ReloadMessage`、`GuestToHostMessage`、`HostToGuestMessage`、`SandboxMessage`、`MessageDirection`、`parseSandboxMessage`、`buildPreviewCsp` |
| `src/types/storage.ts` | `CURRENT_SCHEMA_VERSION`、`StorageEnvelope`、`isStorageEnvelope`、`MigrationFn`、`MigrationTable`、`MigrationResult`、`StorageScope`、`storageKey`、`QuarantineMeta` |

---

## 2. iframe sandbox 配置

### 2.1 sandbox 属性决策表

| 标志 | 是否启用 | 理由 |
|---|---|---|
| `allow-scripts` | 启用（恒定） | 生成代码需要执行，这是沙箱存在的目的 |
| `allow-same-origin` | 永久禁止 | 见 2.3 专述，代码层抛错兜底 |
| `allow-forms` | 默认关，可按 `PreviewConfig.extraSandboxFlags` 开 | 打开后原生表单提交可用。注意 CSP `form-action 'none'` 会拦截原生提交，推荐生成代码用按钮 click 与 input 事件做交互 |
| `allow-modals` | 默认关，同上 | alert/confirm 会阻塞预览体验，仅在生成代码确需时开 |
| `allow-popups` | 禁用 | window.open 打开的窗口无法追溯管控，且本产品无合理场景 |
| `allow-top-navigation` | 禁止（类型层就不存在） | 防生成代码把父页面导航走 |
| `allow-downloads` | 禁止 | 防生成代码静默下载文件 |

### 2.2 SandboxFrame 组件（实际配置代码）

iframe 只允许经由这一个组件创建，禁止在别处手写 `<iframe>`，保证 sandbox 属性不可能被遗漏（这是真实世界里最大的逃逸入口，见 6.1 威胁 T1）。

```tsx
// src/sandbox/SandboxFrame.tsx
import { useEffect, useRef } from 'react';
import { buildSandboxAttribute, parseSandboxMessage, type GuestToHostMessage, type HostToGuestMessage } from '../types/sandbox';

interface SandboxFrameProps {
  /** 组装器输出的完整 HTML 文档 */
  html: string;
  /** 本次预览会话 id，宿主生成，随 html 一起注入 shim */
  sessionId: string;
  onGuestMessage: (message: GuestToHostMessage) => void;
}

export function SandboxFrame({ html, sessionId, onGuestMessage }: SandboxFrameProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // html 或 sessionId 变化时重装 srcdoc，等价于整页重建
  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe) {
      // 关键：用 DOM 属性赋值，浏览器自动处理转义。
      // 禁止手写字符串拼接 `<iframe srcdoc="${html}">`，那是注入漏洞。
      iframe.srcdoc = html;
    }
  }, [html, sessionId]);

  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      const iframe = iframeRef.current;
      if (!iframe) return;
      // 来源校验第一步：身份比对。event.source 是发送窗口的唯一引用
      if (event.source !== iframe.contentWindow) return;
      // 来源校验第二步：沙箱 iframe 无 allow-same-origin 时 origin 恒为 "null"（不透明来源），
      // 因此 host 侧校验目标是字符串 "null" 而不是自家域名
      if (event.origin !== 'null') return;
      // 来源校验第三步：协议版本、会话 id、类型白名单、payload 形状
      const message = parseSandboxMessage(event.data, sessionId, 'guestToHost');
      if (!message) return;
      onGuestMessage(message);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId, onGuestMessage]);

  return (
    <iframe
      ref={iframeRef}
      title="应用预览"
      sandbox={buildSandboxAttribute([])}
      referrerpolicy="no-referrer"
      loading="eager"
    />
  );
}

/** host 向沙箱发消息。目标是不透明来源，无法指定真实 origin，用 '*'；
 *  安全性由 contentWindow 引用唯一性保证：消息只会送达这一个窗口。 */
export function postToSandbox(iframe: HTMLIFrameElement, message: HostToGuestMessage): void {
  const target = iframe.contentWindow;
  if (!target) return;
  target.postMessage(message, '*');
}
```

补充事实说明：srcdoc 文档正常情况下继承父页面同源，因此「srcdoc + sandbox（且不含 allow-same-origin）」的组合才是隔离成立的关键，二者缺一不可。另外 blob URL 与创建它的 origin 绑定，不透明来源的 iframe 加载不了父页面的 blob，所以 srcdoc 是不透明沙箱唯一顺畅的装载通道，这也是选它而非 data: / blob: URL 的原因。

### 2.3 与 allow-same-origin 的关系（专述）

- 按 HTML 规范，`sandbox` 同时包含 `allow-scripts` 与 `allow-same-origin` 时，整个 sandbox 标志组被忽略，iframe 回到与父页面完全同源的状态。此时生成代码可以读写主应用的 localStorage（全部项目数据）、访问父文档 DOM、伪造一切。这是方案里唯一会一击致命的配置错误。
- 三层堵法：
  1. 类型层：`SandboxAllowFlag` 联合类型里根本没有 `allow-same-origin` 这个成员，业务代码写不出它；
  2. 函数层：`buildSandboxAttribute` 对 `FORBIDDEN_SANDBOX_FLAGS` 做运行时断言，命中即抛错；
  3. 测试层：单测断言 `buildSandboxAttribute` 的任何合法输出都不含 `allow-same-origin` 与 `allow-top-navigation`（测试用例随 6.4 一并交付）。
- 事件语义影响：因为访客 origin 是 `"null"`，host 侧不能用域名白名单校验 `event.origin`，必须以 `event.source === iframe.contentWindow` 做身份判定；反向（shim 收 host 消息）则可以且必须校验 `event.origin` 等于组装时注入的真实宿主 origin。两个方向的校验方式不对称，这是有意设计，见 3.3。

---

## 3. postMessage 通信协议

### 3.1 握手与装载流程

```
宿主                                   沙箱 iframe
 |                                       |
 | 组装: 生成 HTML + 注入 meta CSP        |
 |        + 注入 shim（含 HOST_ORIGIN、   |
 |        SESSION_ID）                   |
 | iframe.srcdoc = html                  |
 | ------------------------------------> | shim 先于业务代码执行
 |                                       | load 完成
 |                                       | -- ready {documentHeight} -->
 | 记录会话已就绪，按高度自适应容器        |
 |                                       | -- resize {width,height} --> (持续)
 |                                       | -- error {...} -----------> (运行期)
 | -- readyAck {autoResize} ------------ | (握手确认)
 | -- reload {reason} ------------------ | (用户点刷新或代码更新)
 |                                       | location.reload() 后重新走 ready
```

会话规则：宿主每次重装 srcdoc（代码更新）生成新的 `sessionId` 并同步注入 shim；旧会话的一切消息因 sessionId 不匹配被静默丢弃，天然解决迟到消息串扰。手动刷新（reason 为 manual）复用同一 sessionId，iframe 自身 `location.reload()` 重跑；若 3 秒内收不到新的 ready，宿主降级为重装 srcdoc（换新 sessionId）。

### 3.2 协议表

信封公共字段：`protocol`（整数 1）、`from`（host 或 guest）、`sessionId`（字符串）、`seq`（非负整数）。下表 payload 列只写 payload。

| type | direction | 分类 | payload schema | 示例 |
|---|---|---|---|---|
| `ready` | guest 到 host | 握手 | `{ documentHeight: number }` | `{"documentHeight":842}` |
| `readyAck` | host 到 guest | 握手 | `{ autoResize: boolean }` | `{"autoResize":true}` |
| `error` | guest 到 host | 错误 | `{ level: "error"或"unhandledrejection", message: string, source: string, lineno: number, colno: number, stack?: string }` | `{"level":"error","message":"x is not defined","source":"about:srcdoc","lineno":42,"colno":7,"stack":"ReferenceError: x is not defined\\n    at about:srcdoc:42:7"}` |
| `resize` | guest 到 host | 尺寸 | `{ width: number, height: number }` | `{"width":1280,"height":916}` |
| `log` | guest 到 host | 数据 | `{ level: "log"或"info"或"warn"或"error", text: string }` | `{"level":"warn","text":"Chart.js: canvas 已复用"}` |
| `reload` | host 到 guest | 刷新 | `{ reason: "manual"或"codeUpdate" }` | `{"reason":"codeUpdate"}` |

覆盖性说明：本表同时满足任务书四类（ready 握手、error 错误、resize 尺寸、reload 刷新）与角色契约四类（握手 ready/readyAck、数据 log、错误 error、尺寸 resize）。

### 3.3 双向校验规则

| 方向 | 身份校验 | origin 校验 | 结构校验 |
|---|---|---|---|
| host 收 | `event.source === iframe.contentWindow` | `event.origin === "null"`（不透明来源特征） | `parseSandboxMessage(data, sessionId, 'guestToHost')`，类型白名单仅 ready/error/resize/log |
| guest 收 | `event.source === window.parent` | `event.origin === HOST_ORIGIN`（组装时注入的真实宿主 origin） | shim 内联校验 protocol 与 sessionId，类型白名单仅 reload/readyAck |

guest 发来的 `from` 字段是可伪造的声明，方向判定永远以接收方解析器的白名单为准，不信 `from`。

### 3.4 注入 shim 的完整代码（由组装器写入 srcdoc 头部）

```javascript
// src/sandbox/guestShim.ts 导出的模板字符串产物，两个占位值由宿主组装时安全注入
(function () {
  'use strict';
  var PROTOCOL = 1;
  var HOST_ORIGIN = "__HOST_ORIGIN__"; // 形如 "https://app.example.com"，宿主运行时写入
  var SESSION_ID = "__SESSION_ID__";   // 宿主生成的 UUID，宿主运行时写入
  var seq = 0;

  function send(type, payload) {
    seq += 1;
    try {
      parent.postMessage({ protocol: PROTOCOL, from: 'guest', sessionId: SESSION_ID, seq: seq, type: type, payload: payload }, '*');
    } catch (err) { /* 上报失败不影响访客自身运行 */ }
  }

  // 用 addEventListener 而非 window.onerror 赋值，避免被生成代码覆盖后丢失上报
  window.addEventListener('error', function (event) {
    var err = event.error;
    send('error', {
      level: 'error',
      message: event.message ? String(event.message) : 'unknown error',
      source: event.filename ? String(event.filename) : '',
      lineno: typeof event.lineno === 'number' ? event.lineno : 0,
      colno: typeof event.colno === 'number' ? event.colno : 0,
      stack: err && typeof err.stack === 'string' ? err.stack : undefined
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    send('error', {
      level: 'unhandledrejection',
      message: reason && reason.message ? String(reason.message) : String(reason),
      source: '',
      lineno: 0,
      colno: 0,
      stack: reason && typeof reason.stack === 'string' ? reason.stack : undefined
    });
  });

  var lastHeight = 0;
  function reportSize() {
    var doc = document.documentElement;
    if (!doc) return;
    var h = doc.scrollHeight;
    if (Math.abs(h - lastHeight) >= 1) {
      lastHeight = h;
      send('resize', { width: doc.scrollWidth, height: h });
    }
  }
  if (typeof ResizeObserver === 'function') {
    try { new ResizeObserver(reportSize).observe(document.documentElement); } catch (err) { /* 老浏览器走兜底 */ }
  }
  window.setInterval(reportSize, 500); // ResizeObserver 兜底轮询

  window.addEventListener('message', function (event) {
    if (event.origin !== HOST_ORIGIN) return;       // 只信真实宿主 origin
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.protocol !== PROTOCOL || data.sessionId !== SESSION_ID) return;
    if (data.type === 'reload') { window.location.reload(); return; }
    // readyAck 当前仅作握手确认，行为预留
  });

  function announceReady() {
    reportSize();
    send('ready', { documentHeight: lastHeight });
  }
  if (document.readyState === 'complete') { announceReady(); }
  else { window.addEventListener('load', announceReady); }
})();
```

shim 注入值的安全性：占位值由宿主以 `JSON.stringify` 写入，写入前断言不含 `<`、`>`、`&`，杜绝把注入值变成脚本逃逸点（见 6.1 威胁 T8）。

### 3.5 组装器：虚拟文件到 srcdoc 文档

```typescript
// src/sandbox/assembler.ts（浏览器环境，DOMParser 为全局 API，无需导入）
import { DEFAULT_CDN_HOSTS, buildPreviewCsp } from '../types/sandbox';
import { ENTRY_FILE_PATH, type FileNode } from '../types/project';

const SHIM_TEMPLATE = `/* 3.4 节的 shim 源码，含 __HOST_ORIGIN__ 与 __SESSION_ID__ 占位符 */`;

export interface AssembleOptions {
  hostOrigin: string;
  sessionId: string;
  cdnHosts?: readonly string[];
}

export function assemblePreviewDocument(files: Record<string, FileNode>, options: AssembleOptions): string {
  const entry = files[ENTRY_FILE_PATH];
  if (!entry) {
    throw new Error(`虚拟文件系统缺少入口文件: ${ENTRY_FILE_PATH}`);
  }
  const doc = new DOMParser().parseFromString(entry.content, 'text/html');

  const violations = collectOffWhitelistHosts(doc, options.cdnHosts ?? DEFAULT_CDN_HOSTS);
  if (violations.length > 0) {
    // 静态扫描是给 AI 层的快速反馈；真正的强制力在 meta CSP（浏览器层，绕不过）
    throw new Error(`引用了白名单外的资源: ${violations.join(', ')}`);
  }

  injectMeta(doc, 'Content-Security-Policy', buildPreviewCsp(options.cdnHosts ?? DEFAULT_CDN_HOSTS));
  injectShim(doc, options.hostOrigin, options.sessionId);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function injectMeta(doc: Document, httpEquiv: string, content: string): void {
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', httpEquiv);
  meta.setAttribute('content', content);
  doc.head.insertBefore(meta, doc.head.firstChild);
}

function injectShim(doc: Document, hostOrigin: string, sessionId: string): void {
  for (const [name, value] of [['HOST_ORIGIN', hostOrigin], ['SESSION_ID', sessionId]] as const) {
    if (/[<>&]/.test(value)) {
      throw new Error(`shim 注入值不安全: ${name}`);
    }
  }
  const script = doc.createElement('script');
  script.textContent = buildShimSource(hostOrigin, sessionId);
  doc.head.insertBefore(script, doc.head.firstChild); // shim 必须先于业务脚本执行
}

function buildShimSource(hostOrigin: string, sessionId: string): string {
  return SHIM_TEMPLATE.replace('__HOST_ORIGIN__', JSON.stringify(hostOrigin))
    .replace('__SESSION_ID__', JSON.stringify(sessionId));
}

function collectOffWhitelistHosts(doc: Document, allow: readonly string[]): string[] {
  const offenders: string[] = [];
  const probes: Array<{ selector: string; attr: string }> = [
    { selector: 'script[src], img[src], source[src], video[src], audio[src], iframe[src]', attr: 'src' },
    { selector: 'link[href]', attr: 'href' },
  ];
  for (const probe of probes) {
    doc.querySelectorAll(probe.selector).forEach((el) => {
      const raw = el.getAttribute(probe.attr);
      if (!raw) return;
      try {
        const host = new URL(raw, 'https://preview.invalid/').host;
        if (!allow.includes(host) && !offenders.includes(host)) offenders.push(host);
      } catch {
        offenders.push(raw); // 连 URL 都不是的引用同样上报
      }
    });
  }
  return offenders;
}
```

实现注记：浏览器端直接用全局 `DOMParser`，不引入 `@xmldom/xmldom`；解析归一化会丢弃 doctype 之外的杂质节点，对生成的标准 HTML5 文档无副作用。组装输出的 HTML 整体进入 srcdoc，主文档自始至终不把生成内容注入自身 DOM（铁律 5 的主文档侧约束）。

---

## 4. localStorage 布局

### 4.1 key 布局表

所有 key 统一前缀 `atoms:v1:`（`storageKey()` 唯一生成，禁止手拼）。每个值都是 `StorageEnvelope` 信封。

| key | 用途 | 值结构（data 字段） | 大小预估 | 清理策略 |
|---|---|---|---|---|
| `atoms:v1:meta` | 存储层元信息 | `{ installedAt: string, lastMigrationAt: string }` | 约 200 B | 永不清理 |
| `atoms:v1:settings` | 用户偏好（主题、预览尺寸模式、AI 参数） | `Record<string, string | number | boolean>` | 小于 2 KB | 永不清理 |
| `atoms:v1:projects:index` | 项目摘要数组，列表页专用 | `ProjectSummary[]` | 每项目约 150 B，上限 50 项，约 8 KB | 随项目驱逐同步重写 |
| `atoms:v1:projects:<id>` | 单个项目全量数据 | `Project`（含 files 与 chat） | 单项目 50 KB 到 300 KB；入口 HTML 建议小于 100 KB，硬上限 1 MB；chat 上限 200 条 | LRU：超限先裁 chat，再驱逐最旧 draft；见 4.3 |
| `atoms:v1:backup:<keyhash>` | 坏数据隔离区 / 驱逐前快照 | `{ meta: QuarantineMeta, raw: string }` | 单份不超过 1 MB，环形保留最近 2 份 | FIFO 淘汰 |

### 4.2 容量预算

浏览器 quota 通常约 5 MB（iOS Safari 更紧，隐私模式写入直接抛错）。方案按软预算 4 MB 运行，留 1 MB 余量：

| 项 | 预算 |
|---|---|
| meta + settings + index | 小于 16 KB |
| 活跃项目（3 到 5 个） | 小于 1.5 MB |
| 历史项目沉淀（最多 50 个，多数小项目） | 小于 2 MB |
| 隔离备份区 | 小于 1 MB（计入预算，超额即不再写备份，优先保活数据） |

### 4.3 quota 超限清理策略（分级降级）

写入统一走 `saveProject`，`QuotaExceededError` 触发分级回收，级别逐级加重：

1. **L1 聊天裁剪**：所有项目 chat 只保留最近 50 条，重试写入。
2. **L2 驱逐最旧 draft**：按 `updatedAt` 最旧优先驱逐 `status === 'draft'` 且非当前活跃的项目；驱逐前把原始字符串写入备份区（最多 2 份），重试写入。
3. **L3 驱逐最旧 ready 项目**：同 L2 规则扩展到 ready 项目，重试。
4. **L4 内存降级**：写入失败但数据留在内存（Zustand store），当前会话功能不受影响；UI 弹提示引导用户导出或删除项目。绝不静默丢数据。

```typescript
// src/services/storage/saveProject.ts
import { storageKey, CURRENT_SCHEMA_VERSION, type StorageEnvelope } from '../../types/storage';
import { ENTRY_FILE_PATH, type Project, type ProjectSummary } from '../../types/project';

type SaveOutcome = { ok: true } | { ok: false; level: 'L4-memory-only'; cause: 'quota' };

export function saveProject(project: Project, envelopeOf: (p: Project) => StorageEnvelope<Project>): SaveOutcome {
  const key = storageKey('projects', project.id);
  const attempts: Array<() => void> = [
    () => writeThrough(key, envelopeOf(project)),
    () => { trimAllChats(50); writeThrough(key, envelopeOf(project)); },
    () => { evictOldest('draft', project.id); writeThrough(key, envelopeOf(project)); },
    () => { evictOldest('ready', project.id); writeThrough(key, envelopeOf(project)); },
  ];
  for (const attempt of attempts) {
    try {
      attempt();
      syncIndex(project);
      return { ok: true };
    } catch (err: unknown) {
      if (!isQuotaError(err)) throw err; // 非容量问题不降级，直接上抛
    }
  }
  return { ok: false, level: 'L4-memory-only', cause: 'quota' };
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

function writeThrough(key: string, envelope: StorageEnvelope<Project>): void {
  localStorage.setItem(key, JSON.stringify(envelope)); // 失败即抛 QuotaExceededError，交由上层分级处理
}

function syncIndex(project: Project): void {
  const indexKey = storageKey('projects', 'index');
  const raw = localStorage.getItem(indexKey);
  const list: ProjectSummary[] = raw ? (JSON.parse(raw) as unknown as ProjectSummary[]) : [];
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    status: project.status,
    updatedAt: project.updatedAt,
    entryBytes: new Blob([project.files[ENTRY_FILE_PATH]?.content ?? '']).size,
  };
  const next = [summary, ...list.filter((item) => item.id !== project.id)].slice(0, 50);
  const envelope: StorageEnvelope<ProjectSummary[]> = { schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: new Date().toISOString(), data: next };
  localStorage.setItem(indexKey, JSON.stringify(envelope));
}
```

配套约定：写入做 800 ms 防抖合并；`visibilitychange` 进入 hidden 与 `beforeunload` 时强制 flush；流式生成期间不落盘，流结束才写，避免半截消息持久化。iOS 隐私模式下 `setItem` 一律抛错，`saveProject` 的 L4 分支天然覆盖该场景。

---

## 5. 数据迁移策略

### 5.1 schemaVersion 设计

- 版本字段只存在于 `StorageEnvelope.schemaVersion` 一层。payload（Project 等）不自报版本，杜绝双真源漂移。
- `CURRENT_SCHEMA_VERSION = 1` 与代码同版本发布。读取时：等于当前版本直接通过校验使用；小于则跑迁移链；大于则**原样保留、绝不写入、绝不猜测性降级**，UI 提示「数据来自更新版本的应用」。
- key 前缀 `atoms:v1:` 中的 v1 是格式代际，仅当值形态变化无法表达为数据变换（比如整库换 key 组织方式）时才 bump。常规演进全部走 schemaVersion 迁移链，避免前缀代际频繁膨胀。

### 5.2 迁移函数链模式

链式逐级升级：v1 到 v2、v2 到 v3，逐跳执行，任何一跳失败整体失败并进入隔离备份流程，不做跳版本合并。

```typescript
// src/services/storage/migrations.ts
import { CURRENT_SCHEMA_VERSION, type MigrationFn, type MigrationResult, type StorageEnvelope } from '../../types/storage';
import { isProject } from '../../types/project';

/**
 * 迁移注册表：键为源版本号，函数把该版本 payload 升级到下一版本。
 * v1 是首个正式版本，当前为空表；发 v2 时追加 `1: promoteV1ToV2`。
 */
const MIGRATIONS: Readonly<Record<number, MigrationFn>> = {
  // 1: promoteV1ToV2,   // v1 -> v2（示例见下，尚未启用）
};

export function runMigrations(envelope: StorageEnvelope<unknown>): MigrationResult<unknown> {
  if (envelope.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, reason: 'future-version' };
  }
  let version = envelope.schemaVersion;
  let data: unknown = envelope.data;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step: MigrationFn | undefined = MIGRATIONS[version];
    if (!step) return { ok: false, reason: 'chain-gap' };
    try {
      data = step(data);
    } catch {
      return { ok: false, reason: 'step-threw' };
    }
    version += 1;
  }
  if (!isProject(data)) return { ok: false, reason: 'validate-failed' };
  return { ok: true, envelope: { schemaVersion: version, savedAt: new Date().toISOString(), data } };
}

// ---- 示例（演示链模式用，当前未注册）----
// v2 需求：Project.preview 增加必填的 sizeMode。迁移给旧数据补默认值，缺字段的前端因此不会崩。
// function promoteV1ToV2(data: unknown): unknown {
//   if (typeof data !== 'object' || data === null) return data;
//   const record = data as Record<string, unknown>;
//   const preview = typeof record.preview === 'object' && record.preview !== null ? record.preview as Record<string, unknown> : {};
//   return { ...record, preview: { sizeMode: 'autoHeight', extraSandboxFlags: [], ...preview } };
// }
```

### 5.3 损坏数据恢复流程

原则：先备份、再重建、可追溯，绝不静默丢弃。

```
读取 key
  ├─ getItem 为 null ............... 视为空，正常初始化
  ├─ JSON.parse 抛错 ............... 隔离备份 + 返回空，UI 提示「检测到损坏数据已备份」
  ├─ 信封结构不合法 ................ 同上
  ├─ schemaVersion 大于当前 ........ 原样保留，不读写 data，提示升级应用
  ├─ 迁移链失败 .................... 隔离备份（记录失败跳数）+ 返回空
  ├─ 校验失败（isProject 不过）..... 隔离备份 + 返回空
  └─ 通过 .......................... 正常返回
```

隔离备份写入 `atoms:v1:backup:<keyhash>`，值结构 `{ meta: QuarantineMeta, raw: string }`，`raw` 是损坏前的原始字符串原文。用户可在设置页查看备份并选择导出（延展能力入口）。

```typescript
// src/services/storage/readEnvelope.ts（读取主路径）
import { CURRENT_SCHEMA_VERSION, isStorageEnvelope, storageKey, type StorageEnvelope } from '../../types/storage';
import { isProject, type Project } from '../../types/project';
import { runMigrations } from './migrations';

export type ReadOutcome =
  | { status: 'ok' | 'empty' | 'future' | 'quarantined'; envelope?: StorageEnvelope<Project> }
  | { status: 'migrated'; envelope: StorageEnvelope<Project> };

export function readProject(projectId: string): ReadOutcome {
  const key = storageKey('projects', projectId);
  const raw = localStorage.getItem(key);
  if (raw === null) return { status: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { status: 'quarantined', ...quarantine(key, raw, 'json-parse-failed') };
  }
  if (!isStorageEnvelope(parsed)) {
    return { status: 'quarantined', ...quarantine(key, raw, 'envelope-shape-invalid') };
  }
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { status: 'future' }; // 未来版本：不碰、不备份、不覆盖
  }
  if (parsed.schemaVersion < CURRENT_SCHEMA_VERSION) {
    quarantine(key, raw, `pre-migration-${parsed.schemaVersion}`); // 迁移前快照，失败可人工回捞
    const result = runMigrations(parsed);
    if (!result.ok || !result.envelope) {
      return { status: 'quarantined', ...quarantine(key, raw, `migration-${result.reason ?? 'unknown'}`) };
    }
    localStorage.setItem(key, JSON.stringify(result.envelope)); // 回写升级后的数据
    return { status: 'migrated', envelope: result.envelope };
  }
  if (!isProject(parsed.data)) {
    return { status: 'quarantined', ...quarantine(key, raw, 'payload-validation-failed') };
  }
  return { status: 'ok', envelope: parsed as StorageEnvelope<Project> };
}

function quarantine(key: string, raw: string, reason: string): { envelope: undefined } {
  const backupKey = storageKey('backup', simpleHash(key));
  localStorage.setItem(backupKey, JSON.stringify({
    meta: { originalKey: key, reason, quarantinedAt: new Date().toISOString() },
    raw,
  }));
  localStorage.removeItem(key); // 主位重建为空，应用可继续使用
  return { envelope: undefined };
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
```

### 5.4 回滚策略

- 迁移只向前，不提供自动降级。`schemaVersion` 永不减号。
- 用户把应用降级到旧版本时：旧代码读到更高版本数据走 `future` 分支，数据原样留在 localStorage，不会被旧代码写入破坏；用户升级回新版即恢复。
- 迁移前快照（5.3 的 `pre-migration-*` 备份）是人工回滚通道：迁移缺陷被发现后，可从备份区把原始字符串写回主 key 再修复迁移函数重跑。

### 5.5 迁移链的测试方式（契约声明）

测试框架 vitest，位于 `src/services/storage/__tests__/migrations.test.ts`：

1. **固定夹具逐版本验证**：`__fixtures__/v1/project-full.json`、`project-minimal.json` 等手工构造的旧版本数据，逐个跑 `runMigrations`，断言输出 `schemaVersion === CURRENT_SCHEMA_VERSION` 且 `isProject` 通过、关键字段语义正确。
2. **链完整性**：夹具版本从 1 遍历到 `CURRENT_SCHEMA_VERSION - 1`，断言每一跳在注册表中有对应函数（防 chain-gap 回归）。
3. **破坏性用例**：截断的 JSON、信封缺字段、payload 类型错误、版本号 999，断言全部走 quarantine 且 `raw` 与原文逐字节一致。
4. **幂等性**：对已是当前版本的数据重复调用 `runMigrations` 为无操作（空表时直接通过校验返回原 data）。
5. **未来版本保护**：schemaVersion 高于当前的数据读取后 localStorage 原文不变。

---

## 6. 安全分析：生成代码可能从哪里逃逸，每一处怎么堵

### 6.1 威胁面清单（逐条对应铁律）

| 编号 | 威胁面 | 攻击方式 | 堵法 | 铁律对应 |
|---|---|---|---|---|
| T1 | iframe 缺 sandbox 属性 | srcdoc 文档默认与父页面同源，漏写 sandbox 等于完全逃逸：读写主应用 localStorage、操纵父 DOM | iframe 只能经 `SandboxFrame` 组件创建，sandbox 属性硬编码在组件 JSX 中，不暴露 props；配合单测断言组件渲染产物含 `sandbox="allow-scripts"` | 铁律 1（必须沙箱执行） |
| T2 | allow-same-origin 组合逃逸 | `allow-scripts + allow-same-origin` 同用时规范规定整组 sandbox 失效，回到 T1 的完全同源 | 类型层写不出该标志（联合类型无此成员）；`buildSandboxAttribute` 运行时断言抛错；单测断言任何合法输出不含该串 | 铁律 2（绝不与 allow-same-origin 同用） |
| T3 | 主文档 eval / new Function | 绕过 iframe 通道直接在主文档执行生成代码，sandbox 形同虚设 | 架构约束：生成代码只有一条执行路径（srcdoc 组装），代码评审 checklist 明确主文档禁 eval、禁 new Function、禁 setTimeout 字符串参数；后续主应用 CSP 可加 `script-src` 无 unsafe-eval 收紧 | 铁律 1（禁止 eval / new Function） |
| T4 | 生成内容注入主文档 DOM | 对话面板、控制台视图若用 innerHTML 渲染访客消息，一个 `<img onerror>` 就是主文档 XSS | host 侧 UI 一律 React 文本渲染（默认转义），禁 `dangerouslySetInnerHTML` 接触任何 `GuestToHostMessage` 字段；协议解析器已把消息收敛为强类型白名单结构，UI 拿不到原始字符串对象 | 铁律 5（视为不可信输入，不做字符串拼接进 HTML） |
| T5 | postMessage 伪造与注入 | 生成代码向 parent 发伪造消息：谎报尺寸撑爆布局、伪造错误文本钓鱼、用 reload 类型攻击 | 三层校验（3.3 节）：`event.source` 身份比对、origin 特征校验（host 侧验 `"null"`）、`parseSandboxMessage` 白名单加形状校验；方向由接收方白名单决定，guest 发 reload/readyAck 直接丢弃；resize 高度在 host 侧做上限 clamp | 铁律 3（校验 event.source 与来源 iframe，未识别来源丢弃） |
| T6 | 网络外逃（数据外传） | 生成代码 fetch / img beacon 向任意外域回传信息 | meta CSP：`connect-src 'none'`、`script-src` 白名单、`img-src` 限 data/blob/https 图片（见残余风险 R1）；组装器静态扫描白名单外引用，违规直接拒绝装载并回传 AI 层修正 | 铁律 4（CDN 白名单） |
| T7 | 恶意 CDN 脚本 | 生成代码引用攻击者控制的脚本源 | `script-src 'unsafe-inline' https://cdn.jsdelivr.net` 在浏览器层强制；白名单是常量 `DEFAULT_CDN_HOSTS`，扩充需改代码过评审；静态扫描提前拦截给 AI 层反馈 | 铁律 4 |
| T8 | shim 注入值逃逸 | sessionId/hostOrigin 拼进脚本字符串时未转义，携带 `</script>` 可提前闭合标签注入 | 注入前断言值不含 `<`、`>`、`&`，宿主侧值（UUID、自家 origin）本身可控；srcdoc 用 DOM 属性赋值而非字符串拼属性 | 铁律 5 |
| T9 | 顶部导航与弹窗劫持 | `top.location = ...` 拖走父页面、window.open 钓鱼 | sandbox 不含 `allow-top-navigation`、`allow-popups`，且这两个标志不在 `SandboxAllowFlag` 类型中，类型层不可表达 | 铁律 2（最小化） |
| T10 | 存储与 Cookie 窃取 | 生成代码读 localStorage / document.cookie | 无 `allow-same-origin` 时访客 origin 不透明，访问 localStorage、indexedDB、cookie 直接抛 SecurityError，浏览器层兜底，无需应用层代码 | 铁律 2（最小化） |
| T11 | 旧会话消息串扰 | 上一个预览会话的迟到消息影响新会话状态 | 每次重装 srcdoc 换新 sessionId，收发双方都做 sessionId 等值过滤 | 铁律 3 |
| T12 | 访客内 eval | 生成代码自身用 eval 动态拼代码 | `buildPreviewCsp` 的 script-src 不含 `unsafe-eval`，meta CSP 在访客内同样拦截 eval 与 new Function，白赚一层 | 铁律 1 |
| T13 | 自导航毁页 | 生成代码 `location.href = ...` 把 iframe 自己导航走 | 沙箱内自导航只毁掉自己的预览（用户可见、可刷新恢复），无法波及父页面；宿主监听 ready 超时给出「重新载入」入口 | 铁律 2（最小化的自然结果） |

### 6.2 直接回答：生成代码可能从哪里逃逸，方案为什么堵住了

可能逃逸的通道在浏览器安全模型里只有四类，逐一封死：

1. **同源能力通道**（DOM、localStorage、cookie）：被 `sandbox="allow-scripts"`（不含 allow-same-origin）收敛为不透明 origin，访问即抛 SecurityError。T1、T2、T10 从组件硬编码、类型系统、运行时断言、单测四层保证属性不可能出错。
2. **postMessage 通道**：这是沙箱唯一被允许的对外声道，攻击者必然尝试滥用。所有入站消息过 `parseSandboxMessage` 单点校验（身份、origin 特征、协议版本、会话、类型白名单、payload 形状），未识别来源静默丢弃；出站到访客的消息同样带校验。能落到 UI 的数据是强类型且以文本渲染的。
3. **网络通道**：CSP 把脚本源锁死在白名单 CDN，connect-src 直接归零，外传数据的通路被浏览器层切断，不依赖生成代码自觉。
4. **执行通道**：主文档无 eval、无 new Function、生成代码只有 srcdoc 一条装载路径；srcdoc 本身以 DOM 属性赋值装载，注入值有字符断言。访客内 eval 亦被 CSP 拦截。

结论：在四条通道全部收口之后，生成代码的可达范围只剩「自己那个不透明 origin 的 iframe 内部」加「白名单 CDN 的只读资源」。剩余风险见 6.3。

### 6.3 残余风险（明确接受或后续收敛）

| 编号 | 风险 | 现状决策 |
|---|---|---|
| R1 | 图片像素外传：`img-src https:` 允许把信息编码进图片 URL 发往外域 | Demo 阶段接受（保真度优先，生成应用常用外链图片）。收敛路径：把 img-src 收窄为白名单图床 |
| R2 | 计算资源耗尽：死循环或巨 DOM 卡死预览 | 接受。iframe 卸载即终止执行，宿主提供「停止预览」按钮；无跨 iframe CPU 限额是平台限制 |
| R3 | CDN 供应链：jsdelivr 本身被投毒 | 接受（与全网引用同一风险面）。后续可锁定具体版本号 URL |
| R4 | CSS 取色侧信道 | Demo 数据不含敏感信息，接受 |

### 6.4 安全回归测试清单（交付 reality-checker 执行）

1. 渲染 `SandboxFrame` 后断言 DOM 中 iframe 的 sandbox 属性恰为 `allow-scripts`（或加白名单扩展标志），绝不含 allow-same-origin。
2. 用 `contentWindow.postMessage` 模拟 guest 发送：伪造类型 reload、错 sessionId、缺 payload 字段、超类型 union 的数据，断言宿主 `onGuestMessage` 零调用。
3. `event.source` 指向其他 iframe 时断言零调用。
4. 组装含 `https://evil.example/x.js` 引用的 HTML，断言 assemblePreviewDocument 抛错且错误信息含该主机名。
5. 断言 `buildPreviewCsp` 输出含 `connect-src 'none'`、不含 `unsafe-eval`。

---

## 7. 附则

### 7.1 协作 Handoff

| 接收方 | 需要遵守的约定 |
|---|---|
| dev-litpp-frontend-developer | iframe 一律经 `SandboxFrame`；消息一律过 `parseSandboxMessage`；控制台/对话渲染走文本节点；quota L4 提示 UI |
| dev-litpp-ai-engineer | 生成 HTML 的外部资源只准引用 `DEFAULT_CDN_HOSTS`；推荐生成代码用 click/input 事件做交互，避免依赖原生表单提交；流式结束后才触发持久化 |
| dev-litpp-data-engineer | 导入导出格式以 `StorageEnvelope<Project>` 为准，导入复用 readProject 的校验与隔离逻辑 |
| dev-litpp-reality-checker | 验证清单见 6.4 与 5.5 |

### 7.2 Supabase 云同步预留（不在本期实现）

云同步层未来只需实现「以 `Project` 为单元的键值读写」：本地为主副本，登录后双写，冲突取 `updatedAt` 新者（last-write-wins），覆盖前把本地快照写入备份区。本期类型已保证 `Project` 自包含可序列化，无需为此改动。

### 7.3 验证要求自证（对照角色契约）

- 沙箱 iframe 实际配置代码：2.2 节 `SandboxFrame` 组件（JSX 属性 `sandbox={buildSandboxAttribute([])}`）与 2.1 决策表。
- 全部对外类型定义及路径：1.4 节盘点表。
- 协议表覆盖握手、数据、错误、尺寸（另含刷新）：3.2 节。
- 迁移链测试方式：5.5 节（固定夹具逐版本跑迁移函数）。
- 逃逸面回答：6.2 节逐通道论证，6.1 节逐威胁对应铁律。

### 7.4 后续展望（非本期承诺）

Web Worker 承载执行以获得可终止性（解决 R2）；img-src 收窄（解决 R1）；CSP 以响应头下发替代 meta（需自有服务端，当前 Demo 无服务端，维持 meta 方案）。
