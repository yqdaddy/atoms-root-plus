import { describe, it, expect } from 'vitest';
import { BARE_IMPORT_SHIMS, BARE_IMPORT_SPECIFIERS, getBareShimBody, generateBareShimLoader } from './bareImportShims';
import vm from 'node:vm';

/** 在受控沙箱上下文中执行 bare shim 加载器，返回加载函数 */
function createLoader(globals: Record<string, unknown>): (spec: string) => unknown {
  const context = vm.createContext({ window: globals, console });
  const source = `${generateBareShimLoader()}
  __loadBareModule;`;
  return vm.runInContext(source, context) as (spec: string) => unknown;
}

describe('bareImportShims - 表定义', () => {
  it('覆盖任务要求的全部 bare 说明符', () => {
    for (const spec of ['react', 'react-dom', 'react-dom/client', 'chart.js', 'echarts']) {
      expect(BARE_IMPORT_SPECIFIERS).toContain(spec);
      expect(getBareShimBody(spec)).not.toBeNull();
    }
  });

  it('表外说明符查询返回 null', () => {
    expect(getBareShimBody('lodash')).toBeNull();
    expect(getBareShimBody('react/unknown-subpath')).toBeNull();
  });

  it('shim 工厂体都含 __esModule 互操作标记', () => {
    for (const spec of BARE_IMPORT_SPECIFIERS) {
      expect(BARE_IMPORT_SHIMS[spec]).toContain('__esModule');
    }
  });
});

describe('bareImportShims - react shim 行为', () => {
  it('require("react") 返回 default + 全部具名导出的互操作对象', () => {
    const fakeReact = { createElement: () => 'element', useState: () => 'state', Fragment: Symbol.for('frag'), version: '18.3.1' };
    const load = createLoader({ React: fakeReact });
    const mod = load('react') as Record<string, unknown>;
    expect(mod.__esModule).toBe(true);
    expect(mod.default).toBe(fakeReact);
    expect(mod.createElement).toBe(fakeReact.createElement);
    expect(mod.useState).toBe(fakeReact.useState);
    expect(mod.version).toBe('18.3.1');
  });

  it('同一加载器内 shim 结果缓存（多次 require 同一对象）', () => {
    const load = createLoader({ React: { version: '18' } });
    expect(load('react')).toBe(load('react'));
  });
});

describe('bareImportShims - react-dom/client shim 行为', () => {
  it('createRoot 调用转发到 window.ReactDOM 且 this 绑定正确', () => {
    let createRootThis: unknown = null;
    let createRootArg: unknown = null;
    const fakeReactDOM = {
      createRoot: function (this: unknown, container: unknown) {
        createRootThis = this;
        createRootArg = container;
        return { render: () => 'rendered' };
      },
    };
    const load = createLoader({ ReactDOM: fakeReactDOM });
    const client = load('react-dom/client') as Record<string, unknown>;
    const root = (client.createRoot as (c: unknown) => unknown)('#root');
    expect(createRootThis).toBe(fakeReactDOM);
    expect(createRootArg).toBe('#root');
    expect((root as { render: () => string }).render()).toBe('rendered');
    expect(client.default).toBe(client);
    expect(client.__esModule).toBe(true);
  });

  it('window.ReactDOM 缺失时抛含说明符的明确错误', () => {
    const load = createLoader({});
    expect(() => load('react-dom/client')).toThrowError(/react-dom\/client/);
    expect(() => load('react')).toThrowError(/window\.React/);
    expect(() => load('chart.js')).toThrowError(/window\.Chart/);
    expect(() => load('echarts')).toThrowError(/window\.echarts/);
  });
});

describe('bareImportShims - 表外说明符错误文案', () => {
  it('抛出的错误列出全部可用依赖（可喂给 AI 修复循环）', () => {
    const load = createLoader({ React: {} });
    try {
      load('lodash');
      throw new Error('should not reach');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('lodash');
      expect(message).toContain('react');
      expect(message).toContain('chart.js');
      expect(message).toContain('echarts');
    }
  });
});
