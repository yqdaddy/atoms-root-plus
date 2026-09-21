/**
 * 权限检查服务。
 * 根据配置检查工具权限，支持默认规则与工具覆盖。
 */
import type {
  PermissionLevel,
  PermissionConfig,
  PermissionRequest,
  PermissionDecision,
  PermissionCategory,
} from '../types/permission';
import { TOOL_CATEGORIES } from '../types/permission';

/** 获取工具的分类 */
export function getToolCategory(toolName: string): PermissionCategory {
  // 精确匹配
  const category = TOOL_CATEGORIES[toolName];
  if (category) return category;

  // 前缀匹配：如 file.xxx 归为 file
  const prefix = toolName.split('.')[0];
  if (prefix && prefix in TOOL_CATEGORIES) {
    return TOOL_CATEGORIES[prefix] as PermissionCategory;
  }

  return 'other';
}

/** 获取工具的权限级别 */
export function getPermissionLevel(
  toolName: string,
  config: PermissionConfig
): PermissionLevel {
  // 优先检查工具覆盖规则
  const toolLevel = config.tools[toolName];
  if (toolLevel) return toolLevel;

  // 使用分类默认规则
  const category = getToolCategory(toolName);
  return config.categoryRules[category];
}

/** 检查是否需要询问用户 */
export function shouldAskUser(
  toolName: string,
  config: PermissionConfig
): boolean {
  const level = getPermissionLevel(toolName, config);
  return level === 'ask';
}

/** 检查是否被禁止 */
export function isDenied(
  toolName: string,
  config: PermissionConfig
): boolean {
  const level = getPermissionLevel(toolName, config);
  return level === 'deny';
}

/** 检查是否允许 */
export function isAllowed(
  toolName: string,
  config: PermissionConfig
): boolean {
  const level = getPermissionLevel(toolName, config);
  return level === 'allow';
}

/** 创建权限决策 */
export function createDecision(
  level: PermissionLevel,
  userChoice?: 'allow' | 'deny',
  remember?: boolean
): PermissionDecision {
  if (level === 'allow') {
    return { allowed: true, decisionType: 'allow' };
  }

  if (level === 'deny') {
    return { allowed: false, decisionType: 'deny' };
  }

  // ask 级别需要用户选择
  if (userChoice === 'allow') {
    const result: PermissionDecision = {
      allowed: true,
      decisionType: 'user-allow',
    };
    if (remember !== undefined) result.remember = remember;
    return result;
  }

  if (userChoice === 'deny') {
    const result: PermissionDecision = {
      allowed: false,
      decisionType: 'user-deny',
    };
    if (remember !== undefined) result.remember = remember;
    return result;
  }

  // 默认不允许
  return { allowed: false, decisionType: 'ask' };
}

/** 获取工具的风险描述 */
export function getRiskNote(toolName: string, params?: Record<string, unknown>): string {
  const category = getToolCategory(toolName);

  const riskNotes: Record<PermissionCategory, string> = {
    file: '此操作将访问文件系统。',
    network: '此操作将发起网络请求。',
    command: '此操作将执行系统命令，存在安全风险。',
    sandbox: '此操作将修改沙箱环境。',
    other: '此操作需要权限确认。',
  };

  let note = riskNotes[category];

  // 根据具体参数补充风险信息
  if (category === 'file' && params?.path) {
    note = `此操作将访问文件：${params.path}`;
  }

  if (category === 'network' && params?.url) {
    note = `此操作将请求：${params.url}`;
  }

  return note;
}

/** 权限检查主函数 */
export function checkPermission(
  request: PermissionRequest,
  config: PermissionConfig
): PermissionDecision {
  const level = getPermissionLevel(request.toolName, config);

  // 自动决策
  if (level === 'allow') {
    return { allowed: true, decisionType: 'allow' };
  }

  if (level === 'deny') {
    return { allowed: false, decisionType: 'deny' };
  }

  // ask 级别需要等待用户决策
  // 此处返回 pending 状态，由 UI 层处理
  return {
    allowed: false,
    decisionType: 'ask',
  };
}