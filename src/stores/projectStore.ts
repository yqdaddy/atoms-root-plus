/**
 * 项目状态管理。
 * 负责项目列表、当前项目、CRUD 操作与持久化。
 * 支持本地优先 + API 同步双路径。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project, ProjectSummary, FileNode, ChatMessage, IsoDateTime } from '../types/project';
import { ENTRY_FILE_PATH, DEFAULT_PREVIEW_CONFIG } from '../types/project';
import { storageKey } from '../types/storage';
import { migrateProject } from '../services/storage/migration';
import {
  createProjectApi,
  updateProjectApi,
  deleteProjectApi,
  initializeSync,
  mergeProjects,
} from '../services/storage/apiSync';
import { persistProjectDetail } from '../services/storage/localPersistence';

/** 生成 UUID v4（兼容非安全上下文，如局域网 HTTP） */
function generateId(): string {
  // 优先用原生 API（localhost/HTTPS 安全上下文）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // fallback：手动构造 UUID v4
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40; // version 4
  bytes[8] = (b8 & 0x3f) | 0x80; // variant
  const h = (i: number) => (bytes[i] ?? 0).toString(16).padStart(2, '0');
  return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

/** 获取当前 ISO 时间戳 */
function now(): IsoDateTime {
  return new Date().toISOString();
}

/** 创建空白项目 */
function createEmptyProject(name: string = '未命名项目'): Project {
  const timestamp = now();
  return {
    id: generateId(),
    name,
    description: '',
    status: 'draft',
    files: {
      [ENTRY_FILE_PATH]: {
        path: ENTRY_FILE_PATH,
        content: '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>新应用</title>\n</head>\n<body>\n  <p>开始描述你的应用...</p>\n</body>\n</html>',
        language: 'html',
        updatedAt: timestamp,
      },
    },
    chat: [],
    preview: DEFAULT_PREVIEW_CONFIG,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

interface ProjectState {
  /** 当前项目 ID */
  currentId: string | null;
  /** 当前项目完整数据 */
  currentProject: Project | null;
  /** 项目摘要列表 */
  summaries: ProjectSummary[];
  /** API 是否可用 */
  apiAvailable: boolean;
}

interface ProjectActions {
  /** 创建新项目并设为当前 */
  createProject: (name?: string) => Project;
  /** 切换当前项目 */
  switchProject: (id: string) => void;
  /** 更新当前项目名称 */
  updateProjectName: (name: string) => void;
  /** 更新当前项目状态 */
  updateProjectStatus: (status: Project['status']) => void;
  /** 更新当前项目入口文件内容 */
  updateEntryFile: (html: string) => void;
  /** 添加消息到当前项目 */
  addMessage: (message: Omit<ChatMessage, 'id' | 'createdAt'>) => void;
  /** 删除项目 */
  deleteProject: (id: string) => void;
  /** 从摘要列表加载项目详情 */
  loadProject: (id: string) => Project | null;
  /** 初始化：检测 API + 合并数据 */
  initialize: () => Promise<void>;
}

export type ProjectStore = ProjectState & ProjectActions;

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      currentId: null,
      currentProject: null,
      summaries: [],
      apiAvailable: false,

      createProject: (name) => {
        const project = createEmptyProject(name);
        const summary: ProjectSummary = {
          id: project.id,
          name: project.name,
          status: project.status,
          updatedAt: project.updatedAt,
          entryBytes: new Blob([project.files[ENTRY_FILE_PATH]?.content ?? '']).size,
        };
        persistProjectDetail(project);
        set((state) => ({
          currentId: project.id,
          currentProject: project,
          summaries: [summary, ...state.summaries],
        }));

        // 异步同步到 API（静默失败）。统一走 apiSync 层，POST body 携带本地 id，
        // 服务端校验采用后本地与远端身份一致，后续 PUT/DELETE 路径天然命中
        if (get().apiAvailable) {
          createProjectApi(project)
            .then((serverId) => {
              if (serverId && serverId !== project.id) {
                // 服务端未采用客户端 id（如格式非法回退生成），后续增量同步将失配，告警便于排查
                console.warn('[projectStore] 服务端项目 id 与本地不一致', {
                  localId: project.id,
                  serverId,
                });
              }
            })
            .catch(() => {});
        }

        return project;
      },

      switchProject: (id) => {
        const { currentProject, loadProject, deleteProject } = get();
        if (currentProject?.id === id) return;
        const project = loadProject(id);
        if (project) {
          set({ currentId: id, currentProject: project });
        } else {
          // 详情已丢失的孤儿摘要：清理出列表，避免点击无响应
          deleteProject(id);
        }
      },

      updateProjectName: (name) => {
        set((state) => {
          if (!state.currentProject) return state;
          const updated = { ...state.currentProject, name, updatedAt: now() };
          persistProjectDetail(updated);

          // 异步同步到 API
          updateProjectApi(updated).catch(() => {});

          return {
            currentProject: updated,
            summaries: state.summaries.map((s) =>
              s.id === updated.id ? { ...s, name, updatedAt: updated.updatedAt } : s
            ),
          };
        });
      },

      updateProjectStatus: (status) => {
        set((state) => {
          if (!state.currentProject) return state;
          const updated = { ...state.currentProject, status, updatedAt: now() };
          persistProjectDetail(updated);

          // 异步同步到 API
          updateProjectApi(updated).catch(() => {});

          return {
            currentProject: updated,
            summaries: state.summaries.map((s) =>
              s.id === updated.id ? { ...s, status, updatedAt: updated.updatedAt } : s
            ),
          };
        });
      },

      updateEntryFile: (html) => {
        set((state) => {
          if (!state.currentProject) return state;
          const timestamp = now();
          const updatedFile: FileNode = {
            path: ENTRY_FILE_PATH,
            content: html,
            language: 'html',
            updatedAt: timestamp,
          };
          const updated: Project = {
            ...state.currentProject,
            files: { ...state.currentProject.files, [ENTRY_FILE_PATH]: updatedFile },
            status: 'ready',
            updatedAt: timestamp,
          };
          persistProjectDetail(updated);

          // 异步同步到 API
          updateProjectApi(updated).catch(() => {});

          return {
            currentProject: updated,
            summaries: state.summaries.map((s) =>
              s.id === updated.id
                ? { ...s, status: 'ready', updatedAt: timestamp, entryBytes: new Blob([html]).size }
                : s
            ),
          };
        });
      },

      addMessage: (message) => {
        set((state) => {
          if (!state.currentProject) return state;
          const newMessage: ChatMessage = {
            id: generateId(),
            ...message,
            createdAt: now(),
          };
          const updated: Project = {
            ...state.currentProject,
            chat: [...state.currentProject.chat, newMessage],
            updatedAt: now(),
          };
          persistProjectDetail(updated);

          // 异步同步到 API
          updateProjectApi(updated).catch(() => {});

          return { currentProject: updated };
        });
      },

      deleteProject: (id) => {
        set((state) => ({
          currentId: state.currentId === id ? null : state.currentId,
          currentProject: state.currentProject?.id === id ? null : state.currentProject,
          summaries: state.summaries.filter((s) => s.id !== id),
        }));
        // 清理 localStorage 中的项目详情
        try {
          localStorage.removeItem(storageKey('projects', id));
        } catch {
          // 忽略清理错误
        }

        // 异步同步到 API
        deleteProjectApi(id).catch(() => {});
      },

      loadProject: (id) => {
        try {
          const raw = localStorage.getItem(storageKey('projects', id));
          if (!raw) return null;

          // 尝试迁移
          const result = migrateProject(raw);

          if (result.ok && result.envelope) {
            // 迁移成功，更新 localStorage
            const updatedRaw = JSON.stringify(result.envelope);
            localStorage.setItem(storageKey('projects', id), updatedRaw);
            return result.envelope.data;
          }

          // 迁移失败，隔离备份
          import('../services/storage/quarantine').then(({ quarantineData }) => {
            quarantineData(
              storageKey('projects', id),
              raw,
              `迁移失败: ${result.reason || 'unknown'}`
            );
          });

          return null;
        } catch {
          // 解析失败返回 null
          return null;
        }
      },

      initialize: async () => {
        // 检测 API 可用性并拉取服务端数据
        const result = await initializeSync();

        set({ apiAvailable: result.apiAvailable });

        if (!result.apiAvailable || result.projects.length === 0) {
          // API 不可用或无远程数据，保持本地状态
          return;
        }

        // 合并本地与服务端数据
        const localProjects: Project[] = [];
        for (const summary of get().summaries) {
          const project = get().loadProject(summary.id);
          if (project) {
            localProjects.push(project);
          }
        }

        const merged = mergeProjects(localProjects, result.projects);

        // 更新本地存储和状态
        for (const project of merged) {
          persistProjectDetail(project);
        }

        const newSummaries: ProjectSummary[] = merged.map((p: Project) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          updatedAt: p.updatedAt,
          entryBytes: new Blob([p.files[ENTRY_FILE_PATH]?.content ?? '']).size,
        }));

        // 按 updatedAt 降序排序
        newSummaries.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        set({ summaries: newSummaries });
      },
    }),
    {
      name: storageKey('projects'),
      partialize: (state) => ({
        currentId: state.currentId,
        summaries: state.summaries,
      }),
    }
  )
);

/** 初始化时加载当前项目详情，并订阅后续变化统一持久化项目详情 */
if (typeof window !== 'undefined') {
  const store = useProjectStore.getState();
  if (store.currentId && !store.currentProject) {
    const project = store.loadProject(store.currentId);
    if (project) {
      useProjectStore.setState({ currentProject: project });
    }
  }

  // currentProject 每次变化即写入 localStorage（信封格式），保证刷新后可恢复
  useProjectStore.subscribe((state) => {
    const project = state.currentProject;
    if (!project) return;
    persistProjectDetail(project);
  });

  // 异步初始化 API 同步
  store.initialize().catch(console.error);
}