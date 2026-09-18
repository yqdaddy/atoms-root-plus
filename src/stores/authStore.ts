/**
 * 认证状态管理。
 * 会话由 HttpOnly cookie 承载，前端不持久化到 localStorage。
 */
import { create } from 'zustand';
import {
  registerUser,
  loginUser,
  logoutUser,
  fetchCurrentUser,
} from '../services/auth';

export interface AuthUser {
  id: string;
  username: string;
}

interface AuthState {
  /** 当前登录用户，null 表示未登录 */
  user: AuthUser | null;
  /** 会话恢复进行中（应用启动时调用 checkAuth） */
  isLoading: boolean;
}

interface AuthActions {
  /** 恢复会话（应用启动时调用一次） */
  checkAuth: () => Promise<void>;
  /** 登录，成功返回 user，失败抛 AuthApiError */
  login: (username: string, password: string) => Promise<AuthUser>;
  /** 注册，成功返回 user，失败抛 AuthApiError */
  register: (username: string, password: string) => Promise<AuthUser>;
  /** 退出登录 */
  logout: () => Promise<void>;
  /** 直接设置用户（供外部使用，如注册/登录成功后） */
  setUser: (user: AuthUser | null) => void;
}

export type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  isLoading: true,

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const user = await fetchCurrentUser();
      set({ user, isLoading: false });
    } catch {
      // 网络异常或服务端错误，静默失败，允许游客使用
      set({ user: null, isLoading: false });
    }
  },

  login: async (username, password) => {
    const user = await loginUser(username, password);
    set({ user });
    return user;
  },

  register: async (username, password) => {
    const user = await registerUser(username, password);
    set({ user });
    return user;
  },

  logout: async () => {
    await logoutUser();
    set({ user: null });
  },

  setUser: (user) => {
    set({ user });
  },
}));