/**
 * 项目资料（Project Resources）服务封装。
 *
 * 对应后端契约 server/routes/resources.ts：
 * - GET    /api/projects/:id/resources             列表（id/name/size/created_at/content 全文）
 * - POST   /api/projects/:id/resources             新增（body: { name, content }，返回 201 与新条目）
 * - DELETE /api/projects/:id/resources/:resourceId 删除（返回 { success: true }）
 *
 * 全部接口要求登录：401 由 apiClient 统一拦截（toast 提示会话过期并跳转登录）；
 * 400 的后端中文错误信息经 ApiError.message 原样透出，由面板行内红字展示。
 */
import { apiFetchJson } from './apiClient';

/** 资料列表条目（size 为 UTF-8 字节数，content 为全文，均与后端口径一致） */
export interface ProjectResource {
  id: string;
  name: string;
  size: number;
  created_at: number;
  /** 资料全文（列表响应已携带，供面板内点击查看，无需二次请求） */
  content: string;
}

/** 单条资料内容上限：16KB（UTF-8 字节） */
export const MAX_RESOURCE_CONTENT_BYTES = 16 * 1024;

/** 单项目资料总量上限：32KB（UTF-8 字节） */
export const MAX_PROJECT_TOTAL_BYTES = 32 * 1024;

/** 单项目资料条数上限：20 条 */
export const MAX_PROJECT_RESOURCE_COUNT = 20;

/** 上传允许的文件扩展名 */
export const ALLOWED_RESOURCE_EXTENSIONS = ['.md', '.txt', '.json'] as const;

/** 名称长度上限：60 字符（与后端一致，输入框 maxLength 同步） */
export const MAX_RESOURCE_NAME_LENGTH = 60;

/** UTF-8 字节数（前端预检口径，与后端 Buffer.byteLength 一致） */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** 字节数格式化为 KB 文本（保留 1 位小数，如 12.4 KB） */
export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 按扩展名判断是否为允许上传的文件（.md/.txt/.json） */
export function isAllowedResourceFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_RESOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 去掉扩展名后的文件名，作为上传资料的默认名称，并截断到 60 字符 */
export function defaultResourceName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const name = base.length > 0 ? base : '未命名资料';
  return name.slice(0, MAX_RESOURCE_NAME_LENGTH);
}

/** 读取当前用户在指定项目下的资料列表（按 created_at 升序） */
export async function listResources(projectId: string): Promise<ProjectResource[]> {
  const items = await apiFetchJson<ProjectResource[]>(
    `/api/projects/${encodeURIComponent(projectId)}/resources`,
  );
  return items ?? [];
}

/** 新增资料（粘贴文本或文件内容），成功返回创建后的条目；400 时抛出带后端中文信息的 ApiError */
export async function createResource(
  projectId: string,
  name: string,
  content: string,
): Promise<ProjectResource> {
  const created = await apiFetchJson<ProjectResource>(
    `/api/projects/${encodeURIComponent(projectId)}/resources`,
    {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    },
  );
  if (!created) {
    throw new Error('资料保存失败，请重试');
  }
  return created;
}

/** 删除指定资料；404（资料不存在）同样按失败抛出 ApiError */
export async function deleteResource(projectId: string, resourceId: string): Promise<void> {
  await apiFetchJson(
    `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`,
    { method: 'DELETE' },
  );
}
