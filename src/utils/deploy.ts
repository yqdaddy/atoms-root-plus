/**
 * 部署功能工具函数
 * 将生成的项目文件部署到服务器本地目录，经 Nginx 静态托管。
 * 走 apiFetch 以复用 401 会话过期拦截。
 */
import { apiFetchJson } from '../services/apiClient';

/** 部署响应 */
export interface DeployResponse {
  /** 部署后的访问 URL */
  deployUrl: string;
  /** 部署时间（ISO 字符串） */
  deployedAt: string;
  /** 部署文件数 */
  fileCount: number;
  /** 部署总字节数 */
  totalSize: number;
}

/** 最小文件节点结构（兼容 projectStore 中的 FileNode） */
interface DeployableFile {
  content: string;
}

/**
 * 部署项目到服务器。
 * @param projectId 项目 ID（仅字母数字连字符）
 * @param files 项目文件表（key 为路径，值至少包含 content）
 * @returns 部署响应（含部署 URL）
 */
export async function deployProject(
  projectId: string,
  files: Record<string, DeployableFile>,
): Promise<DeployResponse> {
  // 服务端仅消费 content，路径以 key 为准
  const payload = Object.fromEntries(
    Object.entries(files).map(([path, file]) => [path, file.content]),
  );
  return await apiFetchJson<DeployResponse>('/api/deploy', {
    method: 'POST',
    body: JSON.stringify({ projectId, files: payload }),
  }) as DeployResponse;
}
