/**
 * /clear 命令：清空当前对话。
 */
import type { Command, CommandContext, CommandResult, CommandSuggestion } from './types';

/** 清空命令定义 */
export const clearCommand: Command = {
  name: 'clear',
  description: '清空当前对话',
  icon: 'lucide:trash-2',
  aliases: ['cls'],

  execute(_args: string, context: CommandContext): CommandResult {
    context.clearChat();
    context.showToast('对话已清空', 'success');
    return { success: true, action: 'clear' };
  },
};

/** 导出命令建议（用于下拉列表） */
export function getClearSuggestions(): CommandSuggestion[] {
  return [
    { name: 'clear', description: '清空当前对话', icon: 'lucide:trash-2' },
    { name: 'cls', description: '清空当前对话（别名）', icon: 'lucide:trash-2', isAlias: true },
  ];
}