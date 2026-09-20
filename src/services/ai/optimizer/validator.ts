/**
 * 优化器输出校验器。
 * 校验 LLM 返回的 JSON 结构是否符合预期。
 */

import type { OptimizedRequirement, AppType, CoreFeature, AuxFeature } from './types';

/** 优化器错误。code 与 types.ts 的 OptimizerErrorPayload.code 保持对齐 */
export class OptimizerError extends Error {
  constructor(
    public code: 'PARSE_FAILED' | 'INVALID_STRUCTURE' | 'INVALID_TITLE' | 'INVALID_TYPE' | 'INVALID_FEATURES' | 'EMPTY_OUTPUT' | 'CANCELLED',
    message: string,
  ) {
    super(message);
    this.name = 'OptimizerError';
  }
}

/**
 * 校验并解析优化器输出
 * @param rawOutput LLM 返回的原始字符串
 * @returns 校验后的结构化需求文档
 * @throws OptimizerError 当输出不符合预期时
 */
export function validateOptimizerOutput(rawOutput: string): OptimizedRequirement {
  // 0. 检查空输出
  if (!rawOutput || rawOutput.trim().length === 0) {
    throw new OptimizerError('EMPTY_OUTPUT', '优化器输出为空');
  }

  // 1. 尝试解析 JSON
  let parsed: unknown;
  try {
    // 移除可能的 markdown 代码围栏
    const cleaned = rawOutput
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/g, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new OptimizerError('PARSE_FAILED', '优化器输出不是有效的 JSON');
  }

  // 2. 校验结构
  if (!isOptimizedRequirement(parsed)) {
    throw new OptimizerError('INVALID_STRUCTURE', '优化器输出结构不符合预期');
  }

  // 3. 校验字段内容
  if (!parsed.appTitle || parsed.appTitle.length > 20) {
    throw new OptimizerError('INVALID_TITLE', '应用标题必须为 1-20 个字符');
  }

  if (!isValidAppType(parsed.appType)) {
    throw new OptimizerError('INVALID_TYPE', `无效的应用类型: ${parsed.appType}`);
  }

  if (parsed.coreFeatures.length < 2 || parsed.coreFeatures.length > 4) {
    throw new OptimizerError('INVALID_FEATURES', '核心功能数量必须为 2-4 条');
  }

  // 4. 校验核心功能结构
  for (const feature of parsed.coreFeatures as unknown[]) {
    if (!isValidCoreFeature(feature)) {
      const id = (feature as { id?: unknown } | null)?.id;
      throw new OptimizerError('INVALID_FEATURES', `核心功能 ${String(id ?? '未知')} 结构不完整`);
    }
  }

  // 5. 校验辅助功能结构（如果有）
  for (const feature of parsed.auxFeatures as unknown[]) {
    if (!isValidAuxFeature(feature)) {
      const id = (feature as { id?: unknown } | null)?.id;
      throw new OptimizerError('INVALID_FEATURES', `辅助功能 ${String(id ?? '未知')} 结构不完整`);
    }
  }

  // 6. 确保必要字段有默认值
  const result: OptimizedRequirement = {
    ...parsed,
    // 确保 questions 不超过 3 条
    questions: parsed.questions.slice(0, 3),
    // 确保 auxFeatures 不超过 2 条
    auxFeatures: parsed.auxFeatures.slice(0, 2),
  };

  return result;
}

/**
 * 类型守卫：检查是否为有效的 OptimizedRequirement
 */
function isOptimizedRequirement(value: unknown): value is OptimizedRequirement {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.appTitle === 'string' &&
    typeof obj.appType === 'string' &&
    typeof obj.summary === 'string' &&
    Array.isArray(obj.coreFeatures) &&
    Array.isArray(obj.auxFeatures) &&
    typeof obj.dataModel === 'object' &&
    obj.dataModel !== null &&
    typeof obj.uiLayout === 'string' &&
    typeof obj.theme === 'object' &&
    obj.theme !== null &&
    Array.isArray(obj.assumptions) &&
    Array.isArray(obj.questions)
  );
}

/**
 * 检查是否为有效的应用类型
 */
function isValidAppType(type: string): type is AppType {
  return ['dashboard', 'landing', 'todo', 'chart', 'tool', 'game', 'other'].includes(type);
}

/**
 * 检查是否为有效的核心功能
 */
function isValidCoreFeature(feature: unknown): feature is CoreFeature {
  if (typeof feature !== 'object' || feature === null) return false;

  const obj = feature as Record<string, unknown>;

  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.ui === 'string' &&
    Array.isArray(obj.interactions)
  );
}

/**
 * 检查是否为有效的辅助功能
 */
function isValidAuxFeature(feature: unknown): feature is AuxFeature {
  if (typeof feature !== 'object' || feature === null) return false;

  const obj = feature as Record<string, unknown>;

  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string'
  );
}

/**
 * 修复常见的输出问题（非破坏性）
 * 用于在用户手动编辑后进行轻微修复
 */
export function repairOptimizerOutput(output: Partial<OptimizedRequirement>): OptimizedRequirement | null {
  try {
    // 如果缺少必要字段，返回 null
    if (!output.appTitle || !output.appType) {
      return null;
    }

    // 提供默认值
    const repaired: OptimizedRequirement = {
      appTitle: output.appTitle,
      appType: isValidAppType(output.appType) ? output.appType : 'other',
      summary: output.summary || '',
      coreFeatures: (output.coreFeatures || []).filter(isValidCoreFeature),
      auxFeatures: (output.auxFeatures || []).filter(isValidAuxFeature),
      dataModel: output.dataModel || { entities: [], storageKey: 'app_data' },
      uiLayout: output.uiLayout || '默认布局',
      theme: output.theme || { primary: '#3b82f6', tone: 'light' },
      assumptions: output.assumptions || [],
      questions: output.questions || [],
    };

    // 再次校验
    if (repaired.coreFeatures.length < 2) {
      return null;
    }

    return repaired;
  } catch {
    return null;
  }
}