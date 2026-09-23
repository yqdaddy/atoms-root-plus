/**
 * 测试脚本：验证 conversation 意图识别
 * 直接调用 classifyIntent 函数，无需通过 HTTP API
 */

import { classifyIntent, INTENT_LABELS } from './server/intentClassifier.js';

async function testConversationIntent() {
  console.log('=== 测试 conversation 意图识别 ===\n');

  // 测试用例
  const testCases = [
    { prompt: '你好', expected: 'conversation', description: '打招呼' },
    { prompt: '谢谢', expected: 'conversation', description: '感谢' },
    { prompt: '这个项目是做什么的', expected: 'conversation', description: '询问概念' },
    { prompt: '做一个计算器', expected: 'create', description: '创建应用' },
    { prompt: '把标题改成红色', expected: 'modify', description: '修改应用' },
    { prompt: '帮我分析一下这个项目', expected: 'analyze', description: '分析应用' },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = await classifyIntent({
      userPrompt: testCase.prompt,
      hasExistingProject: false
    });

    const isPassed = result.type === testCase.expected;
    const status = isPassed ? '✅ PASS' : '❌ FAIL';

    console.log(`${status} | 输入: "${testCase.prompt}"`);
    console.log(`   期望: ${testCase.expected}, 实际: ${result.type} (置信度: ${result.confidence.toFixed(2)})`);
    if (result.reasoning) {
      console.log(`   理由: ${result.reasoning}`);
    }
    console.log();

    if (isPassed) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n=== 测试结果 ===`);
  console.log(`通过: ${passed}/${testCases.length}`);
  console.log(`失败: ${failed}/${testCases.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

testConversationIntent().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});