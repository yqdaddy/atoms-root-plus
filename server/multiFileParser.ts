/**
 * 多文件输出解析器。
 *
 * 职责：
 * 1. 解析 LLM 输出的 JSON 格式多文件结构
 * 2. 剥离 markdown 围栏
 * 3. 校验文件结构合法性
 * 4. 支持流式累积解析
 *
 * 设计文档：docs/tech-multi-file-generation.md 第 3 节
 */

/** 文件语言类型 */
export type FileLanguage = 'html' | 'css' | 'javascript' | 'json' | 'text';

/** 单个生成文件 */
export interface GeneratedFile {
  path: string;
  content: string;
  language: FileLanguage;
}

/** 多文件输出结构 */
export interface MultiFileOutput {
  files: GeneratedFile[];
}

/** 合法的文件语言类型 */
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['html', 'css', 'javascript', 'json', 'text']);

/**
 * 剥离 LLM 输出中误加的 markdown 代码围栏。
 * 仅剥离首行围栏与末行围栏，不触碰 JSON 内部内容。
 */
export function stripMarkdownFence(text: string): string {
  let result = text.trim();
  // 剥离开头围栏行（```json / ``` 等）
  if (result.startsWith('```')) {
    const firstNewline = result.indexOf('\n');
    result = firstNewline === -1 ? '' : result.slice(firstNewline + 1);
  }
  // 剥离结尾的围栏行
  if (result.endsWith('```')) {
    const lastNewline = result.lastIndexOf('\n');
    result = lastNewline === -1 ? '' : result.slice(0, lastNewline);
  }
  return result.trim();
}

/**
 * 校验文件路径格式。
 * 路径必须以 "/" 开头。
 */
function isValidPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/');
}

/**
 * 校验语言类型。
 */
function isValidLanguage(language: unknown): language is FileLanguage {
  return typeof language === 'string' && VALID_LANGUAGES.has(language);
}

/**
 * 校验单个文件结构。
 */
function isValidFile(file: unknown): file is GeneratedFile {
  if (typeof file !== 'object' || file === null) return false;
  const f = file as Record<string, unknown>;
  return isValidPath(f.path) &&
         typeof f.content === 'string' &&
         isValidLanguage(f.language);
}

/**
 * 解析多文件 JSON 输出。
 *
 * @param text LLM 输出的原始文本（可能包含 markdown 围栏）
 * @returns 解析后的多文件结构
 * @throws ParseError 解析失败时抛出
 */
export function parseMultiFileOutput(text: string): MultiFileOutput {
  // 剥离 markdown 围栏
  const cleanText = stripMarkdownFence(text);

  // 尝试提取 JSON
  const jsonMatch = cleanText.match(/\{[\s\S]*"files"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('无法从输出中提取 JSON 对象');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw new Error(`JSON 解析失败: ${errorMessage}`);
  }

  // 校验顶层结构
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('解析结果不是对象');
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.files)) {
    throw new Error('files 字段不是数组');
  }

  // 校验每个文件
  const files: GeneratedFile[] = [];
  for (let i = 0; i < obj.files.length; i++) {
    const file = obj.files[i];
    if (!isValidFile(file)) {
      throw new Error(`files[${i}] 结构不合法：需要 { path: "/...", content: "...", language: "html|css|javascript|json|text" }`);
    }
    files.push(file);
  }

  // 校验必须有入口文件
  const hasIndexHtml = files.some(f => f.path === '/index.html');
  if (!hasIndexHtml) {
    throw new Error('缺少入口文件 /index.html');
  }

  return { files };
}

/**
 * 流式多文件解析器。
 * 支持增量追加文本，在 JSON 完整后解析。
 */
export class StreamingMultiFileParser {
  private buffer = '';

  /**
   * 追加流式文本。
   */
  append(text: string): void {
    this.buffer += text;
  }

  /**
   * 尝试解析当前缓冲区。
   * @returns 解析成功返回结果，JSON 不完整返回 null
   */
  tryParse(): MultiFileOutput | null {
    try {
      return parseMultiFileOutput(this.buffer);
    } catch {
      // JSON 不完整或格式错误，返回 null
      return null;
    }
  }

  /**
   * 检查缓冲区是否包含完整的 JSON。
   * 用于判断是否可以尝试解析。
   */
  hasCompleteJson(): boolean {
    const cleanText = stripMarkdownFence(this.buffer);
    // 检查是否有完整的 JSON 结构
    if (!cleanText.includes('"files"')) return false;
    // 检查花括号是否匹配
    let depth = 0;
    for (const char of cleanText) {
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    return depth === 0;
  }

  /**
   * 获取当前缓冲区内容（用于调试）。
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * 重置缓冲区。
   */
  reset(): void {
    this.buffer = '';
  }
}

/**
 * 将多文件输出转换为 Record<string, FileNode> 格式。
 * 用于存储到 Project.files。
 */
export function toFileNodeRecord(
  output: MultiFileOutput,
  existingFiles?: Record<string, { path: string; content: string; language: FileLanguage; updatedAt?: string }>
): Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }> {
  const now = new Date().toISOString();
  const result: Record<string, { path: string; content: string; language: FileLanguage; updatedAt: string }> = {};

  // 保留未变更的文件
  if (existingFiles) {
    for (const [path, node] of Object.entries(existingFiles)) {
      result[path] = {
        path: node.path,
        content: node.content,
        language: node.language,
        updatedAt: node.updatedAt || now,
      };
    }
  }

  // 覆盖变更的文件
  for (const file of output.files) {
    result[file.path] = {
      path: file.path,
      content: file.content,
      language: file.language,
      updatedAt: now,
    };
  }

  return result;
}

/**
 * 生成文件树摘要。
 * 用于迭代模式时传给分析师阶段的上下文。
 *
 * @param files 文件系统
 * @returns 文件树摘要文本
 */
export function generateFileTreeSummary(
  files: Record<string, { path: string; content: string }>
): string {
  const paths = Object.keys(files).sort();

  // 生成每个文件的一行描述
  const lines = paths.map(path => {
    const file = files[path];
    if (!file) return path;

    // 根据文件类型生成简短描述
    const ext = path.split('.').pop()?.toLowerCase();

    // 尝试从内容中提取简单描述
    let description = '';
    if (ext === 'html') {
      // 提取 title
      const titleMatch = file.content.match(/<title>([^<]+)<\/title>/i);
      description = titleMatch ? `主入口，${titleMatch[1]}` : '主入口文件';
    } else if (ext === 'css') {
      // 计算 CSS 规则数
      const ruleCount = (file.content.match(/\{/g) || []).length;
      description = `样式文件，${ruleCount} 条规则`;
    } else if (ext === 'js') {
      // 提取函数名或组件名
      const functionMatches = file.content.match(/function\s+(\w+)/g);
      const constMatches = file.content.match(/const\s+(\w+)\s*=/g);
      const names: string[] = [];
      if (functionMatches) {
        names.push(...functionMatches.map(m => m.replace('function ', '')));
      }
      if (constMatches) {
        names.push(...constMatches.map(m => m.replace('const ', '').replace('=', '').trim()));
      }
      description = names.length > 0 ? `脚本，含 ${names.slice(0, 3).join('、')}` : '脚本文件';
    } else {
      description = '项目文件';
    }

    return `${path} - ${description}`;
  });

  return lines.join('\n');
}

/**
 * 根据变更计划筛选受影响的文件。
 * 用于迭代模式时传给工程师阶段的完整文件内容。
 *
 * @param files 当前文件系统
 * @param affectedPaths 受影响的文件路径列表
 * @returns 受影响文件的完整内容，格式化为一行分隔符格式
 */
export function formatAffectedFiles(
  files: Record<string, { path: string; content: string }>,
  affectedPaths: string[]
): string {
  const result: string[] = [];

  for (const path of affectedPaths) {
    const file = files[path];
    if (file) {
      result.push(`=== ${path} ===`);
      result.push(file.content);
      result.push('');
    }
  }

  return result.join('\n');
}