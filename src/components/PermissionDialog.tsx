/**
 * 权限确认弹窗组件。
 * 显示工具名称、参数、风险说明，提供允许/拒绝/始终允许操作。
 */
import { useCallback, useMemo } from 'react';
import Modal from './Modal';
import { Icon } from '@iconify/react';
import { usePermissionStore } from '../stores/permissionStore';
import type { PermissionRequest } from '../types/permission';

export interface PermissionDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 工具名称到中文标签的映射 */
const TOOL_LABELS: Record<string, string> = {
  'file.read': '读取文件',
  'file.write': '写入文件',
  'file.create': '创建文件',
  'file.delete': '删除文件',
  'network.request': '网络请求',
  'network.fetch': '网络获取',
  'command.execute': '执行命令',
  'command.shell': '执行 Shell 命令',
  'sandbox.create': '创建沙箱',
  'sandbox.modify': '修改沙箱',
  'sandbox.delete': '删除沙箱',
  'clipboard.read': '读取剪贴板',
  'clipboard.write': '写入剪贴板',
};

/** 风险等级样式 */
const RISK_STYLES: Record<'high' | 'medium' | 'low', { icon: string; color: string; bg: string; border: string; label: string }> = {
  high: {
    icon: 'lucide:alert-circle',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.3)',
    label: '高风险',
  },
  medium: {
    icon: 'lucide:alert-circle',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.3)',
    label: '中风险',
  },
  low: {
    icon: 'lucide:shield-check',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.3)',
    label: '低风险',
  },
};

/** 根据工具名判断风险等级 */
function getRiskLevel(toolName: string): 'high' | 'medium' | 'low' {
  if (toolName.startsWith('command.') || toolName === 'file.delete') {
    return 'high';
  }
  if (toolName.startsWith('network.') || toolName.startsWith('file.')) {
    return 'medium';
  }
  return 'low';
}

/** 渲染参数列表 */
function ParamsList({ params }: { params: Record<string, unknown> }) {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[12px] font-medium text-[var(--color-text-tertiary)]">参数详情</p>
      <div className="bg-[var(--color-bg-elevated)] rounded-[8px] border border-[var(--color-border-default)] p-3 space-y-1.5 max-h-40 overflow-auto">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 text-[12px]">
            <span className="text-[var(--color-text-tertiary)] font-mono shrink-0">{key}:</span>
            <span className="text-[var(--color-text-secondary)] font-mono break-all">
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PermissionDialog({ open, onClose }: PermissionDialogProps) {
  const pendingRequest = usePermissionStore((s) => s.pendingRequest);
  const handleUserDecision = usePermissionStore((s) => s.handleUserDecision);

  const request: PermissionRequest | null = pendingRequest;

  const riskLevel = useMemo(
    () => (request ? getRiskLevel(request.toolName) : 'low'),
    [request]
  );
  const riskStyle = RISK_STYLES[riskLevel];

  const toolLabel = request
    ? TOOL_LABELS[request.toolName] ?? request.toolName
    : '';

  const params = useMemo(() => {
    if (!request?.params) return null;
    return Object.keys(request.params).length > 0 ? request.params : null;
  }, [request]);

  const handleAllow = useCallback(() => {
    if (!request) return;
    handleUserDecision(request, true, false);
    onClose();
  }, [request, handleUserDecision, onClose]);

  const handleAlwaysAllow = useCallback(() => {
    if (!request) return;
    handleUserDecision(request, true, true);
    onClose();
  }, [request, handleUserDecision, onClose]);

  const handleDeny = useCallback(() => {
    if (!request) return;
    handleUserDecision(request, false, false);
    onClose();
  }, [request, handleUserDecision, onClose]);

  // 无待处理请求时不渲染
  if (!request) return null;

  return (
    <Modal
      open={open && !!pendingRequest}
      onClose={onClose}
      title="权限确认"
      maxWidth="440px"
      closeOnOverlay={false}
    >
      {/* 工具信息 */}
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-[10px] shrink-0"
          style={{ backgroundColor: riskStyle.bg }}
        >
          <Icon
            icon={riskStyle.icon}
            width={20}
            height={20}
            style={{ color: riskStyle.color }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {toolLabel}
            </h4>
            <span
              className="px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium"
              style={{
                color: riskStyle.color,
                backgroundColor: riskStyle.bg,
              }}
            >
              {riskStyle.label}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)] font-mono">
            {request.toolName}
          </p>
        </div>
      </div>

      {/* 风险说明 */}
      <div
        className="mt-4 px-3 py-2.5 rounded-[8px] text-[13px] leading-[1.5]"
        style={{
          backgroundColor: riskStyle.bg,
          border: `1px solid ${riskStyle.border}`,
          color: riskStyle.color,
        }}
      >
        {request.riskNote ?? '此操作需要权限确认。'}
      </div>

      {/* 参数详情 */}
      {params && <ParamsList params={params} />}

      {/* 操作按钮 */}
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleDeny}
          className="px-4 py-2 rounded-[10px] text-[13px] font-medium text-[#ef4444] border border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.08)] active:scale-[0.98] transition-all duration-[80ms]"
        >
          拒绝
        </button>
        <button
          type="button"
          onClick={handleAllow}
          className="px-4 py-2 rounded-[10px] text-[13px] font-medium text-[var(--color-text-primary)] border border-[var(--color-border-default)] hover:bg-[var(--color-bg-elevated)] active:scale-[0.98] transition-all duration-[80ms]"
        >
          允许
        </button>
        <button
          type="button"
          onClick={handleAlwaysAllow}
          className="px-4 py-2 rounded-[10px] text-[13px] font-medium text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms]"
        >
          始终允许
        </button>
      </div>

      {/* 提示信息 */}
      <p className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">
        选择"始终允许"将为此工具保存 allow 规则，可在设置中修改。
      </p>
    </Modal>
  );
}

/** 便捷 Hook：发起权限请求并等待结果 */
export function usePermissionGuard() {
  const requestPermission = usePermissionStore((s) => s.requestPermission);
  const checkPermission = usePermissionStore((s) => s.checkPermission);

  const guard = useCallback(
    async (request: PermissionRequest) => {
      // 先做快速检查，非 ask 级别不弹窗
      const quick = checkPermission(request);
      if (quick.decisionType !== 'ask') return quick;
      return requestPermission(request);
    },
    [checkPermission, requestPermission]
  );

  return { guard, checkPermission };
}