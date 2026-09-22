/**
 * useKeybinding hook 单元测试
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeybinding, formatKeybinding, type Keybinding } from './useKeybinding.js';

describe('useKeybinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('简单按键触发动作', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'Escape', action, description: '取消' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // 模拟按下 Escape
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(event);

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith();

    unmount();
  });

  it('Ctrl 组合键触发动作', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'Enter', ctrl: true, action, description: '提交' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // 单独按 Enter 不触发
    const event1 = new KeyboardEvent('keydown', { key: 'Enter' });
    window.dispatchEvent(event1);
    expect(action).not.toHaveBeenCalled();

    // Ctrl+Enter 触发
    const event2 = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true });
    window.dispatchEvent(event2);
    expect(action).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('Shift 组合键触发动作', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'A', shift: true, action, description: '全选' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // Shift+A 触发
    const event = new KeyboardEvent('keydown', { key: 'A', shiftKey: true });
    window.dispatchEvent(event);
    expect(action).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('Alt 组合键触发动作', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'F', alt: true, action, description: '文件菜单' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // Alt+F 触发
    const event = new KeyboardEvent('keydown', { key: 'F', altKey: true });
    window.dispatchEvent(event);
    expect(action).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('多修饰键组合', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'S', ctrl: true, shift: true, action, description: '另存为' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // Ctrl+S 不触发
    const event1 = new KeyboardEvent('keydown', { key: 'S', ctrlKey: true });
    window.dispatchEvent(event1);
    expect(action).not.toHaveBeenCalled();

    // Ctrl+Shift+S 触发
    const event2 = new KeyboardEvent('keydown', {
      key: 'S',
      ctrlKey: true,
      shiftKey: true,
    });
    window.dispatchEvent(event2);
    expect(action).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('按键不区分大小写', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'a', ctrl: true, action, description: '全选' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // Ctrl+a 触发
    const event1 = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
    window.dispatchEvent(event1);
    expect(action).toHaveBeenCalledTimes(1);

    // Ctrl+A 也触发
    const event2 = new KeyboardEvent('keydown', { key: 'A', ctrlKey: true });
    window.dispatchEvent(event2);
    expect(action).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('阻止浏览器默认行为', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'L', ctrl: true, action, description: '清空' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // 创建一个可以跟踪 preventDefault 的 mock 事件
    const preventDefaultMock = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'L', ctrlKey: true });
    // 重写 preventDefault 方法
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefaultMock,
      writable: true,
    });

    window.dispatchEvent(event);

    // preventDefault 应该被调用
    expect(preventDefaultMock).toHaveBeenCalled();

    unmount();
  });

  it('阻止事件冒泡', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'Escape', action, description: '取消' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // 创建一个可以跟踪 stopPropagation 的 mock 事件
    const stopPropagationMock = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    Object.defineProperty(event, 'stopPropagation', {
      value: stopPropagationMock,
      writable: true,
    });

    window.dispatchEvent(event);

    // stopPropagation 应该被调用
    expect(stopPropagationMock).toHaveBeenCalled();

    unmount();
  });

  it('多个快捷键绑定', () => {
    const action1 = vi.fn();
    const action2 = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'Enter', ctrl: true, action: action1, description: '提交' },
      { key: 'Escape', action: action2, description: '取消' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // Ctrl+Enter
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).not.toHaveBeenCalled();

    // Escape
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(action2).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('动态更新绑定', () => {
    const action1 = vi.fn();
    const action2 = vi.fn();

    const { unmount, rerender } = renderHook(
      ({ bindings }: { bindings: Keybinding[] }) => useKeybinding(bindings),
      {
        initialProps: {
          bindings: [{ key: 'A', action: action1, description: '动作A' }],
        },
      }
    );

    // 初始绑定
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    expect(action1).toHaveBeenCalledTimes(1);

    // 更新绑定
    rerender({
      bindings: [{ key: 'B', action: action2, description: '动作B' }],
    });

    // A 不再触发
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    expect(action1).toHaveBeenCalledTimes(1); // 仍然是 1

    // B 触发
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B' }));
    expect(action2).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('卸载后移除事件监听', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'Escape', action, description: '取消' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // 卸载前触发
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(action).toHaveBeenCalledTimes(1);

    unmount();

    // 卸载后不触发
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(action).toHaveBeenCalledTimes(1); // 仍然是 1
  });

  it('精确匹配修饰键：不允许额外修饰键', () => {
    const action = vi.fn();
    const bindings: Keybinding[] = [
      { key: 'Enter', ctrl: true, action, description: '提交' },
    ];

    const { unmount } = renderHook(() => useKeybinding(bindings));

    // Ctrl+Shift+Enter 不应该触发（多了 Shift）
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      shiftKey: true,
    });
    window.dispatchEvent(event);
    expect(action).not.toHaveBeenCalled();

    unmount();
  });

  it('空绑定列表不报错', () => {
    const { unmount } = renderHook(() => useKeybinding([]));

    // 按任意键不报错
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    unmount();
  });
});

describe('formatKeybinding', () => {
  it('格式化简单按键', () => {
    expect(formatKeybinding({ key: 'Escape', action: () => {}, description: '取消' })).toBe('Escape');
  });

  it('格式化单字母按键（大写）', () => {
    expect(formatKeybinding({ key: 'a', action: () => {}, description: '测试' })).toBe('A');
  });

  it('格式化 Ctrl 组合键', () => {
    const result = formatKeybinding({ key: 'Enter', ctrl: true, action: () => {}, description: '提交' });
    // 根据平台可能是 Ctrl+Enter 或 Cmd+Enter
    expect(result).toMatch(/(Ctrl|Cmd)\+Enter/);
  });

  it('格式化 Shift 组合键', () => {
    expect(formatKeybinding({ key: 'A', shift: true, action: () => {}, description: '测试' })).toBe('Shift+A');
  });

  it('格式化 Alt 组合键', () => {
    const result = formatKeybinding({ key: 'F', alt: true, action: () => {}, description: '菜单' });
    // 根据平台可能是 Alt+F 或 Option+F
    expect(result).toMatch(/(Alt|Option)\+F/);
  });

  it('格式化多修饰键组合', () => {
    const result = formatKeybinding({
      key: 'S',
      ctrl: true,
      shift: true,
      action: () => {},
      description: '另存为',
    });
    // 根据平台可能是 Ctrl+Shift+S 或 Cmd+Shift+S
    expect(result).toMatch(/(Ctrl|Cmd)\+Shift\+S/);
  });

  it('格式化特殊按键', () => {
    expect(formatKeybinding({ key: 'F1', action: () => {}, description: '帮助' })).toBe('F1');
    expect(formatKeybinding({ key: 'ArrowUp', action: () => {}, description: '上' })).toBe('ArrowUp');
  });
});