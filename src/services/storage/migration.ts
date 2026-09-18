/**
 * 数据迁移系统。
 * 处理 schema version 升级时的向后兼容。
 */

import type { StorageEnvelope, MigrationTable, MigrationResult } from '../../types/storage';
import { isStorageEnvelope, CURRENT_SCHEMA_VERSION } from '../../types/storage';
import { isProject } from '../../types/project';
import type { Project } from '../../types/project';

/**
 * 迁移函数表。
 * 当前 schema version = 1，尚无历史版本需要迁移。
 * 未来 schema 升级时在此添加迁移函数：
 *
 * 例：从 v1 → v2
 * const MIGRATIONS: MigrationTable = {
 *   1: (data: unknown) => {
 *     // v1 结构 → v2 结构
 *     return { ...data, newField: 'defaultValue' };
 *   },
 * };
 */
const MIGRATIONS: MigrationTable = {};

/**
 * 对原始 payload 执行迁移链。
 * 从 envelope.schemaVersion 开始，依次执行 (v → v+1) 的迁移函数，
 * 直到达到 CURRENT_SCHEMA_VERSION。
 *
 * @param rawPayload 原始 payload（未迁移）
 * @param fromVersion 起始版本号
 * @returns 迁移后的 payload，或抛出错误
 */
function runMigrationChain(rawPayload: unknown, fromVersion: number): unknown {
  let payload = rawPayload;
  let version = fromVersion;

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new Error(`缺少从版本 ${version} 到 ${version + 1} 的迁移函数`);
    }
    payload = migrate(payload);
    version += 1;
  }

  return payload;
}

/**
 * 从 localStorage 读取并迁移项目数据。
 *
 * 流程：
 * 1. 解析 JSON，验证信封格式
 * 2. 如果版本号 > 当前版本，拒绝（未来版本无法降级）
 * 3. 如果版本号 < 当前版本，执行迁移链
 * 4. 验证迁移后的数据结构
 * 5. 返回迁移后的信封
 *
 * @param raw localStorage 中的原始字符串
 * @returns 迁移结果（包含 envelope 或错误原因）
 */
export function migrateProject(raw: string): MigrationResult<Project> {
  try {
    const parsed = JSON.parse(raw);

    // 1. 验证信封格式
    if (!isStorageEnvelope(parsed)) {
      return { ok: false, reason: 'validate-failed' };
    }

    const envelope = parsed as StorageEnvelope<unknown>;
    const { schemaVersion, savedAt, data } = envelope;

    // 2. 未来版本无法降级
    if (schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { ok: false, reason: 'future-version' };
    }

    // 3. 执行迁移链
    let migratedData: unknown;
    if (schemaVersion < CURRENT_SCHEMA_VERSION) {
      try {
        migratedData = runMigrationChain(data, schemaVersion);
      } catch (err) {
        return {
          ok: false,
          reason: 'step-threw',
        };
      }
    } else {
      migratedData = data;
    }

    // 4. 验证迁移后的数据结构
    if (!isProject(migratedData)) {
      return { ok: false, reason: 'validate-failed' };
    }

    // 5. 返回迁移后的信封（更新 schemaVersion 和 savedAt）
    return {
      ok: true,
      envelope: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt,
        data: migratedData,
      },
    };
  } catch {
    // JSON 解析失败
    return { ok: false, reason: 'validate-failed' };
  }
}

/**
 * 检查是否需要迁移。
 * 用于初始化时快速扫描所有项目。
 */
export function needsMigration(schemaVersion: number): boolean {
  return schemaVersion < CURRENT_SCHEMA_VERSION;
}

/**
 * 获取当前 schema version。
 */
export function getSchemaVersion(): number {
  return CURRENT_SCHEMA_VERSION;
}