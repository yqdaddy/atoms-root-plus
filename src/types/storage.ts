/**
 * localStorage 存储信封、key 布局与迁移链类型。
 */

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * 存储信封：每个 localStorage key 的值都是这个结构。
 * schemaVersion 只存在于信封一层，payload 类型不自报版本，避免双份真源。
 */
export interface StorageEnvelope<T> {
  schemaVersion: number;
  /** 本次写入时间，ISO 8601 */
  savedAt: string;
  data: T;
}

export function isStorageEnvelope(value: unknown): value is StorageEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number'
    && Number.isInteger(v.schemaVersion)
    && v.schemaVersion >= 1
    && typeof v.savedAt === 'string'
    && 'data' in v
  );
}

/** 迁移函数：输入上一版本 payload，输出下一版本 payload。失败时抛错，由调用方隔离处理 */
export type MigrationFn = (data: unknown) => unknown;
/** 键为源版本号，值为升级到 (源版本号 + 1) 的函数 */
export type MigrationTable = Readonly<Record<number, MigrationFn>>;

export interface MigrationResult<T> {
  ok: boolean;
  envelope?: StorageEnvelope<T>;
  /** 失败原因，用于隔离备份的元数据 */
  reason?: 'chain-gap' | 'step-threw' | 'validate-failed' | 'future-version';
}

/** 存储作用域，对应 localStorage key 的第三段 */
export type StorageScope = 'meta' | 'projects' | 'settings' | 'backup' | 'preferences' | 'versions' | 'plans';

const APP_PREFIX = 'litpp';
/** key 中的格式代际。仅当值形态无法用数据变换表达时才 bump，正常演进走 schemaVersion */
const KEY_GENERATION = 'v1';

export function storageKey(scope: StorageScope, id?: string): string {
  return id ? `${APP_PREFIX}:${KEY_GENERATION}:${scope}:${id}` : `${APP_PREFIX}:${KEY_GENERATION}:${scope}`;
}

/** 隔离备份 key 的元信息 */
export interface QuarantineMeta {
  /** 备份 ID（用于恢复或清理） */
  backupId?: string;
  originalKey: string;
  reason: string;
  quarantinedAt: string;
}