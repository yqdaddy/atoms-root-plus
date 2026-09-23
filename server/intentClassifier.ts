/**
 * 意图识别模块（服务端）。
 * 根据用户输入和项目状态判断用户意图，选择合适的处理流水线。
 *
 * 策略：语义向量相似度优先 → 关键词匹配兜底 → 项目状态推断最终兜底。
 * LLM 分类预留接口（llmClassify 参数），当前默认不启用：
 * 意图识别在生成关键路径上，多一次 LLM 往返会拖慢首字延迟，
 * 向量相似度 + 关键词 + 状态兜底已覆盖绝大多数场景，LLM 分类留给误判率超标后再开。
 *
 * 类型在本文件内定义：tsconfig.server.json rootDir=server，服务端构建
 * 无法引用 src，与 server/prompts.ts 的镜像约定一致。字段与
 * src/types/intent.ts 保持同构，任何一侧变更必须同步另一侧。
 */

/** 意图类型 */
export type IntentType = 'create' | 'modify' | 'analyze' | 'diagnose' | 'conversation';

/** 意图识别结果 */
export interface IntentResult {
  type: IntentType;
  /** 置信度 0-1 */
  confidence: number;
  /** 判断理由（日志与前端提示用） */
  reasoning?: string;
  /** 建议框架：html / react-cdn / vue-cdn */
  suggestedFramework?: 'html' | 'react-cdn' | 'vue-cdn';
}

/** 意图识别上下文 */
export interface IntentContext {
  userPrompt: string;
  hasExistingProject: boolean;
  fileCount: number;
}

/** 意图识别配置 */
export const INTENT_CONFIG = {
  /** 向量相似度置信度阈值：达到即采信向量结果 */
  VECTOR_CONFIDENCE_THRESHOLD: 0.7,
  /** 关键词匹配置信度阈值：达到即采信关键词结果，不再走兜底 */
  KEYWORD_CONFIDENCE_THRESHOLD: 0.8,
  /** 兜底推断的置信度 */
  DEFAULT_CONFIDENCE: 0.5,
  /** 创建关键词：配合空项目状态命中 */
  CREATE_KEYWORDS: ['创建', '做一个', '帮我写', '做一个新', '生成', '实现', '新建', 'create', 'build', 'make'],
  /** 修改关键词：配合已有项目状态命中 */
  MODIFY_KEYWORDS: ['修改', '改一下', '改成', '调整', '优化', '增加', '添加', '删除', '去掉', '换个', 'modify', 'change', 'update', 'edit', 'add', 'remove'],
  /** 分析关键词：只想了解项目，不改动 */
  ANALYZE_KEYWORDS: ['分析', '检查一下', '解释', '说明一下', '介绍一下', '了解一下', '是什么', '了解', '看看', 'analyze', 'explain', 'describe', 'walk me through', 'what is', 'show me'],
  /** 诊断关键词：遇到问题要求定位 */
  DIAGNOSE_KEYWORDS: ['为什么', '报错', '不工作', '不生效', '没反应', '有问题', 'bug', '出错', '修复', '排查', 'why', 'error', 'broken', 'fix', 'debug'],
  /** 对话/闲聊关键词：纯对话、问候、致谢等，无明确任务意图 */
  CONVERSATION_KEYWORDS: ['你好', '您好', '谢谢', '感谢', '再见', '拜拜', '好的', '可以吗', '能不能', '是否', '怎么样', '如何理解', '是什么意思', '帮我看看', 'hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye', 'ok', 'okay', 'yes', 'no'],
  /** React 框架关键词 */
  REACT_KEYWORDS: ['react', 'jsx', 'react组件', 'React 组件', '用 React', '用react', 'React 做一个', 'react 做一个', 'React 写', 'react 写'],
  /** Vue 框架关键词 */
  VUE_KEYWORDS: ['vue', 'vue组件', 'Vue 组件', '用 Vue', '用vue', 'Vue 做一个', 'vue 做一个', 'Vue 写', 'vue 写', '单文件组件'],
} as const;

/**
 * 意图种子句子：每种意图的代表性句子，用于语义向量相似度匹配。
 *
 * 设计原则：
 * 1. 覆盖典型表达方式（中英文）
 * 2. 句子简洁、语义明确
 * 3. 不同意图的种子句子尽可能差异化
 */
const INTENT_SEEDS: Record<IntentType, string[]> = {
  conversation: [
    '你好',
    '谢谢',
    '再见',
    '是什么',
    '能不能',
    '可以吗',
    '怎么',
    '如何',
    'hello',
    'hi',
    'thanks',
    'bye',
    'what is',
    'how to',
    '帮我看看',
    '怎么样',
  ],
  create: [
    '做一个应用',
    '创建一个网页',
    '生成代码',
    '帮我写一个',
    '实现一个功能',
    '新建一个项目',
    '开发一个页面',
    'create an app',
    'build a page',
    'make a website',
    'develop a feature',
    '从零开始做一个',
  ],
  modify: [
    '修改一下',
    '添加功能',
    '删除这个',
    '调整一下',
    '优化这个',
    '改一下样式',
    'change this',
    'add feature',
    'modify the code',
    'update the app',
    '给这个应用加个功能',
  ],
  analyze: [
    '分析一下项目',
    '了解这个应用',
    '解释一下代码',
    '介绍一下功能',
    '看看这个项目',
    '说明一下实现',
    'analyze the project',
    'explain the code',
    'walk me through',
    'describe this app',
  ],
  diagnose: [
    '为什么报错',
    '不工作',
    '没反应',
    '有问题',
    'bug',
    '修复',
    '为什么不动',
    '报错了',
    'why error',
    'not working',
    'broken',
    'fix the bug',
    '为什么没效果',
  ],
};

/**
 * 分词函数：将文本拆分为词元。
 *
 * 简单实现：
 * - 中文按字符拆分
 * - 英文按空格拆分
 * - 过滤停用词
 * - 统一转小写
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const stopWords = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '与', '或', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once']);

  // 中文按字符拆分，英文按空格拆分
  let currentWord = '';
  let isPrevCharChinese = false;

  for (const char of text.toLowerCase()) {
    const isChinese = /[一-龥]/.test(char);

    if (isChinese) {
      // 遇到中文字符，先保存之前的英文单词
      if (currentWord && !isPrevCharChinese) {
        if (!stopWords.has(currentWord)) {
          tokens.push(currentWord);
        }
        currentWord = '';
      }
      // 中文字符单独成词（过滤停用词）
      if (!stopWords.has(char)) {
        tokens.push(char);
      }
      isPrevCharChinese = true;
    } else if (char === ' ' || char === '\n' || char === '\t') {
      // 遇到空白符，保存当前单词
      if (currentWord && !stopWords.has(currentWord)) {
        tokens.push(currentWord);
      }
      currentWord = '';
      isPrevCharChinese = false;
    } else {
      // 其他字符（英文、数字、符号）
      currentWord += char;
      isPrevCharChinese = false;
    }
  }

  // 保存最后一个单词
  if (currentWord && !stopWords.has(currentWord)) {
    tokens.push(currentWord);
  }

  return tokens;
}

/**
 * 计算词频向量。
 *
 * @param text 输入文本
 * @returns 词频映射表
 */
function computeTermFrequency(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();

  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  return tf;
}

/**
 * 计算余弦相似度。
 *
 * 公式：cos(θ) = (A·B) / (||A|| * ||B||)
 *
 * @param vec1 词频向量1
 * @param vec2 词频向量2
 * @returns 相似度 0-1
 */
function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
  // 计算点积
  let dotProduct = 0;
  for (const [term, freq1] of vec1) {
    const freq2 = vec2.get(term);
    if (freq2 !== undefined) {
      dotProduct += freq1 * freq2;
    }
  }

  // 计算模长
  const norm1 = Math.sqrt(Array.from(vec1.values()).reduce((sum, f) => sum + f * f, 0));
  const norm2 = Math.sqrt(Array.from(vec2.values()).reduce((sum, f) => sum + f * f, 0));

  // 避免除零
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (norm1 * norm2);
}

/**
 * 是否启用向量相似度匹配（运行时读取，支持热切换）。
 *
 * 环境变量 INTENT_ENABLE_VECTOR：
 * - 未设置 → 开启（默认）
 * - 'false' / '0' / 'off'（不区分大小写）→ 关闭，退回纯关键词 + 状态推断链路
 */
export function isVectorSimilarityEnabled(): boolean {
  const flag = process.env.INTENT_ENABLE_VECTOR;
  if (flag === undefined || flag === '') return true;
  return !['false', '0', 'off'].includes(flag.toLowerCase());
}

/**
 * 语义向量相似度匹配。
 *
 * 流程：
 * 1. 计算用户输入的词频向量
 * 2. 计算各意图种子句子的词频向量
 * 3. 计算用户输入与各种子句子的余弦相似度
 * 4. 选择相似度最高的意图
 *
 * @param userInput 用户输入
 * @returns 意图识别结果或 null（未启用时返回 null）
 */
function matchByVectorSimilarity(userInput: string): IntentResult | null {
  if (!isVectorSimilarityEnabled()) {
    return null;
  }

  const userVec = computeTermFrequency(userInput);
  let bestIntent: IntentType = 'conversation';
  let bestScore = 0;
  let bestReasoning = '';

  for (const intent of Object.keys(INTENT_SEEDS) as IntentType[]) {
    const seeds = INTENT_SEEDS[intent];
    const seedVecs = seeds.map(computeTermFrequency);
    const scores = seedVecs.map(v => cosineSimilarity(userVec, v));
    const maxScore = Math.max(...scores);

    if (maxScore > bestScore) {
      bestScore = maxScore;
      bestIntent = intent;
      const maxIndex = scores.indexOf(maxScore);
      bestReasoning = `向量相似度匹配：与 "${seeds[maxIndex]}" 相似度最高 (${maxScore.toFixed(3)})`;
    }
  }

  return {
    type: bestIntent,
    confidence: bestScore,
    reasoning: bestReasoning,
  };
}

/**
 * 意图识别主函数。
 *
 * 处理流程：
 * 1. 语义向量相似度匹配（快速，零依赖）
 *    ├─ 置信度 > 0.7 → 直接返回
 *    └─ 置信度 <= 0.7 → 进入下一步
 * 2. 关键词匹配（兜底）
 *    ├─ 命中 → 返回
 *    └─ 未命中 → 进入下一步
 * 3. 项目状态推断（最终兜底）
 *
 * @param context 意图识别上下文
 * @param llmClassify 可选的 LLM 分类函数（关键词未命中时调用；当前调用方未传入）
 */
export async function classifyIntent(
  context: IntentContext,
  llmClassify?: (prompt: string) => Promise<string>
): Promise<IntentResult> {
  // 1. 语义向量相似度匹配（快速，零依赖）
  const vectorResult = matchByVectorSimilarity(context.userPrompt);
  if (vectorResult && vectorResult.confidence >= INTENT_CONFIG.VECTOR_CONFIDENCE_THRESHOLD) {
    const suggestedFramework = detectFramework(context);
    console.info(`[classifyIntent] 向量相似度匹配成功：${vectorResult.type} (${vectorResult.confidence.toFixed(3)})`);
    return { ...vectorResult, suggestedFramework };
  }

  // 2. 关键词快速匹配（零成本，命中即返回）
  const keywordResult = matchKeywords(context);
  if (keywordResult && keywordResult.confidence >= INTENT_CONFIG.KEYWORD_CONFIDENCE_THRESHOLD) {
    // 框架识别：关键词命中时也进行框架识别
    const suggestedFramework = detectFramework(context);
    console.info(`[classifyIntent] 关键词匹配成功：${keywordResult.type} (${keywordResult.confidence.toFixed(3)})`);
    return { ...keywordResult, suggestedFramework };
  }

  // 3. LLM 精确分类（预留；未传入时跳过）
  if (llmClassify) {
    try {
      const llmOutput = await llmClassify(buildClassificationPrompt(context));
      const result = parseLLMOutput(llmOutput);
      // LLM 置信度不足时回退关键词结果（如有）
      if (result.confidence < 0.7 && keywordResult) {
        const suggestedFramework = detectFramework(context);
        return { ...keywordResult, suggestedFramework };
      }
      // LLM 结果也进行框架识别
      const suggestedFramework = detectFramework(context);
      console.info(`[classifyIntent] LLM 分类成功：${result.type} (${result.confidence.toFixed(3)})`);
      return { ...result, suggestedFramework };
    } catch (error) {
      console.error('[classifyIntent] LLM classification failed:', error);
      if (keywordResult) {
        const suggestedFramework = detectFramework(context);
        return { ...keywordResult, suggestedFramework };
      }
    }
  }

  // 4. 兜底：按项目状态推断（空项目 → 创建，已有项目 → 修改迭代）
  const suggestedFramework = detectFramework(context);
  const fallbackResult: IntentResult = {
    type: context.hasExistingProject ? 'modify' : 'create',
    confidence: INTENT_CONFIG.DEFAULT_CONFIDENCE,
    reasoning: '向量相似度与关键词均未命中，基于项目状态推断',
    suggestedFramework,
  };
  console.info(`[classifyIntent] 状态推断：${fallbackResult.type}（项目${context.hasExistingProject ? '已有' : '空'}）`);
  return fallbackResult;
}

/**
 * 关键词匹配逻辑。
 * 命中规则结合项目状态：如"修改"关键词只有在已有项目时才判定为 modify，
 * 空项目说"帮我加个删除功能"实际是创建需求的一部分。
 */
function matchKeywords(context: IntentContext): IntentResult | null {
  const { userPrompt, hasExistingProject } = context;
  const prompt = userPrompt.toLowerCase();

  const countHits = (keywords: readonly string[]) =>
    keywords.filter(kw => prompt.includes(kw)).length;

  const conversationHits = countHits(INTENT_CONFIG.CONVERSATION_KEYWORDS);
  const createHits = countHits(INTENT_CONFIG.CREATE_KEYWORDS);
  const modifyHits = countHits(INTENT_CONFIG.MODIFY_KEYWORDS);
  const analyzeHits = countHits(INTENT_CONFIG.ANALYZE_KEYWORDS);
  const diagnoseHits = countHits(INTENT_CONFIG.DIAGNOSE_KEYWORDS);

  // 对话/闲聊检测优先级最高：避免"你好"等问候语被误判为 modify
  // 只有当对话关键词命中且没有其他明确任务关键词时才判定为对话
  if (conversationHits > 0 && createHits === 0 && modifyHits === 0 && analyzeHits === 0 && diagnoseHits === 0) {
    return {
      type: 'conversation',
      confidence: Math.min(0.95, 0.85 + conversationHits * 0.05),
      reasoning: `对话关键词命中 ${conversationHits} 次，无任务意图`,
    };
  }

  // 诊断优先级次高：报错/不工作等词汇表示用户被问题阻塞，
  // 即使同时含"修改"字样（如"修复一下"同时命中两边），也应先诊断
  if (diagnoseHits > 0) {
    return {
      type: 'diagnose',
      confidence: Math.min(0.9, 0.75 + diagnoseHits * 0.05),
      reasoning: `诊断关键词命中 ${diagnoseHits} 次`,
    };
  }

  // 创建：空项目 + 创建词，或创建词显著多于修改词（已有项目但用户想推倒重来）
  // 命中基数 0.8：单次命中即达 KEYWORD_CONFIDENCE_THRESHOLD（0.8）被采信，
  // 否则单关键词输入（如"分析一下这个项目"）会全部跌落到状态兜底被误判
  if (createHits > 0 && (!hasExistingProject || createHits > modifyHits)) {
    return {
      type: 'create',
      confidence: Math.min(0.9, 0.8 + createHits * 0.05),
      reasoning: `创建关键词命中 ${createHits} 次 + ${hasExistingProject ? '已有项目' : '空项目'}`,
    };
  }

  // 修改：已有项目 + 修改词（且无更强的分析意图）
  if (modifyHits > 0 && hasExistingProject && analyzeHits === 0) {
    return {
      type: 'modify',
      confidence: Math.min(0.9, 0.8 + modifyHits * 0.05),
      reasoning: `修改关键词命中 ${modifyHits} 次 + 已有项目`,
    };
  }

  // 分析：已有项目 + 分析词，且无修改/诊断词（"检查一下代码"是分析不是诊断）
  if (analyzeHits > 0 && hasExistingProject && modifyHits === 0) {
    return {
      type: 'analyze',
      confidence: Math.min(0.9, 0.8 + analyzeHits * 0.05),
      reasoning: `分析关键词命中 ${analyzeHits} 次 + 已有项目`,
    };
  }

  return null;
}

/**
 * 构建 LLM 分类 prompt（预留，当前调用方未启用 LLM 分类）。
 */
function buildClassificationPrompt(context: IntentContext): string {
  return `请判断用户意图。可选类型：
- create：创建新应用（用户想从零开始创建一个新应用）
- modify：修改现有项目（用户想对现有项目做修改或优化）
- analyze：分析现有项目（用户想了解项目的功能、结构或实现）
- diagnose：诊断问题（用户遇到 bug 或行为不符合预期，需要定位原因）

用户输入：${context.userPrompt}
项目状态：${context.hasExistingProject ? '已有项目文件' : '空项目'}
文件数量：${context.fileCount}

请输出 JSON（不要其他文字）：
{
  "intent": "create | modify | analyze | diagnose",
  "confidence": 0.0 到 1.0 的数字,
  "reasoning": "判断理由"
}`;
}

/**
 * 解析 LLM 分类输出（容忍 markdown 代码围栏）。
 */
function parseLLMOutput(output: string): IntentResult {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM output');
    }
    const parsed = JSON.parse(jsonMatch[0]) as { intent?: string; confidence?: number; reasoning?: string };

    const validIntents: IntentType[] = ['create', 'modify', 'analyze', 'diagnose', 'conversation'];
    if (!parsed.intent || !validIntents.includes(parsed.intent as IntentType)) {
      throw new Error(`Invalid intent: ${parsed.intent}`);
    }

    return {
      type: parsed.intent as IntentType,
      confidence: Math.max(0, Math.min(1, typeof parsed.confidence === 'number' ? parsed.confidence : 0.5)),
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    console.error('[parseLLMOutput] Failed to parse LLM output:', error);
    return {
      type: 'create',
      confidence: INTENT_CONFIG.DEFAULT_CONFIDENCE,
      reasoning: 'LLM 输出解析失败，默认创建意图',
    };
  }
}

/** 意图类型的中文名称（日志与用户提示用） */
export const INTENT_LABELS: Record<IntentType, string> = {
  create: '创建应用',
  modify: '修改迭代',
  analyze: '功能分析',
  diagnose: '问题诊断',
  conversation: '对话交流',
};

/**
 * 框架识别：根据用户提示词关键词识别建议使用的框架。
 *
 * 识别规则：
 * 1. React 关键词命中 → React CDN
 * 2. Vue 关键词命中 → Vue CDN
 * 3. 默认 → HTML
 *
 * @param context 意图识别上下文
 * @returns 建议的框架
 */
export function detectFramework(context: IntentContext): 'html' | 'react-cdn' | 'vue-cdn' {
  const { userPrompt } = context;
  const prompt = userPrompt.toLowerCase();

  // 检查 React 关键词
  const reactKeywords = INTENT_CONFIG.REACT_KEYWORDS as readonly string[];
  for (const kw of reactKeywords) {
    if (prompt.includes(kw.toLowerCase())) {
      console.info(`[detectFramework] 命中 React 关键词: ${kw}`);
      return 'react-cdn';
    }
  }

  // 检查 Vue 关键词
  const vueKeywords = INTENT_CONFIG.VUE_KEYWORDS as readonly string[];
  for (const kw of vueKeywords) {
    if (prompt.includes(kw.toLowerCase())) {
      console.info(`[detectFramework] 命中 Vue 关键词: ${kw}`);
      return 'vue-cdn';
    }
  }

  // 默认使用 HTML
  return 'html';
}
