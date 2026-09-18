/**
 * 存储服务统一导出。
 */

// 类型定义
export type { ExportData, ImportOptions, ImportResult } from './types';
export { EXPORT_VERSION } from './types';

// 迁移系统
export { migrateProject, needsMigration, getSchemaVersion } from './migration';

// 隔离备份
export {
  quarantineData,
  restoreQuarantine,
  listQuarantines,
  cleanupOldQuarantines,
  clearAllQuarantines,
} from './quarantine';

// 导出功能
export {
  exportAllProjects,
  exportProject,
  downloadExport,
} from './export';

// 导入功能
export {
  importProjects,
  validateExportFile,
} from './import';

// API 同步
export {
  checkApiHealth,
  isApiAvailable,
  fetchProjectSummaries,
  fetchProject,
  createProjectApi,
  updateProjectApi,
  deleteProjectApi,
  initializeSync,
  mergeProjects,
} from './apiSync';

// 本地持久化
export { persistProjectDetail } from './localPersistence';