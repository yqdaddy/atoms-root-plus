/**
 * 项目状态管理。
 * 负责项目列表、当前项目、CRUD 操作与持久化。
 * 支持本地优先 + API 同步双路径。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useChatStore } from './chatStore';
import { cancelActiveRun } from '../services/ai/activeRun';
import type { Project, ProjectSummary, FileNode, ChatMessage, IsoDateTime, Version, Plan } from '../types/project';
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
function createEmptyProject(name: string = '未命名项目', framework: Project['framework'] = 'html'): Project {
  const timestamp = now();
  return {
    id: generateId(),
    name,
    description: '',
    status: 'draft',
    framework,
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
  /** 当前项目版本列表（降序：最新在前） */
  versions: Version[];
  /** 当前版本 ID（显式标记，回滚/保存时更新） */
  currentVersionId: string | null;
  /** 当前项目计划（分析师产出） */
  currentPlan: Plan | null;
  /** API 是否可用 */
  apiAvailable: boolean;
}

interface ProjectActions {
  /** 创建新项目并设为当前 */
  createProject: (name?: string, framework?: Project['framework']) => Project;
  /** 清空工作台状态，进入"未开始新项目"状态（提交首个需求时才真正 createProject） */
  newProject: () => void;
  /** 切换当前项目 */
  switchProject: (id: string) => void;
  /** 更新当前项目名称 */
  updateProjectName: (name: string) => void;
  /** 更新当前项目状态 */
  updateProjectStatus: (status: Project['status']) => void;
  /** 更新当前项目入口文件内容（单文件模式，向后兼容） */
  updateEntryFile: (html: string) => void;
  /** 更新当前项目的多文件（多文件模式） */
  updateFiles: (files: Record<string, FileNode>, entryFile?: string) => void;
  /** 添加消息到当前项目 */
  addMessage: (message: Omit<ChatMessage, 'id' | 'createdAt'>) => void;
  /** 清空当前项目的对话历史 */
  clearChat: () => void;
  /** 清除当前项目（用于刷新后重置） */
  clearCurrentProject: () => void;
  /** 删除项目 */
  deleteProject: (id: string) => void;
  /** 从摘要列表加载项目详情 */
  loadProject: (id: string) => Project | null;
  /** 初始化：检测 API + 合并数据 */
  initialize: () => Promise<void>;
  /** 保存当前版本快照 */
  saveVersion: (summary: string, type?: Version['type']) => Version | null;
  /** 切换到指定版本 */
  loadVersion: (versionId: string) => void;
  /** 从 localStorage 加载版本列表 */
  loadVersionsFromStorage: (projectId: string) => void;
  /** 保存计划（分析师产出或用户编辑） */
  savePlan: (content: string, capabilities?: string[], editedByUser?: boolean) => Plan | null;
  /** 加载当前项目的计划 */
  loadPlan: () => Plan | null;
  /** 更新计划内容（用户编辑） */
  updatePlan: (content: string) => void;
}

export type ProjectStore = ProjectState & ProjectActions;

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      currentId: null,
      currentProject: null,
      summaries: [],
      versions: [],
      currentVersionId: null,
      currentPlan: null,
      apiAvailable: false,

      createProject: (name, framework) => {
        const project = createEmptyProject(name, framework);
        const summary: ProjectSummary = {
          id: project.id,
          name: project.name,
          status: project.status,
          ...(project.framework ? { framework: project.framework } : {}),
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

      newProject: () => {
        // 中断残留的生成任务与界面状态：旧项目即使生成中，也立即回到干净欢迎界面
        cancelActiveRun();
        useChatStore.setState({ isGenerating: false, error: null, currentInput: '' });
        useChatStore.getState().resetStreamBuffer();
        set({ currentId: null, currentProject: null, versions: [], currentVersionId: null });
      },

      switchProject: (id) => {
        const { currentProject, loadProject, deleteProject, loadVersionsFromStorage } = get();
        if (currentProject?.id === id) return;
        const project = loadProject(id);
        if (project) {
          loadVersionsFromStorage(id);
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
          if (!state.currentProject) {
            console.warn('[projectStore] updateEntryFile: currentProject 为 null');
            return state;
          }
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

      updateFiles: (files, entryFile) => {
        set((state) => {
          if (!state.currentProject) {
            console.warn('[projectStore] updateFiles: currentProject 为 null');
            return state;
          }
          const timestamp = now();

          // 确定入口文件路径
          const entryPath = entryFile ?? ENTRY_FILE_PATH;
          const entryContent = files[entryPath]?.content ?? files[ENTRY_FILE_PATH]?.content ?? '';

          // 构建新的文件映射
          const updatedFiles: Record<string, FileNode> = {};

          for (const [path, file] of Object.entries(files)) {
            updatedFiles[path] = {
              ...file,
              updatedAt: timestamp,
            };
          }

          const updated: Project = {
            ...state.currentProject,
            files: updatedFiles,
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
                ? { ...s, status: 'ready', updatedAt: timestamp, entryBytes: new Blob([entryContent]).size }
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

      clearChat: () => {
        set((state) => {
          if (!state.currentProject) return state;
          const updated: Project = {
            ...state.currentProject,
            chat: [],
            updatedAt: now(),
          };
          persistProjectDetail(updated);

          // 异步同步到 API
          updateProjectApi(updated).catch(() => {});

          return { currentProject: updated };
        });
      },

      clearCurrentProject: () => {
        set({ currentId: null, currentProject: null, versions: [], currentVersionId: null });
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
          ...(p.framework ? { framework: p.framework } : {}),
          updatedAt: p.updatedAt,
          entryBytes: new Blob([p.files[ENTRY_FILE_PATH]?.content ?? '']).size,
        }));

        // 按 updatedAt 降序排序
        newSummaries.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        set({ summaries: newSummaries });
      },

      saveVersion: (summary, type = 'iteration') => {
        const { currentProject, versions } = get();
        if (!currentProject) return null;

        const versionId = generateId();
        const timestamp = now();
        const version: Version = {
          id: versionId,
          projectId: currentProject.id,
          createdAt: timestamp,
          summary,
          type,
          files: JSON.parse(JSON.stringify(currentProject.files)), // 深拷贝文件快照
        };

        // 统一降序：新版本插入头部
        let newVersions = [version, ...versions];

        // 版本数量限制：最多 20 个，超出自动清理最旧（保留 initial）
        if (newVersions.length > 20) {
          // 保留 initial 和最近 19 个版本
          const initialVersions = newVersions.filter(v => v.type === 'initial');
          const nonInitialVersions = newVersions.filter(v => v.type !== 'initial');
          // 非初始版本已按降序排列，直接保留前 19 个
          newVersions = [...initialVersions, ...nonInitialVersions.slice(0, 19)];
        }

        // 持久化到 localStorage
        try {
          localStorage.setItem(
            storageKey('versions', currentProject.id),
            JSON.stringify(newVersions)
          );
        } catch {
          console.warn('[projectStore] 版本持久化失败');
        }

        // 新版本自动成为当前版本
        set({ versions: newVersions, currentVersionId: versionId });
        return version;
      },

      loadVersion: (versionId) => {
        const { versions, currentProject } = get();
        const targetVersion = versions.find(v => v.id === versionId);
        if (!targetVersion || !currentProject) return;

        // 恢复文件快照
        const restoredFiles = JSON.parse(JSON.stringify(targetVersion.files));
        const timestamp = now();

        // 更新文件时间戳
        for (const file of Object.values(restoredFiles) as FileNode[]) {
          file.updatedAt = timestamp;
        }

        const updated: Project = {
          ...currentProject,
          files: restoredFiles,
          status: 'ready',
          updatedAt: timestamp,
        };

        persistProjectDetail(updated);
        set({ currentProject: updated });

        // 创建回滚版本并更新当前版本标记
        const rollbackSummary = `回滚自 V${versions.findIndex(v => v.id === versionId) + 1}`;
        get().saveVersion(rollbackSummary, 'rollback');
      },

      loadVersionsFromStorage: (projectId) => {
        try {
          const raw = localStorage.getItem(storageKey('versions', projectId));
          if (!raw) {
            set({ versions: [], currentVersionId: null });
            return;
          }

          const versions = JSON.parse(raw) as Version[];
          // 统一降序排序（最新在前）
          versions.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          // 当前版本为最新版本
          const currentVersionId = versions.length > 0 ? versions[0]!.id : null;
          set({ versions, currentVersionId });
        } catch {
          console.warn('[projectStore] 版本加载失败');
          set({ versions: [], currentVersionId: null });
        }
      },

      savePlan: (content, capabilities, editedByUser = false) => {
        const { currentProject, currentPlan } = get();
        if (!currentProject) return null;

        const planId = currentPlan?.id || generateId();
        const timestamp = now();
        const version = currentPlan ? currentPlan.version + 1 : 1;

        const plan: Plan = {
          id: planId,
          projectId: currentProject.id,
          version,
          content,
          createdAt: currentPlan?.createdAt || timestamp,
          updatedAt: timestamp,
          ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
          ...(editedByUser ? { editedByUser } : {}),
        };

        // 持久化计划（覆盖式，只保留最新）
        try {
          localStorage.setItem(
            storageKey('plans', currentProject.id),
            JSON.stringify(plan)
          );
        } catch {
          console.warn('[projectStore] 计划持久化失败');
        }

        set({ currentPlan: plan });
        return plan;
      },

      loadPlan: () => {
        const { currentProject } = get();
        if (!currentProject) return null;

        try {
          const raw = localStorage.getItem(storageKey('plans', currentProject.id));
          if (!raw) {
            set({ currentPlan: null });
            return null;
          }

          const plan = JSON.parse(raw) as Plan;
          set({ currentPlan: plan });
          return plan;
        } catch {
          console.warn('[projectStore] 计划加载失败');
          set({ currentPlan: null });
          return null;
        }
      },

      updatePlan: (content) => {
        const { currentPlan, savePlan } = get();
        if (!currentPlan) return;

        // 用户编辑后标记 editedByUser
        savePlan(content, currentPlan.capabilities, true);
      },
    }),
    {
      name: storageKey('projects'),
      partialize: (state) => ({
        currentId: state.currentId,
        summaries: state.summaries,
        currentVersionId: state.currentVersionId,
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