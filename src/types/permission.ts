/**
 * 工具权限类型定义。
 * 实现 Claude Code 风格的三态权限控制：allow / ask / deny。
 */

/** 权限级别 */
export type PermissionLevel = 'allow' | 'ask' | 'deny';

/** 工具权限配置 */
export interface ToolPermission {
  /** 工具名称 */
  toolName: string;
  /** 权限级别 */
  level: PermissionLevel;
  /** 权限描述 */
  description?: string;
}

/** 权限分类 */
export type PermissionCategory = 'file' | 'network' | 'command' | 'sandbox' | 'other';

/** 工具分类映射 */
export const TOOL_CATEGORIES: Record<string, PermissionCategory> = {
  // 文件操作
  'file.read': 'file',
  'file.write': 'file',
  'file.delete': 'file',
  'file.create': 'file',

  // 网络操作
  'network.request': 'network',
  'network.fetch': 'network',

  // 命令执行
  'command.execute': 'command',
  'command.shell': 'command',

  // 沙箱操作
  'sandbox.create': 'sandbox',
  'sandbox.modify': 'sandbox',
  'sandbox.delete': 'sandbox',

  // 其他
  'clipboard.read': 'other',
  'clipboard.write': 'other',
};

/** 默认权限规则 */
export const DEFAULT_PERMISSION_RULES: Record<PermissionCategory, PermissionLevel> = {
  file: 'ask',
  network: 'ask',
  command: 'deny',
  sandbox: 'allow',
  other: 'ask',
};

/** 权限配置 */
export interface PermissionConfig {
  /** 工具权限映射（覆盖默认规则） */
  tools: Record<string, PermissionLevel>;
  /** 分类默认规则 */
  categoryRules: Record<PermissionCategory, PermissionLevel>;
}

/** 权限请求 */
export interface PermissionRequest {
  /** 请求唯一标识（内部使用，用于匹配回调） */
  id?: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  params?: Record<string, unknown>;
  /** 风险说明 */
  riskNote?: string;
  /** 来源描述（用于日志） */
  source?: string;
}

/** 权限决策结果 */
export interface PermissionDecision {
  /** 是否允许 */
  allowed: boolean;
  /** 决策类型 */
  decisionType: 'allow' | 'ask' | 'deny' | 'user-allow' | 'user-deny';
  /** 是否记住选择 */
  remember?: boolean;
}