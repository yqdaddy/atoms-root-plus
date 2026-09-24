import { describe, it, expect, vi } from 'vitest';
import { generateModuleRuntimeScript, assembleBundleScript } from './moduleRuntime';
import vm from 'node:vm';

type DefineFn = (path: string, factory: (m: { exports: unknown }, e: unknown, r: (p: string) => unknown) => void) => void;
type RequireFn = (path: string) => unknown;

interface RuntimeHarness {
  define: DefineFn;
  require: RequireFn;
  registry: Record<string, { exports: unknown; state: string }>;
}

/**
 * 在 node:vm 沙箱中装配并执行 bundle（真实产物形态：IIFE），返回运行时句柄。
 * setTimeout 以"记录但不执行"的方式注入，模拟浏览器中异步重抛语义。
 */
function runBundle(moduleEntries: { path: string; body: string }[], entryPath: string, extraGlobals: Record<string, unknown> = {}): { harness: RuntimeHarness; window: Record<string, unknown>; consoleWarn: ReturnType<typeof vi.fn>; asyncThrows: unknown[] } {
  const consoleWarn = vi.fn();
  const asyncThrows: unknown[] = [];
  const window: Record<string, unknown> = { ...extraGlobals };
  const context = vm.createContext({
    window,
    console: { warn: consoleWarn, error: () => {} },
    setTimeout: (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        asyncThrows.push(err);
      }
    },
  });
  const script = assembleBundleScript(generateModuleRuntimeScript(), moduleEntries, entryPath);
  vm.runInContext(script, context, { filename: 'bundle.js' });
  return {
    harness: {
      define: window.__defineModule as DefineFn,
      require: window.__requireModule as RequireFn,
      registry: window.__modules as RuntimeHarness['registry'],
    },
    window,
    consoleWarn,
    asyncThrows,
  };
}

describe('moduleRuntime - CJS 语义', () => {
  it('惰性执行 + 缓存：模块工厂只执行一次，二次 require 命中缓存', () => {
    const { harness, window } = runBundle(
      [
        { path: '/src/counted.js', body: 'window.__count = (window.__count || 0) + 1; module.exports = { value: window.__count };' },
        { path: '/src/consumer.js', body: 'var a = require("/src/counted.js"); var b = require("/src/counted.js"); module.exports = { same: a === b, value: a.value };' },
      ],
      '/src/never-booted.js'
    );
    const result = harness.require('/src/consumer.js') as { same: boolean; value: number };
    expect(window.__count).toBe(1);
    expect(result.same).toBe(true);
    expect(result.value).toBe(1);
  });

  it('执行时机惰性：注册不执行，require 才执行', () => {
    const { harness, window } = runBundle(
      [{ path: '/src/lazy.js', body: 'window.__lazyRan = true;' }],
      '/src/never-booted.js'
    );
    expect((harness.registry['/src/lazy.js'] as { state: string }).state).toBe('pending');
    expect(window.__lazyRan).toBeUndefined();
    harness.require('/src/lazy.js');
    expect(window.__lazyRan).toBe(true);
  });

  it('module.exports 整体重替换后 require 返回新对象', () => {
    const { harness } = runBundle(
      [{ path: '/src/replacer.js', body: 'module.exports = { replaced: true };' }],
      '/src/never-booted.js'
    );
    expect(harness.require('/src/replacer.js')).toEqual({ replaced: true });
  });

  it('循环依赖：被循环方返回部分导出并 console.warn', () => {
    const { harness, consoleWarn } = runBundle(
      [
        { path: '/src/a.js', body: 'exports.name = "a-partial"; var b = require("/src/b.js"); module.exports = { name: "a-final", fromB: b.got };' },
        { path: '/src/b.js', body: 'var a = require("/src/a.js"); module.exports = { got: a.name || "empty" };' },
      ],
      '/src/never-booted.js'
    );
    const a = harness.require('/src/a.js') as { fromB: string };
    expect(a.fromB).toBe('a-partial');
    expect(consoleWarn).toHaveBeenCalled();
    expect(String(consoleWarn.mock.calls[0][0])).toContain('循环依赖');
  });

  it('模块执行错误重抛并附模块路径前缀', () => {
    const { harness } = runBundle(
      [{ path: '/src/boom.js', body: 'throw new Error("炸了");' }],
      '/src/never-booted.js'
    );
    try {
      harness.require('/src/boom.js');
      throw new Error('should not reach');
    } catch (err) {
      // vm 跨 realm 的 Error 不满足宿主 instanceof，直接读 message 属性
      const message = (err as Error).message as string;
      expect(message).toBe('[模块] /src/boom.js: 炸了');
    }
  });

  it('非 Error 抛出值（字符串）也被包装并附路径前缀', () => {
    const { harness } = runBundle(
      [{ path: '/src/string-throw.js', body: 'throw "字符串异常";' }],
      '/src/never-booted.js'
    );
    expect(() => harness.require('/src/string-throw.js')).toThrowError(/\[模块\] \/src\/string-throw\.js: 字符串异常/);
  });

  it('注册表中不存在的绝对路径抛"模块不存在"错误', () => {
    const { harness } = runBundle([], '/src/never-booted.js');
    expect(() => harness.require('/src/missing.js')).toThrowError(/模块不存在: \/src\/missing\.js/);
  });

  it('CSS 哨兵返回空对象（css import no-op）', () => {
    const { harness } = runBundle([], '/src/never-booted.js');
    expect(harness.require('__css_module__')).toEqual({});
  });
});

describe('moduleRuntime - bare shim 集成', () => {
  it('require("react") 经 shim 表返回 window.React 互操作对象', () => {
    const fakeReact = { createElement: () => 'e', useState: () => 's' };
    const { harness } = runBundle([], '/src/never-booted.js', { React: fakeReact });
    const mod = harness.require('react') as Record<string, unknown>;
    expect(mod.default).toBe(fakeReact);
    expect(mod.createElement).toBe(fakeReact.createElement);
  });
});

describe('moduleRuntime - assembleBundleScript 产物形态', () => {
  it('入口 require 置于注册之后，整体包进单一 IIFE', () => {
    const script = assembleBundleScript(generateModuleRuntimeScript(), [
      { path: '/src/a.js', body: 'module.exports = 1;' },
      { path: '/src/main.jsx', body: 'const a = require("/src/a.js");' },
    ], '/src/main.jsx');
    const entryIdx = script.indexOf('__requireModule("/src/main.jsx")');
    const regIdx = script.indexOf('__defineModule("/src/a.js"');
    expect(entryIdx).toBeGreaterThan(regIdx);
    expect(script.startsWith('(function () {')).toBe(true);
    expect(script.endsWith('})();')).toBe(true);
  });

  it('入口启动错误经 setTimeout 异步重抛，同步阶段不抛出', () => {
    const { asyncThrows } = runBundle([], '/src/gone.jsx');
    expect(asyncThrows).toHaveLength(1);
    const err = asyncThrows[0] as Error;
    expect(err.message).toContain('[入口] /src/gone.jsx');
    expect(err.message).toContain('模块不存在');
  });
});
