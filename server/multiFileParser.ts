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

/** 解析结果类型：文件列表或纯文本对话 */
export type ParseResultType = 'files' | 'conversation';

/** 统一解析结果：可能是文件列表，也可能是纯文本对话 */
export interface ParseResult {
  type: ParseResultType;
  files?: GeneratedFile[];
  content?: string; // 纯文本对话内容
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
 * 从文件路径扩展名推断语言类型。
 * 未知扩展名默认返回 'text'。
 */
export function inferLanguageFromPath(path: string): FileLanguage {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
    case 'tsx':
      return 'javascript';
    case 'vue':
      return 'html'; // Vue SFC 含 template 主体，按 html 处理
    case 'json':
      return 'json';
    default:
      return 'text';
  }
}

/**
 * 校验并补全单个文件结构。
 * 如果缺少 language 字段，从路径扩展名推断。
 */
function normalizeFile(file: unknown): GeneratedFile | null {
  if (typeof file !== 'object' || file === null) return null;
  const f = file as Record<string, unknown>;

  // path 和 content 是必需的
  if (!isValidPath(f.path) || typeof f.content !== 'string') {
    return null;
  }

  // language 可选，缺失时从路径推断
  const language = isValidLanguage(f.language)
    ? f.language
    : inferLanguageFromPath(f.path);

  return {
    path: f.path,
    content: f.content,
    language,
  };
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
 * 检测文本是否看起来像对话内容而非 JSON。
 *
 * 对话内容的特征：
 * - 包含完整的句子和段落
 * - 没有 JSON 结构特征（花括号、方括号）
 * - 或者 JSON 不完整但文本流畅
 * - 长度较短（通常 < 500 字符）
 */
function looksLikeConversation(text: string): boolean {
  const trimmed = text.trim();

  // 空文本不算对话
  if (trimmed.length === 0) return false;

  // 有明显 JSON 结构的（完整花括号配对），不算对话
  if (trimmed.includes('{') && trimmed.includes('}')) {
    let depth = 0;
    let hasCompleteJson = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          hasCompleteJson = true;
          break;
        }
      }
    }
    if (hasCompleteJson) return false;
  }

  // 检测对话特征：完整的句子、段落结构
  const sentences = trimmed.split(/[。！？\n]/).filter(s => s.trim().length > 0);
  if (sentences.length >= 1) {
    // 如果每段都是完整句子，且没有明显代码结构，判定为对话
    const hasCodeMarkers = /{.*}|[<>\/]=|function\s*\(|const\s+\w+\s*=/.test(trimmed);
    if (!hasCodeMarkers && trimmed.length < 1000) {
      return true;
    }
  }

  return false;
}

/**
 * 将 changes 格式转换为 files 格式的尝试结果。
 * changes 格式基于现有文件进行修改，无法在解析阶段完整转换，
 * 所以这个函数主要用于检测和提供诊断信息。
 */
function convertChangesToFiles(changes: unknown[]): GeneratedFile[] {
  // 检查 changes 结构
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('changes 数组为空或无效');
  }

  // 遍历每个 change，检查是否包含完整的文件内容
  // 某些情况下，LLM 可能在 changes 中输出完整的新文件
  const files: GeneratedFile[] = [];
  for (const change of changes) {
    if (typeof change !== 'object' || change === null) continue;
    const c = change as Record<string, unknown>;

    // 如果 change 中包含完整的 file 对象（有 path、content、language）
    if (isValidPath(c.path) && typeof c.content === 'string') {
      const language = isValidLanguage(c.language)
        ? c.language
        : inferLanguageFromPath(c.path);
      files.push({
        path: c.path as string,
        content: c.content as string,
        language,
      });
    }
  }

  // 如果所有 changes 都包含完整文件内容，可以转换
  if (files.length === changes.length) {
    return files;
  }

  // 否则，changes 是增量修改格式，无法在此阶段转换
  throw new Error('changes 格式为增量修改，需要现有文件才能应用');
}

/**
 * 解析多文件 JSON 输出。
 *
 * @param text LLM 输出的原始文本（可能包含 markdown 围栏）
 * @returns 解析结果，可能是文件列表或纯文本对话
 * @throws ParseError 解析失败且不是对话内容时抛出
 */
export function parseMultiFileOutput(text: string): MultiFileOutput {
  const result = parseOutput(text);
  if (result.type === 'conversation') {
    throw new Error('AI 返回了对话内容而非代码：' + (result.content || ''));
  }
  return { files: result.files! };
}

/**
 * 解析 LLM 输出，支持文件列表和纯文本对话两种类型。
 *
 * @param text LLM 输出的原始文本
 * @returns 统一解析结果
 */
export function parseOutput(text: string): ParseResult {
  // 剥离 markdown 围栏
  const cleanText = stripMarkdownFence(text);

  // 使用括号配平提取首个完整 JSON 对象（避免贪婪匹配跨多个 JSON 块）
  let jsonStr: string | null = null;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (ch === '"') {
      // 跳过字符串字面量，避免 JSON 内部的花括号干扰配对
      i = skipJsonString(cleanText, i) - 1; // -1 因为循环会 i++
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        jsonStr = cleanText.slice(start, i + 1);
        break;
      }
    }
  }

  if (!jsonStr) {
    // 没有 JSON，检查是否是对话内容
    if (looksLikeConversation(cleanText)) {
      console.log('[parseOutput] 检测到纯文本对话内容');
      return {
        type: 'conversation',
        content: cleanText,
        files: undefined,
      };
    }

    // 既没有 JSON，也不是对话，记录详细错误
    const preview = cleanText.length > 1000 ? cleanText.slice(0, 1000) + '...(truncated)' : cleanText;
    console.error('[parseOutput] 无法提取 JSON 对象，原始输出（前 1000 字符）:', preview);
    throw new Error('无法从输出中提取 JSON 对象');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    // JSON 解析失败，尝试检测是否是对话内容
    if (looksLikeConversation(cleanText)) {
      console.log('[parseOutput] JSON 解析失败但检测到对话内容');
      return {
        type: 'conversation',
        content: cleanText,
        files: undefined,
      };
    }
    // 记录详细错误
    const jsonPreview = jsonStr.length > 500 ? jsonStr.slice(0, 500) + '...(truncated)' : jsonStr;
    console.error('[parseOutput] JSON 解析失败:', errorMessage, '\nJSON 片段（前 500 字符）:', jsonPreview);
    throw new Error(`JSON 解析失败: ${errorMessage}`);
  }

  // 校验顶层结构
  if (typeof parsed !== 'object' || parsed === null) {
    // 可能是对话内容被误识别为 JSON
    if (looksLikeConversation(cleanText)) {
      console.log('[parseOutput] 解析结果不是对象但检测到对话内容');
      return {
        type: 'conversation',
        content: cleanText,
        files: undefined,
      };
    }
    throw new Error('解析结果不是对象');
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.files)) {
    // 可能是对话内容被误识别为 JSON
    if (looksLikeConversation(cleanText)) {
      console.log('[parseOutput] files 字段不是数组但检测到对话内容');
      return {
        type: 'conversation',
        content: cleanText,
        files: undefined,
      };
    }

    // 智能格式检测：当没有 files 但有 changes 时，尝试转换
    // 这处理了非 diff 模式下 LLM 返回 diff 格式的情况
    if (Array.isArray(obj.changes)) {
      console.log('[parseOutput] 检测到 changes 格式，尝试转换为 files');
      try {
        const convertedFiles = convertChangesToFiles(obj.changes as unknown[]);
        if (convertedFiles.length > 0) {
          console.log('[parseOutput] changes 转换成功，得到', convertedFiles.length, '个文件');
          return {
            type: 'files',
            files: convertedFiles,
            content: undefined,
          };
        }
      } catch (convertError) {
        console.warn('[parseOutput] changes 转换失败:', convertError);
      }
    }

    // 提供更友好的错误信息
    const preview = JSON.stringify(obj).slice(0, 200);
    throw new Error(`输出格式错误：期望包含 files 数组的对象，但得到：${preview}...`);
  }

  // 校验并补全每个文件
  const files: GeneratedFile[] = [];
  for (let i = 0; i < obj.files.length; i++) {
    const file = normalizeFile(obj.files[i]);
    if (!file) {
      // 提供详细的错误信息
      const filePreview = JSON.stringify(obj.files[i]).slice(0, 100);
      throw new Error(`文件 ${i} 格式错误：需要 { path: "/...", content: "..." }，但得到：${filePreview}...`);
    }
    files.push(file);
  }

  // 校验必须有入口文件
  const hasIndexHtml = files.some(f => f.path === '/index.html');
  if (!hasIndexHtml) {
    // 如果有其他文件，尝试降级处理
    if (files.length > 0) {
      console.warn('[parseOutput] 缺少入口文件 /index.html，但返回其他文件');
      // 添加一个简单的入口文件
      files.unshift({
        path: '/index.html',
        content: '<!DOCTYPE html><html><body>缺少入口文件</body></html>',
        language: 'html',
      });
    } else {
      throw new Error('生成失败：没有有效的文件');
    }
  }

  return {
    type: 'files',
    files,
    content: undefined,
  };
}

/**
 * 跳过一个 JSON 字符串字面量。
 * start 指向起始引号，返回结束引号之后的位置；字符串未闭合时返回文本长度。
 * 正确处理反斜杠转义（如 \" 与 \\），因此文件内容中的引号不会干扰边界判断。
 */
function skipJsonString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2; // 跳过转义符与被转义的字符
      continue;
    }
    if (ch === '"') {
      return i + 1;
    }
    i++;
  }
  return text.length;
}

/**
 * 从 start（指向 "{"）开始寻找配对的 "}"。
 * 扫描时跳过字符串字面量，避免文件内容中的花括号干扰配对。
 * 找不到配对（输出在字符串中途被截断）时返回 -1。
 */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipJsonString(text, i);
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

/**
 * 逐文件边界扫描：从（可能截断的）JSON 文本中抢救所有结构完整的文件对象。
 *
 * 原理：
 * 1. 以字符为单位扫描，字符串字面量整体跳过，文件内容中的花括号与引号不会干扰定位
 * 2. 遇到能闭合的对象就尝试 JSON.parse 并按文件结构校验，通过则收入抢救结果
 * 3. 无法闭合的对象（最后一个被截断的文件，或外层包裹对象）下潜一层继续扫描，
 *    其内部已完成的文件对象仍可被找到
 * 4. 被截断文件的未闭合字符串会被整体跳到文本末尾，不完整尾部自然被丢弃
 */
function salvageCompleteFiles(text: string): GeneratedFile[] {
  const salvaged: GeneratedFile[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipJsonString(text, i);
      continue;
    }
    if (ch === '{') {
      const end = findMatchingBrace(text, i);
      if (end !== -1) {
        const candidate = text.slice(i, end + 1);
        try {
          const parsed: unknown = JSON.parse(candidate);
          const normalized = normalizeFile(parsed);
          if (normalized) {
            salvaged.push(normalized);
            i = end + 1;
            continue;
          }
        } catch {
          // 不是合法的 JSON 文件对象（如外层包裹对象），下潜继续扫描
        }
      }
      // 无法闭合或不是文件对象：下潜一层，继续寻找内部的文件对象
      i++;
      continue;
    }
    i++;
  }
  return salvaged;
}

/**
 * 截断修复：从因 max_tokens 耗尽而中途截断的多文件 JSON 输出中抢救已完成的文件。
 *
 * 逐文件边界扫描（容忍字符串中途截断），丢弃不完整尾部；
 * 抢救结果必须包含入口文件 /index.html 才值得采纳（否则组装后无法预览）。
 * 对完整输入同样安全：完整 JSON 中的每个文件对象也能被逐个扫描出来，结果不丢失。
 *
 * @param text LLM 输出的原始文本（可能包含 markdown 围栏）
 * @returns 抢救成功返回多文件结构；完全无法抢救（无任何完整文件或缺入口文件）返回 null
 */
export function repairTruncatedMultiFileOutput(text: string): MultiFileOutput | null {
  const cleanText = stripMarkdownFence(text);
  const salvaged = salvageCompleteFiles(cleanText);
  const hasIndexHtml = salvaged.some(f => f.path === '/index.html');
  if (!hasIndexHtml) {
    return null;
  }
  return { files: salvaged };
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