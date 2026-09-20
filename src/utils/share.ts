/**
 * 分享功能工具函数
 * 使用 localStorage 存储分享内容，生成可恢复的分享链接
 */

/** 分享存储前缀 */
const SHARE_PREFIX = 'atoms-share-';

/** 分享 ID 长度 */
const SHARE_ID_LENGTH = 8;

/** 分享有效期（毫秒）：7 天 */
const SHARE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** 分享数据结构 */
export interface ShareData {
  /** HTML 内容 */
  html: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 项目名称（可选） */
  projectName?: string;
}

/**
 * 生成随机分享 ID
 */
function generateShareId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < SHARE_ID_LENGTH; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * 保存分享内容到 localStorage
 * @param html HTML 内容
 * @param projectName 项目名称（可选）
 * @returns 分享 ID
 */
export function saveShare(html: string, projectName?: string): string {
  const id = generateShareId();
  const data: ShareData = {
    html,
    createdAt: Date.now(),
    ...(projectName ? { projectName } : {}),
  };
  
  const key = `${SHARE_PREFIX}${id}`;
  localStorage.setItem(key, JSON.stringify(data));
  
  return id;
}

/**
 * 从 localStorage 读取分享内容
 * @param id 分享 ID
 * @returns 分享数据，如果不存在或已过期则返回 null
 */
export function loadShare(id: string): ShareData | null {
  const key = `${SHARE_PREFIX}${id}`;
  const raw = localStorage.getItem(key);
  
  if (!raw) {
    return null;
  }
  
  try {
    const data: ShareData = JSON.parse(raw);
    
    // 检查是否过期
    if (Date.now() - data.createdAt > SHARE_EXPIRY_MS) {
      localStorage.removeItem(key);
      return null;
    }
    
    return data;
  } catch {
    return null;
  }
}

/**
 * 删除分享内容
 * @param id 分享 ID
 */
export function deleteShare(id: string): void {
  const key = `${SHARE_PREFIX}${id}`;
  localStorage.removeItem(key);
}

/**
 * 生成分享链接
 * @param id 分享 ID
 * @returns 完整的分享 URL
 */
export function getShareUrl(id: string): string {
  return `${window.location.origin}/#/share/${id}`;
}

/**
 * 清理所有过期的分享数据
 */
export function cleanupExpiredShares(): void {
  const keys = Object.keys(localStorage);
  const now = Date.now();
  
  for (const key of keys) {
    if (key.startsWith(SHARE_PREFIX)) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const data: ShareData = JSON.parse(raw);
          if (now - data.createdAt > SHARE_EXPIRY_MS) {
            localStorage.removeItem(key);
          }
        } catch {
          localStorage.removeItem(key);
        }
      }
    }
  }
}
