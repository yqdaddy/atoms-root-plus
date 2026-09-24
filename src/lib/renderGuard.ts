/**
 * 渲染防护工具（MAJOR-D1 前端兜底）。
 *
 * 背景：一条畸形或超大 payload 的聊天消息曾让渲染组件崩溃（PriorityBadge
 * 读取畸形 priority 抛 TypeError），并可能拖垮整个对话面板。本模块提供
 * 渲染前的量化防护：超长文本截断、超大 JSON 跳过解析、列表条目截断。
 *
 * 与 MessageErrorBoundary 的分工：防护层降低崩溃与卡顿概率，边界层保证
 * 崩溃不外溢到对话面板。两层独立生效，缺一不可。
 */

/** 大 JSON 输入阈值（字符数）：超过则不做 JSON.parse 与结构化渲染 */
export const LARGE_JSON_THRESHOLD = 50_000;

/** 正则高亮跳过阈值（字符数）：超过则仅转义、不做关键词高亮 */
export const HIGHLIGHT_SKIP_THRESHOLD = 20_000;

/** 单次渲染的原始文本上限（字符数）：超过则截断渲染 */
export const RAW_TEXT_RENDER_LIMIT = 100_000;

/** 折叠视图默认预览长度（字符数） */
export const COLLAPSED_PREVIEW_LENGTH = 2_000;

/** 结构化卡片单列表最大渲染条目数 */
export const MAX_LIST_ITEMS = 50;

/** 文本截断结果 */
export interface ClampedText {
  /** 可安全渲染的文本片段 */
  text: string;
  /** 原文本是否被截断 */
  clipped: boolean;
}

/**
 * 截断文本到可安全渲染的长度。
 * 超限时返回新字符串（slice），不修改原文本，返回值可直接交给 React 渲染。
 */
export function clampRenderText(
  text: string,
  limit: number = RAW_TEXT_RENDER_LIMIT,
): ClampedText {
  if (text.length <= limit) {
    return { text, clipped: false };
  }
  return { text: text.slice(0, limit), clipped: true };
}

/** 列表条目截断结果 */
export interface LimitedItems<T> {
  /** 可安全渲染的条目 */
  items: T[];
  /** 被隐藏的条目数量（仅计数，不渲染） */
  hiddenCount: number;
}

/**
 * 截断列表条目：最多渲染 max 条，隐藏部分仅计数。
 * 非数组输入返回空列表（渲染层防御字段类型错乱）。
 */
export function limitItems<T>(
  items: T[] | undefined | null,
  max: number = MAX_LIST_ITEMS,
): LimitedItems<T> {
  if (!Array.isArray(items)) {
    return { items: [], hiddenCount: 0 };
  }
  if (items.length <= max) {
    return { items, hiddenCount: 0 };
  }
  return { items: items.slice(0, max), hiddenCount: items.length - max };
}

/**
 * 判断文本是否超过大 JSON 阈值。
 * 超过时调用方应跳过 JSON.parse 与结构化渲染，直接走折叠文本视图。
 */
export function isOversizedJson(text: string): boolean {
  return text.length > LARGE_JSON_THRESHOLD;
}
