/**
 * 需求覆盖核对单测。
 *
 * 覆盖面：
 * - extractRequirementItems：标准 features 数组归一化、raw 文本回退拆行、
 *   无效输入容错
 * - extractCoverageSignals：引号命名、领域动作词、英文技术词、中文滑窗、
 *   信号词数量上限
 * - checkItemCoverage：动作词实现痕迹命中、原文信号命中、动作词无痕迹
 *   不误判、无信号不误判（宁漏报不误报）
 * - checkRequirementCoverage：批量统计与报告结构
 * - mergeCodeText：css 文件排除
 * - buildCoverageNotice：全覆盖/空清单返回 null、部分覆盖文案、must 标注
 */

import { describe, it, expect } from 'vitest';
import {
  extractRequirementItems,
  extractCoverageSignals,
  checkItemCoverage,
  checkRequirementCoverage,
  mergeCodeText,
  buildCoverageNotice,
  type RequirementItem,
} from './requirementCoverage.js';

describe('extractRequirementItems：清单提取', () => {
  it('标准 features 数组逐项归一化', () => {
    const items = extractRequirementItems({
      features: [
        { id: 'F1', name: '添加待办', description: '输入框 + 按钮 + 回车', priority: 'must' },
        { name: '删除待办', description: '带确认对话框' }, // id 缺失自动编号
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'F1', name: '添加待办', description: '输入框 + 按钮 + 回车', priority: 'must' });
    expect(items[1]!.id).toBe('F2');
    expect(items[1]!.priority).toBe('nice'); // priority 缺省补 nice
  });

  it('features 中 null/无 name 且无 description 的条目被过滤', () => {
    const items = extractRequirementItems({
      features: [
        null,
        { id: 'F1', name: '', description: '' },
        { id: 'F2', name: '有效功能', description: 'x', priority: 'must' },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('F2');
  });

  it('raw 文本回退：按行拆分并剥离列表前缀', () => {
    const items = extractRequirementItems({
      raw: '- 添加待办，输入后回车确认\n1. 删除待办需要确认\n这是一个足够长的普通需求行',
    });
    expect(items).toHaveLength(3);
    expect(items[0]!.name).toBe('添加待办，输入后回车确认');
    expect(items[1]!.name).toBe('删除待办需要确认');
    expect(items[0]!.id).toBe('R1');
  });

  it('raw 中短行与标题行被过滤', () => {
    const items = extractRequirementItems({
      raw: '# 标题行\n短\n这条是长度足够的普通描述行',
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('这条是长度足够的普通描述行');
  });

  it('无效输入返回空数组（不抛错）', () => {
    expect(extractRequirementItems(undefined)).toEqual([]);
    expect(extractRequirementItems(null)).toEqual([]);
    expect(extractRequirementItems('字符串')).toEqual([]);
    expect(extractRequirementItems({ other: 1 })).toEqual([]);
    expect(extractRequirementItems({ features: '不是数组' })).toEqual([]);
  });
});

describe('extractCoverageSignals：信号词提炼', () => {
  it('引号内的显式命名作为信号', () => {
    const signals = extractCoverageSignals({
      id: 'F1', name: '特殊功能', description: '支持"番茄模式"切换', priority: 'must',
    });
    expect(signals).toContain('番茄模式');
  });

  it('领域动作词命中（添加/删除/导出等）', () => {
    const signals = extractCoverageSignals({
      id: 'F1', name: '数据管理', description: '支持添加与导出 CSV', priority: 'must',
    });
    expect(signals).toContain('添加');
    expect(signals).toContain('导出');
  });

  it('英文技术词原样作为信号', () => {
    const signals = extractCoverageSignals({
      id: 'F1', name: '持久化', description: '使用 localStorage 保存数据', priority: 'must',
    });
    expect(signals).toContain('localStorage');
  });

  it('通用停用词不进入信号', () => {
    const signals = extractCoverageSignals({
      id: 'F1', name: '功能', description: '用户可以点击按钮进行显示', priority: 'must',
    });
    expect(signals).not.toContain('功能');
    expect(signals).not.toContain('用户');
    expect(signals).not.toContain('点击');
  });

  it('信号词至多 5 个', () => {
    const signals = extractCoverageSignals({
      id: 'F1', name: '复合功能', description: '添加删除编辑筛选搜索导出导入复制重置撤销拖拽',
      priority: 'must',
    });
    expect(signals.length).toBeLessThanOrEqual(5);
  });

  it('空条目返回空信号', () => {
    expect(extractCoverageSignals({ id: 'F1', name: '', description: '', priority: 'must' })).toEqual([]);
  });
});

describe('checkItemCoverage：单条覆盖判定', () => {
  it('动作词有实现痕迹 → 覆盖', () => {
    const item: RequirementItem = { id: 'F1', name: '删除待办', description: '点击删除按钮移除条目', priority: 'must' };
    const code = `
      function handleDelete(id) { setTodos(todos.filter(t => t.id !== id)); }
      <button onClick={() => handleDelete(1)}>删除</button>
    `;
    const entry = checkItemCoverage(item, code.toLowerCase());
    expect(entry.covered).toBe(true);
    expect(entry.matchedSignals).toContain('删除');
  });

  it('动作词在代码中无实现痕迹 → 不覆盖（防需求原词误判）', () => {
    const item: RequirementItem = { id: 'F1', name: '导出数据', description: '支持导出为文件', priority: 'must' };
    // 代码只有"导出"字样的文案，无 export/download/CSV 等实现痕迹
    const code = '<div>导出功能开发中，敬请期待</div>';
    const entry = checkItemCoverage(item, code.toLowerCase());
    expect(entry.covered).toBe(false);
  });

  it('原文信号词在代码中命中 → 覆盖', () => {
    const item: RequirementItem = { id: 'F1', name: '深色主题', description: '支持深色主题切换', priority: 'nice' };
    const code = 'const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");';
    const entry = checkItemCoverage(item, code.toLowerCase());
    expect(entry.covered).toBe(true);
  });

  it('无信号可提炼时不误判（返回覆盖）', () => {
    const item: RequirementItem = { id: 'F1', name: '', description: '', priority: 'must' };
    const entry = checkItemCoverage(item, '');
    expect(entry.covered).toBe(true);
  });

  it('判定结果携带条目元信息', () => {
    const item: RequirementItem = { id: 'F7', name: '重置', description: '重置按钮', priority: 'must' };
    const entry = checkItemCoverage(item, 'function reset() { count = 0; }');
    expect(entry.id).toBe('F7');
    expect(entry.priority).toBe('must');
  });
});

describe('checkRequirementCoverage：批量核对', () => {
  const items: RequirementItem[] = [
    { id: 'F1', name: '添加', description: '添加待办', priority: 'must' },
    { id: 'F2', name: '删除', description: '删除待办', priority: 'must' },
    { id: 'F3', name: '主题切换', description: '深色主题', priority: 'nice' },
  ];
  const code = `
    function handleAdd(text) { setTodos([...todos, { text }]); }
    function handleDelete(id) { setTodos(todos.filter(t => t.id !== id)); }
  `;

  it('统计与未覆盖清单正确', () => {
    const report = checkRequirementCoverage(items, code);
    expect(report.total).toBe(3);
    expect(report.coveredCount).toBe(2);
    expect(report.uncovered).toHaveLength(1);
    expect(report.uncovered[0]!.id).toBe('F3');
  });

  it('entries 逐项结果齐全', () => {
    const report = checkRequirementCoverage(items, code);
    expect(report.entries.map((e) => e.covered)).toEqual([true, true, false]);
  });

  it('全覆盖时 uncovered 为空', () => {
    const fullCode = code + ' const toggleTheme = () => {};';
    const report = checkRequirementCoverage(items, fullCode);
    expect(report.uncovered).toHaveLength(0);
  });
});

describe('mergeCodeText：代码合并', () => {
  it('合并非 css 文件内容', () => {
    const files = {
      '/index.html': { path: '/index.html', content: '<button id="add">添加</button>', language: 'html' as const },
      '/src/main.js': { path: '/src/main.js', content: 'function handleAdd() {}', language: 'javascript' as const },
      '/styles/main.css': { path: '/styles/main.css', content: '.btn { color: red }', language: 'css' as const },
    };
    const merged = mergeCodeText(files);
    expect(merged).toContain('handleAdd');
    expect(merged).toContain('id="add"');
    expect(merged).not.toContain('.btn { color: red }');
  });
});

describe('buildCoverageNotice：提醒文案', () => {
  it('全覆盖返回 null（不打扰）', () => {
    const report = checkRequirementCoverage(
      [{ id: 'F1', name: '添加', description: '添加待办', priority: 'must' }],
      'function handleAdd() {}'
    );
    expect(buildCoverageNotice(report)).toBeNull();
  });

  it('空清单返回 null（无从核对）', () => {
    const report = { total: 0, coveredCount: 0, uncovered: [], entries: [] };
    expect(buildCoverageNotice(report)).toBeNull();
  });

  it('部分覆盖输出已实现比例与未覆盖清单', () => {
    const report = checkRequirementCoverage(
      [
        { id: 'F1', name: '添加', description: '添加待办', priority: 'must' },
        { id: 'F2', name: '主题切换', description: '深色主题', priority: 'nice' },
      ],
      'function handleAdd() {}'
    );
    const notice = buildCoverageNotice(report);
    expect(notice).not.toBeNull();
    expect(notice).toContain('已实现 1/2 项需求');
    expect(notice).toContain('主题切换');
  });

  it('must 未覆盖条目带（必须）标注', () => {
    const report = checkRequirementCoverage(
      [
        { id: 'F1', name: '添加', description: '添加待办', priority: 'nice' },
        { id: 'F2', name: '数据导出', description: '导出为文件', priority: 'must' },
      ],
      'function handleAdd() {}'
    );
    const notice = buildCoverageNotice(report);
    expect(notice).toContain('数据导出（必须）');
  });
});
