/**
 * 权限状态管理。
 * 负责权限配置、工具权限映射、用户决策记录。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { storageKey } from '../types/storage';
import type {
  PermissionLevel,
  PermissionConfig,
  PermissionRequest,
  PermissionDecision,
  PermissionCategory,
} from '../types/permission';
import { DEFAULT_PERMISSION_RULES } from '../types/permission';
import {
  getPermissionLevel,
  getRiskNote,
} from '../services/permission';

interface PermissionState {
  /** 权限配置 */
  config: PermissionConfig;
  /** 待处理的权限请求（用于 UI 弹窗） */
  pendingRequest: PermissionRequest | null;
  /** 权限请求回调映射 */
  requestCallbacks: Map<string, (decision: PermissionDecision) => void>;
}

interface PermissionActions {
  /** 检查权限 */
  checkPermission: (request: PermissionRequest) => PermissionDecision;

  /** 请求权限（异步，返回 Promise） */
  requestPermission: (request: PermissionRequest) => Promise<PermissionDecision>;

  /** 设置工具权限 */
  setToolPermission: (toolName: string, level: PermissionLevel) => void;

  /** 设置分类默认权限 */
  setCategoryPermission: (category: PermissionCategory, level: PermissionLevel) => void;

  /** 清除工具权限（恢复默认） */
  clearToolPermission: (toolName: string) => void;

  /** 获取工具权限级别 */
  getToolLevel: (toolName: string) => PermissionLevel;

  /** 处理用户决策 */
  handleUserDecision: (
    request: PermissionRequest,
    allowed: boolean,
    remember?: boolean
  ) => void;

  /** 关闭权限弹窗 */
  dismissRequest: () => void;

  /** 重置为默认配置 */
  resetToDefault: () => void;
}

export type PermissionStore = PermissionState & PermissionActions;

/** 创建默认配置 */
function createDefaultConfig(): PermissionConfig {
  return {
    tools: {},
    categoryRules: { ...DEFAULT_PERMISSION_RULES },
  };
}

export const usePermissionStore = create<PermissionStore>()(
  persist(
    (set, get) => ({
      config: createDefaultConfig(),
      pendingRequest: null,
      requestCallbacks: new Map(),

      checkPermission: (request) => {
        const { config } = get();
        const level = getPermissionLevel(request.toolName, config);

        // 自动决策
        if (level === 'allow') {
          return { allowed: true, decisionType: 'allow' };
        }

        if (level === 'deny') {
          return { allowed: false, decisionType: 'deny' };
        }

        // ask 级别返回 pending
        return { allowed: false, decisionType: 'ask' };
      },

      requestPermission: (request) => {
        const { checkPermission } = get();

        // 先检查自动决策
        const decision = checkPermission(request);

        // 如果可以自动决策，直接返回
        if (decision.decisionType !== 'ask') {
          return Promise.resolve(decision);
        }

        // 需要用户确认，设置 pending 请求
        return new Promise<PermissionDecision>((resolve) => {
          const requestId = `${request.toolName}-${Date.now()}`;
          const callbacks = get().requestCallbacks;
          callbacks.set(requestId, resolve);

          set({
            pendingRequest: {
              ...request,
              id: requestId,
              riskNote: request.riskNote || getRiskNote(request.toolName, request.params),
            },
          });
        });
      },

      setToolPermission: (toolName, level) => {
        set((state) => ({
          config: {
            ...state.config,
            tools: {
              ...state.config.tools,
              [toolName]: level,
            },
          },
        }));
      },

      setCategoryPermission: (category, level) => {
        set((state) => ({
          config: {
            ...state.config,
            categoryRules: {
              ...state.config.categoryRules,
              [category]: level,
            },
          },
        }));
      },

      clearToolPermission: (toolName) => {
        set((state) => {
          const newTools = { ...state.config.tools };
          delete newTools[toolName];
          return {
            config: {
              ...state.config,
              tools: newTools,
            },
          };
        });
      },

      getToolLevel: (toolName) => {
        const { config } = get();
        return getPermissionLevel(toolName, config);
      },

      handleUserDecision: (request, allowed, remember = false) => {
        const decision: PermissionDecision = {
          allowed,
          decisionType: allowed ? 'user-allow' : 'user-deny',
          remember,
        };

        // 如果用户选择记住
        if (remember) {
          const { setToolPermission } = get();
          setToolPermission(request.toolName, allowed ? 'allow' : 'deny');
        }

        // 触发回调：使用请求对象的 id，不再重新生成
        const callbacks = get().requestCallbacks;
        const requestId = request.id;
        if (requestId) {
          const callback = callbacks.get(requestId);
          if (callback) {
            callback(decision);
            callbacks.delete(requestId);
          }
        }

        // 清除 pending 请求
        set({ pendingRequest: null });
      },

      dismissRequest: () => {
        const { pendingRequest, requestCallbacks } = get();
        // 清理未处理的回调，避免内存泄漏
        if (pendingRequest?.id) {
          requestCallbacks.delete(pendingRequest.id);
        }
        set({ pendingRequest: null });
      },

      resetToDefault: () => {
        set({ config: createDefaultConfig() });
      },
    }),
    {
      name: storageKey('settings', 'permissions'),
      partialize: (state) => ({
        config: state.config,
      }),
    }
  )
);