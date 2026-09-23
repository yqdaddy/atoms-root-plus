/**
 * 意图识别类型定义。
 * 用于根据用户输入和项目状态判断用户意图，从而选择合适的处理流水线。
 */

/** 意图类型 */
export type IntentType = 'create' | 'modify' | 'analyze' | 'diagnose' | 'conversation';

/** 意图识别结果 */
export interface IntentResult {
  /** 意图类型 */
  type: IntentType;
  /** 置信度 0-1 */
  confidence: number;
  /** 判断理由（LLM 分类时给出） */
  reasoning?: string;
  /** 建议的框架（自动识别结果） */
  suggestedFramework?: 'html' | 'react-cdn' | 'vue-cdn';
}

/** 意图识别上下文 */
export interface IntentContext {
  /** 用户输入 prompt */
  userPrompt: string;
  /** 是否已有项目文件 */
  hasExistingProject: boolean;
  /** 项目文件数量 */
  fileCount: number;
  /** 项目状态 */
  projectStatus: 'draft' | 'generating' | 'ready' | 'error';
}

/** 意图识别配置 */
export const INTENT_CONFIG = {
  /** 关键词匹配置信度阈值 */
  KEYWORD_CONFIDENCE_THRESHOLD: 0.8,
  /** LLM 分类失败的默认置信度 */
  DEFAULT_CONFIDENCE: 0.5,
  /** 创建关键词 */
  CREATE_KEYWORDS: ['创建', '做一个', '帮我写', '生成', '实现', 'create', 'build', 'make', 'develop'],
  /** 修改关键词 */
  MODIFY_KEYWORDS: ['修改', '改一下', '调整', '优化', '增加', '删除', '修改成', '改成', 'modify', 'change', 'update', 'edit'],
  /** 分析关键词 */
  ANALYZE_KEYWORDS: ['分析', '检查', '解释', '说明', '是什么', '了解', '介绍一下', '了解一下', '看看', 'analyze', 'explain', 'describe', 'what', 'show me'],
  /** 诊断关键词 */
  DIAGNOSE_KEYWORDS: ['为什么', '报错', '问题', '不工作', 'bug', '错误', 'why', 'error', 'problem', 'fix', '修复'],
  /** 对话/闲聊关键词 */
  CONVERSATION_KEYWORDS: ['你好', '您好', '谢谢', '感谢', '再见', '拜拜', '好的', '可以吗', '能不能', '是否', '怎么样', '如何理解', '是什么意思', '帮我看看', 'hello', 'hi', 'hey', 'thanks', 'thank you', 'bye', 'goodbye', 'ok', 'okay', 'yes', 'no'],
} as const;