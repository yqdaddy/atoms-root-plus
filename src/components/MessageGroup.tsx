/**
 * 消息分组组件。
 * 将同一 runId 的消息归为一组，显示意图类型和折叠功能。
 */
import { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { ChatMessage, IntentType } from '../types/project';

/** 消息分组数据结构 */
export interface MessageGroup {
  runId: string;
  intent: IntentType;
  timestamp: number;
  messages: ChatMessage[];
  collapsed: boolean;
}

/** 意图类型到标签文案和颜色的映射 */
const INTENT_CONFIG: Record<IntentType, { label: string; color: string; bgColor: string; icon: string }> = {
  create: { label: '创建', color: 'text-blue-500', bgColor: 'bg-blue-500/10', icon: 'lucide:circle-plus' },
  modify: { label: '修改', color: 'text-green-500', bgColor: 'bg-green-500/10', icon: 'lucide:square-pen' },
  analyze: { label: '分析', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10', icon: 'lucide:search' },
  diagnose: { label: '诊断', color: 'text-orange-500', bgColor: 'bg-orange-500/10', icon: 'lucide:stethoscope' },
  conversation: { label: '对话', color: 'text-purple-500', bgColor: 'bg-purple-500/10', icon: 'lucide:message-circle' },
};

/** 格式化时间 */
function formatGroupTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `今天 ${timeStr}`;
  }
  if (isYesterday) {
    return `昨天 ${timeStr}`;
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 消息分组头部组件
 */
interface GroupHeaderProps {
  group: MessageGroup;
  onToggle: () => void;
  isLatest: boolean;
}

function GroupHeader({ group, onToggle, isLatest }: GroupHeaderProps) {
  const config = INTENT_CONFIG[group.intent] ?? INTENT_CONFIG.conversation;
  const messageCount = group.messages.length;

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-base)] border border-[var(--color-border-default)] transition-all duration-[140ms]"
    >
      {/* 意图图标和标签 */}
      <div className={`flex items-center gap-2 px-2 py-1 rounded ${config.bgColor}`}>
        <Icon icon={config.icon} width={14} height={14} className={config.color} />
        <span className={`text-[12px] font-medium ${config.color}`}>{config.label}</span>
      </div>

      {/* 时间戳 */}
      <span className="text-[11px] text-[var(--color-text-tertiary)]">
        {formatGroupTime(group.timestamp)}
      </span>

      {/* 消息数量 */}
      <span className="text-[11px] text-[var(--color-text-tertiary)]">
        {messageCount} 条消息
      </span>

      {/* 折叠图标（最新组不折叠，不显示折叠图标） */}
      {!isLatest && (
        <Icon
          icon={group.collapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'}
          width={14}
          height={14}
          className="ml-auto text-[var(--color-text-tertiary)]"
        />
      )}

      {/* 最新标签 */}
      {isLatest && (
        <span className="ml-auto text-[11px] text-[var(--color-accent)]">最新</span>
      )}
    </button>
  );
}

/**
 * 消息分组容器组件
 */
interface MessageGroupContainerProps {
  group: MessageGroup;
  children: React.ReactNode;
  isLatest: boolean;
}

export function MessageGroupContainer({ group, children, isLatest }: MessageGroupContainerProps) {
  const [collapsed, setCollapsed] = useState(!isLatest && group.collapsed);

  const handleToggle = useCallback(() => {
    if (!isLatest) {
      setCollapsed((prev) => !prev);
    }
  }, [isLatest]);

  return (
    <div className="space-y-2">
      {/* 分组头部 */}
      <GroupHeader
        group={{ ...group, collapsed }}
        onToggle={handleToggle}
        isLatest={isLatest}
      />

      {/* 消息列表（折叠时隐藏） */}
      {!collapsed && (
        <div className="pl-4 border-l-2 border-[var(--color-border-default)] space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 将消息按 runId 分组
 * @param messages 消息列表（按时间升序）
 * @returns 分组列表（按时间升序，最旧在前、最新在后，符合聊天 UI 阅读顺序；组内 messages 保持时间升序）
 */
export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groupMap = new Map<string, MessageGroup>();

  for (const msg of messages) {
    // 没有 runId 的消息归入默认组（兼容历史消息）
    const runId = msg.runId ?? 'default';

    if (!groupMap.has(runId)) {
      groupMap.set(runId, {
        runId,
        intent: msg.intentType ?? 'conversation',
        timestamp: new Date(msg.createdAt).getTime(),
        messages: [],
        collapsed: true,
      });
    }

    const group = groupMap.get(runId)!;
    group.messages.push(msg);

    // 更新时间戳为最新消息的时间
    const msgTime = new Date(msg.createdAt).getTime();
    if (msgTime > group.timestamp) {
      group.timestamp = msgTime;
    }
  }

  // 按时间升序排序（最旧在前、最新在后；稳定排序，同时间戳保持输入顺序）
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => a.timestamp - b.timestamp);

  return groups;
}