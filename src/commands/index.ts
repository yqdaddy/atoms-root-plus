/**
 * 命令注册与解析。
 *
 * 支持：
 * - 注册命令
 * - 解析输入是否为命令
 * - 根据前缀获取命令建议
 * - 执行命令
 */
import type { CommandContext, CommandResult } from './types';
export type { CommandContext, CommandResult };
import { registerCommand, getAllCommands, getCommand as getCommandFromRegistry, getCommandSuggestions as getCommandSuggestionsFromRegistry } from './registry';
import { helpCommand } from './help';
import { clearCommand } from './clear';
import { newCommand } from './new';
import { exportCommand } from './export';

// 重新导出 registry 函数
export { registerCommand, getAllCommands, getCommandFromRegistry as getCommand, getCommandSuggestionsFromRegistry as getCommandSuggestions };

/** 初始化：注册内置命令 */
export function registerBuiltInCommands(): void {
  registerCommand(helpCommand);
  registerCommand(clearCommand);
  registerCommand(newCommand);
  registerCommand(exportCommand);
}

/** 解析输入，判断是否为命令 */
export function parseCommandInput(input: string): { isCommand: boolean; commandName?: string; args?: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { isCommand: false };
  }

  // 提取命令名和参数
  const match = trimmed.match(/^\/(\S+)\s*(.*)$/);
  if (!match) {
    // 只有 / 没有命令名
    return { isCommand: true, commandName: '', args: '' };
  }

  const name = match[1];
  if (!name) {
    return { isCommand: true, commandName: '', args: '' };
  }

  const argsStr = match[2] ?? '';
  return { isCommand: true, commandName: name, args: argsStr };
}

/** 执行命令 */
export async function executeCommand(
  commandName: string,
  args: string,
  context: CommandContext
): Promise<CommandResult> {
  const command = getCommandFromRegistry(commandName);
  if (!command) {
    context.showToast(`未知命令：/${commandName}`, 'error');
    return { success: false, message: `未知命令：/${commandName}` };
  }

  try {
    return await command.execute(args, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : '命令执行失败';
    context.showToast(message, 'error');
    return { success: false, message };
  }
}

/** 初始化命令系统（导入时自动执行） */
registerBuiltInCommands();