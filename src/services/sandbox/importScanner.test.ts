import { describe, it, expect } from 'vitest';
import {
  stripComments,
  scanImportSpecifiers,
  containsImportMeta,
  dirnameOf,
  normalizeJoin,
  resolveImportSpecifier,
} from './importScanner';
import { CSS_MODULE_SENTINEL } from './bareImportShims';

describe('importScanner - stripComments', () => {
  it('剥离块注释并保留换行数', () => {
    const source = 'const a = 1;\n/* import x from "hidden";\n   multi line */\nconst b = 2;';
    const stripped = stripComments(source);
    expect(stripped).not.toContain('hidden');
    expect(stripped).toContain('const a = 1;');
    expect(stripped).toContain('const b = 2;');
    expect(stripped.split('\n').length).toBe(source.split('\n').length);
  });

  it('剥离行首注释', () => {
    const source = "// import Ghost from './ghost';\nconst a = 1;";
    expect(stripComments(source)).not.toContain('Ghost');
  });

  it('保留代码中的除号不误剥', () => {
    const source = "const v = a / b;\nconst url = 'https://example.com';";
    const stripped = stripComments(source);
    expect(stripped).toContain('a / b');
    expect(stripped).toContain("'https://example.com'");
  });
});

describe('importScanner - scanImportSpecifiers', () => {
  it('扫描 default / named / namespace 导入', () => {
    const source = [
      "import React from 'react';",
      "import { useState, useEffect } from 'react';",
      "import * as Utils from './utils';",
    ].join('\n');
    expect(scanImportSpecifiers(source)).toEqual(['react', './utils']);
  });

  it('扫描多行 import 与无分号形态', () => {
    const source = "import {\n  useState,\n  useEffect,\n} from 'react'\nconsole.log(useState);";
    expect(scanImportSpecifiers(source)).toEqual(['react']);
  });

  it('扫描副作用 import 与 re-export 与动态 import', () => {
    const source = [
      "import './styles.css';",
      "export * from './utils';",
      "export { default as Card } from './Card';",
      "import('./lazy').then((m) => m.run());",
    ].join('\n');
    const specs = scanImportSpecifiers(source);
    expect(specs).toContain('./styles.css');
    expect(specs).toContain('./utils');
    expect(specs).toContain('./Card');
    expect(specs).toContain('./lazy');
  });

  it('忽略注释中的伪 import', () => {
    const source = [
      "// import Ghost from './ghost';",
      "/* import BlockGhost from './block-ghost'; */",
      "import Real from './real';",
    ].join('\n');
    expect(scanImportSpecifiers(source)).toEqual(['./real']);
  });

  it('不把字符串字面量中的 import 关键字当导入', () => {
    const source = "const tip = \"import x from 'y'\";\nimport Real from './real';";
    expect(scanImportSpecifiers(source)).toEqual(['./real']);
  });

  it('空输入与无导入输入返回空数组', () => {
    expect(scanImportSpecifiers('')).toEqual([]);
    expect(scanImportSpecifiers('const a = 1; console.log(a);')).toEqual([]);
  });
});

describe('importScanner - containsImportMeta', () => {
  it('检测 import.meta 各种写法', () => {
    expect(containsImportMeta('console.log(import.meta.env);')).toBe(true);
    expect(containsImportMeta('const x = import\n  .meta.url;')).toBe(true);
  });

  it('不误报普通属性访问与字符串', () => {
    expect(containsImportMeta('const meta = obj.importx.meta;')).toBe(false);
    expect(containsImportMeta("// comment import.meta")).toBe(false);
  });
});

describe('importScanner - 路径工具', () => {
  it('dirnameOf 返回模块所在目录', () => {
    expect(dirnameOf('/src/components/App.jsx')).toBe('/src/components');
    expect(dirnameOf('/main.jsx')).toBe('');
  });

  it('normalizeJoin 处理 ./ ../ 与多余斜杠', () => {
    expect(normalizeJoin('/src/components', './Counter.jsx')).toBe('/src/components/Counter.jsx');
    expect(normalizeJoin('/src/components', '../hooks/useCounter')).toBe('/src/hooks/useCounter');
    expect(normalizeJoin('/src', './a/../b/./c.js')).toBe('/src/b/c.js');
  });
});

describe('importScanner - resolveImportSpecifier', () => {
  const known = ['/src/main.jsx', '/src/App.jsx', '/src/components/Counter.jsx', '/src/utils/index.js'];

  it('相对说明符：精确命中', () => {
    const r = resolveImportSpecifier('./App.jsx', '/src/main.jsx', known);
    expect(r).toEqual({ kind: 'local', path: '/src/App.jsx' });
  });

  it('相对说明符：省略扩展名推断 .jsx', () => {
    const r = resolveImportSpecifier('./components/Counter', '/src/main.jsx', known);
    expect(r).toEqual({ kind: 'local', path: '/src/components/Counter.jsx' });
  });

  it('相对说明符：目录 index 归一', () => {
    const r = resolveImportSpecifier('./utils', '/src/main.jsx', known);
    expect(r).toEqual({ kind: 'local', path: '/src/utils/index.js' });
  });

  it('相对说明符：.js 后缀改判 .jsx 文件', () => {
    const r = resolveImportSpecifier('./App.js', '/src/main.jsx', known);
    expect(r).toEqual({ kind: 'local', path: '/src/App.jsx' });
  });

  it('根相对说明符按项目根解析', () => {
    const r = resolveImportSpecifier('/src/App.jsx', '/src/deep/Nested.jsx', known);
    expect(r).toEqual({ kind: 'local', path: '/src/App.jsx' });
  });

  it('找不到目标返回 missing', () => {
    expect(resolveImportSpecifier('./NoSuchFile', '/src/main.jsx', known)).toEqual({ kind: 'missing' });
  });

  it('css 导入返回 css 哨兵类别', () => {
    expect(resolveImportSpecifier('./styles.css', '/src/main.jsx', known)).toEqual({ kind: 'css' });
    expect(resolveImportSpecifier('./styles.css?inline', '/src/main.jsx', known)).toEqual({ kind: 'css' });
  });

  it('shim 表内 bare 说明符返回 shim', () => {
    expect(resolveImportSpecifier('react', '/src/main.jsx', known)).toEqual({ kind: 'shim', specifier: 'react' });
    expect(resolveImportSpecifier('react-dom/client', '/src/main.jsx', known)).toEqual({ kind: 'shim', specifier: 'react-dom/client' });
    expect(resolveImportSpecifier('chart.js', '/src/main.jsx', known)).toEqual({ kind: 'shim', specifier: 'chart.js' });
    expect(resolveImportSpecifier('echarts', '/src/main.jsx', known)).toEqual({ kind: 'shim', specifier: 'echarts' });
  });

  it('shim 表外 bare 说明符返回 unknown-bare', () => {
    expect(resolveImportSpecifier('lodash', '/src/main.jsx', known)).toEqual({ kind: 'unknown-bare' });
    expect(resolveImportSpecifier('dayjs', '/src/main.jsx', known)).toEqual({ kind: 'unknown-bare' });
  });

  it('CSS 哨兵常量值为固定字符串', () => {
    expect(CSS_MODULE_SENTINEL).toBe('__css_module__');
  });
});
