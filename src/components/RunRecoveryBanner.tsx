/**
 * 后台任务恢复提示条（PRD：docs/prd-background-runs.md F-003/F-004）。
 * 两个形态：
 * - 恢复中/已接续：提示已检测到进行中的生成并恢复进度（配合现有生成状态面板）；
 * - 失败终态：展示失败原因，提供「重试」与「关闭」入口（AC-007 错误感知 + 一键重试）。
 */
import { Icon } from '@iconify/react';
import type { RecoveryState } from '../hooks/useRunRecovery';

interface RunRecoveryBannerProps {
  state: RecoveryState;
  /** 失败终态点击重试：重新发起最近一次用户需求 */
  onRetry: () => void;
  /** 关闭失败提示条 */
  onDismiss: () => void;
}

export function RunRecoveryBanner({ state, onRetry, onDismiss }: RunRecoveryBannerProps) {
  if (state.phase === 'recovering' || state.phase === 'attached') {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 px-3 py-2"
        data-testid="run-recovery-banner"
      >
        <Icon
          icon="lucide:history"
          width={14}
          height={14}
          className="text-[var(--color-accent)] shrink-0"
        />
        <span className="text-[13px] text-[var(--color-text-secondary)]">
          检测到进行中的生成，已恢复进度{state.phase === 'attached' ? '，正在接续服务端输出' : ''}
        </span>
        <Icon
          icon="lucide:loader-circle"
          width={13}
          height={13}
          className="text-[var(--color-accent)] animate-spin ml-auto shrink-0"
        />
      </div>
    );
  }

  if (state.phase === 'finished' && state.failed) {
    return (
      <div
        className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2"
        data-testid="run-recovery-failure"
      >
        <div className="flex items-start gap-2">
          <Icon
            icon="lucide:alert-circle"
            width={15}
            height={15}
            className="text-red-500 shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-[var(--color-text-primary)] font-medium">
              {state.errorMessage ?? '上次生成未完成'}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors text-[12px] font-medium"
              >
                <Icon icon="lucide:refresh-cw" width={13} height={13} />
                重试
              </button>
              <button
                onClick={onDismiss}
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
