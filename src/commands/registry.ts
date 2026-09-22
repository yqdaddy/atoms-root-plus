/**
 * 命令注册表。
 *
 * 独立于命令定义，避免循环依赖。
 */
import type { Command, CommandSuggestion } from './types';

/** 所有注册的命令（name -> Command） */
export const commands: Map<string, Command> = new Map();

/** 别名映射（alias -> name） */
export const aliases: Map<string, string> = new Map();

/** 注册命令 */
export function registerCommand(command: Command): void {
  commands.set(command.name, command);
  // 注册别名
  if (command.aliases) {
    for (const alias of command.aliases) {
      aliases.set(alias, command.name);
    }
  }
}

/** 获取所有命令（排除隐藏的） */
export function getAllCommands(): Command[] {
  return Array.from(commands.values()).filter(cmd => !cmd.hidden);
}

/** 根据名称获取命令 */
export function getCommand(name: string): Command | undefined {
  // 先查原名
  let command = commands.get(name);
  if (command) return command;
  // 再查别名
  const realName = aliases.get(name);
  if (realName) {
    return commands.get(realName);
  }
  return undefined;
}

/** 根据前缀获取命令建议 */
export function getCommandSuggestions(prefix: string): CommandSuggestion[] {
  // 去掉开头的 /
  const query = prefix.startsWith('/') ? prefix.slice(1).toLowerCase() : prefix.toLowerCase();

  if (!query) {
    // 空查询：返回所有命令
    return getAllCommands().map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      icon: cmd.icon,
    }));
  }

  // 按前缀匹配
  const suggestions: CommandSuggestion[] = [];

  for (const cmd of commands.values()) {
    // 匹配原名
    if (cmd.name.toLowerCase().startsWith(query)) {
      if (!cmd.hidden) {
        suggestions.push({
          name: cmd.name,
          description: cmd.description,
          icon: cmd.icon,
        });
      }
    }
    // 匹配别名
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        if (alias.toLowerCase().startsWith(query)) {
          suggestions.push({
            name: alias,
            description: `${cmd.description}（别名）`,
            icon: cmd.icon,
            isAlias: true,
          });
        }
      }
    }
  }

  return suggestions;
}