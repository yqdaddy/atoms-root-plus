/**
 * 快捷键系统 hook。
 * 支持修饰键组合（Ctrl/Shift/Alt），阻止浏览器默认行为。
 */

import { useEffect, useCallback } from 'react';

/**
 * 快捷键绑定配置
 */
export interface Keybinding {
  /** 按键（不区分大小写，如 'Enter', 'a', '1'） */
  key: string;
  /** 是否需要 Ctrl（Mac 上为 Meta/Command） */
  ctrl?: boolean;
  /** 是否需要 Shift */
  shift?: boolean;
  /** 是否需要 Alt（Mac 上为 Option） */
  alt?: boolean;
  /** 触发的动作 */
  action: () => void;
  /** 快捷键描述（用于帮助显示） */
  description: string;
}

/**
 * 判断按键是否匹配（忽略大小写）
 */
function keyMatches(eventKey: string, bindingKey: string): boolean {
  return eventKey.toLowerCase() === bindingKey.toLowerCase();
}

/**
 * 判断修饰键是否匹配
 */
function modifiersMatch(
  event: KeyboardEvent,
  binding: Keybinding
): boolean {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const ctrlKey = isMac ? event.metaKey : event.ctrlKey;

  const expectedCtrl = binding.ctrl ?? false;
  const expectedShift = binding.shift ?? false;
  const expectedAlt = binding.alt ?? false;

  // 精确匹配：要求的修饰键必须按下，未要求的修饰键不能按下
  return (
    ctrlKey === expectedCtrl &&
    event.shiftKey === expectedShift &&
    event.altKey === expectedAlt
  );
}

/**
 * 注册全局快捷键。
 *
 * @param bindings 快捷键绑定列表
 *
 * @example
 * useKeybinding([
 *   { key: 'Enter', ctrl: true, action: handleSubmit, description: '提交输入' },
 *   { key: 'Escape', action: handleCancel, description: '取消生成' },
 * ]);
 */
export function useKeybinding(bindings: Keybinding[]): void {
  // 使用 useCallback 确保事件处理器稳定
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 遍历所有绑定，查找匹配项
      for (const binding of bindings) {
        if (keyMatches(event.key, binding.key) && modifiersMatch(event, binding)) {
          // 阻止浏览器默认行为（如 Ctrl+L 打开地址栏）
          event.preventDefault();
          // 阻止事件冒泡
          event.stopPropagation();
          // 执行动作
          binding.action();
          return;
        }
      }
    },
    [bindings]
  );

  useEffect(() => {
    // 添加全局键盘事件监听
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      // 清理：移除事件监听
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * 格式化快捷键为可读字符串（用于帮助显示）
 */
export function formatKeybinding(binding: Keybinding): string {
  const parts: string[] = [];

  if (binding.ctrl) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    parts.push(isMac ? 'Cmd' : 'Ctrl');
  }
  if (binding.shift) {
    parts.push('Shift');
  }
  if (binding.alt) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    parts.push(isMac ? 'Option' : 'Alt');
  }

  // 格式化按键名：首字母大写，特殊键保持原样
  const keyName = binding.key.length === 1
    ? binding.key.toUpperCase()
    : binding.key;

  parts.push(keyName);

  return parts.join('+');
}