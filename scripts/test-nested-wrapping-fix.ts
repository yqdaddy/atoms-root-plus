/**
 * 手动测试脚本：验证 React CDN 模式嵌套包装修复
 *
 * 测试场景：模拟 LLM 按照 React CDN 提示词生成的多文件项目
 * 验证目标：assembler 组装后不会产生 __compileAndRun("\n__compileAndRun(... 嵌套
 */
import { assembleFiles } from '../src/services/sandbox/assembler.js';
import type { FileNode } from '../src/types/project.js';

console.log('=== React CDN 嵌套包装修复验证 ===\n');

// 模拟 LLM 生成的 React CDN 项目文件
const testFiles: Record<string, FileNode> = {
  '/index.html': {
    content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>React CDN 计数器</title>
  <link rel="stylesheet" href="./styles/main.css">
</head>
<body>
  <div id="root"></div>
  <script src="./src/Counter.jsx"></script>
</body>
</html>`,
  },
  '/styles/main.css': {
    content: `.counter {
  padding: 20px;
  text-align: center;
}
button {
  padding: 10px 20px;
  font-size: 16px;
}`,
  },
  '/src/Counter.jsx': {
    content: `function Counter() {
  const [count, setCount] = React.useState(0);

  return (
    <div className="counter">
      <h1>计数器</h1>
      <p>当前计数: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        点击增加
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Counter />);`,
  },
};

console.log('测试文件:');
console.log('  - /index.html (入口)');
console.log('  - /styles/main.css (样式)');
console.log('  - /src/Counter.jsx (React 组件)\n');

// 组装文件
const result = assembleFiles(testFiles, '/index.html', 'react-cdn');

console.log('组装统计:');
console.log(`  - 总文件数: ${result.stats.totalFiles}`);
console.log(`  - 内联 CSS: ${result.stats.inlinedCss}`);
console.log(`  - 内联 JS: ${result.stats.inlinedJs}`);
console.log(`  - 警告: ${result.warnings.length > 0 ? result.warnings.join(', ') : '无'}\n`);

// 核心验证：检查是否存在嵌套包装
const hasNestedWrapping =
  result.html.includes('__compileAndRun("\\n__compileAndRun') ||
  result.html.includes('__compileAndRun(\\"\\n__compileAndRun') ||
  result.html.includes('__compileAndRun("\n__compileAndRun');

console.log('验证结果:');
console.log(`  ${!hasNestedWrapping ? '✓' : '✗'} 无嵌套包装: ${!hasNestedWrapping ? '通过' : '失败'}`);

// 检查 JSX 文件是否被正确包装
const hasCorrectWrapping = result.html.includes('"./src/Counter.jsx"');
console.log(`  ${hasCorrectWrapping ? '✓' : '✗'} JSX 文件正确包装: ${hasCorrectWrapping ? '通过' : '失败'}`);

// 检查 React 运行时是否注入
const hasReactRuntime =
  result.html.includes('react@') && result.html.includes('react-dom@');
console.log(`  ${hasReactRuntime ? '✓' : '✗'} React 运行时注入: ${hasReactRuntime ? '通过' : '失败'}`);

// 检查 Sucrase 运行时是否注入
const hasSucraseRuntime = result.html.includes('esm.sh/sucrase');
console.log(`  ${hasSucraseRuntime ? '✓' : '✗'} Sucrase 运行时注入: ${hasSucraseRuntime ? '通过' : '失败'}`);

// 检查 CSS 是否内联
const hasInlinedCss = result.html.includes('.counter {') && result.html.includes('<style>');
console.log(`  ${hasInlinedCss ? '✓' : '✗'} CSS 正确内联: ${hasInlinedCss ? '通过' : '失败'}`);

console.log('\n=== 测试总结 ===');
const allPassed = !hasNestedWrapping && hasCorrectWrapping && hasReactRuntime && hasSucraseRuntime && hasInlinedCss;

if (allPassed) {
  console.log('✓ 所有验证通过，嵌套包装 bug 已修复\n');
} else {
  console.log('✗ 部分验证失败，需要进一步调查\n');
  console.log('组装后的 HTML 片段:');
  console.log(result.html.substring(0, 500) + '...');
}

// 输出完整的组装结果（用于调试）
if (process.argv.includes('--verbose')) {
  console.log('\n=== 完整组装结果 ===\n');
  console.log(result.html);
}