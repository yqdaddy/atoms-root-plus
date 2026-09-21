/**
 * 流式内容解析器：从 LLM 流式输出中提取文件名等结构化信息。
 *
 * 设计参考：Claude Code 的 Tool.ts - renderToolUseMessage 接受 Partial<Input>，
 * 在参数还没流完就开始渲染。
 */

/** 从流式文本中推断文件名 */
export function inferFileNameFromStream(text: string): string | null {
  // 常见模式 1：HTML 文件
  // <filename>index.html</filename> 或 <!-- file: index.html -->
  const htmlFileMatch = text.match(/<(?:filename|file)>\s*([\w\-./]+\.(?:html|htm))\s*<\/(?:filename|file)>/i);
  if (htmlFileMatch) {
    return htmlFileMatch[1] ?? null;
  }

  // 常见模式 2：Markdown 代码块
  // ```html filename="index.html"
  const codeBlockMatch = text.match(/```(?:html|htm)\s+(?:filename=["']?([\w\-./]+\.(?:html|htm))["']?)/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1] ?? null;
  }

  // 常见模式 3：JSON 文件结构
  // { "path": "index.html", "content": "..." }
  const jsonPathMatch = text.match(/"path"\s*:\s*"([\w\-./]+\.(?:html|htm|css|js|ts|tsx|jsx))"/);
  if (jsonPathMatch) {
    return jsonPathMatch[1] ?? null;
  }

  // 常见模式 4：文件路径注释
  // // File: src/index.html 或 /* File: index.html */
  const fileCommentMatch = text.match(/(?:\/\/|\/\*)\s*(?:File|文件)\s*:\s*([\w\-./]+\.(?:html|htm|css|js|ts|tsx|jsx))/i);
  if (fileCommentMatch) {
    return fileCommentMatch[1] ?? null;
  }

  // 默认：如果有明显的 HTML 结构，推断为 index.html
  if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
    return 'index.html';
  }

  return null;
}

/** 从流式文本中推断操作类型 */
export function inferOperationFromStream(text: string): 'create' | 'modify' {
  // 修改关键词
  const modifyKeywords = [
    '修改', '更新', '编辑', 'update', 'modify', 'edit', 'change',
    '调整', '优化', '优化', 'fix', '修复',
  ];

  const lowerText = text.toLowerCase();
  for (const keyword of modifyKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return 'modify';
    }
  }

  return 'create';
}

/** 从流式文本中提取当前生成进度信息 */
export function extractProgressInfo(text: string): {
  fileName: string | null;
  operation: 'create' | 'modify';
} {
  return {
    fileName: inferFileNameFromStream(text),
    operation: inferOperationFromStream(text),
  };
}

/** 审查检查项（与 ReviewVerdict 契约对齐的前端轻量结构） */
export interface ParsedReviewCheck {
  item: string;
  pass: boolean;
  note: string;
}

/**
 * 从审查者输出文本中解析检查结果 JSON。
 * 审查者契约输出 ReviewVerdict（pass + checks[]），文本中可能混有其他内容，
 * 因此用括号配平提取首个完整 JSON 对象后做字段校验。
 */
export function parseReviewChecks(text: string): ParsedReviewCheck[] | null {
  // 括号配平提取首个完整 JSON 对象（避免贪婪匹配跨多个 JSON 块）
  let depth = 0;
  let start = -1;
  let jsonStr: string | null = null;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        jsonStr = text.slice(start, i + 1);
        break;
      }
    }
  }

  if (!jsonStr) return null;

  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.checks)) return null;

    const checks: ParsedReviewCheck[] = [];
    for (const raw of obj.checks) {
      if (typeof raw !== 'object' || raw === null) continue;
      const c = raw as Record<string, unknown>;
      if (typeof c.item !== 'string') continue;
      checks.push({
        item: c.item,
        pass: c.pass === true,
        note: typeof c.note === 'string' ? c.note : '',
      });
    }
    return checks.length > 0 ? checks : null;
  } catch {
    return null;
  }
}