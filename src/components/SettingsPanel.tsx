/**
 * 设置面板组件。
 * 配置 API key、Provider、baseURL 等选项。
 */
import { useState, useCallback } from 'react';
import Modal from './Modal';
import { Icon } from '@iconify/react';
import { useSettingsStore } from '../stores/settingsStore';
import { PROVIDER_PRESETS } from '../services/ai/liveEngine';
import { toast } from './Toast';
import PermissionSettingsSection from './PermissionSettingsSection';

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { apiKey, setApiKey, providerId, setProvider, baseURL, setBaseURL } = useSettingsStore();
  const [localKey, setLocalKey] = useState(apiKey ?? '');
  const [showKey, setShowKey] = useState(false);

  const currentPreset = PROVIDER_PRESETS.find((p) => p.id === providerId) ?? PROVIDER_PRESETS[0]!;

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setProvider(e.target.value);
    },
    [setProvider]
  );

  const handleBaseURLChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setBaseURL(e.target.value);
    },
    [setBaseURL]
  );

  const handleKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalKey(e.target.value);
  }, []);

  const handleSave = useCallback(() => {
    setApiKey(localKey.trim() || null);
    toast.success('设置已保存');
    onClose();
  }, [localKey, setApiKey, onClose]);

  const handleClearKey = useCallback(() => {
    setLocalKey('');
    setApiKey(null);
    toast.info('API key 已清除');
  }, [setApiKey]);

  return (
    <Modal open={open} onClose={onClose} title="设置" maxWidth="520px">
      <div className="space-y-5">
        {/* Provider 选择 */}
        <div className="space-y-2">
          <label className="block text-[14px] font-medium text-[var(--color-text-primary)]">
            服务提供商
          </label>
          <select
            value={providerId}
            onChange={handleProviderChange}
            className="w-full px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[10px] text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-strong)] transition-colors"
          >
            {PROVIDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">
            默认接口地址：{currentPreset.baseURL}
          </p>
        </div>

        {/* 自定义 baseURL */}
        <div className="space-y-2">
          <label className="block text-[14px] font-medium text-[var(--color-text-primary)]">
            自定义接口地址
            <span className="ml-2 text-[12px] font-normal text-[var(--color-text-tertiary)]">
              （可选）
            </span>
          </label>
          <input
            type="url"
            value={baseURL}
            onChange={handleBaseURLChange}
            placeholder={currentPreset.baseURL}
            className="w-full px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[10px] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-strong)] transition-colors font-mono"
          />
          <p className="text-[12px] text-[var(--color-text-tertiary)]">
            留空则使用默认地址。支持中转或代理服务。
          </p>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <label className="block text-[14px] font-medium text-[var(--color-text-primary)]">
            API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={localKey}
              onChange={handleKeyChange}
              placeholder="sk-..."
              className="w-full px-3 py-2.5 pr-20 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] rounded-[10px] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-border-strong)] transition-colors font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <div className="flex items-start justify-between">
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              仅保存在浏览器内存中，刷新后需重新输入。
            </p>
            {localKey && (
              <button
                type="button"
                onClick={handleClearKey}
                className="text-[12px] text-[#ef4444] hover:underline"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {/* 提示信息 */}
        <div className="px-3 py-2.5 bg-[var(--color-bg-elevated)] rounded-[10px] border border-[var(--color-border-default)]">
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-[1.5]">
            未配置 API Key 时，将使用演示模式生成示例应用。
          </p>
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
          className="px-4 py-2 rounded-[10px] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[80ms]"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          className="px-5 py-2 rounded-[10px] text-[14px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms]"
        >
          保存
        </button>
      </div>
    </Modal>
  );
}