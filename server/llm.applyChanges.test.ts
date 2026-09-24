/**
 * F2 applyChanges 诚实匹配测试（不盲改）
 *
 * 背景（用户事故）：modify 时模型把历史摘要里的代码片段幻觉成现有内容写进 old，
 * 旧实现"old 不匹配仍按行号盲改"（注释原话：信任 LLM 的定位），导致"改得很乱"。
 *
 * 修复语义：
 * - replace/delete 的 old 必须与实际行匹配（精确或 trim 双口径），不匹配即跳过并诚实计数
 * - 空 old 的 replace/delete 视为不匹配（无验证锚点即不动现有内容）
 * - insert 按行号插入不覆盖现有行，不做内容校验（old 常为空是合法形态）
 * - 单文件全部编辑被跳过时不写回该文件（不产生内容不变的"伪修改"标记）
 */

import { describe, it, expect } from 'vitest';
import { applyChanges, parseChangeList } from './llm.js';

const BASE = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>',
    language: 'html' as const,
  },
};

/** 行号对照：1 = <!DOCTYPE html>，2 = <html>，3 = <body>...，4 = </html> */
const LINE3_OLD = '<body><h1 id="title">标题</h1></body>';

describe('F2 applyChanges 诚实匹配（不盲改）', () => {
  it('1. old 精确匹配 → 正常应用', () => {
    const { newFiles, appliedCount, skippedCount } = applyChanges(BASE, [
      {
        file: '/index.html',
        edits: [{ line: 3, old: LINE3_OLD, new: '<body><h1 id="title">新标题</h1></body>', type: 'replace' }],
      },
    ]);
    expect(appliedCount).toBe(1);
    expect(skippedCount).toBe(0);
    expect(newFiles['/index.html']!.content).toContain('新标题');
  });

  it('2. old 不匹配（幻觉内容）→ 跳过不盲改，文件保持原样', () => {
    const { newFiles, appliedCount, skippedCount, skippedEdits } = applyChanges(BASE, [
      {
        file: '/index.html',
        edits: [{ line: 3, old: '历史摘要里幻觉出来的旧代码', new: '<body><h1>覆盖后</h1></body>', type: 'replace' }],
      },
    ]);
    expect(appliedCount).toBe(0);
    expect(skippedCount).toBe(1);
    expect(skippedEdits).toEqual(['/index.html:3']);
    // 修复前：按行号盲改，第 3 行被幻觉 new 覆盖（"改得很乱"根因）
    expect(newFiles['/index.html']!.content).toBe(BASE['/index.html']!.content);
  });

  it('3. 空 old 的 replace/delete 无验证锚点 → 跳过', () => {
    const { appliedCount, skippedCount } = applyChanges(BASE, [
      { file: '/index.html', edits: [{ line: 3, old: '', new: '<body>空锚点</body>', type: 'replace' }] },
      { file: '/index.html', edits: [{ line: 4, old: '', new: '', type: 'delete' }] },
    ]);
    expect(appliedCount).toBe(0);
    expect(skippedCount).toBe(2);
  });

  it('4. old 仅差首尾空白 → trim 口径仍算匹配', () => {
    const { appliedCount, skippedCount, newFiles } = applyChanges(BASE, [
      {
        file: '/index.html',
        edits: [{ line: 3, old: `  ${LINE3_OLD}  `, new: '<body><h1>trim匹配</h1></body>', type: 'replace' }],
      },
    ]);
    expect(appliedCount).toBe(1);
    expect(skippedCount).toBe(0);
    expect(newFiles['/index.html']!.content).toContain('trim匹配');
  });

  it('5. insert 空 old 是合法形态 → 不做内容校验，按行号插入', () => {
    const { newFiles, appliedCount, skippedCount } = applyChanges(BASE, [
      { file: '/index.html', edits: [{ line: 2, old: '', new: '<div>插入的行</div>', type: 'insert' }] },
    ]);
    expect(appliedCount).toBe(1);
    expect(skippedCount).toBe(0);
    const lines = newFiles['/index.html']!.content.split('\n');
    expect(lines[2]).toBe('<div>插入的行</div>');
    expect(lines[3]).toBe(LINE3_OLD);
  });

  it('6. 混合部分应用：匹配的生效，幻觉的跳过且不影响其余行', () => {
    const { newFiles, appliedCount, skippedCount, skippedEdits } = applyChanges(BASE, [
      {
        file: '/index.html',
        edits: [
          { line: 4, old: '</body>', new: '', type: 'replace' }, // 幻觉：第 4 行实际是 </html>
          { line: 3, old: LINE3_OLD, new: '<body><h1>新标题</h1></body>', type: 'replace' }, // 真实
        ],
      },
    ]);
    expect(appliedCount).toBe(1);
    expect(skippedCount).toBe(1);
    expect(skippedEdits).toEqual(['/index.html:4']);
    const content = newFiles['/index.html']!.content;
    expect(content).toContain('新标题');
    expect(content).toContain('</html>'); // 幻觉编辑未污染第 4 行
  });

  it('7. 单文件全部编辑被跳过 → 该文件不写回（无伪修改标记）', () => {
    const { newFiles, appliedCount } = applyChanges(BASE, [
      {
        file: '/index.html',
        edits: [
          { line: 3, old: '幻觉行 A', new: 'x', type: 'replace' },
          { line: 4, old: '幻觉行 B', new: 'y', type: 'delete' },
        ],
      },
    ]);
    expect(appliedCount).toBe(0);
    // 引用不变 = 未被标记为已修改
    expect(newFiles['/index.html']).toBe(BASE['/index.html']);
  });

  it('8. 行号越界与文件不存在 → 结构性 errors，不应用（既有行为保持）', () => {
    const { newFiles, appliedCount, skippedCount, errors } = applyChanges(BASE, [
      { file: '/index.html', edits: [{ line: 99, old: 'x', new: 'y', type: 'replace' }] },
      { file: '/missing.html', edits: [{ line: 1, old: 'x', new: 'y', type: 'replace' }] },
    ]);
    expect(appliedCount).toBe(0);
    expect(skippedCount).toBe(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('行号超出文件范围');
    expect(errors[1]).toContain('文件不存在');
    expect(newFiles['/index.html']).toBe(BASE['/index.html']);
  });
});

describe('P1 §6.2 applyChanges create/delete 扩展', () => {
  it('create 新文件：不要求已存在，content 完整写入，language 按扩展名推断', () => {
    const { newFiles, appliedCount, skippedCount, errors } = applyChanges(BASE, [
      {
        file: '/src/components/Counter.jsx',
        action: 'create',
        content: "import React from 'react';\nexport default function Counter() { return null; }",
        edits: [],
      },
    ]);
    expect(appliedCount).toBe(1);
    expect(skippedCount).toBe(0);
    expect(errors).toHaveLength(0);
    expect(newFiles['/src/components/Counter.jsx']).toEqual({
      path: '/src/components/Counter.jsx',
      content: "import React from 'react';\nexport default function Counter() { return null; }",
      language: 'javascript',
    });
  });

  it('create 语义下 edits 被忽略：带幻觉 edits 也不产生行级改动', () => {
    const { newFiles, appliedCount, skippedCount } = applyChanges(BASE, [
      {
        file: '/src/add.js',
        action: 'create',
        content: 'export const add = (a, b) => a + b;',
        edits: [{ line: 1, old: '不存在的锚点行', new: '幻觉行', type: 'replace' }],
      },
    ]);
    expect(appliedCount).toBe(1); // create 本身计 1
    expect(skippedCount).toBe(0); // edits 被忽略，不进 skip 计数
    expect(newFiles['/src/add.js']!.content).toBe('export const add = (a, b) => a + b;');
  });

  it('create 覆盖已存在文件（整文件替换语义）', () => {
    const { newFiles, appliedCount } = applyChanges(BASE, [
      { file: '/index.html', action: 'create', content: '<!DOCTYPE html><html><body>重写</body></html>', edits: [] },
    ]);
    expect(appliedCount).toBe(1);
    expect(newFiles['/index.html']!.content).toContain('重写');
    expect(newFiles['/index.html']!.path).toBe('/index.html');
  });

  it('create 的 json 文件推断 language 为 json', () => {
    const { newFiles } = applyChanges(BASE, [
      { file: '/src/data.json', action: 'create', content: '{"a":1}', edits: [] },
    ]);
    expect(newFiles['/src/data.json']!.language).toBe('json');
  });

  it('delete 从文件集合移除', () => {
    const extra = {
      ...BASE,
      '/src/old.js': { path: '/src/old.js', content: 'export const old = 1;', language: 'javascript' as const },
    };
    const { newFiles, appliedCount, errors } = applyChanges(extra, [
      { file: '/src/old.js', action: 'delete', edits: [] },
    ]);
    expect(appliedCount).toBe(1);
    expect(errors).toHaveLength(0);
    expect(newFiles['/src/old.js']).toBeUndefined();
    expect(newFiles['/index.html']).toBeDefined();
  });

  it('delete 不存在的文件 → 结构性 errors，不静默吞掉', () => {
    const { newFiles, appliedCount, errors } = applyChanges(BASE, [
      { file: '/src/ghost.js', action: 'delete', edits: [] },
    ]);
    expect(appliedCount).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('文件不存在: /src/ghost.js');
    expect(Object.keys(newFiles)).toEqual(['/index.html']);
  });

  it('create + edit + delete 混合清单一次应用', () => {
    const extra = {
      ...BASE,
      '/src/legacy.js': { path: '/src/legacy.js', content: 'export const legacy = 1;', language: 'javascript' as const },
    };
    const { newFiles, appliedCount } = applyChanges(extra, [
      {
        file: '/index.html',
        edits: [{ line: 3, old: LINE3_OLD, new: '<body><h1 id="title">混合变更</h1></body>', type: 'replace' }],
      },
      { file: '/src/components/Badge.jsx', action: 'create', content: 'export default function Badge() { return null; }', edits: [] },
      { file: '/src/legacy.js', action: 'delete', edits: [] },
    ]);
    expect(appliedCount).toBe(3);
    expect(newFiles['/index.html']!.content).toContain('混合变更');
    expect(newFiles['/src/components/Badge.jsx']).toBeDefined();
    expect(newFiles['/src/legacy.js']).toBeUndefined();
  });

  it('仅 create 的清单 appliedCount > 0（不被误判为"零应用"）', () => {
    const { appliedCount } = applyChanges(BASE, [
      { file: '/src/new.js', action: 'create', content: 'export const n = 1;', edits: [] },
    ]);
    expect(appliedCount).toBeGreaterThan(0);
  });
});

describe('P1 §6.2 parseChangeList action 向后兼容', () => {
  it('无 action 字段 → 归一化为 edit（旧格式兼容）', () => {
    const parsed = parseChangeList(
      JSON.stringify({
        changes: [{ file: '/index.html', edits: [{ line: 1, old: 'a', new: 'b', type: 'replace' }] }],
        summary: '旧格式',
      }),
    );
    expect(parsed.changes[0]!.action).toBe('edit');
  });

  it('显式 action: "edit" 原样保留', () => {
    const parsed = parseChangeList(
      JSON.stringify({
        changes: [{ file: '/index.html', action: 'edit', edits: [{ line: 1, old: 'a', new: 'b', type: 'replace' }] }],
        summary: '显式 edit',
      }),
    );
    expect(parsed.changes[0]!.action).toBe('edit');
  });

  it('action: "create" 允许省略 edits，content 透传', () => {
    const parsed = parseChangeList(
      JSON.stringify({
        changes: [{ file: '/src/components/X.jsx', action: 'create', content: 'export default 1;' }],
        summary: '新增组件',
      }),
    );
    expect(parsed.changes[0]!.action).toBe('create');
    expect(parsed.changes[0]!.content).toBe('export default 1;');
    expect(parsed.changes[0]!.edits).toEqual([]);
  });

  it('action: "delete" 允许省略 edits 与 content', () => {
    const parsed = parseChangeList(
      JSON.stringify({ changes: [{ file: '/src/old.js', action: 'delete' }], summary: '删除' }),
    );
    expect(parsed.changes[0]!.action).toBe('delete');
    expect(parsed.changes[0]!.edits).toEqual([]);
  });

  it('action 非法值 → 抛错（走重试通道修正）', () => {
    expect(() =>
      parseChangeList(
        JSON.stringify({ changes: [{ file: '/a.js', action: 'rewrite', content: 'x' }], summary: 's' }),
      ),
    ).toThrow(/action 非法/);
  });

  it('create 缺 content 或 content 为空 → 抛错', () => {
    expect(() =>
      parseChangeList(JSON.stringify({ changes: [{ file: '/a.js', action: 'create' }], summary: 's' })),
    ).toThrow(/缺少 content/);
    expect(() =>
      parseChangeList(JSON.stringify({ changes: [{ file: '/a.js', action: 'create', content: '   ' }], summary: 's' })),
    ).toThrow(/缺少 content/);
  });

  it('edit action 缺 edits 数组仍抛错（原有校验保持）', () => {
    expect(() =>
      parseChangeList(JSON.stringify({ changes: [{ file: '/a.js', action: 'edit' }], summary: 's' })),
    ).toThrow(/缺少 edits 数组/);
  });
});
