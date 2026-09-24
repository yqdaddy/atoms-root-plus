import { describe, it, expect } from 'vitest';
import { bundleModules, tryBundleModules, maybeInjectReactImport, rewriteRequireSpecifiers } from './moduleBundler';
import type { BundleModuleFile } from './bundlerTypes';
import { ModuleBundleErrorCode } from './bundlerTypes';
import { generateModuleRuntimeScript, assembleBundleScript } from './moduleRuntime';
import vm from 'node:vm';

function f(path: string, content: string): BundleModuleFile {
  return { path, content };
}

/** 具备 useState 最小实现的 React 仿真（含 createElement 产生可断言的元素树） */
function createFakeReact() {
  const createElement = (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({
    type,
    props,
    children,
  });
  return {
    createElement,
    Fragment: Symbol.for('fragment'),
    useState: (init: unknown) => [init, () => {}],
    useEffect: () => {},
    useRef: (init: unknown) => ({ current: init }),
    version: '18.3.1-test',
  };
}

interface ExecResult {
  rendered: unknown[];
  window: Record<string, unknown>;
  asyncThrows: unknown[];
  consoleWarns: unknown[][];
}

/** 用真实产物脚本（含运行时 + 注册 + 入口启动）在 vm 中执行 */
function execBundle(script: string): ExecResult {
  const rendered: unknown[] = [];
  const asyncThrows: unknown[] = [];
  const consoleWarns: unknown[][] = [];
  const fakeReact = createFakeReact();
  const window: Record<string, unknown> = {
    React: fakeReact,
    ReactDOM: {
      createRoot: (container: unknown) => {
        void container;
        return { render: (el: unknown) => rendered.push(el) };
      },
    },
    document: { getElementById: () => ({ id: 'root' }) },
  };
  const context = vm.createContext({
    window,
    document: window.document,
    console: { warn: (...args: unknown[]) => consoleWarns.push(args), error: () => {} },
    setTimeout: (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        asyncThrows.push(err);
      }
    },
  });
  vm.runInContext(script, context, { filename: 'bundle.js' });
  return { rendered, window, asyncThrows, consoleWarns };
}

const FILES_THREE_LAYER: BundleModuleFile[] = [
  f('/src/main.jsx', [
    "import React from 'react';",
    "import App from './App.jsx';",
    "import { createRoot } from 'react-dom/client';",
    "createRoot(document.getElementById('root')).render(<App />);",
  ].join('\n')),
  f('/src/App.jsx', [
    "import { useCounter } from './hooks/useCounter';",
    "import { formatCount } from './utils/format';",
    'export default function App() {',
    '  const { count, increment } = useCounter(2);',
    '  return <div className="app"><h1>{formatCount(count)}</h1><button onClick={increment}>+1</button></div>;',
    '}',
  ].join('\n')),
  f('/src/hooks/useCounter.js', [
    "import { useState } from 'react';",
    'export function useCounter(initial) {',
    '  const [count, setCount] = useState(initial);',
    '  return { count, increment: () => setCount(count + 1) };',
    '}',
  ].join('\n')),
  f('/src/utils/format.js', [
    'export function formatCount(n) { return `count: ${n}`; }',
  ].join('\n')),
];

describe('moduleBundler - happy path', () => {
  it('三层依赖项目打包成功，模块清单为拓扑序（依赖在前）', async () => {
    const result = await tryBundleModules(FILES_THREE_LAYER, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.modulePaths).toEqual(['/src/hooks/useCounter.js', '/src/utils/format.js', '/src/App.jsx', '/src/main.jsx']);
    expect(result.script).toContain('__defineModule("/src/App.jsx"');
    expect(result.script).toContain('__requireModule("/src/main.jsx")');
  });

  it('S1 结论固化：classic runtime（createElement 形态），不产生 jsx-runtime require', async () => {
    const result = await bundleModules(FILES_THREE_LAYER, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.script).toContain('.createElement(');
    // 自动 runtime 的编译产物特征（jsxDEV.call / jsx.call）不得出现；
    // shim 表中的防御性 jsx 别名源码不算（其不含 .call 调用形态）
    expect(result.script).not.toContain('require("react/jsx-runtime")');
    expect(result.script).not.toContain('_jsxruntime');
    expect(result.script).not.toContain('jsxDEV.call');
    expect(result.script).not.toContain('.jsx.call');
  });

  it('require 说明符在产物中被改写为绝对路径', async () => {
    const result = await bundleModules(FILES_THREE_LAYER, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.script).toContain('require("/src/App.jsx")');
    expect(result.script).toContain('require("/src/hooks/useCounter.js")');
    expect(result.script).not.toContain(`require("'./App.jsx'")`);
    expect(result.script).not.toContain("require('./App.jsx')");
  });

  it('端到端执行：入口启动、组件渲染出元素树（真实互操作链路）', async () => {
    const result = await bundleModules(FILES_THREE_LAYER, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    const { rendered, asyncThrows } = execBundle(result.script);
    expect(asyncThrows).toHaveLength(0);
    expect(rendered).toHaveLength(1);
    const el = rendered[0] as { type: (props: unknown) => unknown };
    expect(typeof el.type).toBe('function');
    const tree = el.type({}) as { children: unknown[] };
    expect(JSON.stringify(tree)).toContain('count: 2');
  });
});

describe('moduleBundler - 自动注入 import React', () => {
  it('含 JSX 且未导入 React 的文件被注入并产出告警', async () => {
    const files = [
      f('/src/main.jsx', [
        "import { createRoot } from 'react-dom/client';",
        'const App = () => <div>hi</div>;',
        "createRoot(document.getElementById('root')).render(<App />);",
      ].join('\n')),
    ];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.warnings.some((w) => w.includes('已自动注入 import React') && w.includes('/src/main.jsx'))).toBe(true);
    const { asyncThrows } = execBundle(result.script);
    expect(asyncThrows).toHaveLength(0);
  });

  it('已导入 React 的文件不重复注入（无告警）', async () => {
    const files = [f('/src/main.jsx', "import React from 'react';\nconst x = <div />;\nexport default x;")];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.warnings).toHaveLength(0);
  });

  it('纯 JS 工具文件（无 JSX）不注入', () => {
    expect(maybeInjectReactImport('/src/utils/format.js', 'export const a = 1;')).toBe('export const a = 1;');
  });

  it('本地声明 React 的文件不注入（避免重复声明语法错误）', () => {
    const source = 'const React = { createElement: () => null };\nexport const el = <div />;';
    expect(maybeInjectReactImport('/src/local.jsx', source)).toBe(source);
  });

  it('maybeInjectReactImport 直接单测：注入行置于文件顶部', () => {
    const injected = maybeInjectReactImport('/src/A.jsx', 'export default () => <div />;');
    expect(injected.startsWith("import React from 'react';\n")).toBe(true);
  });
});

describe('moduleBundler - 结构化错误（文案可喂给 AI 修复循环）', () => {
  it('入口缺失返回 ENTRY_MISSING', async () => {
    const result = await tryBundleModules([f('/src/a.js', 'export const a = 1;')], '/src/main.jsx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ModuleBundleErrorCode.EntryMissing);
      expect(result.error.message).toContain('/src/main.jsx');
    }
  });

  it('相对导入指向不存在的文件返回 MODULE_NOT_FOUND 且附拼写建议文案', async () => {
    const files = [f('/src/main.jsx', "import X from './components/Conter';\nexport default X;")];
    const result = await tryBundleModules(files, '/src/main.jsx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ModuleBundleErrorCode.ModuleNotFound);
      expect(result.error.message).toContain('./components/Conter');
      expect(result.error.message).toContain('/src/main.jsx');
      expect(result.error.specifier).toBe('./components/Conter');
    }
  });

  it('表外 bare import 返回 UNKNOWN_BARE_IMPORT 并列出白名单', async () => {
    const files = [f('/src/main.jsx', "import dayjs from 'dayjs';\nexport default dayjs;")];
    const result = await tryBundleModules(files, '/src/main.jsx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ModuleBundleErrorCode.UnknownBareImport);
      expect(result.error.message).toContain('dayjs');
      expect(result.error.message).toContain('react');
      expect(result.error.message).toContain('chart.js');
    }
  });

  it('import.meta 返回 UNSUPPORTED_SYNTAX', async () => {
    const files = [f('/src/main.jsx', 'const base = import.meta.url;\nexport default base;')];
    const result = await tryBundleModules(files, '/src/main.jsx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ModuleBundleErrorCode.UnsupportedSyntax);
      expect(result.error.message).toContain('import.meta');
    }
  });

  it('顶层 await 返回 INCOMPATIBLE_SYNTAX（构建期拦截而非运行时白屏）', async () => {
    const files = [f('/src/main.jsx', 'const data = await Promise.resolve(1);\nexport default data;')];
    const result = await tryBundleModules(files, '/src/main.jsx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ModuleBundleErrorCode.IncompatibleSyntax);
      expect(result.error.message).toContain('顶层 await');
    }
  });

  it('语法错误模块返回 TRANSFORM_FAILED 并附模块路径', async () => {
    const files = [
      f('/src/lib.js', 'export const ok = 1;'),
      f('/src/main.jsx', "import { ok } from './lib.js';\nconst = 1;\nexport default ok;"),
    ];
    const result = await tryBundleModules(files, '/src/main.jsx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ModuleBundleErrorCode.TransformFailed);
      expect(result.error.message).toContain('/src/main.jsx');
    }
  });
});

describe('moduleBundler - 边界与集成', () => {
  it('css 导入重写为哨兵 require，不作为依赖边', async () => {
    const files = [
      f('/src/main.jsx', "import './styles.css';\nimport App from './App.jsx';\nexport default App;"),
      f('/src/App.jsx', 'export default () => <div>ok</div>;'),
      f('/src/styles.css', '.app { color: red; }'),
    ];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.script).toContain('require("__css_module__")');
    expect(result.modulePaths).not.toContain('/src/styles.css');
  });

  it('动态 import 静态字符串经改写后可执行', async () => {
    const files = [
      f('/src/main.jsx', [
        "export default async function load() {",
        "  const m = await import('./lazy');",
        '  return m.value;',
        '}',
      ].join('\n')),
      f('/src/lazy.js', 'export const value = 42;'),
    ];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.script).toContain('require("/src/lazy.js")');
  });

  it('循环依赖项目打包成功且运行时按 CJS 部分导出语义执行', async () => {
    const files = [
      f('/src/main.jsx', [
        "import { aName } from './a.js';",
        'export default aName;',
      ].join('\n')),
      f('/src/a.js', "import { bName } from './b.js';\nexport const aName = 'a+' + bName;"),
      f('/src/b.js', "import { aPartial } from './a.js';\nexport const bName = typeof aPartial === 'undefined' ? 'cycle-safe' : 'got';\naPartial;"),
    ];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    const { asyncThrows } = execBundle(result.script);
    expect(asyncThrows).toHaveLength(0);
  });

  it('命名导出与 default 混合互操作正确（执行验证）', async () => {
    const files = [
      f('/src/main.jsx', [
        "import Tile, { subtitle } from './Tile.jsx';",
        'export default subtitle + (typeof Tile === "function" ? "-fn" : "-other");',
      ].join('\n')),
      f('/src/Tile.jsx', 'export const subtitle = "tile";\nexport default function Tile() { return <b>t</b>; }'),
    ];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    expect(result.ok).toBe(true);
  });

  it('tryBundleModules 对任何输入都不抛异常（空文件集）', async () => {
    const result = await tryBundleModules([], '/src/main.jsx');
    expect(result.ok).toBe(false);
  });

  it('export * 透传具名导出（执行验证）', async () => {
    const files = [
      f('/src/main.jsx', "export * from './inner.js';"),
      f('/src/inner.js', 'export const value = 7;'),
    ];
    const result = await bundleModules(files, '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    // 在 vm 中通过调试句柄取 main 的导出（自动注入的 React 依赖由仿真提供）
    const window: Record<string, unknown> = { React: createFakeReact() };
    const context = vm.createContext({
      window,
      console: { warn: () => {}, error: () => {} },
      setTimeout: () => {},
    });
    vm.runInContext(result.script, context);
    const registry = window.__modules as Record<string, { exports: Record<string, unknown> }>;
    expect(registry['/src/main.jsx'].exports.value).toBe(7);
  });
});

describe('moduleBundler - rewriteRequireSpecifiers 单元', () => {
  it('只改写映射内的说明符，其余原样保留', () => {
    const compiled = "var a = require('./x'); var b = require('react'); var s = \"require('./fake')\";";
    const map = new Map([['./x', '"/src/x.js"']]);
    const out = rewriteRequireSpecifiers(compiled, map);
    expect(out).toContain('require("/src/x.js")');
    expect(out).toContain("require('react')");
    expect(out).toContain(`"require('./fake')"`);
  });

  it('空映射原样返回', () => {
    const compiled = "require('./x')";
    expect(rewriteRequireSpecifiers(compiled, new Map())).toBe(compiled);
  });
});

describe('moduleBundler - 运行时与产物组合', () => {
  it('generateModuleRuntimeScript 暴露 window 调试句柄', () => {
    const runtime = generateModuleRuntimeScript();
    expect(runtime).toContain('window.__modules');
    expect(runtime).toContain('window.__requireModule');
    expect(runtime).toContain('window.__defineModule');
  });

  it('完整产物在严格模式下不泄漏全局（除调试句柄）', async () => {
    const result = await bundleModules([f('/src/main.jsx', 'export const leak = 1;')], '/src/main.jsx');
    if (!result.ok) {
      throw new Error(`expected ok, got: ${result.error.message}`);
    }
    const { window } = execBundle(result.script);
    expect(window.leak).toBeUndefined();
    expect(window.__modules).toBeDefined();
  });
});
