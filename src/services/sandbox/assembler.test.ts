import { describe, it, expect } from 'vitest';
import { assembleFiles, assembleProjectFiles, Assembler } from './assembler';
import type { FileNode } from '../../types/project';

describe('Assembler', () => {
  describe('processInlineJsxScripts - 嵌套包装防护', () => {
    it('应跳过已包装的 JSX 代码，避免嵌套包装', () => {
      // 模拟已由 inlineJsScripts 包装的 JSX 代码
      const alreadyWrappedJsx = `<!DOCTYPE html><html><body><script>__compileAndRun("function Counter() { return <div>Count: {count}</div>; }", "./src/Counter.jsx");</script></body></html>`;

      const files: Record<string, FileNode> = {
        '/index.html': { content: alreadyWrappedJsx },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 验证没有产生嵌套包装（这是核心修复目标）
      expect(result.html).not.toContain('__compileAndRun("\\n__compileAndRun');
      expect(result.html).not.toContain('__compileAndRun(\\"\\n__compileAndRun');
      expect(result.html).not.toContain('__compileAndRun("\n__compileAndRun');

      // 验证原始包装调用仍然存在（文件名标记为 ./src/Counter.jsx）
      expect(result.html).toContain('"./src/Counter.jsx"');
    });

    it('应正常包装未包装的内联 JSX 代码', () => {
      const inlineJsx = `<!DOCTYPE html><html><body><script>
function App() {
  const [count, setCount] = React.useState(0);
  return <div>Count: {count}</div>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script></body></html>`;

      const files: Record<string, FileNode> = {
        '/index.html': { content: inlineJsx },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 验证 JSX 被正确包装（文件名标记为 inline-jsx）
      expect(result.html).toContain('"inline-jsx"');

      // 验证没有嵌套包装
      expect(result.html).not.toContain('__compileAndRun("\\n__compileAndRun');
    });

    it('应正确处理混合场景：部分已包装、部分未包装', () => {
      const mixedHtml = `<!DOCTYPE html><html><body>
<script>__compileAndRun("function Counter() { return <div>Counter</div>; }", "./src/Counter.jsx");</script>
<script>
function App() {
  return <div><Counter /></div>;
}
</script>
</body></html>`;

      const files: Record<string, FileNode> = {
        '/index.html': { content: mixedHtml },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 验证第一个 script 未被二次包装
      expect(result.html).not.toContain('__compileAndRun("\\n__compileAndRun');

      // 验证两个包装调用都存在（通过文件名区分）
      expect(result.html).toContain('"./src/Counter.jsx"'); // 第一个已存在
      expect(result.html).toContain('"inline-jsx"'); // 第二个新包装
    });

    it('应正确处理不包含 JSX 的普通 JavaScript（仅注入运行时，不包装）', () => {
      const plainJs = `<!DOCTYPE html><html><body><script>
console.log('Hello World');
const x = 1 + 2;
</script></body></html>`;

      const files: Record<string, FileNode> = {
        '/index.html': { content: plainJs },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 普通 JS 代码内容应保持原样
      expect(result.html).toContain("console.log('Hello World');");

      // 不应有内联 JSX 包装（无 "inline-jsx" 标记）
      expect(result.html).not.toContain('"inline-jsx"');
    });
  });

  describe('inlineJsScripts - React CDN 模式', () => {
    it('应将外部 JSX 文件包装为编译执行脚本块', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="./src/Counter.jsx"></script></body></html>',
        },
        '/src/Counter.jsx': {
          content: `function Counter() {
  const [count, setCount] = React.useState(0);
  return <div>Count: {count}</div>;
}`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 验证 JSX 文件被内联并包装（通过文件名标记）
      expect(result.html).toContain('"./src/Counter.jsx"');

      // 验证没有嵌套包装
      expect(result.html).not.toContain('__compileAndRun("\\n__compileAndRun');
    });

    it('应正确处理 React CDN 模式的完整项目', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Test App</title>
  <link rel="stylesheet" href="./styles/main.css">
</head>
<body>
  <div id="root"></div>
  <script src="./src/App.jsx"></script>
</body>
</html>`,
        },
        '/styles/main.css': {
          content: '.app { padding: 20px; }',
        },
        '/src/App.jsx': {
          content: `function App() {
  return <h1>Hello World</h1>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 验证 CSS 被内联
      expect(result.html).toContain('<style>');
      expect(result.html).toContain('.app { padding: 20px; }');

      // 验证 React 运行时被注入（同源 vendor：React 运行时 + Sucrase 编译器）
      expect(result.html).toContain('<script src="/vendor/react.vendor.js"></script>');
      expect(result.html).toContain('<script src="/vendor/sucrase.vendor.js"></script>');

      // 验证 JSX 文件被正确包装（通过文件名标记）
      expect(result.html).toContain('"./src/App.jsx"');

      // 验证没有嵌套包装
      expect(result.html).not.toContain('__compileAndRun("\\n__compileAndRun');

      // 验证统计
      expect(result.stats.inlinedCss).toBe(1);
      expect(result.stats.inlinedJs).toBe(1);
    });
  });

  describe('inlineJsScripts - 根相对路径支持（D-10）', () => {
    it('应内联根相对路径 /src/xxx.jsx 的 JSX 文件（react-cdn 模式）', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/Counter.jsx"></script></body></html>',
        },
        '/src/Counter.jsx': {
          content: `function Counter() {
  const [count, setCount] = React.useState(0);
  return <div>Count: {count}</div>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<Counter />);`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 根相对路径文件被内联并包装（路径标记为 /src/Counter.jsx）
      expect(result.html).toContain('"/src/Counter.jsx"');
      expect(result.html).not.toContain('<script src="/src/Counter.jsx">');
      expect(result.stats.inlinedJs).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('应内联根相对路径 /src/xxx.js 的普通 JS 文件（html 框架）', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="/src/main.js"></script></body></html>',
        },
        '/src/main.js': {
          content: "document.getElementById('app').textContent = 'ok';",
        },
      };

      const result = assembleFiles(files, '/index.html', 'html');

      expect(result.html).toContain("document.getElementById('app').textContent = 'ok';");
      expect(result.html).not.toContain('<script src="/src/main.js">');
      expect(result.stats.inlinedJs).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('应继续支持 ./src/xxx.jsx 相对路径（回归防护）', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><div id="root"></div><script src="./src/App.jsx"></script></body></html>',
        },
        '/src/App.jsx': {
          content: `function App() {
  return <h1>Hello</h1>;
}`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      expect(result.html).toContain('"./src/App.jsx"');
      expect(result.stats.inlinedJs).toBe(1);
    });

    it('应跳过入口文件自身引用 /index.html，不产生自嵌套', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="/index.html"></script></body></html>',
        },
      };

      const result = assembleFiles(files, '/index.html', 'html');

      // 入口自身引用原样保留，未内联为自嵌套脚本
      expect(result.html).toContain('<script src="/index.html"></script>');
      expect(result.stats.inlinedJs).toBe(0);
      expect(result.warnings.some((w) => w.includes('入口文件自身引用'))).toBe(true);
    });

    it('不应内联外部 https URL 的 script', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="https://cdn.example.com/lib.min.js"></script></body></html>',
        },
      };

      const result = assembleFiles(files, '/index.html', 'html');

      expect(result.html).toContain('<script src="https://cdn.example.com/lib.min.js"></script>');
      expect(result.stats.inlinedJs).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('不应内联协议相对 // 开头的 URL', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="//cdn.example.com/lib.min.js"></script></body></html>',
        },
      };

      const result = assembleFiles(files, '/index.html', 'html');

      expect(result.html).toContain('<script src="//cdn.example.com/lib.min.js"></script>');
      expect(result.stats.inlinedJs).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('应内联根相对路径的 CSS link（D-10 对称修复）', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="/styles/main.css"></head><body></body></html>',
        },
        '/styles/main.css': {
          content: 'body { margin: 0; }',
        },
      };

      const result = assembleFiles(files, '/index.html', 'html');

      expect(result.html).toContain('<style>');
      expect(result.html).toContain('body { margin: 0; }');
      expect(result.html).not.toContain('href="/styles/main.css"');
      expect(result.stats.inlinedCss).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('根相对路径文件缺失时应替换为缺失注释并告警', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="/src/missing.js"></script></body></html>',
        },
      };

      const result = assembleFiles(files, '/index.html', 'html');

      expect(result.html).toContain('<!-- 缺失: /src/missing.js -->');
      expect(result.stats.inlinedJs).toBe(0);
      expect(result.warnings.some((w) => w.includes('JS 文件不存在: /src/missing.js'))).toBe(true);
    });
    it('项目自带 React CDN 引用时平台运行时仍注入并与用户引用并存', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" src="/src/main.jsx"></script>
</body>
</html>`,
        },
        '/styles/main.css': { content: 'body { margin: 0; }' },
        '/src/main.jsx': {
          content: `const App = () => <div>Hello</div>;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 根相对脚本与样式均已内联，无外置根相对引用残留
      expect(result.html).not.toContain('src="/src/main.jsx"');
      expect(result.html).not.toContain('href="/styles/main.css"');

      // JSX 被包装为 __compileAndRun 调用，且编译执行器（Sucrase 运行时）已注入
      expect(result.html).toContain('__compileAndRun(');
      expect(result.html).toContain('__sucraseReady');

      // 平台运行时（同源 vendor，零外网依赖）已注入，保证 React 在 CSP 下可用
      expect(result.html).toContain('<script src="/vendor/react.vendor.js"></script>');
      expect(result.html).toContain('<script src="/vendor/sucrase.vendor.js"></script>');

      // 用户自带引用保留原样（白名单外由 CSP 拦截，白名单内后加载覆盖）
      expect(result.html).toContain('https://unpkg.com/react@18/umd/react.production.min.js');

      // 告警说明与平台运行时并存
      expect(result.warnings.some((w) => w.includes('与平台运行时并存'))).toBe(true);
    });

    it('项目自带 Vue CDN 引用时平台运行时仍注入并与用户引用并存', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
</head>
<body>
  <div id="app"></div>
  <script src="/src/main.js"></script>
</body>
</html>`,
        },
        '/src/main.js': {
          content: `const { createApp } = Vue;
createApp({ template: '<div>ok</div>' }).mount('#app');`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'vue-cdn');

      // 根相对脚本已内联
      expect(result.html).not.toContain('src="/src/main.js"');
      expect(result.html).toContain('createApp({ template: ');

      // 平台运行时（白名单内 jsdelivr）已注入
      expect(result.html).toContain('https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js');
      expect(result.html).toContain('window.Vue = window.Vue || Vue');

      // 用户自带引用保留原样
      expect(result.html).toContain('https://unpkg.com/vue@3/dist/vue.global.prod.js');
      expect(result.warnings.some((w) => w.includes('与平台运行时并存'))).toBe(true);
    });

    it('react-cdn 模式下未引用的 /src 源码文件应产生告警', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>',
        },
        '/src/main.jsx': {
          content: "const App = window.__components.App;\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
        },
        '/src/components/TodoItem.jsx': {
          content: 'function TodoItem() { return <div>item</div>; }\nwindow.__components = window.__components || {};\nwindow.__components.TodoItem = TodoItem;',
        },
        '/src/hooks/useTodos.js': {
          content: 'function useTodos() { return []; }\nwindow.__hooks = window.__hooks || {};\nwindow.__hooks.useTodos = useTodos;',
        },
        '/README.md': { content: 'readme' },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      expect(
        result.warnings.some((w) => w.includes('未被入口 HTML 引用') && w.includes('/src/components/TodoItem.jsx') && w.includes('/src/hooks/useTodos.js'))
      ).toBe(true);
    });

    it('react-cdn 模式下源码文件全部被引用时不应告警', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/components/TodoItem.jsx"></script><script src="/src/main.jsx"></script></body></html>',
        },
        '/src/main.jsx': {
          content: "const App = window.__components.App;\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
        },
        '/src/components/TodoItem.jsx': {
          content: 'function TodoItem() { return <div>item</div>; }\nwindow.__components = window.__components || {};\nwindow.__components.TodoItem = TodoItem;',
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      expect(result.warnings.some((w) => w.includes('未被入口 HTML 引用'))).toBe(false);
    });

    it('return ( 换行 JSX 形态应被识别并包装（react-cdn 组件白屏第四层）', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/components/TodoInput.jsx"></script></body></html>',
        },
        '/src/components/TodoInput.jsx': {
          content: `function TodoInput() {
  const [text, setText] = React.useState('');
  return (
    <div className="p-4">
      <input value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  );
}
window.__components = window.__components || {};
window.__components.TodoInput = TodoInput;`,
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      // 组件被包装为编译执行块，而非裸留在普通 script 里
      expect(result.html).toContain('"/src/components/TodoInput.jsx"');
      expect(result.html).not.toContain('<script>\nfunction TodoInput()');
      expect(result.stats.inlinedJs).toBe(1);
    });

    it('.jsx 扩展名兜底：启发式漏判时仍按 JSX 包装（react-cdn）', () => {
      // JSX 挂在赋值括号形态里：无大写标签、无箭头标签、return 后无标签，确保启发式判定为 false
      const trickyJsx = `function Item({ label }) {
  const node = (
    <em>
      {label}
    </em>
  );
  return node;
}
window.__components = window.__components || {};
window.__components.Item = Item;`;

      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/components/Item.jsx"></script></body></html>',
        },
        '/src/components/Item.jsx': { content: trickyJsx },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      expect(result.html).toContain('"/src/components/Item.jsx"');
      expect(result.stats.inlinedJs).toBe(1);
    });

    it('react-cdn 模式下 .js 文件不含 JSX 时仍按普通脚本内联', () => {
      const files: Record<string, FileNode> = {
        '/index.html': {
          content: '<!DOCTYPE html><html><body><script src="/src/utils/storage.js"></script></body></html>',
        },
        '/src/utils/storage.js': {
          content: 'function saveData(key, value) {\n  localStorage.setItem(key, JSON.stringify(value));\n}',
        },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');

      expect(result.html).toContain('function saveData(key, value)');
      expect(result.html).not.toContain('"/src/utils/storage.js"');
      expect(result.stats.inlinedJs).toBe(1);
    });

  });

  describe('containsJsx 检测', () => {
    it('应正确检测大写组件标签', () => {
      const codeWithComponent = `<!DOCTYPE html><html><body><script>function App() { return <Counter />; }</script></body></html>`;
      const files: Record<string, FileNode> = {
        '/index.html': { content: codeWithComponent },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');
      expect(result.html).toContain('"inline-jsx"');
    });

    it('应正确检测箭头函数返回 JSX', () => {
      const codeWithArrow = `<!DOCTYPE html><html><body><script>const App = () => <div>Hello</div>;</script></body></html>`;
      const files: Record<string, FileNode> = {
        '/index.html': { content: codeWithArrow },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');
      expect(result.html).toContain('"inline-jsx"');
    });

    it('应正确检测 return 语句后的 JSX', () => {
      const codeWithReturn = `<!DOCTYPE html><html><body><script>
function App() {
  return <div>Hello</div>;
}
</script></body></html>`;
      const files: Record<string, FileNode> = {
        '/index.html': { content: codeWithReturn },
      };

      const result = assembleFiles(files, '/index.html', 'react-cdn');
      expect(result.html).toContain('"inline-jsx"');
    });
  });
});

describe('assembleProjectFiles - mini-bundler 集成（P1 批次 2）', () => {
  /** 真实 import 多文件项目的标准文件集 */
  function buildRealImportProject() {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Bundled App</title>
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <div id="root"></div>
  <script src="/src/App.jsx"></script>
  <script src="/src/main.jsx"></script>
</body>
</html>`,
      },
      '/styles/main.css': { content: '.app { color: red; }' },
      '/styles/theme.css': { content: '.theme { margin: 0; }' },
      '/src/main.jsx': {
        content: `import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/theme.css';
createRoot(document.getElementById('root')).render(<App />);`,
      },
      '/src/App.jsx': {
        content: `import { greet } from './utils/greet';
export default function App() {
  return <div className="app">{greet('litpp')}</div>;
}`,
      },
      '/src/utils/greet.js': {
        content: `export function greet(name) {
  return 'hello ' + name;
}`,
      },
    };
    return files;
  }

  it('真实 import 项目：打包为单一脚本注入，不再逐文件 __compileAndRun 包装', async () => {
    const files = buildRealImportProject();
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    // 单一打包脚本：模块注册与入口启动均在产物中
    expect(result.html).toContain('__defineModule("/src/utils/greet.js"');
    expect(result.html).toContain('__defineModule("/src/App.jsx"');
    expect(result.html).toContain('__defineModule("/src/main.jsx"');
    expect(result.html).toContain('__requireModule("/src/main.jsx")');

    // 模块注册为拓扑序（依赖在前）
    const greetIdx = result.html.indexOf('__defineModule("/src/utils/greet.js"');
    const appIdx = result.html.indexOf('__defineModule("/src/App.jsx"');
    const mainIdx = result.html.indexOf('__defineModule("/src/main.jsx"');
    expect(greetIdx).toBeLessThan(appIdx);
    expect(appIdx).toBeLessThan(mainIdx);

    // 不再逐文件包装（运行时定义 window.__compileAndRun = function 除外）
    expect(result.html).not.toContain('__compileAndRun("');
    expect(result.html).not.toContain('"inline-jsx"');

    // 源码 ESM 语句不再出现，require 已改写为绝对路径（证明走了编译打包）
    expect(result.html).not.toContain("import App from './App.jsx'");
    expect(result.html).toContain('require("/src/App.jsx")');

    // 打包脚本占用首个引用槽位，后续槽位替换为并入注释
    expect(result.html).toContain('已并入模块打包脚本');

    // CSS link 内联不受影响；JS 里的 css import 不破坏打包
    expect(result.html).toContain('<style>');
    expect(result.html).toContain('.app { color: red; }');

    // 统计：两个 script 槽位都被处理（首个注入 bundle，后续并入注释）
    expect(result.stats.inlinedCss).toBe(1);
    expect(result.stats.inlinedJs).toBe(2);

    // 平台 React 运行时注入保持不变（同源 vendor），且先于打包脚本执行（文档序：
    // vendor 为经典 script 在 head 同步执行，bundle 内联脚本在其后）
    expect(result.html).toContain('<script src="/vendor/react.vendor.js"></script>');
    expect(result.html.indexOf('/vendor/react.vendor.js')).toBeLessThan(
      result.html.indexOf('__defineModule(')
    );

    // 无回退告警；依赖图可达但未被 HTML 直接引用的文件不产生未引用告警
    expect(result.warnings.some((w) => w.includes('模块打包失败'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('已回退'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('未被入口 HTML 引用'))).toBe(false);

    // bundler 自身警告经既有 warning 通道透出（App.jsx 缺 React import 被自动注入）
    expect(result.warnings.some((w) => w.includes('已自动注入 import React: /src/App.jsx'))).toBe(true);
  });

  it('入口 HTML 无打包模块 script 槽位时，bundle 追加到 body 末尾', async () => {
    const files = buildRealImportProject();
    // 去掉两个 script 标签，模拟 import 驱动、HTML 无脚本引用的项目
    files['/index.html'] = {
      content: `<!DOCTYPE html>
<html lang="zh-CN">
<head><title>No Script Refs</title></head>
<body><div id="root"></div></body>
</html>`,
    };

    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toContain('__defineModule("/src/main.jsx"');
    const bundleIdx = result.html.indexOf('__defineModule(');
    const bodyEndIdx = result.html.indexOf('</body>');
    expect(bundleIdx).toBeGreaterThan(-1);
    expect(bundleIdx).toBeLessThan(bodyEndIdx);
    expect(result.stats.inlinedJs).toBe(1);
    expect(result.warnings.some((w) => w.includes('模块打包失败'))).toBe(false);
  });

  it('bundler 失败（MODULE_NOT_FOUND）：回退产物与现状逐字节一致，附打包失败警告', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>',
      },
      '/src/main.jsx': {
        content: `import { helper } from './lib/missing.js';
console.log(helper);`,
      },
    };

    const legacy = assembleFiles(files, '/index.html', 'react-cdn');
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings.length).toBe(legacy.warnings.length + 1);
    expect(result.warnings[0]).toContain('模块打包失败');
    expect(result.warnings[0]).toContain('MODULE_NOT_FOUND');
    expect(result.warnings[0]).toContain("./lib/missing.js");
    expect(result.warnings[0]).toContain('从 /src/main.jsx 解析');
    // 回退产物保留逐文件包装特征
    expect(result.html).toContain('__compileAndRun("');
  });

  it('bundler 失败（UNKNOWN_BARE_IMPORT）：白名单外依赖回退逐文件内联', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>',
      },
      '/src/main.jsx': {
        content: `import dayjs from 'dayjs';
console.log(dayjs);`,
      },
    };

    const legacy = assembleFiles(files, '/index.html', 'react-cdn');
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings[0]).toContain('模块打包失败');
    expect(result.warnings[0]).toContain('UNKNOWN_BARE_IMPORT');
    expect(result.warnings[0]).toContain('dayjs');
  });

  it('bundler 失败（ENTRY_MISSING）：无 /src/main.jsx 时回退且不漏现状告警', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: '<!DOCTYPE html><html><body><div id="root"></div><script src="/src/App.jsx"></script></body></html>',
      },
      '/src/App.jsx': {
        content: `import { greet } from './greet.js';
export default function App() { return greet('x'); }`,
      },
      '/src/greet.js': { content: `export function greet(name) { return 'hi ' + name; }` },
    };

    const legacy = assembleFiles(files, '/index.html', 'react-cdn');
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings.length).toBe(legacy.warnings.length + 1);
    expect(result.warnings[0]).toContain('模块打包失败');
    expect(result.warnings[0]).toContain('ENTRY_MISSING');
    // 现状链路的未引用告警在回退产物中原样保留（greet.js 未被 HTML 引用）
    expect(result.warnings.some((w) => w.includes('未被入口 HTML 引用') && w.includes('/src/greet.js'))).toBe(true);
  });

  it('混合项目：入口 HTML 引用文件不在依赖图中，回退以保证其执行语义', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: `<!DOCTYPE html><html><body><div id="root"></div>
<script src="/src/components/Counter.jsx"></script>
<script src="/src/main.jsx"></script>
</body></html>`,
      },
      '/src/main.jsx': {
        content: `import { mount } from './boot.js';
mount();`,
      },
      '/src/boot.js': { content: `export function mount() { console.log('booted'); }` },
      '/src/components/Counter.jsx': {
        content: `function Counter() { return <div>0</div>; }
window.__components = window.__components || {};
window.__components.Counter = Counter;`,
      },
    };

    const legacy = assembleFiles(files, '/index.html', 'react-cdn');
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings[0]).toContain('不在 import 依赖图中');
    expect(result.warnings[0]).toContain('已回退');
    expect(result.warnings[0]).toContain('/src/components/Counter.jsx');
    // Counter.jsx 在回退产物中按现状原样内联执行
    expect(result.html).toContain('window.__components.Counter = Counter');
  });

  it('P0 注册约定项目（无 import）：不尝试打包，产物与告警与现状一致', async () => {
    const files: Record<string, FileNode> = {
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
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
window.__components = window.__components || {};
window.__components.Counter = Counter;`,
      },
    };

    const legacy = assembleFiles(files, '/index.html', 'react-cdn');
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings).toEqual(legacy.warnings);
    expect(result.warnings.some((w) => w.includes('模块打包'))).toBe(false);
    expect(result.html).toContain('__compileAndRun("');
  });

  it('html 框架：assembleProjectFiles 与现状 assembleFiles 完全一致（回归）', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="/styles/main.css"></head><body><script src="/src/main.js"></script></body></html>',
      },
      '/styles/main.css': { content: 'body { margin: 0; }' },
      '/src/main.js': { content: "document.getElementById('app').textContent = 'ok';" },
    };

    const legacy = assembleFiles(files, '/index.html', 'html');
    const result = await assembleProjectFiles(files, '/index.html', 'html');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings).toEqual(legacy.warnings);
    expect(result.stats).toEqual(legacy.stats);
  });

  it('react-cdn 单文件项目（无 /src 模块文件）：与现状完全一致（回归）', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: `<!DOCTYPE html><html><body><div id="root"></div><script>
function App() { return <div>Hello</div>; }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script></body></html>`,
      },
    };

    const legacy = assembleFiles(files, '/index.html', 'react-cdn');
    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    expect(result.html).toBe(legacy.html);
    expect(result.warnings).toEqual(legacy.warnings);
    expect(result.html).toContain('"inline-jsx"');
  });

  it('含 CSS import 的项目：css import 改写为 no-op，不破坏打包与样式内联', async () => {
    const files: Record<string, FileNode> = {
      '/index.html': {
        content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="/styles/main.css"></head><body><div id="root"></div><script src="/src/main.jsx"></script></body></html>',
      },
      '/styles/main.css': { content: 'body { background: #fff; }' },
      '/src/main.jsx': {
        content: `import './styles/only-imported.css';
import { title } from './title.js';
document.title = title;`,
      },
      '/src/title.js': { content: `export const title = 'bundled';` },
      // only-imported.css 未通过 link 引用，仅被 JS import（运行时 no-op，样式不生效属现状语义）
      '/src/styles/only-imported.css': { content: '.x { color: blue; }' },
    };

    const result = await assembleProjectFiles(files, '/index.html', 'react-cdn');

    // 打包成功（无回退），css import 不触发 ModuleNotFound / UnknownBareImport
    expect(result.warnings.some((w) => w.includes('模块打包失败'))).toBe(false);
    expect(result.html).toContain('__defineModule("/src/main.jsx"');
    expect(result.html).toContain('__defineModule("/src/title.js"');
    // css 哨兵 require 出现在产物中（运行时返回空对象）
    expect(result.html).toContain('require("__css_module__")');
    // link 引用的样式仍照现状内联
    expect(result.html).toContain('<style>');
    expect(result.html).toContain('body { background: #fff; }');
  });
});