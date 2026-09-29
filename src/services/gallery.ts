/**
 * 作品广场 API 服务层。
 * 对接后端 /api/gallery/* 端点（契约见 server/routes/gallery.ts 顶部注释）：
 * - GET  /api/gallery          公开列表（sort=latest|forks，limit/offset）
 * - GET  /api/gallery/:id      公开快照详情（含 files/html，供只读预览）
 * - POST /api/gallery          发布项目快照（登录）
 * - POST /api/gallery/:id/fork 复刻为当前用户的新项目（登录），返回 { projectId }
 */
import { apiFetchJson } from './apiClient';
import type { FileNode, ProjectFramework } from '../types/project';

/** 排序方式：最新（发布时间倒序）或最多复刻（复刻数倒序） */
export type GallerySort = 'latest' | 'forks';

/** 广场列表项（不含快照大字段） */
export interface GalleryListItem {
  /** 快照 id */
  id: string;
  /** 项目名（发布时快照） */
  project_name: string;
  /** 作者用户名 */
  owner_name: string;
  /** 发布简介，可为空 */
  description: string | null;
  /** 复刻次数 */
  fork_count: number;
  /** 发布时间（epoch 毫秒） */
  created_at: number;
}

/** 列表响应 */
export interface GalleryListResult {
  items: GalleryListItem[];
  total: number;
}

/** 快照详情（公开，含渲染所需的 files/html） */
export interface GalleryDetail {
  id: string;
  project_id: string;
  project_name: string;
  owner_name: string;
  description: string | null;
  framework?: ProjectFramework;
  /** 快照文件表，服务端解析损坏时为 null（渲染回退 html 字段） */
  files: Record<string, FileNode> | null;
  /** 入口文件内容快照 */
  html: string;
  fork_count: number;
  created_at: number;
}

/** 发布请求体 */
export interface GalleryPublishBody {
  projectId: string;
  /** 发布简介（可选，服务端上限 200 字符） */
  description?: string | undefined;
}

/** 列表分页参数 */
export interface GalleryListParams {
  sort?: GallerySort;
  limit?: number;
  offset?: number;
}

/**
 * 获取广场公开列表。
 * 未登录可调用；请求失败抛出 ApiError。
 */
export async function fetchGalleryList(params: GalleryListParams = {}): Promise<GalleryListResult> {
  const search = new URLSearchParams();
  if (params.sort) search.set('sort', params.sort);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  const query = search.toString();
  const url = query ? `/api/gallery?${query}` : '/api/gallery';
  return (await apiFetchJson<GalleryListResult>(url)) as GalleryListResult;
}

/**
 * 获取快照详情（公开），供广场只读预览。
 * 404 表示作品不存在或已取消发布。
 */
export async function fetchGalleryDetail(id: string): Promise<GalleryDetail> {
  return (await apiFetchJson<GalleryDetail>(`/api/gallery/${encodeURIComponent(id)}`)) as GalleryDetail;
}

/**
 * 发布项目快照到广场（登录）。同一项目重复发布则更新快照。
 * @returns 快照 id 与是否为更新已有发布
 */
export async function publishToGallery(
  body: GalleryPublishBody
): Promise<{ id: string; updated: boolean }> {
  return (await apiFetchJson<{ id: string; updated: boolean }>('/api/gallery', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { id: string; updated: boolean };
}

/**
 * 复刻广场作品为当前用户的新项目（登录）。
 * @returns 新项目 id（调用方随后跳转 /workspace）
 */
export async function forkGalleryItem(id: string): Promise<{ projectId: string }> {
  return (await apiFetchJson<{ projectId: string }>(
    `/api/gallery/${encodeURIComponent(id)}/fork`,
    { method: 'POST' }
  )) as { projectId: string };
}

/**
 * 取消发布（登录，仅作者可删）。
 * 按 gallery 快照 id 删除，作品从广场列表移除（AC-G1.2）。
 * 重新发布同一项目会生成新快照（新 id，复刻计数从零开始）。
 */
export async function removeFromGallery(id: string): Promise<void> {
  await apiFetchJson<{ success: boolean }>(`/api/gallery/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * 本会话已发布标记（localStorage）。
 * 项目列表接口不返回发布状态，前端用该映射在项目卡片显示「已发布」标记
 * 并支撑「取消发布」入口（DELETE 需要发布时返回的 gallery 快照 id，
 * 因此记录 projectId 到 galleryId 的映射，不要求持久准确）。
 */
const PUBLISHED_MAP_KEY = 'litpp_gallery_published_map';

/** projectId 到发布快照 galleryId 的映射 */
export type GalleryPublishedMap = Record<string, string>;

/** 读取本会话已发布映射 */
export function getLocallyPublishedMap(): GalleryPublishedMap {
  try {
    const raw = localStorage.getItem(PUBLISHED_MAP_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

/** 标记项目为已发布（发布成功后调用，记录快照 id 供取消发布使用） */
export function markLocallyPublished(projectId: string, galleryId: string): void {
  const map = getLocallyPublishedMap();
  map[projectId] = galleryId;
  try {
    localStorage.setItem(PUBLISHED_MAP_KEY, JSON.stringify(map));
  } catch {
    // 存储不可用（隐私模式等）：标记退化为内存态，不影响发布主流程
  }
}

/** 移除项目的已发布标记（取消发布成功后调用） */
export function removeLocallyPublished(projectId: string): void {
  const map = getLocallyPublishedMap();
  delete map[projectId];
  try {
    localStorage.setItem(PUBLISHED_MAP_KEY, JSON.stringify(map));
  } catch {
    // 同上，不影响主流程
  }
}
