/**
 * 落地页 Header 组件
 * 设计规范: docs/design/landing-page-spec.md 4.1
 */
import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="h-14 border-b border-[var(--color-border-default)] bg-[var(--color-bg-base)]">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6 lg:px-6">
        {/* Logo */}
        <Link
          to="/"
          className="font-display text-xl font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors duration-[var(--ease-standard)]"
        >
          Atoms
        </Link>

        {/* 桌面导航 */}
        <nav className="hidden items-center gap-8 md:flex">
          <Link
            to="#features"
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--ease-standard)]"
          >
            功能
          </Link>
          <Link
            to="#"
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--ease-standard)]"
          >
            定价
          </Link>
          <Link
            to="#"
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--ease-standard)]"
          >
            文档
          </Link>
        </nav>

        {/* 按钮 */}
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--ease-standard)]"
          >
            登录
          </Link>
          <Link
            to="/register"
            className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-6 py-2.5 text-sm font-semibold text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-140"
          >
            免费试用
          </Link>
        </div>
      </div>
    </header>
  );
}