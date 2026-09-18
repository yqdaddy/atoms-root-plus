/**
 * API 同步层：检测 API 可用性，异步同步数据到服务端。
 * 离线降级：API 不可用时纯本地模式，静默工作。
 */

import type { Project, ProjectSummary } from '../../types/project';
import type { StorageEnvelope } from '../../types/storage';

/** API 基础 URL（开发环境使用相对路径，走 Vite 代理） */
const API_BASE = import.meta.env.VITE_API_BASE || '';

/** API 可用性状态 */
let apiAvailable = false;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30000; // 30 秒检查一次

/**
 * 检测 API 可用性。
 * 首次调用立即检查，后续调用在间隔内返回缓存状态。
 */
export async function checkApiHealth(): Promise<boolean> {
  const now = Date.now();

  // 间隔内返回缓存状态
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL && lastHealthCheck > 0) {
    return apiAvailable;
  }

  lastHealthCheck = now;

  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    apiAvailable = response.ok;
    return apiAvailable;
  } catch {
    apiAvailable = false;
    return false;
  }
}

/**
 * 获取 API 是否可用（同步查询，返回缓存状态）。
 */
export function isApiAvailable(): boolean {
  return apiAvailable;
}

/**
 * 从服务端拉取项目列表。
 */
export async function fetchProjectSummaries(): Promise<ProjectSummary[]> {
  if (!apiAvailable) return [];

  try {
    const response = await fetch(`${API_BASE}/api/projects`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) return [];

    return await response.json();
  } catch {
    return [];
  }
}

/**
 * 从服务端拉取项目详情。
 */
export async function fetchProject(id: string): Promise<Project | null> {
  if (!apiAvailable) return null;

  try {
    const response = await fetch(`${API_BASE}/api/projects/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) return null;

    const envelope = await response.json() as StorageEnvelope<Project>;
    return envelope?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * 创建项目到服务端。
 * 客户端 id 随 body 上送：服务端校验为合法 UUID 后采用，
 * 本地与服务端身份一致，后续 PUT 直接命中（服务端契约见 server/routes/projects.ts）。
 */
export async function createProjectApi(project: Project): Promise<string | null> {
  if (!apiAvailable) return null;

  try {
    const response = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: project.id,
        name: project.name,
        description: project.description,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { id: string };
    return data.id;
  } catch {
    return null;
  }
}

/**
 * 更新项目到服务端。
 */
export async function updateProjectApi(project: Project): Promise<boolean> {
  if (!apiAvailable) return false;

  try {
    const response = await fetch(`${API_BASE}/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 删除项目到服务端。
 */
export async function deleteProjectApi(id: string): Promise<boolean> {
  if (!apiAvailable) return false;

  try {
    const response = await fetch(`${API_BASE}/api/projects/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 初始化：检测 API 可用性，如果可用则拉取服务端数据与本地合并。
 * 返回需要写入 localStorage 的项目列表。
 */
export async function initializeSync(): Promise<{
  apiAvailable: boolean;
  projects: Project[];
}> {
  const available = await checkApiHealth();

  if (!available) {
    return { apiAvailable: false, projects: [] };
  }

  // 拉取服务端项目列表
  const summaries = await fetchProjectSummaries();
  const projects: Project[] = [];

  for (const summary of summaries) {
    const project = await fetchProject(summary.id);
    if (project) {
      projects.push(project);
    }
  }

  return { apiAvailable: true, projects };
}

/**
 * 合并本地与服务端数据（last-write-wins）。
 * 比较 updatedAt，更新的版本胜出。
 */
export function mergeProjects(
  localProjects: Project[],
  remoteProjects: Project[]
): Project[] {
  const merged = new Map<string, Project>();

  // 先放本地项目
  for (const p of localProjects) {
    merged.set(p.id, p);
  }

  // 再用远程项目覆盖（如果更新时间更新）
  for (const remote of remoteProjects) {
    const local = merged.get(remote.id);
    if (!local || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
      merged.set(remote.id, remote);
    }
  }

  return Array.from(merged.values());
}