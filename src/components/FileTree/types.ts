/**
 * 文件树类型定义。
 * 支持多文件结构展示，用于项目文件管理器。
 */

/** 文件类型 */
export type FileType = 'html' | 'css' | 'javascript' | 'typescript' | 'json' | 'text' | 'tsx';

/** 文件状态 */
export type FileStatus = 'pending' | 'generating' | 'completed' | 'error';

/** 文件节点 */
export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file';
  fileType: FileType;
  status: FileStatus;
  size?: number;
  lines?: number;
}

/** 目录节点 */
export interface FolderNode {
  id: string;
  name: string;
  path: string;
  type: 'folder';
  expanded: boolean;
  children: TreeNode[];
}

/** 树节点联合类型 */
export type TreeNode = FileNode | FolderNode;

/** 文件树面板 Props */
export interface FileTreePanelProps {
  /** 文件树数据 */
  tree: TreeNode[];
  /** 当前选中的文件路径 */
  activeFilePath: string | null;
  /** 点击文件回调 */
  onFileSelect: (path: string) => void;
  /** 展开/收起目录回调 */
  onFolderToggle: (path: string) => void;
  /** 面板是否显示 */
  isVisible?: boolean;
}

/** 统计文件数量 */
export function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce((acc, node) => {
    if (node.type === 'file') return acc + 1;
    return acc + countFiles(node.children);
  }, 0);
}

/** 根据路径查找文件节点 */
export function findFileByPath(nodes: TreeNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return node;
    if (node.type === 'folder') {
      const found = findFileByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

/** 文件类型 -> lucide 图标映射 */
export const FILE_TYPE_ICONS: Record<FileType, string> = {
  html: 'lucide:code',
  css: 'lucide:palette',
  javascript: 'lucide:code',
  typescript: 'lucide:file-type',
  tsx: 'lucide:file-code-2',
  json: 'lucide:code',
  text: 'lucide:file-text',
};

/** 文件类型 -> 颜色映射 */
export const FILE_TYPE_COLORS: Record<FileType, string> = {
  html: '',
  css: 'text-blue-500',
  javascript: 'text-amber-400',
  typescript: 'text-[#3178c6]',
  tsx: 'text-[#3178c6]',
  json: 'text-amber-400',
  text: '',
};