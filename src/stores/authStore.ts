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
import { storageKey } from '../types/storage'; // F-004: 登出清理本地缓存

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

    // F-004: 登出清理本地缓存
    // 清除项目相关 localStorage 数据
    try {
      // 清除项目摘要和当前项目 ID
      const projectsKey = storageKey('projects');
      localStorage.removeItem(projectsKey);

      // 清除所有项目详情（atoms:v1:projects:{id}）
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('atoms:v1:projects:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // 忽略清理错误
    }
  },

  setUser: (user) => {
    set({ user });
  },
}));