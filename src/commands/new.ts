/**
 * /new 命令：新建项目。
 */
import type { Command, CommandContext, CommandResult, CommandSuggestion } from './types';

/** 新建命令定义 */
export const newCommand: Command = {
  name: 'new',
  description: '新建项目',
  icon: 'lucide:plus',

  execute(_args: string, context: CommandContext): CommandResult {
    context.createNewProject();
    context.showToast('已创建新项目', 'success');
    return { success: true, action: 'new' };
  },
};

/** 导出命令建议（用于下拉列表） */
export function getNewSuggestions(): CommandSuggestion[] {
  return [
    { name: 'new', description: '新建项目', icon: 'lucide:plus' },
  ];
}