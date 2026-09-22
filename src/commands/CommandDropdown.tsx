/**
 * 命令建议下拉组件。
 *
 * 在输入框检测到 / 开头的输入时显示，
 * 支持键盘导航（上下箭头选择，回车执行），
 * 支持点击选择。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { CommandSuggestion } from './types';
import { getCommandSuggestions } from './index';

interface CommandDropdownProps {
  /** 当前输入值（带 / 前缀） */
  input: string;
  /** 选择命令时的回调 */
  onSelect: (command: CommandSuggestion) => void;
  /** 关闭下拉时的回调 */
  onClose: () => void;
  /** 下拉是否可见 */
  visible: boolean;
}

export function CommandDropdown({ input, onSelect, onClose, visible }: CommandDropdownProps) {
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 根据输入更新建议列表
  useEffect(() => {
    if (!visible) return;
    const newSuggestions = getCommandSuggestions(input);
    setSuggestions(newSuggestions);
    setSelectedIndex(0);
  }, [input, visible]);

  // 滚动到选中项
  useEffect(() => {
    if (!listRef.current) return;
    const selectedItem = listRef.current.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || suggestions.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % suggestions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (suggestions[selectedIndex]) {
            onSelect(suggestions[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [visible, suggestions, selectedIndex, onSelect, onClose]
  );

  // 注册键盘事件
  useEffect(() => {
    if (visible) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [visible, handleKeyDown]);

  if (!visible || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-xl shadow-lg overflow-hidden"
    >
      <div className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
        命令
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.name}
            onClick={() => onSelect(suggestion)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors ${
              index === selectedIndex
                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-base)]'
            } ${suggestion.isAlias ? 'opacity-60' : ''}`}
          >
            <Icon icon={suggestion.icon} width={16} height={16} className="shrink-0" />
            <span className="font-mono">/{suggestion.name}</span>
            <span className="flex-1 text-[var(--color-text-tertiary)]">{suggestion.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}