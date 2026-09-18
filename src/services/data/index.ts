/**
 * 数据导入服务
 * 统一入口，支持 CSV 和 JSON 格式
 */

export type { DataImportOptions, DataImportResult, DataImportFormat, ParsedData } from './types';
export { parseCSV } from './csvParser';
export { parseJSON, toJSON } from './jsonParser';

import { parseCSV } from './csvParser';
import { parseJSON } from './jsonParser';
import type { DataImportFormat, DataImportOptions, DataImportResult } from './types';

/**
 * 根据格式自动选择解析器
 */
export function importData(
  content: string,
  format: DataImportFormat,
  options: DataImportOptions = {},
): DataImportResult {
  switch (format) {
    case 'csv':
      return parseCSV(content, options);
    case 'json':
      return parseJSON(content, options);
    default:
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_TYPE',
          message: `不支持的格式: ${format}`,
        },
      };
  }
}

/**
 * 从文件扩展名推断格式
 */
export function inferFormat(fileName: string): DataImportFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'csv':
      return 'csv';
    case 'json':
      return 'json';
    default:
      return null;
  }
}