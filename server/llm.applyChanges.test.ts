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
import { applyChanges } from './llm.js';

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
