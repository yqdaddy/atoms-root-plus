/**
 * API 客户端：统一处理 HTTP 请求与响应拦截。
 * 核心功能：401 会话过期拦截，自动跳转登录页。
 */
import { toast } from '../components/Toast';
import { useAuthStore } from '../stores/authStore';

/** 会话过期标记，避免重复触发 */
let sessionExpiredHandled = false;

/**
 * 处理会话过期：显示 toast、清除用户状态、跳转登录页。
 */
function handleSessionExpired(): void {
  // 避免重复处理
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;

  // 显示 toast 提示
  toast.error('会话已过期，请重新登录');

  // 清除用户状态
  useAuthStore.getState().setUser(null);

  // 获取当前路径，用于登录后重定向
  const currentPath = window.location.pathname + window.location.search;
  const redirectParam = currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : '';

  // 延迟跳转，让用户看到 toast
  setTimeout(() => {
    sessionExpiredHandled = false; // 重置标记
    window.location.href = `/login${redirectParam}`;
  }, 1500);
}

/**
 * API 错误类型。
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * 封装 fetch，统一处理 401 会话过期。
 * @param url 请求 URL
 * @param init 请求配置
 * @returns Response 对象
 */
export async function apiFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  // 401 会话过期拦截
  if (response.status === 401) {
    // 排除登录/注册/检查会话接口
    const isAuthEndpoint =
      url.includes('/api/auth/login') ||
      url.includes('/api/auth/register') ||
      url.includes('/api/auth/me');

    if (!isAuthEndpoint) {
      handleSessionExpired();
    }
  }

  return response;
}

/**
 * 封装 fetch + JSON 响应解析。
 * @param url 请求 URL
 * @param init 请求配置
 * @returns 解析后的 JSON 数据（空响应返回 null）
 */
export async function apiFetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  const response = await apiFetch(url, init);

  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const text = await response.text();
      if (text) {
        const data = JSON.parse(text);
        message = data.error || message;
      }
    } catch {
      // 忽略解析错误
    }
    throw new ApiError(message, response.status);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * 重置会话过期标记（用于登录成功后）。
 */
export function resetSessionExpiredFlag(): void {
  sessionExpiredHandled = false;
}