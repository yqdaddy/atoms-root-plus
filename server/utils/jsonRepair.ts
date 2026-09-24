/**
 * 容错解析工具：修复常见的 JSON 格式错误
 *
 * 职责：
 * 1. 修复尾逗号（trailing comma）
 * 2. 修复缺少引号的键名
 * 3. 修复未闭合的字符串/数组/对象
 * 4. 尝试从截断输出中抢救完整部分
 */

/**
 * 修复常见的 JSON 格式错误
 * @param jsonStr 可能包含错误的 JSON 字符串
 * @returns 修复后的 JSON 字符串，或 null 表示无法修复
 */
export function repairCommonJsonErrors(jsonStr: string): string | null {
  try {
    // 先尝试直接解析，如果成功就直接返回
    JSON.parse(jsonStr);
    return jsonStr;
  } catch {
    // 解析失败，尝试修复
  }

  let result = jsonStr;

  // 1. 修复尾逗号：删除对象和数组中最后一项后的逗号
  // 匹配：}, 或 ], 或 ,} 或 ,] 或 ,\s*} 或 ,\s*]
  result = result.replace(/,(\s*[}\]])/g, '$1');
  result = result.replace(/([}\]]\s*),(\s*[}\]])/g, '$1$2');

  // 2. 尝试修复缺少引号的键名（简化：只处理常见的无引号键名）
  // 匹配：{key: 或 ,key: 并替换为 {"key": 或 ,"key":
  // 注意：这只处理简单的标识符，不处理包含特殊字符的情况
  result = result.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

  // 3. 尝试修复未闭合的字符串
  // 检测未闭合的引号并尝试闭合
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
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

  // 如果最后在字符串中，添加闭合引号
  if (inString) {
    result += '"';
  }

  // 4. 修复未闭合的数组/对象
  // 重新计算深度
  depth = 0;
  inString = false;
  escapeNext = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
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

  // 根据深度闭合未完成的结构
  const closeChars: string[] = [];
  let tempDepth = 0;
  let tempInString = false;
  let tempEscape = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (tempEscape) {
      tempEscape = false;
      continue;
    }
    if (ch === '\\' && tempInString) {
      tempEscape = true;
      continue;
    }
    if (ch === '"') {
      tempInString = !tempInString;
      continue;
    }
    if (!tempInString) {
      if (ch === '{') {
        tempDepth++;
        closeChars.unshift('}');
      } else if (ch === '[') {
        tempDepth++;
        closeChars.unshift(']');
      } else if (ch === '}' || ch === ']') {
        tempDepth--;
        closeChars.shift();
      }
    }
  }

  // 如果有未闭合的结构，添加闭合字符
  if (closeChars.length > 0) {
    result += closeChars.join('');
  }

  // 5. 再次尝试解析
  try {
    JSON.parse(result);
    return result;
  } catch {
    // 仍然失败，返回 null
    return null;
  }
}

/**
 * 检测 JSON 解析失败的错误类型
 */
export type JsonErrorType =
  | 'trailing_comma'
  | 'unclosed_string'
  | 'unclosed_bracket'
  | 'missing_quotes'
  | 'invalid_syntax'
  | 'unknown';

/**
 * 分析 JSON 解析失败的原因
 */
export function diagnoseJsonError(error: Error, jsonStr: string): JsonErrorType {
  const message = error.message.toLowerCase();

  if (message.includes('trailing comma') || message.includes('unexpected token') && jsonStr.match(/,\s*[}\]]/)) {
    return 'trailing_comma';
  }

  if (message.includes('unterminated string') || message.includes('end of json input')) {
    // 检查是否有未闭合的引号
    let quoteCount = 0;
    let escaped = false;
    for (const ch of jsonStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') quoteCount++;
    }
    if (quoteCount % 2 !== 0) {
      return 'unclosed_string';
    }
  }

  if (message.includes('unexpected end of json') || message.includes('unexpected end of input')) {
    // 检查括号配对
    let depth = 0;
    let inString = false;
    let escape = false;
    for (const ch of jsonStr) {
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
    if (depth > 0) {
      return 'unclosed_bracket';
    }
  }

  if (message.includes('unexpected token') && jsonStr.match(/[{,]\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*:/)) {
    return 'missing_quotes';
  }

  if (message.includes('unexpected token') || message.includes('unexpected character')) {
    return 'invalid_syntax';
  }

  return 'unknown';
}

/**
 * 生成针对性的错误提示（用于重试 prompt）
 */
export function getJsonErrorHint(errorType: JsonErrorType): string {
  switch (errorType) {
    case 'trailing_comma':
      return 'JSON 不允许尾逗号（最后一项后的逗号），请删除数组或对象末尾的逗号';
    case 'unclosed_string':
      return 'JSON 字符串必须用双引号闭合，请检查所有字符串是否有对应的结束引号';
    case 'unclosed_bracket':
      return 'JSON 对象/数组必须闭合，请确保每个 { 或 [ 都有对应的 } 或 ]';
    case 'missing_quotes':
      return 'JSON 键名必须用双引号包裹，请将所有键名用双引号包围（如 "path" 而非 path）';
    case 'invalid_syntax':
      return 'JSON 语法错误，请仔细检查格式是否正确';
    default:
      return 'JSON 格式不符合规范，请确保输出是合法的 JSON';
  }
}

/**
 * 增强的 JSON 解析：先尝试标准解析，失败则尝试修复后解析
 * @param jsonStr JSON 字符串
 * @returns 解析结果，包含解析后的对象、是否经过修复、错误类型等信息
 */
export interface EnhancedParseResult<T = unknown> {
  success: boolean;
  data?: T;
  repaired: boolean;
  errorType?: JsonErrorType;
  errorMessage?: string;
}

export function enhancedJsonParse<T = unknown>(jsonStr: string): EnhancedParseResult<T> {
  // 1. 尝试标准解析
  try {
    const data = JSON.parse(jsonStr) as T;
    return {
      success: true,
      data,
      repaired: false,
    };
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    const errorType = diagnoseJsonError(parseError, jsonStr);

    // 2. 尝试修复
    const repaired = repairCommonJsonErrors(jsonStr);
    if (repaired) {
      try {
        const data = JSON.parse(repaired) as T;
        return {
          success: true,
          data,
          repaired: true,
          errorType,
        };
      } catch {
        // 修复后仍失败
      }
    }

    // 3. 返回失败结果
    return {
      success: false,
      repaired: false,
      errorType,
      errorMessage: parseError.message,
    };
  }
}