/**
 * 版本标识组件。
 * 显示 Git SHA 短格式，可点击跳转到 GitHub commit 页面。
 */
import { Icon } from '@iconify/react';

// Git SHA 由 Vite 构建时注入（vite.config.ts）
declare global {
  interface ImportMetaEnv {
    readonly VITE_GIT_SHA: string;
  }
}

// GitHub 仓库 URL（不含 .git 后缀）
const GITHUB_REPO_URL = 'https://github.com/yqdaddy/litpp-root-plus';

export function VersionFooter() {
  const gitSha = import.meta.env.VITE_GIT_SHA || 'dev';

  const commitUrl = `${GITHUB_REPO_URL}/commit/${gitSha}`;

  return (
    <a
      href={commitUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] transition-all"
      title={`查看 commit ${gitSha}`}
    >
      <Icon icon="lucide:git-commit" width={12} height={12} />
      <span className="font-mono">{gitSha}</span>
    </a>
  );
}