/**
 * 斜杠命令系统类型定义。
 *
 * 支持 /help、/clear、/new、/export 等命令，
 * 输入框检测到 / 开头的输入时显示命令建议，
 * 回车或空格执行命令。
 */

/** 命令执行上下文 */
export interface CommandContext {
  /** 当前项目 ID（用于清空/导出） */
  projectId?: string;
  /** 清空当前对话 */
  clearChat: () => void;
  /** 新建项目 */
  createNewProject: () => void;
  /** 导出当前项目 */
  exportProject: () => void;
  /** 显示提示消息 */
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** 命令执行结果 */
export interface CommandResult {
  /** 是否成功 */
  success: boolean;
  /** 显示给用户的消息（可选） */
  message?: string;
  /** 触发的 UI 动作（可选） */
  action?: 'clear' | 'new' | 'export';
}

/** 命令定义 */
export interface Command {
  /** 命令名（不含 /） */
  name: string;
  /** 帮助描述 */
  description: string;
  /** 命令图标（lucide 图标名） */
  icon: string;
  /** 执行命令 */
  execute: (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;
  /** 是否在帮助中隐藏（如别名命令） */
  hidden?: boolean;
  /** 别名（如 clear 的 cls 别名） */
  aliases?: string[];
}

/** 命令建议项（用于下拉列表） */
export interface CommandSuggestion {
  name: string;
  description: string;
  icon: string;
  /** 是否为别名 */
  isAlias?: boolean;
}