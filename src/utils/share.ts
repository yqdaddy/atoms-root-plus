/**
 * 分享功能工具函数
 * 使用服务器存储，生成可跨设备访问的分享链接
 */
import { ApiError, apiFetchJson } from '../services/apiClient';

/** 多文件结构 */
export interface SharedFile {
  path: string;
  content: string;
  language: string;
}

/** 分享数据结构 */
export interface ShareData {
  /** 分享 ID */
  id: string;
  /** HTML 内容（入口文件） */
  html: string;
  /** 多文件内容（可选） */
  files?: Record<string, SharedFile> | null;
  /** 创建时间戳 */
  createdAt: number;
  /** 项目名称（可选） */
  projectName?: string;
  /** 过期时间 */
  expiresAt?: number;
}

/**
 * 保存分享内容到服务器
 * @param html 入口 HTML 内容
 * @param files 多文件内容（可选）
 * @param projectName 项目名称（可选）
 * @returns 分享 ID
 */
export async function saveShare(
  html: string,
  projectName?: string,
  files?: Record<string, SharedFile>
): Promise<string> {
  // apiFetchJson 自带 credentials: 'include'（携带登录 cookie），
  // 失败时抛出带 status 的 ApiError（401 可被上层识别为未登录）
  const data = await apiFetchJson<{ id: string }>('/api/share', {
    method: 'POST',
    body: JSON.stringify({ html, files, projectName }),
  });

  if (!data?.id) {
    throw new ApiError('保存分享失败', 500);
  }

  return data.id;
}

/**
 * 从服务器读取分享内容
 * @param id 分享 ID
 * @returns 分享数据，如果不存在或已过期则返回 null
 */
export async function loadShare(id: string): Promise<ShareData | null> {
  try {
    // 公开接口，但统一携带 credentials 保持一致
    const response = await fetch(`/api/share/${id}`, { credentials: 'include' });

    if (response.status === 404 || response.status === 410) {
      return null;
    }

    if (!response.ok) {
      throw new Error('获取分享失败');
    }

    const data = await response.json();
    return {
      id: data.id,
      html: data.html,
      files: data.files,
      projectName: data.projectName,
      createdAt: data.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * 生成分享链接
 * @param id 分享 ID
 * @returns 完整的分享 URL
 */
export function getShareUrl(id: string): string {
  return `${window.location.origin}/share/${id}`;
}
