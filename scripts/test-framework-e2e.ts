/**
 * 端到端测试：验证框架选择功能
 * 测试场景：发送不同框架的生成请求，验证系统提示词是否正确
 */
import { buildEngineerSystemPrompt } from '../server/llm.js';

// 模拟生成请求参数
interface TestRequest {
  prompt: string;
  framework: 'html' | 'react-cdn' | 'vue-cdn';
  expectedKeywords: string[];
  unexpectedKeywords: string[];
}

const testCases: TestRequest[] = [
  {
    prompt: '创建一个简单的计数器应用',
    framework: 'html',
    expectedKeywords: [
      'Tailwind CDN',
      'HTML 模式约定',
      // 差异化文件结构关键词
      '/index.html',
      '/styles/main.css',
      '简单直接的结构',
      '原生 JavaScript',
      '不使用组件化框架',
      '/src/main.js             # 脚本文件', // HTML 特有的描述
    ],
    unexpectedKeywords: [
      'React CDN',
      'Vue CDN',
      '组件化结构',
      '/src/App.jsx',
      '/src/components/',
      'createApp',
      'ReactDOM.createRoot',
      '/src/main.jsx', // HTML 不用 .jsx
    ],
  },
  {
    prompt: '创建一个简单的计数器应用',
    framework: 'react-cdn',
    expectedKeywords: [
      'React CDN 模式约定',
      'react@18',
      'react-dom@18',
      'babel.min.js',
      // 差异化文件结构关键词
      '/src/main.jsx',
      '/src/App.jsx',
      '/src/components/',
      '组件化结构',
      'ReactDOM.createRoot',
      '<div id="root"',
      'React 入口',
      '根组件',
      '组件文件扩展名',
    ],
    unexpectedKeywords: [
      'HTML 模式约定',
      'Vue CDN 模式约定',
      'createApp(App).mount',
      '简单直接的结构',
      '/src/main.js             # Vue 入口', // Vue 特有的描述
      '/src/main.js             # 脚本文件', // HTML 特有的描述
    ],
  },
  {
    prompt: '创建一个简单的计数器应用',
    framework: 'vue-cdn',
    expectedKeywords: [
      'Vue CDN 模式约定',
      // 差异化文件结构关键词
      '/src/main.js             # Vue 入口', // Vue 特有的描述
      '/src/App.js',
      '/src/components/',
      '组件化结构',
      'createApp(App).mount',
      '<div id="app"',
      'Vue 入口',
      '根组件',
      'template 字符串',
      '组件选项对象',
    ],
    unexpectedKeywords: [
      'HTML 模式约定',
      'React CDN 模式约定',
      'react@18',
      'babel.min.js',
      '简单直接的结构',
      'ReactDOM.createRoot',
      '/src/main.jsx            # React 入口', // React 特有的描述
      '/src/main.js             # 脚本文件', // HTML 特有的描述
    ],
  },
];

console.log('=== 框架选择功能端到端测试 ===\n');

let allPassed = true;

for (const testCase of testCases) {
  console.log(`\n### 测试 ${testCase.framework.toUpperCase()} 框架 ###\n`);

  const systemPrompt = buildEngineerSystemPrompt(testCase.framework);

  // 检查预期关键词
  const missingKeywords: string[] = [];
  for (const keyword of testCase.expectedKeywords) {
    if (!systemPrompt.includes(keyword)) {
      missingKeywords.push(keyword);
      allPassed = false;
    }
  }

  // 检查不应该出现的关键词
  const unexpectedPresent: string[] = [];
  for (const keyword of testCase.unexpectedKeywords) {
    if (systemPrompt.includes(keyword)) {
      unexpectedPresent.push(keyword);
      allPassed = false;
    }
  }

  // 输出结果
  if (missingKeywords.length === 0 && unexpectedPresent.length === 0) {
    console.log('  ✓ 所有检查通过');
  } else {
    if (missingKeywords.length > 0) {
      console.log(`  ✗ 缺少预期关键词: ${missingKeywords.join(', ')}`);
    }
    if (unexpectedPresent.length > 0) {
      console.log(`  ✗ 不应包含关键词: ${unexpectedPresent.join(', ')}`);
    }
  }

  // 显示提示词摘要
  console.log(`\n  提示词长度: ${systemPrompt.length} 字符`);
  console.log(`  包含框架约定: ${systemPrompt.includes('模式约定') ? '是' : '否'}`);
}

console.log('\n=== 测试总结 ===');
console.log(allPassed ? '✓ 所有测试通过' : '✗ 部分测试失败');

// 导出函数供测试使用
export { buildEngineerSystemPrompt };