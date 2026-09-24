/**
 * SandboxFrame 打包链路激活（P1 批次 2）单元测试
 * @vitest-environment jsdom
 *
 * 覆盖：
 * 1. react-cdn 真实 import 项目：首帧同步产物，防抖后升级为 mini-bundler 打包产物
 * 2. 无 import 存量项目：升级结果与首帧同步产物逐字节一致（激活零行为变化）
 * 3. 竞态防护：挂起请求的迟到结果与已显示旧产物在输入切换后都不得出现（只采纳最后一次请求）
 * 4. 组装失败：回退现状链路产物，不白屏
 * 5. html 框架：不触发异步打包请求
 *
 * 说明：使用真实定时器 + waitFor 轮询断言。fake timer 与 act 的微任务冲刷
 * 存在时序竞争（实测偶发组件状态未上屏），waitFor 消除该不确定性。
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import SandboxFrame from './SandboxFrame';
import { assembleProjectFiles } from '../services/sandbox/assembler';
import type { FileNode } from '../types/project';

vi.mock('../services/sandbox/assembler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/sandbox/assembler')>();
  return {
    ...actual,
    assembleProjectFiles: vi.fn(actual.assembleProjectFiles),
  };
});

const assemblerActual = await vi.importActual<typeof import('../services/sandbox/assembler')>(
  '../services/sandbox/assembler'
);

// jsdom 无 matchMedia，settingsStore 模块初始化（主题应用）需要；
// vi.hoisted 保证在 SandboxFrame（间接引用 settingsStore）import 前就位
vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
      }),
    });
  }
});

/** 项目 A：真实 import 项目（可打包），A_PROJECT_MARKER 只存在于 A 的源码 */
function buildProjectA(): Record<string, FileNode> {
  return {
    '/index.html': {
      content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>',
    },
    '/src/main.jsx': {
      content: `import { createRoot } from 'react-dom/client';
import App from './App.jsx';
createRoot(document.getElementById('root')).render(<App />);`,
    },
    '/src/App.jsx': {
      content: `export const marker = 'A_PROJECT_MARKER';
export default function App() {
  return <div>{marker}</div>;
}`,
    },
  };
}

/** 项目 B：P0 注册约定项目（无 import），B_COUNTER_MARKER 只存在于 B 的源码 */
function buildProjectB(): Record<string, FileNode> {
  return {
    '/index.html': {
      content: `<!DOCTYPE html><html><body><div id="root"></div>
<script src="/src/components/Counter.jsx"></script>
<script src="/src/main.jsx"></script>
</body></html>`,
    },
    '/src/main.jsx': {
      content: `const App = window.__components.Counter;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
    },
    '/src/components/Counter.jsx': {
      content: `function Counter() {
  const [n, setN] = React.useState(0);
  return <button onClick={() => setN(n + 1)}>B_COUNTER_MARKER {n}</button>;
}
window.__components = window.__components || {};
window.__components.Counter = Counter;`,
    },
  };
}

function getSrcdoc(): string {
  const iframe = screen.getByTitle('预览');
  return iframe.getAttribute('srcdoc') ?? '';
}

describe('SandboxFrame - 打包链路激活（P1 批次 2）', () => {
  // 预热 Sucrase（真实动态加载一次并缓存于 moduleBundler），
  // 避免首个用例的动态加载耗时挤占 waitFor 窗口
  beforeAll(async () => {
    await assemblerActual.assembleProjectFiles(
      {
        '/src/main.jsx': { path: '/src/main.jsx', content: "import x from './x.js';\nconsole.log(x);" },
        '/src/x.js': { path: '/src/x.js', content: 'export default 1;' },
      },
      '/src/main.jsx'
    );
  });

  beforeEach(() => {
    vi.mocked(assembleProjectFiles).mockImplementation((files, entryPath, framework) =>
      assemblerActual.assembleProjectFiles(files, entryPath, framework)
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('真实 import 项目：首帧为同步逐文件产物，防抖后升级为单一打包产物', async () => {
    render(<SandboxFrame files={buildProjectA()} entryFile="/index.html" framework="react-cdn" />);

    // 首帧：现状链路逐文件 __compileAndRun 包装（与激活前行为一致，不白屏）
    const firstHtml = getSrcdoc();
    expect(firstHtml).toContain('__compileAndRun("');
    expect(firstHtml).not.toContain('__defineModule(');

    // 防抖窗口过后：升级为打包产物
    await waitFor(
      () => {
        expect(getSrcdoc()).toContain('__defineModule("/src/main.jsx"');
      },
      { timeout: 5000 }
    );

    const upgradedHtml = getSrcdoc();
    expect(upgradedHtml).toContain('require("/src/App.jsx")');
    expect(upgradedHtml).toContain('A_PROJECT_MARKER');
    expect(upgradedHtml).not.toContain('__compileAndRun("');
  });

  it('无 import 存量项目：升级产物与首帧同步产物逐字节一致（零行为变化）', async () => {
    render(<SandboxFrame files={buildProjectB()} entryFile="/index.html" framework="react-cdn" />);

    const firstHtml = getSrcdoc();
    expect(firstHtml).toContain('__compileAndRun("');
    expect(firstHtml).toContain('B_COUNTER_MARKER');

    // 等到打包请求发生（资格门控后走现状链路）
    await waitFor(() => expect(assembleProjectFiles).toHaveBeenCalledTimes(1), { timeout: 5000 });
    // 再让出一拍，确保若产物有差异早已上屏
    await waitFor(() => expect(getSrcdoc()).toContain('B_COUNTER_MARKER'), { timeout: 5000 });

    // 资格门控：无 import 项目走现状链路，产物逐字节一致，srcdoc 不变
    expect(getSrcdoc()).toBe(firstHtml);
  });

  it('竞态防护：挂起中的旧项目请求在切换后被丢弃，只显示新项目产物', async () => {
    // 项目 A 的打包请求挂起不返回，模拟慢速打包
    vi.mocked(assembleProjectFiles)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation((files, entryPath, framework) =>
        assemblerActual.assembleProjectFiles(files, entryPath, framework)
      );

    const { rerender } = render(
      <SandboxFrame files={buildProjectA()} entryFile="/index.html" framework="react-cdn" />
    );
    // A 的请求已发出且挂起
    await waitFor(() => expect(assembleProjectFiles).toHaveBeenCalledTimes(1), { timeout: 5000 });

    // 切换到项目 B（无 import），等待 B 的产物上屏
    rerender(<SandboxFrame files={buildProjectB()} entryFile="/index.html" framework="react-cdn" />);
    await waitFor(() => expect(getSrcdoc()).toContain('B_COUNTER_MARKER'), { timeout: 5000 });

    const html = getSrcdoc();
    expect(html).not.toContain('A_PROJECT_MARKER');
    expect(html).not.toContain('__defineModule(');
  });

  it('竞态防护：已显示的旧项目打包产物在切换后的首帧立即被替换', async () => {
    const { rerender } = render(
      <SandboxFrame files={buildProjectA()} entryFile="/index.html" framework="react-cdn" />
    );
    // A 的打包产物已显示
    await waitFor(() => expect(getSrcdoc()).toContain('A_PROJECT_MARKER'), { timeout: 5000 });

    // 切换到项目 B：切换后的第一帧就不得包含 A 的产物（渲染期状态重置）
    rerender(<SandboxFrame files={buildProjectB()} entryFile="/index.html" framework="react-cdn" />);

    const html = getSrcdoc();
    expect(html).not.toContain('A_PROJECT_MARKER');
    expect(html).toContain('B_COUNTER_MARKER');
    expect(html).toContain('__compileAndRun("');

    // B 的打包请求随后发生，产物仍不含 A 特征
    await waitFor(() => expect(assembleProjectFiles).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(getSrcdoc()).not.toContain('A_PROJECT_MARKER');
  });

  it('组装失败：回退现状链路产物，不白屏不崩溃', async () => {
    vi.mocked(assembleProjectFiles).mockRejectedValueOnce(new Error('打包器内部错误'));

    render(<SandboxFrame files={buildProjectA()} entryFile="/index.html" framework="react-cdn" />);

    const firstHtml = getSrcdoc();
    expect(firstHtml).toContain('__compileAndRun("');

    // 打包请求发生并失败
    await waitFor(() => expect(assembleProjectFiles).toHaveBeenCalledTimes(1), { timeout: 5000 });

    // 打包请求失败后落到现状链路产物，界面保持可用。
    // 注意现状链路只内联 HTML 引用的 main.jsx（App.jsx 未被引用不出现），
    // 这正是回退保持现状语义的体现
    await waitFor(() => expect(getSrcdoc()).toContain('"/src/main.jsx"'), { timeout: 5000 });
    const html = getSrcdoc();
    expect(html).toContain('__compileAndRun("');
    expect(html).not.toContain('__defineModule(');
  });

  it('html 框架多文件项目：不触发异步打包请求', async () => {
    render(
      <SandboxFrame
        files={{
          '/index.html': { content: '<!DOCTYPE html><html><body><script src="/src/main.js"></script></body></html>' },
          '/src/main.js': { content: "document.title = 'html-project';" },
        }}
        entryFile="/index.html"
        framework="html"
      />
    );

    // 给足防抖窗口 + 轮询余量，确认从未发起打包请求
    await waitFor(() => expect(getSrcdoc()).toContain("document.title = 'html-project';"), { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(assembleProjectFiles).not.toHaveBeenCalled();
    expect(getSrcdoc()).toContain("document.title = 'html-project';");
  });
});
