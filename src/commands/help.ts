/**
 * /help 命令：显示所有命令帮助。
 */
import type { Command, CommandContext, CommandResult, CommandSuggestion } from './types';
import { getAllCommands } from './registry';

/** 帮助命令定义 */
export const helpCommand: Command = {
  name: 'help',
  description: '显示所有命令帮助',
  icon: 'lucide:help-circle',

  execute(_args: string, context: CommandContext): CommandResult {
    // 获取所有注册的命令（排除隐藏的）
    const commands = getAllCommands().filter((cmd) => !cmd.hidden);

    // 构建帮助文本
    const lines: string[] = ['**可用命令：**', ''];
    for (const cmd of commands) {
      lines.push(`- \`/${cmd.name}\` ${cmd.description}`);
      // 显示别名
      if (cmd.aliases && cmd.aliases.length > 0) {
        lines.push(`  别名：${cmd.aliases.map(a => `\`/${a}\``).join('、')}`);
      }
    }
    lines.push('');
    lines.push('输入 \`/命令名\` 后按回车执行命令。');

    context.showToast(lines.join('\n'), 'info');
    return { success: true, message: '命令列表已显示' };
  },
};

/** 导出命令建议（用于下拉列表） */
export function getHelpSuggestions(): CommandSuggestion[] {
  return [
    { name: 'help', description: '显示所有命令帮助', icon: 'lucide:help-circle' },
  ];
}