/**
 * 文件树构建工具。
 * 从扁平的 files Record 构建层级树结构，用于 FileTreePanel 展示。
 */

import type { FileNode as ProjectFileNode, FileLanguage } from '../../types/project';
import type { TreeNode, FileNode as TreeFileNode, FolderNode, FileType, FileStatus } from './types';

/** FileLanguage 到 FileType 的映射 */
const LANGUAGE_TO_FILE_TYPE: Record<FileLanguage, FileType> = {
  html: 'html',
  css: 'css',
  javascript: 'javascript',
  json: 'json',
  text: 'text',
};

/** 从文件语言获取文件类型图标 */
export function getFileTypeFromLanguage(language: FileLanguage): FileType {
  return LANGUAGE_TO_FILE_TYPE[language] ?? 'text';
}

/** 从文件状态字符串转换为 FileStatus */
function toFileStatus(status: string | undefined): FileStatus {
  if (status === 'generating' || status === 'pending' || status === 'completed' || status === 'error') {
    return status;
  }
  return 'completed';
}

/**
 * 从扁平的 files Record 构建层级树结构。
 *
 * @param files 扁平的文件路径到 FileNode 的映射
 * @param generatingPaths 当前正在生成的文件路径集合（可选）
 * @returns 层级树结构，根节点数组
 *
 * @example
 * buildTree({
 *   '/index.html': { path: '/index.html', content: '...', language: 'html', updatedAt: '...' },
 *   '/styles/main.css': { path: '/styles/main.css', content: '...', language: 'css', updatedAt: '...' },
 *   '/src/app.js': { path: '/src/app.js', content: '...', language: 'javascript', updatedAt: '...' }
 * })
 * // 返回:
 * // [
 * //   { id: '/index.html', name: 'index.html', path: '/index.html', type: 'file', fileType: 'html', status: 'completed' },
 * //   { id: '/styles', name: 'styles', path: '/styles', type: 'folder', expanded: true, children: [...] },
 * //   { id: '/src', name: 'src', path: '/src', type: 'folder', expanded: true, children: [...] }
 * // ]
 */
export function buildTree(
  files: Record<string, ProjectFileNode>,
  generatingPaths: Set<string> = new Set()
): TreeNode[] {
  // 目录路径到子节点的映射
  const folderMap = new Map<string, Map<string, TreeNode>>();

  // 按 path 排序，保证顺序一致
  const sortedPaths = Object.keys(files).sort();

  for (const path of sortedPaths) {
    const fileNode = files[path];
    if (!fileNode) continue;

    // 解析路径：'/styles/main.css' -> ['', 'styles', 'main.css']
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    // 文件名和所在目录
    const fileName = segments[segments.length - 1] ?? '';
    const dirSegments = segments.slice(0, -1);
    const dirPath = dirSegments.length > 0 ? '/' + dirSegments.join('/') : '';

    // 创建文件节点
    const treeFileNode: TreeFileNode = {
      id: path,
      name: fileName,
      path,
      type: 'file',
      fileType: getFileTypeFromLanguage(fileNode.language),
      status: generatingPaths.has(path) ? 'generating' : toFileStatus(undefined),
      size: fileNode.content.length,
      lines: (fileNode.content.match(/\n/g) || []).length + 1,
    };

    // 确保目录存在
    ensureFolderExists(folderMap, dirSegments);

    // 将文件添加到对应目录
    const targetFolder = dirPath === '' ? null : folderMap.get(dirPath);
    if (targetFolder) {
      targetFolder.set(fileName, treeFileNode);
    } else {
      // 根目录文件
      if (!folderMap.has('')) {
        folderMap.set('', new Map());
      }
      folderMap.get('')?.set(fileName, treeFileNode);
    }
  }

  // 构建最终树结构
  return buildTreeFromFolderMap(folderMap);
}

/**
 * 确保目录路径上的所有目录都存在。
 */
function ensureFolderExists(
  folderMap: Map<string, Map<string, TreeNode>>,
  dirSegments: string[]
): void {
  let currentPath = '';

  for (const segment of dirSegments) {
    const nextPath = currentPath === '' ? '/' + segment : currentPath + '/' + segment;

    if (!folderMap.has(nextPath)) {
      folderMap.set(nextPath, new Map());
    }

    // 将目录添加到父目录
    if (currentPath === '') {
      // 根目录下的子目录
      if (!folderMap.has('')) {
        folderMap.set('', new Map());
      }
      const rootChildren = folderMap.get('');
      if (rootChildren && !rootChildren.has(segment)) {
        const folderNode: FolderNode = {
          id: nextPath,
          name: segment,
          path: nextPath,
          type: 'folder',
          expanded: true, // 默认展开
          children: [], // 稍后填充
        };
        rootChildren.set(segment, folderNode);
      }
    } else {
      // 非根目录下的子目录
      const parentChildren = folderMap.get(currentPath);
      if (parentChildren && !parentChildren.has(segment)) {
        const folderNode: FolderNode = {
          id: nextPath,
          name: segment,
          path: nextPath,
          type: 'folder',
          expanded: true,
          children: [],
        };
        parentChildren.set(segment, folderNode);
      }
    }

    currentPath = nextPath;
  }
}

/**
 * 从 folderMap 构建最终的树结构。
 */
function buildTreeFromFolderMap(folderMap: Map<string, Map<string, TreeNode>>): TreeNode[] {
  const rootChildren = folderMap.get('');
  if (!rootChildren) return [];

  return buildChildren(rootChildren, folderMap);
}

/**
 * 递归构建子节点列表。
 */
function buildChildren(
  childrenMap: Map<string, TreeNode>,
  folderMap: Map<string, Map<string, TreeNode>>
): TreeNode[] {
  const result: TreeNode[] = [];

  // 先添加目录，再添加文件
  const folders: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const node of childrenMap.values()) {
    if (node.type === 'folder') {
      // 填充子节点
      const subChildren = folderMap.get(node.path);
      if (subChildren) {
        node.children = buildChildren(subChildren, folderMap);
      }
      folders.push(node);
    } else {
      files.push(node);
    }
  }

  // 排序：目录按名称，文件按名称
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  result.push(...folders, ...files);
  return result;
}

/**
 * 从扁平的 files Record 获取所有文件路径列表。
 */
export function getFilePaths(files: Record<string, ProjectFileNode>): string[] {
  return Object.keys(files).sort();
}

/**
 * 判断项目是否为多文件项目。
 * 多于 1 个文件，或存在非 index.html 文件时返回 true。
 */
export function isMultiFileProject(files: Record<string, ProjectFileNode> | undefined): boolean {
  if (!files) return false;
  const paths = Object.keys(files);
  if (paths.length > 1) return true;
  if (paths.length === 1 && paths[0] !== '/index.html') return true;
  return false;
}