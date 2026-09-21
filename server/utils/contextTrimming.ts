/**
 * 智能上下文裁剪工具。
 *
 * 在修改模式下，从用户请求中提取关键词，匹配相关文件，并分析依赖关系，
 * 只携带相关文件及其依赖闭包，减少 token 消耗。
 *
 * 设计文档：docs/intent-classification-design.md 第 4 节
 */

/** 文件节点结构（与 server/types.ts FileNode 兼容） */
interface FileNode {
  path: string;
  content: string;
  language: string;
}

/**
 * 中文停用词表（高频无意义词）。
 * 来源：常见中文停用词列表精简版。
 */
const CHINESE_STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到',
  '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '但', '可以', '这个', '那个',
  '能', '让', '把', '被', '跟', '与', '或', '及', '等', '对', '为', '什么', '怎么', '如何', '为什么',
  '这', '那', '哪些', '哪个', '哪', '哪些', '怎样', '多', '多少', '几', '第', '请', '帮', '帮忙',
]);

/**
 * 英文停用词表（高频无意义词）。
 */
const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
]);

/**
 * 中文常见术语到文件类型的映射。
 * 用于关键词匹配时推断相关文件类型。
 */
const TERM_TO_FILE_TYPE: Record<string, string[]> = {
  // 样式相关
  '样式': ['css'],
  '颜色': ['css', 'html'],
  '字体': ['css'],
  '布局': ['css', 'html'],
  '间距': ['css'],
  '边距': ['css'],
  '背景': ['css', 'html'],
  '动画': ['css', 'javascript'],
  '过渡': ['css'],
  '样式表': ['css'],

  // 交互相关
  '按钮': ['html', 'javascript', 'css'],
  '表单': ['html', 'javascript'],
  '输入': ['html', 'javascript'],
  '点击': ['javascript', 'html'],
  '事件': ['javascript'],
  '交互': ['javascript', 'html'],
  '提交': ['javascript', 'html'],
  '验证': ['javascript'],
  '弹窗': ['javascript', 'html', 'css'],
  '模态': ['javascript', 'html', 'css'],

  // 功能相关
  '登录': ['html', 'javascript'],
  '注册': ['html', 'javascript'],
  '搜索': ['html', 'javascript'],
  '过滤': ['javascript'],
  '排序': ['javascript'],
  '分页': ['javascript', 'html'],
  '导航': ['html', 'css', 'javascript'],
  '菜单': ['html', 'css', 'javascript'],
  '列表': ['html', 'javascript'],
  '卡片': ['html', 'css'],
  '表格': ['html', 'javascript'],
  '图表': ['html', 'javascript'],

  // 数据相关
  '数据': ['javascript', 'json'],
  '存储': ['javascript'],
  '本地存储': ['javascript'],
  '状态': ['javascript'],
  '变量': ['javascript'],
  '函数': ['javascript'],
  '方法': ['javascript'],
  '组件': ['javascript', 'html'],

  // 结构相关
  '标题': ['html'],
  '文本': ['html', 'css'],
  '图片': ['html', 'css'],
  '链接': ['html'],
  '页面': ['html', 'css', 'javascript'],
  '头部': ['html', 'css'],
  '底部': ['html', 'css'],
  '侧边栏': ['html', 'css', 'javascript'],
};

/**
 * 文件名关键词映射（中文 → 英文路径关键词）。
 */
const TERM_TO_PATH_KEYWORD: Record<string, string[]> = {
  '样式': ['style', 'css', 'theme'],
  '主': ['main', 'index', 'app'],
  '工具': ['util', 'helper', 'tool'],
  '组件': ['component', 'comp'],
  '页面': ['page', 'view'],
  '布局': ['layout'],
  '导航': ['nav', 'menu', 'header'],
  '头部': ['header', 'nav'],
  '底部': ['footer'],
  '侧边栏': ['sidebar', 'aside'],
  '表单': ['form'],
  '列表': ['list'],
  '卡片': ['card'],
  '按钮': ['button', 'btn'],
  '表格': ['table'],
  '图表': ['chart'],
  '数据': ['data', 'store', 'state'],
  '配置': ['config'],
  '路由': ['route', 'router'],
};

/**
 * 从用户请求中提取关键词。
 *
 * 策略：
 * 1. 中文分词（简单按字切分 + 常见词汇匹配）
 * 2. 英文单词提取
 * 3. 去除停用词
 * 4. 保留技术术语
 *
 * @param prompt 用户请求
 * @returns 关键词列表
 */
export function extractKeywords(prompt: string): string[] {
  const keywords: string[] = [];

  // 1. 提取英文单词（连续字母序列）
  const englishWords = prompt.match(/[a-zA-Z]+/g) || [];
  for (const word of englishWords) {
    const lower = word.toLowerCase();
    if (!ENGLISH_STOP_WORDS.has(lower) && word.length >= 2) {
      keywords.push(lower);
    }
  }

  // 2. 提取中文关键词（匹配常见术语表）
  for (const term of Object.keys(TERM_TO_FILE_TYPE)) {
    if (prompt.includes(term)) {
      keywords.push(term);
    }
  }

  // 3. 提取中文词语（改进策略）
  // 匹配常见的动词+宾语结构，如"修改按钮"、"添加样式"、"删除功能"
  const verbObjectPattern = /(修改|添加|删除|调整|优化|增加|移除|重写|替换|修复)(.+?)(?=[，。、！？\s]|$)/g;
  let match;
  while ((match = verbObjectPattern.exec(prompt)) !== null) {
    const object = match[1];
    if (object && object.length >= 2 && object.length <= 4) {
      // 提取宾语中的关键词（去除修饰词）
      const cleanObject = object.replace(/^(一个|这个|那个|新的|旧的|所有的)/, '');
      if (cleanObject.length >= 2) {
        keywords.push(cleanObject);
      }
    }
  }

  // 4. 提取特定领域关键词
  // 数据相关
  if (prompt.includes('数据') || prompt.includes('存储') || prompt.includes('状态')) {
    keywords.push('数据');
  }
  // 用户相关
  if (prompt.includes('用户') || prompt.includes('登录') || prompt.includes('注册')) {
    keywords.push('用户');
    keywords.push('登录');
  }
  // 路由相关
  if (prompt.includes('路由') || prompt.includes('页面') || prompt.includes('导航')) {
    keywords.push('路由');
  }
  // 组件相关
  if (prompt.includes('组件') || prompt.includes('模块')) {
    keywords.push('组件');
  }

  // 去重
  return [...new Set(keywords)];
}

/**
 * 计算文件路径与关键词的匹配分数。
 *
 * 匹配规则：
 * - 文件名包含关键词（如 "style.css" 匹配 "样式"）
 * - 文件扩展名匹配术语关联的文件类型
 *
 * @param filePath 文件路径
 * @param keywords 关键词列表
 * @returns 匹配分数（0-1）
 */
export function matchFileByPath(filePath: string, keywords: string[]): number {
  const path = filePath.toLowerCase();
  let score = 0;

  for (const keyword of keywords) {
    // 直接路径匹配
    if (path.includes(keyword.toLowerCase())) {
      score += 0.5;
    }

    // 术语到路径关键词映射
    const pathKeywords = TERM_TO_PATH_KEYWORD[keyword];
    if (pathKeywords) {
      for (const pk of pathKeywords) {
        if (path.includes(pk.toLowerCase())) {
          score += 0.4;
          break;
        }
      }
    }

    // 术语到文件类型映射
    const fileTypes = TERM_TO_FILE_TYPE[keyword];
    if (fileTypes) {
      const ext = filePath.split('.').pop()?.toLowerCase();
      if (ext && fileTypes.includes(ext)) {
        score += 0.3;
      }
    }
  }

  // 归一化到 0-1
  return Math.min(score / keywords.length, 1);
}

/**
 * 计算文件内容与关键词的匹配分数。
 *
 * 匹配规则：
 * - 内容中关键词出现次数
 * - 归一化处理，避免长文件得分过高
 *
 * @param content 文件内容
 * @param keywords 关键词列表
 * @returns 匹配分数（0-1）
 */
export function matchFileByContent(content: string, keywords: string[]): number {
  if (!content || keywords.length === 0) return 0;

  let matchCount = 0;
  const contentLower = content.toLowerCase();

  for (const keyword of keywords) {
    // 统计关键词出现次数
    const regex = new RegExp(escapeRegExp(keyword.toLowerCase()), 'gi');
    const matches = contentLower.match(regex);
    if (matches) {
      matchCount += matches.length;
    }
  }

  // 归一化：关键词平均出现次数，上限 10 次
  const avgOccurrences = matchCount / keywords.length;
  return Math.min(avgOccurrences / 10, 1);
}

/**
 * 解析文件的 import/require 依赖。
 *
 * 支持格式：
 * - import ... from './xxx'
 * - import ... from './xxx.js'
 * - require('./xxx')
 *
 * @param content 文件内容
 * @param filePath 当前文件路径（用于解析相对路径）
 * @returns 依赖文件路径列表（绝对路径）
 */
export function parseDependencies(content: string, filePath: string): string[] {
  const dependencies: string[] = [];
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));

  // 匹配 import ... from './xxx' 或 './xxx.js'
  const importPattern = /import\s+[^'"]*from\s+['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    const relativePath = match[1];
    if (relativePath) {
      const absolutePath = resolveRelativePath(dir, relativePath);
      if (absolutePath) {
        dependencies.push(absolutePath);
      }
    }
  }

  // 匹配 require('./xxx')
  const requirePattern = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    const relativePath = match[1];
    if (relativePath) {
      const absolutePath = resolveRelativePath(dir, relativePath);
      if (absolutePath) {
        dependencies.push(absolutePath);
      }
    }
  }

  // 匹配 <script src="./xxx.js"></script>（HTML 文件）
  const scriptSrcPattern = /<script[^>]*src\s*=\s*['"](\.[^'"]+)['"]/g;
  while ((match = scriptSrcPattern.exec(content)) !== null) {
    const relativePath = match[1];
    if (relativePath) {
      const absolutePath = resolveRelativePath(dir, relativePath);
      if (absolutePath) {
        dependencies.push(absolutePath);
      }
    }
  }

  // 匹配 <link rel="stylesheet" href="./xxx.css">（HTML 文件）
  const linkHrefPattern = /<link[^>]*href\s*=\s*['"](\.[^'"]+)['"]/g;
  while ((match = linkHrefPattern.exec(content)) !== null) {
    const relativePath = match[1];
    if (relativePath) {
      const absolutePath = resolveRelativePath(dir, relativePath);
      if (absolutePath) {
        dependencies.push(absolutePath);
      }
    }
  }

  return [...new Set(dependencies)];
}

/**
 * 解析相对路径为绝对路径。
 *
 * @param baseDir 基础目录
 * @param relativePath 相对路径
 * @returns 绝对路径
 */
function resolveRelativePath(baseDir: string, relativePath: string): string | null {
  // 移除 ./
  let path = relativePath;
  if (path.startsWith('./')) {
    path = path.substring(2);
  }

  // 处理 ../
  const parts = baseDir.split('/');
  const pathParts = path.split('/');

  for (const part of pathParts) {
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  // 补全扩展名（如果没有）
  let result = parts.join('/');
  if (!result.includes('.') || result.endsWith('/')) {
    // 默认补 .js
    result += '.js';
  }

  return result.startsWith('/') ? result : '/' + result;
}

/**
 * 构建依赖图。
 *
 * @param files 文件集合
 * @returns 依赖图（文件路径 → 依赖文件路径列表）
 */
export function buildDependencyGraph(
  files: Record<string, FileNode>
): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const [path, file] of Object.entries(files)) {
    const deps = parseDependencies(file.content, path);
    // 只保留存在的依赖
    const existingDeps = deps.filter(d => files[d]);
    graph.set(path, existingDeps);
  }

  return graph;
}

/**
 * 构建反向依赖图（被引用关系）。
 *
 * @param files 文件集合
 * @returns 反向依赖图（文件路径 → 引用该文件的文件路径列表）
 */
export function buildReverseDependencyGraph(
  files: Record<string, FileNode>
): Map<string, string[]> {
  const reverseGraph = new Map<string, string[]>();

  // 初始化
  for (const path of Object.keys(files)) {
    reverseGraph.set(path, []);
  }

  // 遍历每个文件，找出它引用了哪些文件，然后建立反向映射
  for (const [path, file] of Object.entries(files)) {
    const deps = parseDependencies(file.content, path);
    for (const dep of deps) {
      if (files[dep]) {
        const reverseDeps = reverseGraph.get(dep);
        if (reverseDeps && !reverseDeps.includes(path)) {
          reverseDeps.push(path);
        }
      }
    }
  }

  return reverseGraph;
}

/**
 * 计算依赖闭包（传递闭包，含正向依赖和反向依赖）。
 *
 * @param startPaths 起始文件路径列表
 * @param depGraph 正向依赖图（文件 → 它依赖的文件）
 * @param reverseDepGraph 反向依赖图（文件 → 引用它的文件）
 * @param options 配置选项
 * @returns 闭包内所有文件路径
 */
export function computeDependencyClosureWithReverse(
  startPaths: string[],
  depGraph: Map<string, string[]>,
  reverseDepGraph: Map<string, string[]>,
  options: {
    /** 是否包含反向依赖（被引用者）。默认 true */
    includeReverse?: boolean;
    /** 反向依赖深度。默认 1（只包含直接引用者，避免闭包爆炸） */
    reverseDepth?: number;
  } = {}
): Set<string> {
  const { includeReverse = true, reverseDepth = 1 } = options;

  const closure = new Set<string>();
  const queue: Array<{ path: string; reverseLevel: number }> = startPaths.map(p => ({ path: p, reverseLevel: 0 }));

  while (queue.length > 0) {
    const { path, reverseLevel } = queue.shift()!;
    if (closure.has(path)) continue;

    closure.add(path);

    // 添加正向依赖到队列（无限深度）
    const deps = depGraph.get(path) || [];
    for (const dep of deps) {
      if (!closure.has(dep)) {
        queue.push({ path: dep, reverseLevel: 0 });
      }
    }

    // 添加反向依赖到队列（限制深度，避免闭包爆炸）
    if (includeReverse && reverseLevel < reverseDepth) {
      const reverseDeps = reverseDepGraph.get(path) || [];
      for (const ref of reverseDeps) {
        if (!closure.has(ref)) {
          queue.push({ path: ref, reverseLevel: reverseLevel + 1 });
        }
      }
    }
  }

  return closure;
}

/**
 * 计算依赖闭包（传递闭包，仅正向依赖）。
 *
 * @param startPaths 起始文件路径列表
 * @param depGraph 依赖图
 * @returns 闭包内所有文件路径
 */
export function computeDependencyClosure(
  startPaths: string[],
  depGraph: Map<string, string[]>
): Set<string> {
  const closure = new Set<string>();
  const queue = [...startPaths];

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (closure.has(path)) continue;

    closure.add(path);

    // 添加依赖到队列
    const deps = depGraph.get(path) || [];
    for (const dep of deps) {
      if (!closure.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return closure;
}

/**
 * 智能裁剪上下文，只携带相关文件。
 *
 * 混合方案：
 * 1. 从用户请求提取关键词
 * 2. 通过文件名和内容匹配候选文件
 * 3. 对候选文件做依赖分析
 * 4. 返回候选文件 + 依赖闭包
 *
 * 兜底策略：如果筛选结果为空，返回所有文件。
 *
 * @param prompt 用户请求
 * @param files 当前项目文件
 * @param options 配置选项
 * @returns 裁剪后的文件路径列表
 */
export function trimContext(
  prompt: string,
  files: Record<string, FileNode>,
  options: {
    /** 路径匹配阈值（0-1） */
    pathMatchThreshold?: number;
    /** 内容匹配阈值（0-1） */
    contentMatchThreshold?: number;
    /** 最小文件数（防止过度裁剪） */
    minFileCount?: number;
    /** 是否强制包含入口文件 */
    includeEntry?: boolean;
  } = {}
): {
  trimmedPaths: string[];
  keywords: string[];
  stats: {
    totalFiles: number;
    matchedByPath: number;
    matchedByContent: number;
    addedByDependency: number;
  };
} {
  const {
    pathMatchThreshold = 0.3,
    contentMatchThreshold = 0.15, // 降低内容匹配阈值，提高匹配率
    minFileCount = 1,
    includeEntry = false, // 默认不强制包含入口文件
  } = options;

  const allPaths = Object.keys(files);
  const stats = {
    totalFiles: allPaths.length,
    matchedByPath: 0,
    matchedByContent: 0,
    addedByDependency: 0,
  };

  // 1. 提取关键词
  const keywords = extractKeywords(prompt);

  // 如果没有关键词或文件数很少，返回所有文件
  if (keywords.length === 0 || allPaths.length <= 2) {
    return {
      trimmedPaths: allPaths,
      keywords,
      stats: { ...stats, matchedByPath: allPaths.length },
    };
  }

  // 2. 关键词匹配筛选候选文件
  const candidatePaths: Set<string> = new Set();
  const scoredFiles: Array<{ path: string; score: number }> = [];

  for (const path of allPaths) {
    const file = files[path];
    if (!file) continue;

    // 路径匹配
    const pathScore = matchFileByPath(path, keywords);
    // 内容匹配
    const contentScore = matchFileByContent(file.content, keywords);

    // 综合评分（路径权重 0.4，内容权重 0.6）
    const totalScore = pathScore * 0.4 + contentScore * 0.6;

    if (pathScore >= pathMatchThreshold) {
      candidatePaths.add(path);
      stats.matchedByPath++;
    } else if (contentScore >= contentMatchThreshold) {
      candidatePaths.add(path);
      stats.matchedByContent++;
    }

    // 记录所有文件的评分（用于后续补充）
    scoredFiles.push({ path, score: totalScore });
  }

  // 3. 如果用户请求明确提到入口文件相关内容，包含入口文件
  const entryKeywords = ['首页', '主页面', '入口', 'index', 'main page', 'layout', '布局'];
  const shouldIncludeEntry = entryKeywords.some(k => keywords.includes(k) || prompt.toLowerCase().includes(k.toLowerCase()));
  if (shouldIncludeEntry || includeEntry) {
    const entryPath = allPaths.find(p => p === '/index.html' || p.endsWith('/index.html'));
    if (entryPath) {
      candidatePaths.add(entryPath);
    }
  }

  // 4. 依赖分析：计算候选文件的依赖闭包（含正向和反向依赖）
  if (candidatePaths.size > 0) {
    const depGraph = buildDependencyGraph(files);
    const reverseDepGraph = buildReverseDependencyGraph(files);
    const closure = computeDependencyClosureWithReverse(
      Array.from(candidatePaths),
      depGraph,
      reverseDepGraph,
      { includeReverse: true, reverseDepth: 1 }
    );

    // 统计通过依赖添加的文件
    for (const path of closure) {
      if (!candidatePaths.has(path)) {
        stats.addedByDependency++;
      }
    }

    // 将闭包内的所有文件加入候选
    for (const path of closure) {
      candidatePaths.add(path);
    }
  }

  // 5. 最小文件数兜底：如果筛选结果太少，按评分补充文件
  if (candidatePaths.size < minFileCount) {
    // 按评分排序，补充文件
    scoredFiles.sort((a, b) => b.score - a.score);

    for (const { path } of scoredFiles) {
      if (!candidatePaths.has(path)) {
        candidatePaths.add(path);
        if (candidatePaths.size >= minFileCount) break;
      }
    }
  }

  // 6. 完全匹配为空时返回所有文件（兜底策略）
  if (candidatePaths.size === 0) {
    console.warn('[trimContext] 裁剪结果为空，回退到全部文件');
    return {
      trimmedPaths: allPaths,
      keywords,
      stats: { ...stats, matchedByPath: allPaths.length },
    };
  }

  return {
    trimmedPaths: Array.from(candidatePaths),
    keywords,
    stats,
  };
}

/**
 * 转义正则表达式特殊字符。
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 估算 token 数量（简单估算：中文按字符数，英文按单词数 * 1.3）。
 *
 * @param text 文本
 * @returns 估算 token 数
 */
export function estimateTokens(text: string): number {
  // 中文字符
  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  // 英文单词
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  // 其他字符（数字、符号等）
  const otherChars = text.length - chineseChars - englishWords * 5;

  // 中文 1 字 ≈ 1 token，英文 1 词 ≈ 1.3 token
  return Math.ceil(chineseChars + englishWords * 1.3 + otherChars * 0.5);
}

/**
 * 计算裁剪节省的 token 数。
 *
 * @param allFiles 所有文件
 * @param trimmedPaths 裁剪后的路径
 * @returns 节省的 token 数和百分比
 */
export function calculateTokenSavings(
  allFiles: Record<string, FileNode>,
  trimmedPaths: string[]
): {
  totalTokens: number;
  trimmedTokens: number;
  savedTokens: number;
  savedPercent: number;
} {
  const allContent = Object.values(allFiles).map(f => f.content).join('\n');
  const trimmedContent = trimmedPaths.map(p => allFiles[p]?.content || '').join('\n');

  const totalTokens = estimateTokens(allContent);
  const trimmedTokens = estimateTokens(trimmedContent);

  return {
    totalTokens,
    trimmedTokens,
    savedTokens: totalTokens - trimmedTokens,
    savedPercent: totalTokens > 0 ? ((totalTokens - trimmedTokens) / totalTokens) * 100 : 0,
  };
}