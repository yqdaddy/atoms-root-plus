/**
 * jsxCompiler 单元测试（FINAL-3 同步回退链噪音报错）。
 *
 * 覆盖：
 * 1. containsModuleSyntax：顶层 import/export 语句判定（让位判据）
 * 2. generateSucraseRuntime：运行时脚本内嵌同一让位守卫（回归防护）
 * 3. 行为级验证：__compileAndRun 对含 import 的文件跳过编译并降级为
 *    console.warn，不再经 setTimeout 重抛用户可见错误；纯 JSX 项目
 *    首帧同步编译契约不受影响
 */

import { describe, it, expect, vi } from 'vitest';
import {
  containsModuleSyntax,
  generateSucraseRuntime,
  MODULE_SYNTAX_PATTERN,
} from './jsxCompiler';

/** 提取 generateSucraseRuntime 产物中的运行时 IIFE 脚本体（含 __compileAndRun 的 script 块） */
function extractRuntimeBody(): string {
  const html = generateSucraseRuntime();
  const blocks = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)).map((m) => m[1]);
  const body = blocks.find((b) => b.includes('__compileAndRun'));
  if (!body) {
    throw new Error('generateSucraseRuntime 产物中未找到运行时脚本体');
  }
  return body;
}

/** 运行时沙箱求值结果 */
interface RuntimeSandbox {
  windowMock: {
    __compileAndRun: (code: string, fileName?: string) => void;
    __jsxQueue: unknown[];
    Sucrase: { transform: ReturnType<typeof vi.fn> };
    [key: string]: unknown;
  };
  /** reportAndRethrow 经 setTimeout 延迟重抛的载荷（非空即产生用户可见错误） */
  deferredThrows: unknown[];
  warnTexts: string[];
}

/** 在受控沙箱中执行运行时脚本体，返回可操作的 window 模拟对象 */
function evalRuntimeBody(body: string): RuntimeSandbox {
  const deferredThrows: unknown[] = [];
  const warnTexts: string[] = [];
  const sucraseTransform = vi.fn((code: string, options: { transforms: string[] }) => {
    // 模拟 Sucrase 真实行为：['jsx'] 链对含 import/export 的源码抛 SyntaxError
    if (!options.transforms.includes('imports') && containsModuleSyntax(code)) {
      throw new SyntaxError('Cannot use import statement outside a module');
    }
    // 产物须为合法可执行 JS（模拟编译成功，执行为 no-op）
    return { code: `/* compiled:${code.length} */` };
  });
  const windowMock: RuntimeSandbox['windowMock'] = {
    __jsxQueue: [],
    Sucrase: { transform: sucraseTransform },
    __compileAndRun: undefined as unknown as RuntimeSandbox['windowMock']['__compileAndRun'],
  };
  const fakeConsole = {
    warn: (...args: unknown[]) => {
      warnTexts.push(args.map(String).join(' '));
    },
    log: () => {},
    info: () => {},
    error: () => {},
  };
  // reportAndRethrow 的 setTimeout 重抛路径：捕获而非真正抛出，便于断言"无用户可见错误"
  const fakeSetTimeout = (fn: () => void) => {
    deferredThrows.push(fn);
  };

  // 运行时脚本的自由标识符：window / console / setTimeout 由沙箱提供；
  // React/ReactDOM 由 vendor 脚本在真实浏览器中挂载，此处以最小 mock 传入
  const reactMock = { createElement: () => null };
  const fn = new Function('window', 'console', 'setTimeout', 'React', 'ReactDOM', body);
  fn(windowMock, fakeConsole, fakeSetTimeout, reactMock, { createRoot: () => ({ render: () => {} }) });

  return { windowMock, deferredThrows, warnTexts };
}

describe('containsModuleSyntax - 顶层 import/export 判定（FINAL-3）', () => {
  it('应识别常见 import 形态', () => {
    expect(containsModuleSyntax("import React from 'react';")).toBe(true);
    expect(containsModuleSyntax("import { createRoot } from 'react-dom/client';")).toBe(true);
    expect(containsModuleSyntax("import * as Utils from './utils';")).toBe(true);
    expect(containsModuleSyntax("import './styles.css';")).toBe(true);
    expect(containsModuleSyntax("\n  import App from './App.jsx';\n")).toBe(true);
  });

  it('应识别常见 export 形态', () => {
    expect(containsModuleSyntax('export default function App() {}')).toBe(true);
    expect(containsModuleSyntax('export const marker = 1;')).toBe(true);
    expect(containsModuleSyntax("export { a, b } from './m';")).toBe(true);
    expect(containsModuleSyntax("export * from './m';")).toBe(true);
    expect(containsModuleSyntax('export function greet() {}')).toBe(true);
  });

  it('不应误判纯 JSX 项目（首帧同步渲染契约）', () => {
    expect(containsModuleSyntax('function App() { return <div>Hi</div>; }')).toBe(false);
    expect(containsModuleSyntax('const [n, setN] = React.useState(0);')).toBe(false);
    expect(containsModuleSyntax("ReactDOM.createRoot(document.getElementById('root')).render(<App />);")).toBe(false);
  });

  it('不应误判动态 import()（new Function 内合法）', () => {
    expect(containsModuleSyntax("const mod = import('./lazy.js');")).toBe(false);
  });

  it('不应误判行首注释里的 import 字样', () => {
    expect(containsModuleSyntax("// import React from 'react';\nfunction App() { return <div />; }")).toBe(false);
  });

  it('pattern 源与运行时注入使用同一事实源', () => {
    const body = extractRuntimeBody();
    expect(body).toContain(`new RegExp(${JSON.stringify(MODULE_SYNTAX_PATTERN.source)})`);
  });
});

describe('generateSucraseRuntime - __compileAndRun 让位守卫（FINAL-3）', () => {
  it('含 import 的文件：跳过编译并降级为 console.warn，不重抛用户可见错误', () => {
    const { windowMock, deferredThrows, warnTexts } = evalRuntimeBody(extractRuntimeBody());

    windowMock.__compileAndRun(
      "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);",
      '/src/main.jsx'
    );

    // 同步链（['jsx']）未尝试编译（预期让位给打包链路）
    expect(windowMock.Sucrase.transform).not.toHaveBeenCalled();
    // 无重抛（不产生 pageerror / 用户可见错误 toast）
    expect(deferredThrows).toHaveLength(0);
    // 降级为 warn 日志（走 console 桥接，仅进控制台视图）
    expect(warnTexts).toHaveLength(1);
    expect(warnTexts[0]).toContain('/src/main.jsx');
    expect(warnTexts[0]).toContain('import/export');
  });

  it('无 import 的纯 JSX 文件：照常编译执行（首帧同步渲染契约不破坏）', () => {
    const { windowMock, deferredThrows, warnTexts } = evalRuntimeBody(extractRuntimeBody());

    windowMock.__compileAndRun(
      "function App() {\n  return <div>Hi</div>;\n}\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
      '/src/App.jsx'
    );

    expect(windowMock.Sucrase.transform).toHaveBeenCalledTimes(1);
    expect(deferredThrows).toHaveLength(0);
    expect(warnTexts).toHaveLength(0);
  });

  it('Sucrase 未就绪时含 import 文件仅进编译队列，不产生错误与告警', () => {
    const { windowMock, deferredThrows, warnTexts } = evalRuntimeBody(extractRuntimeBody());
    // 构造未就绪状态：__compileAndRun 走队列分支
    windowMock.__sucraseReady = false;

    windowMock.__compileAndRun("import x from 'x';", '/src/main.jsx');

    expect(windowMock.Sucrase.transform).not.toHaveBeenCalled();
    expect(windowMock.__jsxQueue).toHaveLength(1);
    expect(deferredThrows).toHaveLength(0);
    expect(warnTexts).toHaveLength(0);
  });

  it('真实语法错误（非 import 让位场景）仍走用户可见错误通道', () => {
    const { windowMock, deferredThrows, warnTexts } = evalRuntimeBody(extractRuntimeBody());

    // 非 import 的编译失败不应被守卫吞掉（守卫只针对 import/export 让位场景）
    windowMock.Sucrase.transform.mockImplementationOnce(() => {
      throw new SyntaxError('Unexpected token');
    });

    windowMock.__compileAndRun('function broken( {', '/src/broken.jsx');

    expect(windowMock.Sucrase.transform).toHaveBeenCalledTimes(1);
    expect(deferredThrows).toHaveLength(1);
    expect(warnTexts).toHaveLength(0);
  });
});
