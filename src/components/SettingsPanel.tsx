/**
 * 设置面板组件。
 * 配置工具权限等选项。
 */
import Modal from './Modal';
import { Icon } from '@iconify/react';
import PermissionSettingsSection from './PermissionSettingsSection';

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  return (
    <Modal open={open} onClose={onClose} title="设置" maxWidth="520px">
      <div className="space-y-5">
        {/* LLM 配置说明 */}
        <div className="px-4 py-3 bg-[var(--color-bg-elevated)] rounded-[10px] border border-[var(--color-border-default)]">
          <div className="flex items-start gap-3">
            <Icon
              icon="lucide:info"
              width={16}
              height={16}
              className="text-[var(--color-text-tertiary)] mt-0.5 shrink-0"
            />
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-[1.6]">
              LLM 配置由服务端管理，当前无法在前端自定义。如需自定义，请配置服务端环境变量（<code className="px-1 py-0.5 bg-[var(--color-bg-base)] rounded text-[var(--color-text-primary)] font-mono text-[12px]">LLM_API_KEY</code>、<code className="px-1 py-0.5 bg-[var(--color-bg-base)] rounded text-[var(--color-text-primary)] font-mono text-[12px]">LLM_BASE_URL</code>）。
            </p>
          </div>
        </div>
      </div>

      {/* 权限配置分隔 */}
      <div className="mt-6 pt-6 border-t border-[var(--color-border-default)]">
        <div className="flex items-center gap-2 mb-4">
          <Icon
            icon="lucide:shield-check"
            width={16}
            height={16}
            className="text-[var(--color-text-tertiary)]"
          />
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            工具权限
          </h3>
        </div>
        <PermissionSettingsSection />
      </div>

      {/* 底部按钮 */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onClose}
          className="px-5 py-2 rounded-[10px] text-[14px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms]"
        >
          完成
        </button>
      </div>
    </Modal>
  );
}