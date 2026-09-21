/**
 * src/utils/streamParser.ts 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  inferFileNameFromStream,
  inferOperationFromStream,
  extractProgressInfo,
  parseReviewChecks,
} from './streamParser.js';

describe('inferFileNameFromStream', () => {
  it('从 HTML 标签格式推断文件名', () => {
    const cases = [
      { input: '<filename>index.html</filename>', expected: 'index.html' },
      { input: '<file>app.html</file>', expected: 'app.html' },
    ];

    for (const { input, expected } of cases) {
      expect(inferFileNameFromStream(input)).toBe(expected);
    }
  });

  it('从 Markdown 代码块推断文件名', () => {
    const cases = [
      { input: '```html filename="index.html"', expected: 'index.html' },
      { input: '```htm filename=\'app.htm\'', expected: 'app.htm' },
      { input: '```html filename=index.html', expected: 'index.html' },
    ];

    for (const { input, expected } of cases) {
      expect(inferFileNameFromStream(input)).toBe(expected);
    }
  });

  it('从 JSON 结构推断文件名', () => {
    const cases = [
      { input: '{ "path": "index.html", "content": "..." }', expected: 'index.html' },
      { input: '{"path":"styles.css","content":"..."}', expected: 'styles.css' },
      { input: '{ "path": "app.js", "language": "javascript" }', expected: 'app.js' },
    ];

    for (const { input, expected } of cases) {
      expect(inferFileNameFromStream(input)).toBe(expected);
    }
  });

  it('从文件注释推断文件名', () => {
    const cases = [
      { input: '// File: src/index.html', expected: 'src/index.html' },
      { input: '/* File: index.css */', expected: 'index.css' },
      { input: '// 文件: app.js', expected: 'app.js' },
    ];

    for (const { input, expected } of cases) {
      expect(inferFileNameFromStream(input)).toBe(expected);
    }
  });

  it('从 DOCTYPE 推断 index.html', () => {
    const cases = [
      { input: '<!DOCTYPE html><html>', expected: 'index.html' },
      { input: '<html lang="en">', expected: 'index.html' },
    ];

    for (const { input, expected } of cases) {
      expect(inferFileNameFromStream(input)).toBe(expected);
    }
  });

  it('无法推断时返回 null', () => {
    const cases = [
      '',
      'random text',
      'no file name here',
      'just some code',
    ];

    for (const input of cases) {
      expect(inferFileNameFromStream(input)).toBeNull();
    }
  });

  it('处理带空白的格式', () => {
    expect(inferFileNameFromStream('<filename>  index.html  </filename>')).toBe('index.html');
    expect(inferFileNameFromStream('{ "path" :  "index.html" }')).toBe('index.html');
  });

  it('支持多种文件扩展名', () => {
    const extensions = ['.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx'];
    for (const ext of extensions) {
      const input = `{ "path": "file${ext}" }`;
      expect(inferFileNameFromStream(input)).toBe(`file${ext}`);
    }
  });
});

describe('inferOperationFromStream', () => {
  it('修改关键词识别为 modify', () => {
    const keywords = [
      '修改按钮',
      '更新页面',
      '编辑内容',
      'Update the code',
      'Modify the style',
      'Edit the file',
      'Change the color',
      '调整布局',
      '优化性能',
      'fix bug',
      '修复问题',
    ];

    for (const text of keywords) {
      expect(inferOperationFromStream(text)).toBe('modify');
    }
  });

  it('创建操作识别为 create', () => {
    const cases = [
      '创建一个新的页面',
      '生成一个组件',
      'Create a new file',
      'Generate a page',
      'Build an app',
    ];

    for (const text of cases) {
      expect(inferOperationFromStream(text)).toBe('create');
    }
  });

  it('空文本默认为 create', () => {
    expect(inferOperationFromStream('')).toBe('create');
  });

  it('关键词不区分大小写', () => {
    expect(inferOperationFromStream('MODIFY the file')).toBe('modify');
    expect(inferOperationFromStream('Update THE code')).toBe('modify');
  });
});

describe('extractProgressInfo', () => {
  it('同时提取文件名和操作类型', () => {
    const result = extractProgressInfo('{ "path": "index.html" } 修改样式');
    expect(result.fileName).toBe('index.html');
    expect(result.operation).toBe('modify');
  });

  it('无法提取文件名时返回 null', () => {
    const result = extractProgressInfo('修改按钮样式');
    expect(result.fileName).toBeNull();
    expect(result.operation).toBe('modify');
  });

  it('创建操作', () => {
    const result = extractProgressInfo('// File: index.html\n创建新页面');
    expect(result.fileName).toBe('index.html');
    expect(result.operation).toBe('create');
  });
});

describe('parseReviewChecks', () => {
  it('解析完整的审查结果 JSON', () => {
    const text = JSON.stringify({
      pass: false,
      checks: [
        { item: '类型安全', pass: true, note: '无类型错误' },
        { item: '命名规范', pass: false, note: '变量名不符合规范' },
      ],
    });

    const result = parseReviewChecks(text);
    expect(result).toEqual([
      { item: '类型安全', pass: true, note: '无类型错误' },
      { item: '命名规范', pass: false, note: '变量名不符合规范' },
    ]);
  });

  it('从混合文本中提取 JSON', () => {
    const text = `
审查结果如下：

{
  "pass": true,
  "checks": [
    { "item": "代码风格", "pass": true, "note": "符合规范" }
  ]
}

以上是审查结果。
`;

    const result = parseReviewChecks(text);
    expect(result).toEqual([{ item: '代码风格', pass: true, note: '符合规范' }]);
  });

  it('note 字段缺失时使用空字符串', () => {
    const text = JSON.stringify({
      pass: false,
      checks: [{ item: '测试覆盖', pass: false }],
    });

    const result = parseReviewChecks(text);
    expect(result).toEqual([{ item: '测试覆盖', pass: false, note: '' }]);
  });

  it('pass 字段非布尔时转为 false', () => {
    const text = JSON.stringify({
      pass: false,
      checks: [{ item: '测试', pass: 'yes', note: '' }],
    });

    const result = parseReviewChecks(text);
    expect(result).toEqual([{ item: '测试', pass: false, note: '' }]);
  });

  it('checks 数组为空时返回 null', () => {
    const text = JSON.stringify({ pass: true, checks: [] });
    expect(parseReviewChecks(text)).toBeNull();
  });

  it('checks 字段缺失时返回 null', () => {
    const text = JSON.stringify({ pass: true });
    expect(parseReviewChecks(text)).toBeNull();
  });

  it('无 JSON 时返回 null', () => {
    expect(parseReviewChecks('无审查结果')).toBeNull();
    expect(parseReviewChecks('')).toBeNull();
  });

  it('JSON 格式错误时返回 null', () => {
    expect(parseReviewChecks('{ invalid json }')).toBeNull();
  });

  it('忽略非对象类型的 checks 元素', () => {
    const text = JSON.stringify({
      pass: false,
      checks: [
        { item: '检查1', pass: true, note: '' },
        'invalid',
        null,
        { item: '检查2', pass: false, note: '' },
      ],
    });

    const result = parseReviewChecks(text);
    expect(result).toEqual([
      { item: '检查1', pass: true, note: '' },
      { item: '检查2', pass: false, note: '' },
    ]);
  });

  it('忽略 item 非字符串的元素', () => {
    const text = JSON.stringify({
      pass: false,
      checks: [
        { item: 123, pass: true, note: '' },
        { item: '有效项', pass: true, note: '' },
      ],
    });

    const result = parseReviewChecks(text);
    expect(result).toEqual([{ item: '有效项', pass: true, note: '' }]);
  });

  it('只提取第一个完整的 JSON 对象', () => {
    const text = `
{"pass": false, "checks": [{"item": "第一项", "pass": true, "note": ""}]}
{"pass": true, "checks": [{"item": "第二项", "pass": false, "note": ""}]}
`;

    const result = parseReviewChecks(text);
    expect(result).toEqual([{ item: '第一项', pass: true, note: '' }]);
  });

  it('处理嵌套的花括号', () => {
    const text = JSON.stringify({
      pass: false,
      checks: [
        {
          item: '复杂检查',
          pass: true,
          note: '包含嵌套对象 {"key": "value"}',
        },
      ],
    });

    const result = parseReviewChecks(text);
    expect(result).toEqual([
      {
        item: '复杂检查',
        pass: true,
        note: '包含嵌套对象 {"key": "value"}',
      },
    ]);
  });
});