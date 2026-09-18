/**
 * CSV 解析器
 * 支持逗号/分号分隔、引号转义、表头解析
 */

import type { DataImportOptions, DataImportResult, ParsedData } from './types';

/**
 * 解析 CSV 字符串
 * @param content CSV 内容
 * @param options 解析选项
 */
export function parseCSV(content: string, options: DataImportOptions = {}): DataImportResult {
  const { fileName, delimiter = ',', skipHeader = false, maxRows = 10000 } = options;

  // 空文件检查
  if (!content || content.trim().length === 0) {
    return {
      ok: false,
      error: { code: 'EMPTY_FILE', message: '文件内容为空' },
    };
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return {
      ok: false,
      error: { code: 'EMPTY_FILE', message: '文件无有效数据行' },
    };
  }

  // 行数限制检查
  const dataLineCount = skipHeader ? lines.length - 1 : lines.length;
  if (dataLineCount > maxRows) {
    return {
      ok: false,
      error: {
        code: 'ROW_LIMIT_EXCEEDED',
        message: `数据行数 ${dataLineCount} 超过限制 ${maxRows}`,
      },
    };
  }

  try {
    // 解析表头
    const headerLineIndex = skipHeader ? 1 : 0;
    const headerLine = lines[headerLineIndex];
    if (!headerLine) {
      return {
        ok: false,
        error: { code: 'INVALID_FORMAT', message: '无法找到表头行', line: headerLineIndex + 1 },
      };
    }
    const rawHeaders = parseCSVLine(headerLine, delimiter);

    if (rawHeaders.length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_FORMAT', message: '无法解析表头', line: 1 },
      };
    }

    // 规范化表头：去除空白、处理重复列名
    const headers = normalizeHeaders(rawHeaders);

    // 解析数据行
    const startIndex = skipHeader ? 2 : 1;
    const rows: Record<string, unknown>[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim().length === 0) continue;

      const values = parseCSVLine(line, delimiter);
      const row: Record<string, unknown> = {};

      for (let j = 0; j < headers.length; j++) {
        const value = j < values.length ? (values[j] ?? '') : '';
        // 循环条件保证 j < headers.length，headers[j] 一定存在
        const header = headers[j] as string;
        row[header] = inferType(value);
      }

      rows.push(row);
    }

    const parsedData: ParsedData = {
      headers,
      rows,
      meta: {
        rowCount: rows.length,
        colCount: headers.length,
        ...(fileName !== undefined && { fileName }),
        parsedAt: Date.now(),
      },
    };

    return { ok: true, data: parsedData };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { code: 'PARSE_ERROR', message: `CSV 解析失败: ${message}` },
    };
  }
}

/**
 * 解析单行 CSV
 * 支持引号包裹字段和转义引号
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // 检查是否为转义引号（双引号）
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        } else {
          // 引号结束
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        result.push(current.trim());
        current = '';
        i++;
        continue;
      } else {
        current += char;
        i++;
      }
    }
  }

  // 添加最后一个字段
  result.push(current.trim());

  return result;
}

/**
 * 规范化表头
 * 去除空白、处理重复列名
 */
function normalizeHeaders(rawHeaders: string[]): string[] {
  const headers: string[] = [];
  const seen = new Map<string, number>();

  for (const raw of rawHeaders) {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      headers.push(`col_${headers.length + 1}`);
      continue;
    }

    // 处理重复列名
    const count = seen.get(trimmed) ?? 0;
    seen.set(trimmed, count + 1);

    if (count === 0) {
      headers.push(trimmed);
    } else {
      headers.push(`${trimmed}_${count + 1}`);
    }
  }

  return headers;
}

/**
 * 类型推断
 * 将字符串值转为合适的类型
 */
function inferType(value: string): unknown {
  const trimmed = value.trim();

  // 空值
  if (trimmed === '' || trimmed === 'null' || trimmed === 'NULL') {
    return null;
  }

  // 布尔值
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;

  // 数值
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    // 区分整数和浮点数
    if (trimmed.includes('.') || trimmed.includes('e') || trimmed.includes('E')) {
      return num;
    }
    return Number.isSafeInteger(num) ? num : num;
  }

  // 默认字符串
  return trimmed;
}