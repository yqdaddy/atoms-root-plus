/**
 * 数据导入类型定义
 * 支持将外部数据导入到生成的应用中
 */

/** 通用数据格式 */
export interface ParsedData {
  /** 表头/字段名 */
  headers: string[];
  /** 数据行，每行为字段名到值的映射 */
  rows: Record<string, unknown>[];
  /** 解析时的元信息 */
  meta?: {
    /** 行数 */
    rowCount: number;
    /** 列数 */
    colCount: number;
    /** 原始文件名 */
    fileName?: string | undefined;
    /** 解析时间戳 */
    parsedAt: number;
  };
}

/** 导入选项 */
export interface DataImportOptions {
  /** 文件名（可选，用于错误提示） */
  fileName?: string;
  /** CSV 分隔符（默认逗号，支持分号） */
  delimiter?: ',' | ';';
  /** 是否跳过首行（默认不跳过，首行为表头） */
  skipHeader?: boolean;
  /** 最大行数限制（防止内存溢出） */
  maxRows?: number;
}

/** 导入结果 */
export interface DataImportResult {
  /** 是否成功 */
  ok: boolean;
  /** 解析后的数据（成功时有值） */
  data?: ParsedData;
  /** 错误信息（失败时有值） */
  error?: {
    code: DataImportErrorCode;
    message: string;
    /** 行号（如果错误发生在特定行） */
    line?: number;
  };
}

/** 错误码 */
export type DataImportErrorCode =
  | 'EMPTY_FILE'
  | 'INVALID_FORMAT'
  | 'PARSE_ERROR'
  | 'ROW_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_TYPE';

/** 支持的导入格式 */
export type DataImportFormat = 'csv' | 'json';