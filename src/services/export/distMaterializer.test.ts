/**
 * dist 物化器单元测试（工程化生成计划决议 5，方案 B）
 *
 * 覆盖：
 * 1. html 框架：同步链路物化，本地 css/js 内联进产物
 * 2. vue-cdn 框架：同步链路物化，注入 Vue CDN 运行时
 * 3. react-cdn 框架：走异步打包入口（assembleProjectFiles），
 *    根绝对 /vendor 引用改写为相对路径并收集运行时清单
 * 4. react-cdn 打包链路抛出：回退同步链路，产物仍可用（同样改写）
 * 5. 两级都失败（入口缺失）：拒绝物化，向上抛错（宁可不给，不给坏的）
 * 6. html / vue-cdn 产物无 vendor 引用，清单为空（路径行为不变）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sandbox/assembler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sandbox/assembler')>();
  return {
    ...actual,
    assembleProjectFiles: vi.fn(actual.assembleProjectFiles),
  };
});

const assemblerActual = await vi.importActual<typeof import('../sandbox/assembler')>(
  '../sandbox/assembler'
);

import { assembleFiles, assembleProjectFiles } from '../sandbox/assembler';
import { materializeDistIndex, rewriteVendorRefsToRelative } from './distMaterializer';
import type { FileNode } from '../../types/project';

/** 构造 FileNode（language 与 updatedAt 与物化无关，固定占位） */
function file(path: string, content: string): FileNode {
  return { path, content, language: 'text', updatedAt: '2026-09-24T00:00:00.000Z' };
}

/** 单入口 html 项目 */
function htmlProject(): Record<string, FileNode> {
  return {
    '/index.html': file(
      '/index.html',
      `<!DOCTYPE html><html><head><link rel="stylesheet" href="./styles/main.css"></head>
<body><div id="app"></div><script src="./src/main.js"></script></body></html>`
    ),
    '/styles/main.css': file('/styles/main.css', 'body { margin: 0; }'),
    '/src/main.js': file('/src/main.js', 'console.log("HTML_SYNC_MARKER");'),
  };
}

describe('materializeDistIndex', () => {
  beforeEach(() => {
    vi.mocked(assembleProjectFiles).mockImplementation((files, entryPath, framework) =>
      assemblerActual.assembleProjectFiles(files, entryPath, framework)
    );
  });

  it('html 框架：同步链路物化，本地引用全部内联', async () => {
    const result = await materializeDistIndex(htmlProject(), 'html');

    expect(result.strategy).toBe('sync');
    expect(result.html).toContain('HTML_SYNC_MARKER');
    expect(result.html).toContain('body { margin: 0; }');
    // 本地引用应被内联替换，不再有相对路径引用
    expect(result.html).not.toContain('src="./src/main.js"');
    expect(result.html).not.toContain('href="./styles/main.css"');
  });

  it('vue-cdn 框架：同步链路物化，注入 Vue CDN 运行时', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': file('/index.html', '<!DOCTYPE html><html><body><div id="app"></div></body></html>'),
    };
    const result = await materializeDistIndex(files, 'vue-cdn');

    expect(result.strategy).toBe('sync');
    expect(result.html).toContain('vue.global.prod.js');
  });

  it('react-cdn 框架：走异步打包入口，注入 React 运行时（相对 vendor 引用）', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': file('/index.html', '<!DOCTYPE html><html><body><div id="root"></div></body></html>'),
    };
    const result = await materializeDistIndex(files, 'react-cdn');

    // 无模块文件时异步入口内部走同步产物，但物化器层面走的是 async 入口
    expect(vi.mocked(assembleProjectFiles)).toHaveBeenCalledWith(files, '/index.html', 'react-cdn');
    expect(result.strategy).toBe('async');
    expect(result.html).toContain('src="./vendor/react.vendor.js"');
    expect(result.vendorFiles).toContain('react.vendor.js');
  });

  it('react-cdn 打包链路抛出：回退同步链路，产物仍完整（相对 vendor 引用）', async () => {
    vi.mocked(assembleProjectFiles).mockRejectedValueOnce(new Error('Sucrase 加载失败'));
    const files: Record<string, FileNode> = {
      '/index.html': file('/index.html', '<!DOCTYPE html><html><body><div id="root"></div></body></html>'),
    };
    const result = await materializeDistIndex(files, 'react-cdn');

    expect(result.strategy).toBe('sync');
    expect(result.html).toContain('src="./vendor/react.vendor.js"');
    expect(result.vendorFiles).toContain('react.vendor.js');
  });

  it('react-cdn 产物：根绝对 /vendor 引用全部改写为相对路径并收集清单', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': file('/index.html', '<!DOCTYPE html><html><body><div id="root"></div></body></html>'),
    };
    const result = await materializeDistIndex(files, 'react-cdn');

    // 不再存在属性形态的根绝对 /vendor/ 引用（file:// 下无法解析）
    expect(result.html).not.toMatch(/(src|href)=["']\/vendor\//);
    // 平台运行时实际引用：React 运行时 + Sucrase 编译器（实测产物两者都有）
    expect(result.vendorFiles).toEqual(['react.vendor.js', 'sucrase.vendor.js']);
    // 改写后的相对引用与清单一一对应
    expect(result.html).toContain('src="./vendor/react.vendor.js"');
    expect(result.html).toContain('src="./vendor/sucrase.vendor.js"');
  });

  it('html / vue-cdn 产物：无 vendor 引用，清单为空，行为不变', async () => {
    const htmlResult = await materializeDistIndex(htmlProject(), 'html');
    expect(htmlResult.vendorFiles).toEqual([]);
    expect(htmlResult.html).not.toContain('/vendor/');

    const vueFiles: Record<string, FileNode> = {
      '/index.html': file('/index.html', '<!DOCTYPE html><html><body><div id="app"></div></body></html>'),
    };
    const vueResult = await materializeDistIndex(vueFiles, 'vue-cdn');
    expect(vueResult.vendorFiles).toEqual([]);
    expect(vueResult.html).not.toContain('/vendor/');
  });

  it('两级都失败（入口缺失）：拒绝物化并抛错', async () => {
    await expect(materializeDistIndex({}, 'react-cdn')).rejects.toThrow('入口文件不存在');
    await expect(materializeDistIndex({}, 'html')).rejects.toThrow('入口文件不存在');
  });

  it('assembleFiles 与物化产物一致（html 框架产物即同步组装产物）', async () => {
    const files = htmlProject();
    const result = await materializeDistIndex(files, 'html');
    const direct = assembleFiles(files, '/index.html', 'html');

    expect(result.html).toBe(direct.html);
  });
});

describe('rewriteVendorRefsToRelative', () => {
  it('双引号与单引号属性均改写，按出现顺序去重收集', () => {
    const html = '<script src="/vendor/react.vendor.js"></script><a href=\'/vendor/react.vendor.js\'>x</a><script src="/vendor/sucrase.vendor.js"></script>';
    const result = rewriteVendorRefsToRelative(html);

    expect(result.html).toContain('src="./vendor/react.vendor.js"');
    expect(result.html).toContain("href='./vendor/react.vendor.js'");
    expect(result.html).toContain('src="./vendor/sucrase.vendor.js"');
    expect(result.vendorFiles).toEqual(['react.vendor.js', 'sucrase.vendor.js']);
  });

  it('脚本正文与普通文本中的 /vendor 不改写（仅属性上下文生效）', () => {
    const html = `<p>路径 /vendor/react.vendor.js</p><script>throw new Error('加载失败（/vendor/react.vendor.js）');</script>`;
    const result = rewriteVendorRefsToRelative(html);

    expect(result.html).toBe(html);
    expect(result.vendorFiles).toEqual([]);
  });

  it('无 vendor 引用时原样返回', () => {
    const html = '<html><body><script src="./main.js"></script></body></html>';
    const result = rewriteVendorRefsToRelative(html);

    expect(result.html).toBe(html);
    expect(result.vendorFiles).toEqual([]);
  });

  it('非法文件名（含路径段）不改写不收集（防御分支）', () => {
    const html = '<script src="/vendor/../secret.js"></script><script src="/vendor/a/b.js"></script>';
    const result = rewriteVendorRefsToRelative(html);

    expect(result.html).toBe(html);
    expect(result.vendorFiles).toEqual([]);
  });
});
