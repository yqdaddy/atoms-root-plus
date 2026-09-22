/**
 * /export 命令：导出当前项目。
 */
import type { Command, CommandContext, CommandResult, CommandSuggestion } from './types';

/** 导出命令定义 */
export const exportCommand: Command = {
  name: 'export',
  description: '导出当前项目为 ZIP',
  icon: 'lucide:download',

  async execute(_args: string, context: CommandContext): Promise<CommandResult> {
    await context.exportProject();
    return { success: true, action: 'export' };
  },
};

/** 导出命令建议（用于下拉列表） */
export function getExportSuggestions(): CommandSuggestion[] {
  return [
    { name: 'export', description: '导出当前项目为 ZIP', icon: 'lucide:download' },
  ];
}