import { describe, it, expect } from 'vitest';
import { assembleFiles, Assembler } from './assembler';
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

      // 验证 React 运行时被注入
      expect(result.html).toContain('react@');
      expect(result.html).toContain('react-dom@');

      // 验证 JSX 文件被正确包装（通过文件名标记）
      expect(result.html).toContain('"./src/App.jsx"');

      // 验证没有嵌套包装
      expect(result.html).not.toContain('__compileAndRun("\\n__compileAndRun');

      // 验证统计
      expect(result.stats.inlinedCss).toBe(1);
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