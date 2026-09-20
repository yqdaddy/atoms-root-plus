/**
 * 分享功能工具函数
 * 使用服务器存储，生成可跨设备访问的分享链接
 */

/** 分享数据结构 */
export interface ShareData {
  /** 分享 ID */
  id: string;
  /** HTML 内容 */
  html: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 项目名称（可选） */
  projectName?: string;
  /** 过期时间 */
  expiresAt?: number;
}

/**
 * 保存分享内容到服务器
 * @param html HTML 内容
 * @param projectName 项目名称（可选）
 * @returns 分享 ID
 */
export async function saveShare(html: string, projectName?: string): Promise<string> {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, projectName }),
  });

  if (!response.ok) {
    throw new Error('保存分享失败');
  }

  const data = await response.json();
  return data.id;
}

/**
 * 从服务器读取分享内容
 * @param id 分享 ID
 * @returns 分享数据，如果不存在或已过期则返回 null
 */
export async function loadShare(id: string): Promise<ShareData | null> {
  try {
    const response = await fetch(`/api/share/${id}`);

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
