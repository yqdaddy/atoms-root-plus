/**
 * 意图识别模块（服务端）。
 * 根据用户输入和项目状态判断用户意图，选择合适的处理流水线。
 *
 * 策略：关键词快速匹配优先，未命中时按项目状态兜底。
 * LLM 分类预留接口（llmClassify 参数），当前默认不启用：
 * 意图识别在生成关键路径上，多一次 LLM 往返会拖慢首字延迟，
 * 关键词 + 状态兜底已覆盖绝大多数场景，LLM 分类留给误判率超标后再开。
 *
 * 类型在本文件内定义：tsconfig.server.json rootDir=server，服务端构建
 * 无法引用 src，与 server/prompts.ts 的镜像约定一致。字段与
 * src/types/intent.ts 保持同构，任何一侧变更必须同步另一侧。
 */

/** 意图类型 */
export type IntentType = 'create' | 'modify' | 'analyze' | 'diagnose';

/** 意图识别结果 */
export interface IntentResult {
  type: IntentType;
  /** 置信度 0-1 */
  confidence: number;
  /** 判断理由（日志与前端提示用） */
  reasoning?: string;
}

/** 意图识别上下文 */
export interface IntentContext {
  userPrompt: string;
  hasExistingProject: boolean;
  fileCount: number;
}

/** 意图识别配置 */
export const INTENT_CONFIG = {
  /** 关键词匹配置信度阈值：达到即采信关键词结果，不再走兜底 */
  KEYWORD_CONFIDENCE_THRESHOLD: 0.8,
  /** 兜底推断的置信度 */
  DEFAULT_CONFIDENCE: 0.5,
  /** 创建关键词：配合空项目状态命中 */
  CREATE_KEYWORDS: ['创建', '做一个', '帮我写', '做一个新', '生成', '实现', '新建', 'create', 'build', 'make'],
  /** 修改关键词：配合已有项目状态命中 */
  MODIFY_KEYWORDS: ['修改', '改一下', '改成', '调整', '优化', '增加', '添加', '删除', '去掉', '换个', 'modify', 'change', 'update', 'edit', 'add', 'remove'],
  /** 分析关键词：只想了解项目，不改动 */
  ANALYZE_KEYWORDS: ['分析', '检查一下', '解释', '说明一下', '介绍一下', '是什么', 'analyze', 'explain', 'describe', 'walk me through'],
  /** 诊断关键词：遇到问题要求定位 */
  DIAGNOSE_KEYWORDS: ['为什么', '报错', '不工作', '不生效', '没反应', '有问题', 'bug', '出错', '修复', '排查', 'why', 'error', 'broken', 'fix', 'debug'],
} as const;

/**
 * 意图识别主函数。
 *
 * @param context 意图识别上下文
 * @param llmClassify 可选的 LLM 分类函数（关键词未命中时调用；当前调用方未传入）
 */
export async function classifyIntent(
  context: IntentContext,
  llmClassify?: (prompt: string) => Promise<string>
): Promise<IntentResult> {
  // 1. 关键词快速匹配（零成本，命中即返回）
  const keywordResult = matchKeywords(context);
  if (keywordResult && keywordResult.confidence >= INTENT_CONFIG.KEYWORD_CONFIDENCE_THRESHOLD) {
    return keywordResult;
  }

  // 2. LLM 精确分类（预留；未传入时跳过）
  if (llmClassify) {
    try {
      const llmOutput = await llmClassify(buildClassificationPrompt(context));
      const result = parseLLMOutput(llmOutput);
      // LLM 置信度不足时回退关键词结果（如有）
      if (result.confidence < 0.7 && keywordResult) {
        return keywordResult;
      }
      return result;
    } catch (error) {
      console.error('[classifyIntent] LLM classification failed:', error);
      if (keywordResult) {
        return keywordResult;
      }
    }
  }

  // 3. 兜底：按项目状态推断（空项目 → 创建，已有项目 → 修改迭代）
  return {
    type: context.hasExistingProject ? 'modify' : 'create',
    confidence: INTENT_CONFIG.DEFAULT_CONFIDENCE,
    reasoning: '关键词未命中，基于项目状态推断',
  };
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

  const createHits = countHits(INTENT_CONFIG.CREATE_KEYWORDS);
  const modifyHits = countHits(INTENT_CONFIG.MODIFY_KEYWORDS);
  const analyzeHits = countHits(INTENT_CONFIG.ANALYZE_KEYWORDS);
  const diagnoseHits = countHits(INTENT_CONFIG.DIAGNOSE_KEYWORDS);

  // 诊断优先级最高：报错/不工作等词汇表示用户被问题阻塞，
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

    const validIntents: IntentType[] = ['create', 'modify', 'analyze', 'diagnose'];
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
};
