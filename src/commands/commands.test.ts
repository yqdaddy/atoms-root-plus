/**
 * 斜杠命令系统单元测试。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCommandInput,
  getCommandSuggestions,
  getCommand,
  executeCommand,
  getAllCommands,
  registerBuiltInCommands,
} from './index';
import { commands, aliases } from './registry';
import type { CommandContext } from './types';

// 每个测试前清空命令注册表
beforeEach(() => {
  commands.clear();
  aliases.clear();
  // 重新注册内置命令
  registerBuiltInCommands();
});

// 模拟命令上下文
function createMockContext(): CommandContext {
  return {
    clearChat: () => {},
    createNewProject: () => {},
    exportProject: async () => {},
    showToast: () => {},
  };
}

describe('parseCommandInput', () => {
  it('识别以 / 开头的输入为命令', () => {
    expect(parseCommandInput('/help')).toEqual({
      isCommand: true,
      commandName: 'help',
      args: '',
    });

    expect(parseCommandInput('/clear')).toEqual({
      isCommand: true,
      commandName: 'clear',
      args: '',
    });
  });

  it('提取命令参数', () => {
    expect(parseCommandInput('/help arg1 arg2')).toEqual({
      isCommand: true,
      commandName: 'help',
      args: 'arg1 arg2',
    });
  });

  it('非命令输入返回 isCommand: false', () => {
    expect(parseCommandInput('hello world')).toEqual({
      isCommand: false,
    });

    expect(parseCommandInput('这是普通文本')).toEqual({
      isCommand: false,
    });
  });

  it('只有 / 的情况', () => {
    expect(parseCommandInput('/')).toEqual({
      isCommand: true,
      commandName: '',
      args: '',
    });
  });

  it('忽略首尾空格', () => {
    expect(parseCommandInput('  /help  ')).toEqual({
      isCommand: true,
      commandName: 'help',
      args: '',
    });
  });
});

describe('getCommand', () => {
  it('根据名称获取命令', () => {
    const helpCmd = getCommand('help');
    expect(helpCmd).toBeDefined();
    expect(helpCmd?.name).toBe('help');
    expect(helpCmd?.description).toBe('显示所有命令帮助');
  });

  it('根据别名获取命令', () => {
    const clearCmd = getCommand('cls');
    expect(clearCmd).toBeDefined();
    expect(clearCmd?.name).toBe('clear');
  });

  it('不存在的命令返回 undefined', () => {
    expect(getCommand('nonexistent')).toBeUndefined();
  });
});

describe('getCommandSuggestions', () => {
  it('空前缀返回所有命令', () => {
    const suggestions = getCommandSuggestions('/');
    expect(suggestions.length).toBeGreaterThan(0);
    // 检查是否包含内置命令
    const names = suggestions.map(s => s.name);
    expect(names).toContain('help');
    expect(names).toContain('clear');
    expect(names).toContain('new');
    expect(names).toContain('export');
  });

  it('根据前缀过滤命令', () => {
    const suggestions = getCommandSuggestions('/c');
    const names = suggestions.map(s => s.name);
    expect(names).toContain('clear');
    expect(names).not.toContain('help');
  });

  it('匹配别名', () => {
    const suggestions = getCommandSuggestions('/cl');
    const names = suggestions.map(s => s.name);
    expect(names).toContain('clear');
    expect(names).toContain('cls');
  });

  it('不区分大小写', () => {
    const suggestions = getCommandSuggestions('/HELP');
    const names = suggestions.map(s => s.name);
    expect(names).toContain('help');
  });
});

describe('executeCommand', () => {
  it('执行 help 命令', async () => {
    const context = createMockContext();
    const result = await executeCommand('help', '', context);
    expect(result.success).toBe(true);
  });

  it('执行 clear 命令', async () => {
    let cleared = false;
    const context: CommandContext = {
      ...createMockContext(),
      clearChat: () => {
        cleared = true;
      },
    };

    const result = await executeCommand('clear', '', context);
    expect(result.success).toBe(true);
    expect(result.action).toBe('clear');
    expect(cleared).toBe(true);
  });

  it('执行 new 命令', async () => {
    let created = false;
    const context: CommandContext = {
      ...createMockContext(),
      createNewProject: () => {
        created = true;
      },
    };

    const result = await executeCommand('new', '', context);
    expect(result.success).toBe(true);
    expect(result.action).toBe('new');
    expect(created).toBe(true);
  });

  it('执行 export 命令', async () => {
    let exported = false;
    const context: CommandContext = {
      ...createMockContext(),
      exportProject: async () => {
        exported = true;
      },
    };

    const result = await executeCommand('export', '', context);
    expect(result.success).toBe(true);
    expect(result.action).toBe('export');
    expect(exported).toBe(true);
  });

  it('使用别名执行命令', async () => {
    let cleared = false;
    const context: CommandContext = {
      ...createMockContext(),
      clearChat: () => {
        cleared = true;
      },
    };

    const result = await executeCommand('cls', '', context);
    expect(result.success).toBe(true);
    expect(cleared).toBe(true);
  });

  it('不存在的命令返回失败', async () => {
    const context = createMockContext();
    const result = await executeCommand('nonexistent', '', context);
    expect(result.success).toBe(false);
    expect(result.message).toContain('未知命令');
  });
});

describe('getAllCommands', () => {
  it('返回所有非隐藏命令', () => {
    const commands = getAllCommands();
    expect(commands.length).toBeGreaterThan(0);

    // 检查是否包含内置命令
    const names = commands.map(c => c.name);
    expect(names).toContain('help');
    expect(names).toContain('clear');
    expect(names).toContain('new');
    expect(names).toContain('export');
  });

  it('每个命令都有必要的属性', () => {
    const commands = getAllCommands();
    for (const cmd of commands) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(cmd.icon).toBeTruthy();
      expect(typeof cmd.execute).toBe('function');
    }
  });
});