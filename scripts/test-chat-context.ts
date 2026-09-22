/**
 * 测试多轮对话上下文是否正确传递
 */
import { buildChatContextBlock, type ChatTurnInput } from '../server/llm.js';

console.log('=== 多轮对话上下文测试 ===\n');

// 模拟对话历史
const chatTurns: ChatTurnInput[] = [
  { role: 'user', content: '做一个简单的计数器应用' },
  { role: 'assistant', content: '已生成一个计数器，有增加和减少按钮' },
  { role: 'user', content: '把按钮改成绿色' },
  { role: 'assistant', content: '已将按钮颜色改为绿色' },
  { role: 'user', content: '添加一个重置按钮' },
  { role: 'assistant', content: '已添加重置按钮，点击后计数归零' },
];

const originalRequest = '做一个简单的计数器应用';

// 构建上下文块
const contextBlock = buildChatContextBlock(chatTurns, originalRequest);

console.log('对话轮次:', chatTurns.length);
console.log('原始需求:', originalRequest);
console.log('\n生成的上下文块:\n');
console.log(contextBlock);
console.log('\n上下文块长度:', contextBlock.length, '字符');

// 验证关键内容是否存在
const checks = [
  { name: '包含原始需求', pass: contextBlock.includes('用户最初需求') || contextBlock.includes('做一个简单的计数器') },
  { name: '包含最近的修改', pass: contextBlock.includes('添加一个重置按钮') },
  { name: '包含用户角色', pass: contextBlock.includes('用户：') },
  { name: '包含助手角色', pass: contextBlock.includes('助手：') },
];

console.log('\n=== 验证结果 ===');
let allPassed = true;
for (const check of checks) {
  console.log(`${check.pass ? '✓' : '✗'} ${check.name}`);
  if (!check.pass) allPassed = false;
}

console.log('\n' + (allPassed ? '✓ 所有测试通过' : '✗ 部分测试失败'));