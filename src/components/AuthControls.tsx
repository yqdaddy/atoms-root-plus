/**
 * 认证相关 UI 控件。
 * 供 HomePage（右上角）与 ProjectSidebar（底部）复用。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../stores/authStore';
import { toast } from './Toast';

/**
 * 首页右上角认证控件。
 * 未登录：登录 / 注册按钮组。
 * 已登录：用户胶囊 + 下拉菜单（退出登录）。
 */
export function HomeAuthControls() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const handleLogout = useCallback(async () => {
    setMenuOpen(false);
    await logout();
    toast.info('已退出登录。');
  }, [logout]);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/login')}
          className="px-3 py-1.5 rounded-[10px] text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
        >
          登录
        </button>
        <button
          onClick={() => navigate('/register')}
          className="px-3 py-1.5 rounded-[10px] text-[14px] text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms]"
        >
          注册
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] text-[14px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
        title="账号菜单"
      >
        <Icon icon="lucide:user" width={16} height={16} />
        <span className="max-w-[120px] truncate">{user.username}</span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-[160px] p-2 rounded-[12px] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] shadow-[0_4px_16px_rgba(0,0,0,0.16)] z-50">
          <div className="px-3 py-2 text-[13px] text-[var(--color-text-secondary)] truncate">
            {user.username}
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[14px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
          >
            <Icon icon="lucide:log-out" width={16} height={16} />
            <span>退出登录</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 侧栏底部认证控件。
 * 未登录：登录按钮。
 * 已登录：用户名行 + 退出登录按钮。
 */
export function SidebarAuthControls() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    await logout();
    toast.info('已退出登录。');
  }, [logout]);

  if (!user) {
    return (
      <button
        onClick={() => navigate('/login')}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
      >
        <Icon icon="lucide:user" width={15} height={15} />
        <span>登录 / 注册</span>
      </button>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
        <Icon icon="lucide:user" width={15} height={15} />
        <span className="truncate">{user.username}</span>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-[10px] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-all duration-[140ms]"
      >
        <Icon icon="lucide:log-out" width={15} height={15} />
        <span>退出登录</span>
      </button>
    </>
  );
}