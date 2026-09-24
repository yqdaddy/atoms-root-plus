/**
 * 多维度重试策略定义
 *
 * 设计目标：
 * 1. 不同输出格式：files / changes / scaffold 三种格式轮流尝试
 * 2. 不同提示词策略：针对不同失败原因用不同强调点
 * 3. 不同模型参数：调整 temperature / top_p
 * 4. 容错解析增强：JSON 修复、截断抢救
 */

import type { JsonErrorType } from './jsonRepair.js';
import { diagnoseJsonError, getJsonErrorHint } from './jsonRepair.js';

/**
 * 输出格式类型
 */
export type OutputFormat = 'files' | 'changes' | 'scaffold';

/**
 * 提示词策略类型
 */
export type PromptStrategy = 'strict' | 'tolerant' | 'guided';

/**
 * 模型参数配置
 */
export interface ModelParameters {
  temperature?: number;
  top_p?: number;
}

/**
 * 容错解析策略
 */
export type RepairStrategy = 'none' | 'repair' | 'json_fix';

/**
 * 重试策略组合
 */
export interface RetryStrategy {
  /** 输出格式 */
  format: OutputFormat;
  /** 提示词策略 */
  promptStrategy: PromptStrategy;
  /** 模型参数 */
  modelParams: ModelParameters;
  /** 容错解析策略 */
  repairStrategy: RepairStrategy;
  /** 策略名称（用于日志和前端展示） */
  name: string;
  /** 策略描述（用于 SSE 通知） */
  description: string;
}

/**
 * 失败原因分类
 */
export type FailureReason =
  | 'json_syntax'
  | 'format_mismatch'
  | 'truncation'
  | 'structure_error'
  | 'validation_error'
  | 'unknown';

/**
 * 失败诊断结果
 */
export interface FailureDiagnosis {
  /** 失败原因 */
  reason: FailureReason;
  /** JSON 错误类型（如果是 JSON 解析失败） */
  jsonErrorType?: JsonErrorType;
  /** 错误消息 */
  errorMessage: string;
  /** 是否可重试 */
  retryable: boolean;
}

/**
 * 重试策略矩阵（5 种组合）
 *
 * 设计原则：
 * - 第 1 次：标准策略，最大成功概率
 * - 第 2 次：针对性修复，针对常见错误类型
 * - 第 3 次：容错格式，降低输出复杂度
 * - 第 4 次：确定性重试，降低模型随机性
 * - 第 5 次：抢救模式，尽可能恢复输出
 */
export const RETRY_STRATEGY_MATRIX: readonly RetryStrategy[] = [
  {
    format: 'files',
    promptStrategy: 'strict',
    modelParams: {},
    repairStrategy: 'none',
    name: '标准模式',
    description: '使用标准文件格式生成',
  },
  {
    format: 'files',
    promptStrategy: 'guided',
    modelParams: {},
    repairStrategy: 'json_fix',
    name: '引导修复模式',
    description: '针对 JSON 格式问题，提供结构示例并自动修复常见错误',
  },
  {
    format: 'scaffold',
    promptStrategy: 'tolerant',
    modelParams: {},
    repairStrategy: 'repair',
    name: '脚手架模式',
    description: '简化输出格式，降低 JSON 复杂度',
  },
  {
    format: 'files',
    promptStrategy: 'strict',
    modelParams: { temperature: 0.3 },
    repairStrategy: 'json_fix',
    name: '确定性模式',
    description: '降低模型随机性，增加输出稳定性',
  },
  {
    format: 'files',
    promptStrategy: 'tolerant',
    modelParams: {},
    repairStrategy: 'repair',
    name: '抢救模式',
    description: '最大化容错，尝试从截断输出中恢复',
  },
] as const;

/**
 * 根据失败原因和重试次数选择策略
 *
 * @param attempt 当前尝试次数（0-based）
 * @param diagnosis 失败诊断结果
 * @returns 重试策略
 */
export function selectRetryStrategy(attempt: number, diagnosis: FailureDiagnosis): RetryStrategy {
  // 根据失败原因和尝试次数选择策略
  // 首次失败（attempt=0）：尝试针对性的修复策略
  // 第二次失败（attempt=1）：尝试格式切换
  // 第三次及以后：按矩阵顺序尝试

  // 特殊情况：针对特定失败原因的策略推荐
  if (attempt === 0) {
    // 首次失败：针对性修复
    switch (diagnosis.reason) {
      case 'json_syntax':
        // JSON 语法错误：引导修复模式
        return RETRY_STRATEGY_MATRIX[1];
      case 'truncation':
        // 截断：抢救模式（索引 4）
        return RETRY_STRATEGY_MATRIX[4];
      case 'format_mismatch':
        // 格式不符：脚手架模式（索引 2）
        return RETRY_STRATEGY_MATRIX[2];
      case 'validation_error':
      case 'structure_error':
        // 结构/校验错误：确定性模式（索引 3）
        return RETRY_STRATEGY_MATRIX[3];
      default:
        // 未知错误：引导修复模式
        return RETRY_STRATEGY_MATRIX[1];
    }
  }

  // 第二次及以后失败：按矩阵顺序（跳过索引 0，那是首次尝试用的）
  const strategyIndex = Math.min(attempt + 1, RETRY_STRATEGY_MATRIX.length - 1);
  return RETRY_STRATEGY_MATRIX[strategyIndex];
}

/**
 * 生成重试提示词增强
 *
 * @param strategy 重试策略
 * @param diagnosis 失败诊断
 * @param previousError 上次的错误信息
 * @returns 提示词增强文本
 */
export function generateRetryHint(
  strategy: RetryStrategy,
  diagnosis: FailureDiagnosis,
  previousError: string
): string {
  const lines: string[] = [];

  // JSON 错误类型针对性提示（有诊断结果时优先给出具体修复建议）
  if (diagnosis.jsonErrorType) {
    lines.push(`【错误分析】${getJsonErrorHint(diagnosis.jsonErrorType)}`);
    lines.push('');
  }

  // 根据提示词策略生成不同的强调点
  switch (strategy.promptStrategy) {
    case 'strict':
      lines.push('【重要】上次生成失败，必须严格遵守格式要求：');
      lines.push(`- 失败原因：${previousError}`);
      lines.push('- 必须输出合法的 JSON 格式');
      lines.push('- 禁止输出任何解释文字');
      lines.push('- 禁止使用 markdown 围栏');
      break;

    case 'guided':
      lines.push('【格式指引】上次存在格式问题，请参考以下示例：');
      lines.push(`- 问题：${previousError}`);
      if (strategy.format === 'files') {
        lines.push('- 正确格式示例：');
        lines.push('{');
        lines.push('  "files": [');
        lines.push('    { "path": "/index.html", "content": "<!DOCTYPE html>...", "language": "html" }');
        lines.push('  ]');
        lines.push('}');
      } else if (strategy.format === 'scaffold') {
        lines.push('- 简化格式示例：');
        lines.push('{');
        lines.push('  "index.html": "<!DOCTYPE html>...",');
        lines.push('  "main.js": "function main() { ... }"');
        lines.push('}');
      }
      lines.push('- 请严格按照示例格式输出');
      break;

    case 'tolerant':
      lines.push('【容错模式】尝试简化输出格式以提高成功率：');
      lines.push(`- 上次问题：${previousError}`);
      lines.push('- 优先输出核心文件（index.html）');
      lines.push('- 其他文件可简化或省略');
      lines.push('- 格式允许一定容错');
      break;
  }

  // 添加格式特定的提示
  if (strategy.format === 'scaffold') {
    lines.push('\n【脚手架模式】使用简化的键值对格式：');
    lines.push('- 键：文件路径（如 "index.html"、"main.js"）');
    lines.push('- 值：文件内容（字符串）');
    lines.push('- 无需 language 字段，自动从路径推断');
  }

  // 添加模型参数提示
  if (strategy.modelParams.temperature !== undefined) {
    lines.push(`\n【确定性模式】已降低温度参数至 ${strategy.modelParams.temperature} 以增加输出稳定性`);
  }

  return lines.join('\n');
}

/**
 * 诊断失败原因
 *
 * @param error 错误对象或错误消息
 * @param output 原始输出（可选）
 * @returns 失败诊断结果
 */
export function diagnoseFailure(error: Error | string, output?: string): FailureDiagnosis {
  const errorMessage = typeof error === 'string' ? error : error.message;

  // 1. 检测截断
  if (output && isTruncated(output)) {
    return {
      reason: 'truncation',
      errorMessage: '输出因长度限制被截断',
      retryable: true,
    };
  }

  // 2. 检测 JSON 语法错误
  if (errorMessage.includes('JSON') || errorMessage.includes('解析') || errorMessage.includes('parse')) {
    // 尝试从输出中提取 JSON 片段并诊断具体错误类型（供针对性修复提示）
    let jsonErrorType: JsonErrorType | undefined;
    if (output) {
      const start = output.indexOf('{');
      if (start !== -1) {
        jsonErrorType = diagnoseJsonError(new Error(errorMessage), output.slice(start));
      }
    }
    return {
      reason: 'json_syntax',
      jsonErrorType,
      errorMessage,
      retryable: true,
    };
  }

  // 3. 检测校验错误（优先于结构错误，处理"结构校验"这种组合）
  if (errorMessage.includes('校验') || errorMessage.includes('验证') || errorMessage.includes('validation')) {
    return {
      reason: 'validation_error',
      errorMessage,
      retryable: true,
    };
  }

  // 4. 检测结构错误
  if (errorMessage.includes('结构') || errorMessage.includes('import') || errorMessage.includes('CDN')) {
    return {
      reason: 'structure_error',
      errorMessage,
      retryable: true,
    };
  }

  // 5. 检测格式不符（最后检测，避免被其他关键词抢夺）
  if (
    errorMessage.includes('格式错误') ||
    errorMessage.includes('格式不符合') ||
    errorMessage.includes('缺少') ||
    errorMessage.includes('期望包含')
  ) {
    return {
      reason: 'format_mismatch',
      errorMessage,
      retryable: true,
    };
  }

  // 6. 未知错误
  return {
    reason: 'unknown',
    errorMessage,
    retryable: true, // 默认允许重试
  };
}

/**
 * 检测输出是否被截断
 */
function isTruncated(output: string): boolean {
  // 1. 检查 JSON 是否完整（括号配对）
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
  }

  // 括号不配对，可能是截断
  if (depth !== 0) {
    return true;
  }

  // 2. 检查字符串是否闭合
  let quoteCount = 0;
  escape = false;
  for (const ch of output) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') quoteCount++;
  }

  // 引号数量为奇数，字符串未闭合
  if (quoteCount % 2 !== 0) {
    return true;
  }

  // 3. 检查是否在 JSON 中间被截断（启发式）
  // 如果输出以非 JSON 自然结尾结束，可能是截断
  const trimmed = output.trim();
  if (
    !trimmed.endsWith('}') &&
    !trimmed.endsWith(']') &&
    !trimmed.endsWith('```') &&
    !trimmed.endsWith('"') &&
    trimmed.length > 100
  ) {
    // 可能是截断（内容在中间被打断）
    return true;
  }

  return false;
}

/**
 * 获取最大重试次数
 */
export const MAX_RETRY_ATTEMPTS = 5;

/**
 * 重试进度事件（扩展自原有 RetryProgressEvent）
 */
export interface RetryProgressEvent {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  errorMessage: string;
  /** 新增：策略名称 */
  strategyName?: string;
  /** 新增：策略描述 */
  strategyDescription?: string;
}