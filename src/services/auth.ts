/**
 * 认证 API 服务层。
 * 对接后端 /api/auth/* 端点，HttpOnly cookie 会话。
 */
import type { AuthUser } from '../stores/authStore';

interface AuthResponse {
  user: AuthUser;
}

interface AuthErrorResponse {
  error?: string;
}

/**
 * 认证相关 API 错误。
 * message 已转换为中文提示，status 保留原始 HTTP 状态码（0 为网络异常）。
 */
export class AuthApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

/**
 * 将 HTTP 状态码转换为中文错误提示。
 */
function toChineseMessage(status: number, data: unknown): string {
  const backendMsg = (data as AuthErrorResponse | null)?.error;
  switch (status) {
    case 400:
      return '提交的信息格式有误。请检查用户名与密码是否符合要求。';
    case 401:
      return '用户名或密码不正确。请检查后重试。';
    case 409:
      return '该用户名已被注册。换一个用户名，或直接登录。';
    case 404:
      return '认证服务不可用。请确认后端服务已启动后再试。';
    default:
      if (status >= 500) return '服务器暂时不可用。请稍后重试。';
      return backendMsg ?? '操作失败，请重试。';
  }
}

/**
 * 封装 fetch 请求，处理 JSON 解析与错误转换。
 */
async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = {};
    if (init?.body) {
      headers['Content-Type'] = 'application/json';
    }
    response = await fetch(path, {
      credentials: 'include',
      headers,
      ...init,
    });
  } catch {
    throw new AuthApiError(
      '网络异常，无法连接服务器。请检查网络后重试。',
      0
    );
  }

  // 解析响应体（可能为空）
  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // 非 JSON 响应，忽略
    }
  }

  if (!response.ok) {
    throw new AuthApiError(toChineseMessage(response.status, data), response.status);
  }

  return data as T;
}

/**
 * 注册新用户。
 * POST /api/auth/register { username, password }
 * 成功返回用户信息，失败抛 AuthApiError。
 */
export async function registerUser(
  username: string,
  password: string
): Promise<AuthUser> {
  const data = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

/**
 * 用户登录。
 * POST /api/auth/login { username, password }
 */
export async function loginUser(
  username: string,
  password: string
): Promise<AuthUser> {
  const data = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

/**
 * 退出登录。
 * POST /api/auth/logout
 * 401 视为已登出（幂等）。
 */
export async function logoutUser(): Promise<void> {
  try {
    await request<unknown>('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    if (e instanceof AuthApiError) {
      // 网络异常或服务端错误仍需抛出
      if (e.status === 0 || e.status >= 500) throw e;
      // 401/404 等：视为已登出，静默成功
    }
  }
}

/**
 * 获取当前登录用户（会话恢复）。
 * GET /api/auth/me
 * 401 返回 null（未登录），其他错误向上抛。
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const data = await request<AuthResponse>('/api/auth/me');
    return data.user;
  } catch (e) {
    if (e instanceof AuthApiError && e.status === 401) {
      return null;
    }
    throw e;
  }
}