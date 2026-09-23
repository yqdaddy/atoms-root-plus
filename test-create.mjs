/**
 * 测试：验证 create 意图仍然正常工作
 */

import './server/env.js';
import { generateWithStages } from './server/llm.js';

async function testCreateIntent() {
  console.log('=== 测试 create 意图 ===\n');

  const events = [];

  try {
    await generateWithStages({
      prompt: '做一个简单的计数器',
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'stage' || event.type === 'done' || event.type === 'approval_required') {
          console.log(`[${event.type}]`, JSON.stringify(event.payload).substring(0, 150));
        }
      },
    });

    console.log('\n=== 验证结果 ===');

    // 检查意图识别
    const stageEvent = events.find(e => e.type === 'stage');
    if (stageEvent && stageEvent.payload.intent) {
      console.log(`✅ 意图识别: ${stageEvent.payload.intent.type} (置信度: ${stageEvent.payload.intent.confidence.toFixed(2)})`);
    }

    // 检查是否进入分析阶段
    const analysisStage = events.find(e => e.type === 'stage' && e.payload.phase === 'analysis');
    if (analysisStage) {
      console.log(`✅ 进入分析阶段`);
    }

    // 检查是否触发批准流程
    const approvalEvent = events.find(e => e.type === 'approval_required');
    if (approvalEvent) {
      console.log(`✅ 触发批准流程（sessionId: ${approvalEvent.payload.sessionId?.substring(0, 8)}...）`);
    } else {
      console.log(`⚠️ 未触发批准流程（可能直接返回了对话内容）`);
    }

  } catch (err) {
    console.error('❌ 测试失败:', err);
    process.exit(1);
  }

  console.log('\n✅ create 意图测试完成');
  process.exit(0);
}

testCreateIntent();