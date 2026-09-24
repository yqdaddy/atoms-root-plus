/**
 * 沙箱配置、postMessage 协议与消息校验。
 * 协议版本号：收发双方不一致时直接丢弃消息。
 */
import type { SandboxAllowFlag } from './project';

export const SANDBOX_PROTOCOL_VERSION = 1 as const;

/**
 * 允许生成代码引用的外部 CDN 主机白名单（铁律 4）。
 * 平台自身运行时已切换为同源 /vendor/ 路径（经 buildPreviewCsp 的 selfOrigin 放行，
 * 不在本表）；本表仅覆盖生成应用可能引用的外部资源（图表库 jsdelivr）与
 * 存量项目的 tailwind CDN 引用（兼容，不再主动指引使用）。
 */
export const DEFAULT_CDN_HOSTS: readonly string[] = [
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',  // Tailwind CSS CDN（仅存量项目兼容；生成指引已改手写 CSS）
];

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
        const errorPayload: ErrorMessage['payload'] = {
          level: payload.level,
          message: payload.message,
          source: payload.source,
          lineno: payload.lineno,
          colno: payload.colno,
        };
        if (payload.stack !== undefined) {
          errorPayload.stack = payload.stack;
        }
        return {
          ...base,
          type: 'error',
          payload: errorPayload,
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

/**
 * 从 preview CSP 构造 meta 标签内容。
 * 默认不含 unsafe-eval（等于在访客内禁了 eval/new Function）。
 * React CDN 模式需要 evalAllowed=true：Sucrase 编译产物经 new Function 执行。
 * unsafe-eval 的风险由 iframe sandbox（无 allow-same-origin）隔离缓解。
 *
 * selfOrigin：宿主页面的同源源表达式（如 http://localhost:5173）。
 * 本地 vendor 运行时（/vendor/*.js）在 srcdoc 文档中以宿主页面为 base URL
 * 解析为 selfOrigin 下的 URL，必须显式加入 script-src 才能加载
 * （srcdoc 文档为 opaque origin，'self' 关键字不可依赖，故由调用方显式传入）。
 */
export function buildPreviewCsp(
  cdnHosts: readonly string[],
  evalAllowed: boolean = false,
  selfOrigin?: string,
): string {
  const scriptSrcParts = ["'unsafe-inline'", ...cdnHosts.map((host) => `https://${host}`)];
  if (selfOrigin && selfOrigin.length > 0) {
    scriptSrcParts.push(selfOrigin);
  }
  if (evalAllowed) {
    scriptSrcParts.push("'unsafe-eval'");
  }
  const scriptSrc = scriptSrcParts.join(' ');
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