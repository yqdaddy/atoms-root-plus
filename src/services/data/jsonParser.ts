/**
 * JSON 数据解析与校验
 * 支持对象数组格式，转换为通用数据格式
 */

import type { DataImportOptions, DataImportResult, ParsedData } from './types';

/**
 * 解析 JSON 数据
 * @param content JSON 字符串
 * @param options 解析选项
 */
export function parseJSON(content: string, options: DataImportOptions = {}): DataImportResult {
  const { fileName, maxRows = 10000 } = options;

  // 空文件检查
  if (!content || content.trim().length === 0) {
    return {
      ok: false,
      error: { code: 'EMPTY_FILE', message: '文件内容为空' },
    };
  }

  try {
    const parsed = JSON.parse(content);

    // 必须是数组
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_FORMAT',
          message: 'JSON 必须是数组格式（对象数组）',
        },
      };
    }

    // 空数组
    if (parsed.length === 0) {
      return {
        ok: false,
        error: { code: 'EMPTY_FILE', message: 'JSON 数组为空' },
      };
    }

    // 行数限制检查
    if (parsed.length > maxRows) {
      return {
        ok: false,
        error: {
          code: 'ROW_LIMIT_EXCEEDED',
          message: `数据行数 ${parsed.length} 超过限制 ${maxRows}`,
        },
      };
    }

    // 验证每个元素都是对象
    for (let i = 0; i < parsed.length; i++) {
      if (typeof parsed[i] !== 'object' || parsed[i] === null || Array.isArray(parsed[i])) {
        return {
          ok: false,
          error: {
            code: 'INVALID_FORMAT',
            message: `数组元素 ${i + 1} 不是对象`,
            line: i + 1,
          },
        };
      }
    }

    // 提取表头（所有对象的键的并集）
    const headerSet = new Set<string>();
    for (const obj of parsed) {
      const record = obj as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        headerSet.add(key);
      }
    }

    const headers = Array.from(headerSet);

    if (headers.length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_FORMAT', message: '无法提取字段名' },
      };
    }

    // 构建行数据
    const rows: Record<string, unknown>[] = parsed.map((obj) => {
      const record = obj as Record<string, unknown>;
      const row: Record<string, unknown> = {};

      for (const header of headers) {
        row[header] = header in record ? record[header] : null;
      }

      return row;
    });

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
      error: { code: 'PARSE_ERROR', message: `JSON 解析失败: ${message}` },
    };
  }
}

/**
 * 将 ParsedData 转回 JSON 字符串
 */
export function toJSON(data: ParsedData): string {
  return JSON.stringify(data.rows, null, 2);
}