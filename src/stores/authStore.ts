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
import { useProjectStore } from './projectStore'; // D-002: 登录后清理游客数据

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

    // D-002: 登录成功后清理游客数据，避免游客池污染用户项目列表
    useProjectStore.setState({ summaries: [], currentId: null, currentProject: null });
    // 重新初始化，拉取登录用户的专属项目
    useProjectStore.getState().initialize();

    return user;
  },

  register: async (username, password) => {
    const user = await registerUser(username, password);
    set({ user });

    // D-002: 注册成功后清理游客数据，避免游客池污染用户项目列表
    useProjectStore.setState({ summaries: [], currentId: null, currentProject: null });
    // 重新初始化，拉取新用户的专属项目（通常为空）
    useProjectStore.getState().initialize();

    return user;
  },

  logout: async () => {
    // 先清理本地缓存，再清除用户状态
    // 注意：如果调用方需要在登出后导航，应该在调用 logout 之前执行 navigate('/')
    // 这样可以避免路由守卫在 user 变为 null 时拦截 /workspace 并重定向到 /login
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