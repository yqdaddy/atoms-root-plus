/**
 * 需求覆盖核对：对照分析师产出的功能清单逐项核对生成结果是否覆盖。
 *
 * 设计要点：
 * 1. 清单来源：分析师 JSON 的 features 数组（id/name/description/priority），
 *    解析失败时回退 raw 文本拆行（纯函数容错，绝不让核对阻塞交付）。
 * 2. 核对策略（启发式、零 LLM 成本）：从每条需求的 name+description 提炼
 *    特征信号（功能名关键词 + 领域动作词），在生成代码（HTML+JS）中检索；
 *    must 与 nice 分开统计，未覆盖 must 优先提醒。
 * 3. 交付铁律：核对结果只影响提醒文案与 done 事件负载，不拦截交付
 *    （防止误报把合格产物变成 error）。
 */

import type { FileLanguage } from '../multiFileParser.js';

/** 需求条目（分析师 features 数组的标准形态，字段缺失容忍） */
export interface RequirementItem {
  id: string;
  name: string;
  description: string;
  priority: 'must' | 'nice' | string;
}

/** 单条需求的覆盖判定结果 */
export interface RequirementCoverageEntry {
  id: string;
  name: string;
  priority: string;
  /** 是否被判定为已覆盖 */
  covered: boolean;
  /** 命中的信号词（covered=true 时非空，供调试与前端展示） */
  matchedSignals: string[];
}

/** 覆盖核对报告 */
export interface RequirementCoverageReport {
  /** 需求总条数（参与核对的 must+nice） */
  total: number;
  /** 已覆盖条数 */
  coveredCount: number;
  /** 未覆盖条目 */
  uncovered: RequirementCoverageEntry[];
  /** 全部条目的逐项结果 */
  entries: RequirementCoverageEntry[];
}

/** 生成代码文件集合（与 llm.ts 的 finalFiles 形态一致） */
export type GeneratedFiles = Record<string, { path: string; content: string; language: FileLanguage }>;

/**
 * 从分析师产出中提取需求条目。
 * 输入为 generateWithStages 解析后的 features（unknown 容错）：
 * - 对象含 features 数组 → 逐项归一化（id 缺失自动编号，name/description 缺失给空串）
 * - 对象含 raw 字符串 → 按行拆分，滤掉空行与标题行，每行作为一条需求
 * - 其余形态 → 空数组（无从核对时覆盖检查静默跳过）
 */
export function extractRequirementItems(features: unknown): RequirementItem[] {
  if (!features || typeof features !== 'object') return [];
  const obj = features as Record<string, unknown>;

  if (Array.isArray(obj.features)) {
    return obj.features
      .filter((f): f is Record<string, unknown> => f != null && typeof f === 'object')
      .map((f, i) => ({
        id: typeof f.id === 'string' && f.id.trim() ? f.id.trim() : `F${i + 1}`,
        name: typeof f.name === 'string' ? f.name.trim() : '',
        description: typeof f.description === 'string' ? f.description.trim() : '',
        priority: typeof f.priority === 'string' ? f.priority : 'nice',
      }))
      .filter((f) => f.name.length > 0 || f.description.length > 0);
  }

  if (typeof obj.raw === 'string') {
    return obj.raw
      .split('\n')
      .map((line) => line.replace(/^\s*[-*\d.、)]*\s*/, '').trim())
      .filter((line) => line.length >= 4 && !/^[#【[]/.test(line))
      .slice(0, 12)
      .map((line, i) => ({
        id: `R${i + 1}`,
        name: line.slice(0, 30),
        description: line,
        priority: 'nice',
      }));
  }

  return [];
}

/**
 * 从需求文本提炼检索信号词。
 *
 * 策略（按优先级取用，全部去重）：
 * 1. 引号/书名号内的显式命名（"记为 X"、《X》）
 * 2. 领域动作词组（增删改查、拖拽、导出等），命中即作为强信号
 * 3. 英文/数字技术词（localStorage、Chart 等）原样作为信号
 * 4. 中文功能名按 2-6 字滑窗抽取候选词（过滤通用词）
 *
 * 返回至多 5 个信号词，供 checkItemCoverage 在代码中检索。
 */
export function extractCoverageSignals(item: RequirementItem): string[] {
  const text = `${item.name} ${item.description}`.trim();
  if (!text) return [];
  const signals = new Set<string>();

  // 1. 显式命名（引号 / 书名号）
  const quoted = text.match(/[“"『「《]([^”"』」》]{1,12})[”"』」》]/g) || [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).trim();
    if (inner.length >= 2 && !STOPWORDS.has(inner)) signals.add(inner);
  }

  // 2. 领域动作词组
  for (const [keyword] of ACTION_KEYWORDS) {
    if (text.includes(keyword)) signals.add(keyword);
  }

  // 3. 英文/数字技术词
  const techWords = text.match(/[A-Za-z][A-Za-z0-9_.]{2,}/g) || [];
  for (const w of techWords) {
    const lower = w.toLowerCase();
    if (!TECH_IGNORE.has(lower)) signals.add(w);
  }

  // 4. 中文滑窗（仅当信号不足时补充）
  if (signals.size < 3) {
    const chinese = item.name.replace(/[^一-龥]/g, '');
    for (let len = Math.min(4, chinese.length); len >= 2 && signals.size < 5; len--) {
      for (let i = 0; i + len <= chinese.length && signals.size < 5; i++) {
        const sub = chinese.slice(i, i + len);
        if (!STOPWORDS.has(sub) && !GENERIC_NAME_WORDS.has(sub)) signals.add(sub);
      }
    }
  }

  return Array.from(signals).slice(0, 5);
}

/** 通用停用词（出现在需求里但检索代码无意义） */
const STOPWORDS = new Set([
  '功能', '支持', '实现', '需要', '可以', '能够', '用户', '点击', '显示', '展示',
  '进行', '使用', '并且', '然后', '以及', '或者', '同时', '的时候', '情况下',
]);

/** 需求名中的通用词（滑窗候选时排除，如"清单""管理"单独出现无区分度） */
const GENERIC_NAME_WORDS = new Set(['应用', '页面', '管理', '清单', '系统', '模块', '视图']);

/** 技术词忽略（大小写归一后） */
const TECH_IGNORE = new Set(['the', 'and', 'for', 'with', 'api']);

/**
 * 领域动作关键词 → 代码侧检索线索。
 * key 为需求文本中的动作词，value 为代码中常见的实现痕迹
 * （标识符 / 方法名 / 注释都可能命中）。
 */
const ACTION_KEYWORDS: Array<[string, string[]]> = [
  ['添加', ['add', 'submit', 'handleAdd', 'insert']],
  ['删除', ['delete', 'remove', 'handleDelete']],
  ['编辑', ['edit', 'update', 'modify']],
  ['筛选', ['filter', 'filterBy', 'setFilter']],
  ['搜索', ['search', 'query', 'handleSearch']],
  ['排序', ['sort', 'sortBy']],
  ['导出', ['export', 'download', 'toCSV', 'toJSON']],
  ['导入', ['import', 'parse', 'readFile']],
  ['复制', ['copy', 'clipboard', 'execCommand']],
  ['重置', ['reset', 'clear']],
  ['撤销', ['undo', 'history']],
  ['拖拽', ['drag', 'drop', 'draggable']],
  ['持久化', ['localStorage', 'sessionStorage', 'save', 'load']],
  ['确认', ['confirm', 'dialog']],
  ['动画', ['animate', 'transition', 'animation', 'transform']],
  ['统计', ['count', 'total', 'stat', 'sum']],
  ['分页', ['page', 'pagination']],
  ['登录', ['login', 'auth', 'signin']],
  ['主题', ['theme', 'dark', 'light']],
  ['全屏', ['fullscreen', 'requestFullscreen']],
  ['撤销重做', ['undo', 'redo']],
  ['播放', ['play', 'pause']],
  ['暂停', ['pause']],
  ['倒计时', ['countdown', 'timer']],
  ['最高分', ['highScore', 'bestScore', 'maxScore']],
  ['游戏结束', ['gameOver', 'game-end', 'endGame']],
  ['重新开始', ['restart', 'replay', 'resetGame']],
];

/**
 * 核对单条需求是否在生成代码中被覆盖。
 *
 * 判定口径（信号词任一命中即算覆盖）：
 * - 动作词组：需求命中动作词时，优先在代码中检索该动作的实现痕迹
 *   （英文标识符），同时检索需求原文其余信号词，任一命中即覆盖
 * - 其余信号词直接在合并代码文本中检索（大小写不敏感）
 *
 * 纯函数，可离线测试。
 */
export function checkItemCoverage(item: RequirementItem, codeText: string): RequirementCoverageEntry {
  const signals = extractCoverageSignals(item);
  const matched: string[] = [];
  const lowerCode = codeText.toLowerCase();

  // 动作词组检索：需求含动作词 → 查代码实现痕迹
  const actionHits: string[] = [];
  for (const [keyword, traces] of ACTION_KEYWORDS) {
    if (!signals.includes(keyword)) continue;
    const codeHit = traces.some((t) => lowerCode.includes(t.toLowerCase()));
    if (codeHit) actionHits.push(keyword);
  }

  for (const s of signals) {
    if (actionHits.includes(s)) {
      matched.push(s);
      continue;
    }
    if (ACTION_KEYWORDS.some(([k]) => k === s)) {
      // 动作词在代码中无实现痕迹 → 不计入命中（避免只凭需求原词误判）
      continue;
    }
    if (lowerCode.includes(s.toLowerCase())) {
      matched.push(s);
    }
  }

  // 动作词需求：至少一个动作有实现痕迹即视为覆盖
  const requiredActions = signals.filter((s) => ACTION_KEYWORDS.some(([k]) => k === s));
  const covered =
    signals.length === 0
      ? true // 无可提炼信号时不误判（宁漏报不误报）
      : requiredActions.length > 0
        ? actionHits.length > 0
        : matched.length > 0;

  return {
    id: item.id,
    name: item.name || item.description.slice(0, 20),
    priority: item.priority,
    covered,
    matchedSignals: matched,
  };
}

/**
 * 批量核对：对清单逐条执行 checkItemCoverage。
 * codeText 由调用方合并（通常为全部生成文件的 content 拼接）。
 */
export function checkRequirementCoverage(items: RequirementItem[], codeText: string): RequirementCoverageReport {
  const entries = items.map((item) => checkItemCoverage(item, codeText));
  const uncovered = entries.filter((e) => !e.covered);
  return {
    total: entries.length,
    coveredCount: entries.length - uncovered.length,
    uncovered,
    entries,
  };
}

/**
 * 合并生成文件为单一检索文本。
 * 只合并 html/javascript/json/text（css 类名区分度低且易误报，排除），
 * 并剥离 HTML 标签属性中的样式噪声是过度设计，保持原文即可
 * （信号词多为标识符，标签不会造成误命中）。
 */
export function mergeCodeText(files: GeneratedFiles): string {
  return Object.values(files)
    .filter((f) => f.language !== 'css')
    .map((f) => f.content)
    .join('\n');
}

/**
 * 构建覆盖情况的用户通知文案。
 *
 * 规则：
 * - 全覆盖 → 返回 null（不打扰用户）
 * - 部分覆盖 → "已实现 X/Y 项需求，未覆盖：…"；must 未覆盖排最前并标注
 * - 无需求条目 → 返回 null（无从核对）
 */
export function buildCoverageNotice(report: RequirementCoverageReport): string | null {
  if (report.total === 0) return null;
  if (report.uncovered.length === 0) return null;

  const uncoveredDesc = report.uncovered
    .map((e) => (e.priority === 'must' ? `${e.name}（必须）` : e.name))
    .join('、');
  return `已实现 ${report.coveredCount}/${report.total} 项需求，未覆盖：${uncoveredDesc}。可补充说明后重试，或接受当前结果继续迭代。`;
}
