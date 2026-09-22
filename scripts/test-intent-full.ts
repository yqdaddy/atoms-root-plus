/**
 * 测试完整的多轮对话生成流程
 * 模拟：创建应用 → 迭代修改
 */

// 模拟后端如何处理迭代请求
import { classifyIntent, INTENT_LABELS } from '../server/intentClassifier.js';

console.log('=== 意图识别测试 ===\n');

const testCases = [
  { prompt: '做一个计数器应用', hasExistingProject: false },
  { prompt: '把按钮改成绿色', hasExistingProject: true },
  { prompt: '添加一个重置按钮', hasExistingProject: true },
  { prompt: '用 React 做一个计数器', hasExistingProject: false },
  { prompt: '用 Vue 写一个贪吃蛇游戏', hasExistingProject: false },
];

for (const tc of testCases) {
  const result = await classifyIntent({
    userPrompt: tc.prompt,
    hasExistingProject: tc.hasExistingProject,
  });
  console.log(`"${tc.prompt}"`);
  console.log(`  → 意图: ${INTENT_LABELS[result.type]} (置信度: ${result.confidence.toFixed(2)})`);
  console.log(`  → 建议框架: ${result.suggestedFramework ?? '无'}`);
  console.log();
}