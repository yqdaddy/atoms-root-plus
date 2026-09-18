/**
 * 设置状态管理。
 * 负责 API key、baseURL、主题、预览配置等用户偏好。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { storageKey } from '../types/storage';
import { PROVIDER_PRESETS, type ProviderPreset } from '../services/ai/liveEngine';

export type Theme = 'light' | 'dark' | 'system';
export type DeviceMode = 'desktop' | 'tablet' | 'mobile';

export interface ViewportSize {
  width: number;
  height: number;
}

export const DEVICE_VIEWPORTS: Record<DeviceMode, ViewportSize> = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

interface SettingsState {
  /** API key（不持久化到 localStorage，仅内存保持） */
  apiKey: string | null;
  /** 自定义 baseURL（为空时使用默认 preset） */
  baseURL: string;
  /** 当前选择的 provider preset ID */
  providerId: string;
  /** UI 主题 */
  theme: Theme;
  /** 预览设备模式 */
  deviceMode: DeviceMode;
  /** 是否全屏预览 */
  isFullscreen: boolean;
}

interface SettingsActions {
  /** 设置 API key */
  setApiKey: (key: string | null) => void;
  /** 设置 baseURL */
  setBaseURL: (url: string) => void;
  /** 设置 provider preset */
  setProvider: (id: string) => void;
  /** 设置主题 */
  setTheme: (theme: Theme) => void;
  /** 切换设备模式 */
  setDeviceMode: (mode: DeviceMode) => void;
  /** 切换全屏 */
  toggleFullscreen: () => void;
  /** 获取当前 provider preset */
  getCurrentPreset: () => ProviderPreset;
  /** 获取有效的 baseURL */
  getEffectiveBaseURL: () => string;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      apiKey: null,
      baseURL: '',
      providerId: 'openai',
      theme: 'system',
      deviceMode: 'desktop',
      isFullscreen: false,

      setApiKey: (key) => {
        set({ apiKey: key });
      },

      setBaseURL: (url) => {
        set({ baseURL: url });
      },

      setProvider: (id) => {
        const preset = PROVIDER_PRESETS.find((p) => p.id === id);
        set({
          providerId: id,
          baseURL: preset?.baseURL ?? '',
        });
      },

      setTheme: (theme) => {
        set({ theme });
        // 应用主题到 DOM
        if (typeof document !== 'undefined') {
          const root = document.documentElement;
          if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            root.classList.toggle('dark', prefersDark);
          } else {
            root.classList.toggle('dark', theme === 'dark');
          }
        }
      },

      setDeviceMode: (mode) => {
        set({ deviceMode: mode });
      },

      toggleFullscreen: () => {
        set((state) => ({ isFullscreen: !state.isFullscreen }));
      },

      getCurrentPreset: () => {
        const { providerId } = get();
        return PROVIDER_PRESETS.find((p) => p.id === providerId) ?? PROVIDER_PRESETS[0]!;
      },

      getEffectiveBaseURL: () => {
        const { baseURL, providerId } = get();
        if (baseURL.trim()) return baseURL.trim();
        const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
        return preset?.baseURL ?? '';
      },
    }),
    {
      name: storageKey('settings'),
      partialize: (state) => ({
        providerId: state.providerId,
        theme: state.theme,
        deviceMode: state.deviceMode,
        // 注意：不持久化 apiKey，安全考虑
      }),
    }
  )
);

/** 初始化主题 */
if (typeof window !== 'undefined') {
  const store = useSettingsStore.getState();
  store.setTheme(store.theme);
}