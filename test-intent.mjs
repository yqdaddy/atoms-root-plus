/**
 * 意图分类器测试脚本
 * 验证修复是否符合验收标准
 */

import { classifyIntent } from './dist-server/intentClassifier.js';

async function testIntentClassification() {
  console.log('=== 意图分类器测试 ===\n');

  const testCases = [
    {
      description: '验收标准1: 创建需求包含技术术语',
      input: '请为六年级语文生成一个随堂知识闯关小游戏',
      expected: 'create',
      context: { userPrompt: '', hasExistingProject: false, fileCount: 0 },
    },
    {
      description: '验收标准2: 明确的诊断问题',
      input: '为什么我的代码报错了',
      expected: 'diagnose',
      context: { userPrompt: '', hasExistingProject: true, fileCount: 3 },
    },
    {
      description: '验收标准3: 功能问题诊断',
      input: '这个功能没反应，帮我看看',
      expected: 'diagnose',
      context: { userPrompt: '', hasExistingProject: true, fileCount: 2 },
    },
    {
      description: '边界情况: 创建需求中包含"bug"但不是问题',
      input: '做一个防bug的数据录入表单',
      expected: 'create',
      context: { userPrompt: '', hasExistingProject: false, fileCount: 0 },
    },
    {
      description: '边界情况: 创建需求中包含"修复"但不是修复问题',
      input: '生成一个自动修复功能的工具页面',
      expected: 'create',
      context: { userPrompt: '', hasExistingProject: false, fileCount: 0 },
    },
    {
      description: '边界情况: 已有项目修改包含技术术语',
      input: '修改这个防点击无反应的功能',
      expected: 'modify',
      context: { userPrompt: '', hasExistingProject: true, fileCount: 2 },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    testCase.context.userPrompt = testCase.input;
    const result = await classifyIntent(testCase.context);

    const isPassed = result.type === testCase.expected;
    const status = isPassed ? '✅ PASS' : '❌ FAIL';

    console.log(`${status} - ${testCase.description}`);
    console.log(`  输入: "${testCase.input}"`);
    console.log(`  预期: ${testCase.expected}`);
    console.log(`  实际: ${result.type} (置信度: ${result.confidence.toFixed(3)})`);
    console.log(`  理由: ${result.reasoning}\n`);

    if (isPassed) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n=== 测试结果 ===`);
  console.log(`通过: ${passed}/${testCases.length}`);
  console.log(`失败: ${failed}/${testCases.length}`);

  if (failed === 0) {
    console.log('\n🎉 所有测试通过！');
  } else {
    console.log('\n⚠️ 存在失败的测试用例');
    process.exit(1);
  }
}

testIntentClassification().catch(console.error);