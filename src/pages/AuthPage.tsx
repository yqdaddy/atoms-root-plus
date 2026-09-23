/**
 * 登录/注册页面。
 * 支持 Tabs 切换，前端校验，四态完备。
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom'; // F-006: 支持 redirect 参数
import { Icon } from '@iconify/react';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../components/Toast';

interface AuthPageProps {
  mode: 'login' | 'register';
}

/** 字段级校验错误 */
interface FieldErrors {
  username?: string | undefined;
  password?: string | undefined;
  confirmPassword?: string | undefined;
}

/** 校验规则 */
function validateUsername(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return '请输入用户名。';
  if (trimmed.length < 3) return '用户名至少 3 个字符。';
  if (trimmed.length > 32) return '用户名最多 32 个字符。';
  return undefined;
}

function validatePassword(value: string): string | undefined {
  if (!value) return '请输入密码。';
  if (value.length < 6) return '密码至少 6 位。';
  return undefined;
}

function validateConfirmPassword(password: string, confirm: string): string | undefined {
  if (!confirm) return '请确认密码。';
  if (password !== confirm) return '两次输入的密码不一致。';
  return undefined;
}

export default function AuthPage({ mode }: AuthPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const navigate = useNavigate();
  const [searchParams] = useSearchParams(); // F-006: 获取 redirect 参数
  const { login, register, isLoading } = useAuthStore();

  // 模式切换时清空密码与错误
  useEffect(() => {
    setPassword('');
    setConfirmPassword('');
    setSubmitError(null);
    setFieldErrors({});
  }, [mode]);

  // 切换 Tab
  const switchMode = useCallback((newMode: 'login' | 'register') => {
    navigate(newMode === 'register' ? '/register' : '/login', { replace: true });
  }, [navigate]);

  // 随机生成用户名：user_ + 6位数字
  const generateRandomUsername = (): string => {
    const digits = Math.floor(100000 + Math.random() * 900000); // 6位数字
    return `user_${digits}`;
  };

  // 随机生成密码：8位字母数字组合
  const generateRandomPassword = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // 移除易混淆字符
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  // 一键注册登录
  const handleQuickRegister = useCallback(async () => {
    setSubmitError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      const randomUsername = generateRandomUsername();
      const randomPassword = generateRandomPassword();

      try {
        // 注册
        await register(randomUsername, randomPassword);
        toast.success('注册成功，已自动登录。');

        // 跳转到工作台
        const redirect = searchParams.get('redirect');
        if (redirect) {
          navigate(redirect, { replace: true });
        } else {
          navigate('/workspace', { replace: true });
        }
        return; // 成功，退出循环
      } catch (e) {
        const message = e instanceof Error ? e.message : '注册失败，请重试。';

        // 用户名冲突时重试
        if (message.includes('用户名已存在') && retryCount < maxRetries - 1) {
          retryCount++;
          continue;
        }

        // 其他错误或重试次数用尽
        setSubmitError(message);
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(false);
  }, [register, navigate, searchParams]);

  // 提交
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    // 清除旧错误
    setSubmitError(null);
    setFieldErrors({});

    // 前端校验
    const errors: FieldErrors = {};
    const usernameErr = validateUsername(username);
    if (usernameErr) errors.username = usernameErr;
    const passwordErr = validatePassword(password);
    if (passwordErr) errors.password = passwordErr;
    if (mode === 'register') {
      const confirmErr = validateConfirmPassword(password, confirmPassword);
      if (confirmErr) errors.confirmPassword = confirmErr;
    }
    setFieldErrors(errors);

    const hasError = Object.values(errors).some(Boolean);
    if (hasError) return;

    setIsSubmitting(true);

    try {
      if (mode === 'register') {
        await register(username.trim(), password);
        toast.success('注册成功，已自动登录。');
      } else {
        await login(username.trim(), password);
        toast.success('登录成功，欢迎回来。');
      }
      // F-006: 登录后重定向到原访问页面，无 redirect 时进入工作台
      const redirect = searchParams.get('redirect');
      if (redirect) {
        navigate(redirect, { replace: true });
      } else {
        navigate('/workspace', { replace: true });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '操作失败，请重试。';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [username, password, confirmPassword, mode, register, login, navigate, searchParams]);

  // tabButtons 必须在条件渲染之前，否则 hooks 数量不一致导致 React 崩溃
  const tabButtons = useMemo(() => [
    { key: 'login' as const, label: '登录' },
    { key: 'register' as const, label: '注册' },
  ], []);

  // 渲染态
  if (isLoading) {
    // loading 态：骨架屏
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-[400px] p-6 rounded-[14px] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]">
          <div className="flex gap-2 mb-6">
            <div className="flex-1 h-10 rounded-[10px] bg-[var(--color-bg-elevated)] animate-pulse" />
            <div className="flex-1 h-10 rounded-[10px] bg-[var(--color-bg-elevated)] animate-pulse" />
          </div>
          <div className="space-y-4">
            <div className="h-[52px] rounded-[10px] bg-[var(--color-bg-elevated)] animate-pulse" />
            <div className="h-[52px] rounded-[10px] bg-[var(--color-bg-elevated)] animate-pulse" />
            <div className="h-10 rounded-[10px] bg-[var(--color-bg-elevated)] animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* 品牌 */}
      <div className="absolute top-6 left-6">
        <Link
          to="/"
          className="text-[var(--text-title-lg)] font-semibold text-[var(--color-text-primary)] font-[var(--font-display)] hover:text-[var(--color-accent)] transition-colors"
        >
          码孖造
        </Link>
      </div>

      {/* 卡片 */}
      <div className="w-full max-w-[400px]">
        {/* 标题 */}
        <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)] text-center mb-2">
          {mode === 'register' ? '创建账号' : '登录'}
        </h2>
        <p className="text-[13px] text-[var(--color-text-secondary)] text-center mb-6">
          {mode === 'register'
            ? '注册后可同步项目到云端。'
            : '登录以同步你的项目。'}
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 p-1 rounded-[10px] bg-[var(--color-bg-elevated)]" role="tablist">
          {tabButtons.map((tab: { key: 'login' | 'register'; label: string }) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={mode === tab.key}
              onClick={() => switchMode(tab.key)}
              disabled={isSubmitting}
              className={`flex-1 py-2 rounded-[8px] text-[14px] font-medium transition-all duration-[140ms] ${
                mode === tab.key
                  ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 用户名 */}
          <div>
            <label htmlFor="username" className="block text-[13px] text-[var(--color-text-secondary)] mb-1.5">
              用户名
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
              className="w-full h-[52px] px-4 rounded-[10px] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-placeholder)] focus:border-[var(--color-border-strong)] focus:shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-all duration-[140ms] disabled:opacity-50"
              placeholder="3 到 32 个字符"
            />
            {fieldErrors.username && (
              <p className="mt-1 text-[12px] text-[var(--color-danger)]">{fieldErrors.username}</p>
            )}
          </div>

          {/* 密码 */}
          <div>
            <label htmlFor="password" className="block text-[13px] text-[var(--color-text-secondary)] mb-1.5">
              密码
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="w-full h-[52px] px-4 pr-10 rounded-[10px] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-placeholder)] focus:border-[var(--color-border-strong)] focus:shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-all duration-[140ms] disabled:opacity-50"
                placeholder="至少 6 位"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={isSubmitting}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                <Icon icon={showPassword ? 'lucide:eye-off' : 'lucide:eye'} width={18} height={18} />
              </button>
            </div>
            {fieldErrors.password && (
              <p className="mt-1 text-[12px] text-[var(--color-danger)]">{fieldErrors.password}</p>
            )}
          </div>

          {/* 确认密码（仅注册） */}
          {mode === 'register' && (
            <div>
              <label htmlFor="confirmPassword" className="block text-[13px] text-[var(--color-text-secondary)] mb-1.5">
                确认密码
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full h-[52px] px-4 pr-10 rounded-[10px] bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-placeholder)] focus:border-[var(--color-border-strong)] focus:shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-all duration-[140ms] disabled:opacity-50"
                  placeholder="再次输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  disabled={isSubmitting}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                  title={showConfirmPassword ? '隐藏密码' : '显示密码'}
                >
                  <Icon icon={showConfirmPassword ? 'lucide:eye-off' : 'lucide:eye'} width={18} height={18} />
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-[12px] text-[var(--color-danger)]">{fieldErrors.confirmPassword}</p>
              )}
            </div>
          )}

          {/* 提交错误 */}
          {submitError && (
            <div className="p-3 rounded-[10px] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[13px] text-[var(--color-danger)]">
              {submitError}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] flex items-center justify-center gap-2 rounded-[10px] text-[14px] font-medium text-[var(--color-text-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:scale-[0.98] transition-all duration-[80ms] disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Icon icon="lucide:loader-circle" width={16} height={16} className="animate-spin" />
                <span>{mode === 'register' ? '注册中…' : '登录中…'}</span>
              </>
            ) : (
              <span>{mode === 'register' ? '注册' : '登录'}</span>
            )}
          </button>

          {/* 一键注册登录 */}
          <button
            type="button"
            onClick={handleQuickRegister}
            disabled={isSubmitting}
            className="w-full h-[44px] flex items-center justify-center gap-2 rounded-[10px] text-[13px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] active:scale-[0.98] transition-all duration-[80ms] disabled:opacity-50"
          >
            <Icon icon="lucide:sparkles" width={16} height={16} />
            <span>一键注册登录</span>
          </button>
        </form>

        {/* F-003: 移除游客模式入口 - 已删除 */}
      </div>
    </div>
  );
}