/**
 * 聊天交付内容安全化（MAJOR-D1 服务端半边）。
 *
 * 缺陷背景（evidence/combined-regression-20260924/m1/gates-static.txt MAJOR-D1）：
 * 降级交付/策略切换路径曾把工程阶段未围栏的原始 LLM JSON（实测 104,026 字符）
 * 经 delta 流累积并整段持久化为 assistant 聊天消息，对话面板直接裸渲染。
 *
 * 本模块是"交付到聊天记录"这段的唯一出口约定：凡工程阶段产物要作为
 * assistant 消息内容出站（delta 文本或 done.analysis），只允许两种形态：
 * 1. 可解析出结构化载荷（files / changes）→ 人话摘要（说明结果与文件清单），
 *    不粘贴原始 JSON；
 * 2. 不可解析 → 代码围栏（```json）包裹 + 长度截断 + 一句简短说明。
 * 纯文本对话内容（非 JSON、非代码）原样放行。
 *
 * 数据契约（纯函数，无副作用，不发起任何 IO）：
 * - looksLikeBareJson(text)          判定"未围栏裸 JSON"
 * - sanitizeEngineerChatContent(raw) 工程阶段原始文本 → 可入库的聊天内容
 * - buildDeliverySummary(input)      交付摘要（是否重试/策略切换 + 文件清单）
 */

import { parseOutput, stripMarkdownFence } from '../multiFileParser.js';

/** 长度阈值：去围栏后达到此长度、且以 { 或 [ 开头的文本判定为"大段裸 JSON"。
 *  小片段 JSON（如行内示例）渲染无风险，不在此列。 */
export const BARE_JSON_LENGTH_THRESHOLD = 200;

/** 围栏兜底路径的最大保留字符数：责任裁定含"未截断"，超长载荷必须截断。 */
export const FENCED_PAYLOAD_MAX_CHARS = 4000;

/** 交付摘要中文件清单的最大罗列数，超出部分聚合为"等 N 个文件"。 */
export const SUMMARY_MAX_LISTED_FILES = 6;

/**
 * 判定文本是否为"未围栏裸 JSON"。
 * 启发式（与验证裁定一致）：剥离成对 markdown 代码围栏后 trim，
 * 以 { 或 [ 开头且长度达到阈值即判定成立。
 * 细化：[ 开头仅当形如 JSON 数组（以 [{ 起始）才判定，用于排除管线自身
 * 的方括号进度标记（如 [自动重试中]）等散文文本，避免误报。
 * 注意：整条消息只有一个围栏代码块、没有任何说明文字的形态同样命中
 * （剥离围栏后即裸 JSON），因为约定要求围栏必须伴随一句简短说明。
 */
export function looksLikeBareJson(
  text: string,
  threshold: number = BARE_JSON_LENGTH_THRESHOLD,
): boolean {
  const stripped = stripMarkdownFence(text ?? '').trim();
  if (stripped.length < threshold) return false;
  if (stripped.startsWith('{')) return true;
  return stripped.startsWith('[{');
}

/** 截断超长文本并追加截断标记。 */
function truncateWithMarker(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars)}\n...(原始输出过长，已截断 ${body.length - maxChars} 字符)`;
}

/**
 * 工程阶段原始输出 → 可安全入库的聊天内容。
 *
 * 处理顺序：
 * 1. 可解析出 files 载荷 → 返回不粘贴原始 JSON 的摘要；
 * 2. 命中"大段裸 JSON"启发式（不可解析但确实是 JSON）→ 围栏 + 截断 + 说明；
 * 3. 其余（对话文本、短片段）原样放行。
 */
export function sanitizeEngineerChatContent(raw: string): string {
  const text = raw ?? '';
  if (text.trim().length === 0) return text;

  // 1) 可解析出结构化载荷：交付人话摘要，绝不回贴原始 JSON
  try {
    const parsed = parseOutput(text);
    if (parsed.type === 'files' && parsed.files && parsed.files.length > 0) {
      const paths = parsed.files.map((f) => f.path);
      const listed = paths.slice(0, SUMMARY_MAX_LISTED_FILES).join('、');
      const more = paths.length > SUMMARY_MAX_LISTED_FILES ? ` 等 ${paths.length} 个文件` : '';
      return `（模型本次返回的是 ${paths.length} 个文件的项目数据：${listed}${more}；该输出未被按项目交付，如需生成请重试。）`;
    }
  } catch {
    // 不可解析，继续走围栏兜底判定
  }

  // 2) 不可解析的大段 JSON：围栏 + 截断（超长时）+ 一句说明
  if (looksLikeBareJson(text)) {
    const body = stripMarkdownFence(text).trim();
    const truncated = body.length > FENCED_PAYLOAD_MAX_CHARS;
    const fencedBody = truncateWithMarker(body, FENCED_PAYLOAD_MAX_CHARS);
    const intro = truncated ? '（超长已截断）' : '';
    return `说明：模型输出无法解析为有效的项目结构，原始 JSON 以代码围栏保留如下${intro}：\n\`\`\`json\n${fencedBody}\n\`\`\``;
  }

  // 3) 对话文本 / 短片段：原样放行
  return text;
}

/** 交付摘要输入（数据契约：调用方只传本次交付的确定事实）。 */
export interface DeliverySummaryInput {
  /** 交付模式：create 全量生成 / diff 增量修改 */
  mode: 'create' | 'diff';
  /** 交付的全量文件路径（finalFiles 的键） */
  deliveredFilePaths: string[];
  /** diff 模式：本轮实际变更的文件路径（changeList 声明） */
  changedFilePaths?: string[];
  /** diff 模式：实际应用的编辑处数 */
  appliedEdits?: number;
  /** diff 模式：模型给出的变更摘要 */
  changeSummary?: string;
  /** 工程师阶段实际消耗的重试次数（0 表示首试成功） */
  retriesUsed: number;
  /** 达到此重试次数即代表发生过策略切换 */
  strategySwitchRetries: number;
}

/**
 * 组装交付摘要（人话）：说明已生成本次结果、是否经历重试/策略切换、包含哪些文件。
 * 供交付时以 delta 文本落入聊天记录，替代被抑制的原始 JSON 流。
 */
export function buildDeliverySummary(input: DeliverySummaryInput): string {
  const {
    mode,
    deliveredFilePaths,
    changedFilePaths,
    appliedEdits,
    changeSummary,
    retriesUsed,
    strategySwitchRetries,
  } = input;

  // 重试与策略切换事实（只陈述，不渲染技术细节）
  let retryContext = '';
  if (retriesUsed >= strategySwitchRetries && retriesUsed > 0) {
    retryContext = `（经 ${retriesUsed} 次自动重试并切换完整重生成策略）`;
  } else if (retriesUsed > 0) {
    retryContext = `（经 ${retriesUsed} 次自动重试）`;
  }

  if (mode === 'diff') {
    const changed = changedFilePaths ?? [];
    const listed = changed.slice(0, SUMMARY_MAX_LISTED_FILES).join('、');
    const more = changed.length > SUMMARY_MAX_LISTED_FILES ? ` 等 ${changed.length} 个文件` : '';
    const editPart = typeof appliedEdits === 'number' ? `已应用 ${appliedEdits} 处修改` : '已完成增量修改';
    const filePart = changed.length > 0 ? `，涉及 ${listed}${more}` : '';
    const summaryPart = changeSummary ? `；${changeSummary}` : '';
    return `\n${editPart}${filePart}${summaryPart}${retryContext}。\n`;
  }

  const total = deliveredFilePaths.length;
  const listed = deliveredFilePaths.slice(0, SUMMARY_MAX_LISTED_FILES).join('、');
  const more = total > SUMMARY_MAX_LISTED_FILES ? ` 等 ${total} 个文件` : '';
  return `\n已生成完整项目，共 ${total} 个文件：${listed}${more}${retryContext}。\n`;
}
