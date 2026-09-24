/**
 * ZIP 导出服务单元测试（工程化生成计划决议 5，方案 B）
 *
 * 覆盖：
 * 1. 文件集完整性：全部源码按原路径写入 + README，内容逐字一致
 * 2. dist 存在性：html 与 react-cdn 两种框架的产物均含 dist/index.html
 * 3. 回退路径：react-cdn 打包失败项目，dist 仍存在且为同步链路产物
 * 4. 空项目拒绝：不产出 Blob，不触发下载
 * 5. 缺少入口拒绝、文件名转义与日期后缀
 *
 * 说明：file-saver 打桩（浏览器下载 API 在 Node 环境不存在），
 * 通过 buildProjectZipBlob + JSZip 回读断言 ZIP 内容。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

import { saveAs } from 'file-saver';
import { buildProjectZipBlob, exportProjectAsZip, buildZipFileName, buildReadme } from './zipExporter';
import { ENTRY_FILE_PATH } from '../../types/project';
import type { Project, FileNode } from '../../types/project';

function file(path: string, content: string): FileNode {
  return { path, content, language: 'text', updatedAt: '2026-09-24T00:00:00.000Z' };
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: '计数器',
    description: '测试项目',
    status: 'ready',
    framework: 'html',
    files: {},
    chat: [],
    preview: {
      extraSandboxFlags: [],
      sizeMode: 'autoHeight',
    },
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

/** html 多文件项目：入口 + 样式 + 脚本 */
function htmlFiles(): Record<string, FileNode> {
  return {
    '/index.html': file(
      '/index.html',
      `<!DOCTYPE html><html><head><link rel="stylesheet" href="./styles/main.css"></head>
<body><script src="./src/main.js"></script></body></html>`
    ),
    '/styles/main.css': file('/styles/main.css', 'body { margin: 0; }'),
    '/src/main.js': file('/src/main.js', 'console.log("ZIP_HTML_MARKER");'),
  };
}

/** react-cdn 无 import 项目（P0 组件注册约定，打包链路直接走现状产物） */
function reactFiles(): Record<string, FileNode> {
  return {
    '/index.html': file(
      '/index.html',
      '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>'
    ),
    '/src/main.jsx': file('/src/main.jsx', 'console.log("ZIP_REACT_MARKER");'),
  };
}

/** react-cdn 打包必败项目：import 指向不存在的模块 */
function brokenImportFiles(): Record<string, FileNode> {
  return {
    '/index.html': file(
      '/index.html',
      '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>'
    ),
    '/src/main.jsx': file('/src/main.jsx', "import missing from './missing.js';\nconsole.log(missing);"),
  };
}

async function readZip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

beforeEach(() => {
  vi.mocked(saveAs).mockClear();
});

describe('buildProjectZipBlob', () => {
  it('文件集完整性：全部源码按原路径写入且内容逐字一致', async () => {
    const project = buildProject({ files: htmlFiles() });
    const zip = await readZip(await buildProjectZipBlob(project));

    const entry = zip.file('index.html');
    expect(entry).not.toBeNull();
    expect(await entry!.async('string')).toBe(htmlFiles()['/index.html'].content);
    expect(await zip.file('styles/main.css')!.async('string')).toBe('body { margin: 0; }');
    expect(await zip.file('src/main.js')!.async('string')).toBe('console.log("ZIP_HTML_MARKER");');

    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain('README.md');
    // 3 个源码 + dist 产物 + README
    expect(names.length).toBe(3 + 1 + 1);
  });

  it('html 框架：dist/index.html 存在且为内联后的自包含产物', async () => {
    const project = buildProject({ files: htmlFiles() });
    const zip = await readZip(await buildProjectZipBlob(project));

    const dist = zip.file('dist/index.html');
    expect(dist).not.toBeNull();
    const distHtml = await dist!.async('string');
    expect(distHtml).toContain('ZIP_HTML_MARKER');
    expect(distHtml).toContain('body { margin: 0; }');
    // 本地引用已内联，不再有相对路径引用
    expect(distHtml).not.toContain('src="./src/main.js"');
  });

  it('react-cdn 框架：dist/index.html 存在且注入 React 运行时', async () => {
    const project = buildProject({ framework: 'react-cdn', files: reactFiles() });
    const zip = await readZip(await buildProjectZipBlob(project));

    const dist = zip.file('dist/index.html');
    expect(dist).not.toBeNull();
    const distHtml = await dist!.async('string');
    expect(distHtml).toContain('ZIP_REACT_MARKER');
    expect(distHtml).toContain('react@18/umd/react.production.min.js');
  });

  it('回退路径：react-cdn 打包失败项目，dist 仍存在且为同步链路产物', async () => {
    const project = buildProject({ framework: 'react-cdn', files: brokenImportFiles() });
    const zip = await readZip(await buildProjectZipBlob(project));

    const dist = zip.file('dist/index.html');
    expect(dist).not.toBeNull();
    const distHtml = await dist!.async('string');
    // 同步链路：JSX 文件被包装为浏览器内编译执行块
    expect(distHtml).toContain('__compileAndRun');
    expect(distHtml).toContain('react@18/umd/react.production.min.js');
  });

  it('空项目拒绝：不产出 Blob', async () => {
    const project = buildProject({ files: {} });
    await expect(buildProjectZipBlob(project)).rejects.toThrow('项目暂无可导出的文件');
  });

  it('缺少入口文件拒绝', async () => {
    const project = buildProject({
      files: { '/src/main.js': file('/src/main.js', 'console.log(1);') },
    });
    await expect(buildProjectZipBlob(project)).rejects.toThrow(`缺少入口文件 ${ENTRY_FILE_PATH}`);
  });

  it('README 指引 dist/index.html 双击运行', async () => {
    const readme = buildReadme(buildProject({ files: htmlFiles() }));
    expect(readme).toContain('dist/index.html');
    expect(readme).toContain('dist/index.html'); // 目录结构与技术说明均有提及
    expect(readme).toContain('作为工程起点使用');
  });
});

describe('exportProjectAsZip', () => {
  it('成功：触发一次下载，文件名为项目名加日期后缀', async () => {
    const project = buildProject({ files: htmlFiles(), name: '我的 计数器' });
    await exportProjectAsZip(project);

    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(saveAs).mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toMatch(/^我的 计数器-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it('空项目拒绝：不触发下载', async () => {
    const project = buildProject({ files: {} });
    await expect(exportProjectAsZip(project)).rejects.toThrow('项目暂无可导出的文件');
    expect(saveAs).not.toHaveBeenCalled();
  });
});

describe('buildZipFileName', () => {
  it('文件名特殊字符转义为连字符', () => {
    const name = buildZipFileName('a/b:c*d', new Date(2026, 0, 2, 12, 0));
    expect(name).toBe('a-b-c-d-2026-01-02.zip');
  });

  it('空白压缩与空名兜底', () => {
    expect(buildZipFileName('  多  空格  ', new Date(2026, 11, 31))).toBe('多 空格-2026-12-31.zip');
    expect(buildZipFileName('///', new Date(2026, 11, 31))).toBe('未命名项目-2026-12-31.zip');
  });

  it('日期补零（本地时区取值）', () => {
    expect(buildZipFileName('x', new Date(2026, 2, 5, 9, 30))).toBe('x-2026-03-05.zip');
  });
});
