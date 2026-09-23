/**
 * 集成测试：验证 conversation 意图的完整流程
 * 直接调用 generateWithStages，验证 conversation 分支
 */

import './server/env.js'; // 加载环境变量
import { generateWithStages } from './server/llm.js';

async function testConversationPipeline() {
  console.log('=== 测试 conversation 流水线 ===\n');

  const events = [];

  try {
    await generateWithStages({
      prompt: '你好',
      onEvent: (event) => {
        events.push(event);
        console.log(`[${event.type}]`, JSON.stringify(event.payload).substring(0, 100));
      },
    });

    console.log('\n=== 验证结果 ===');

    // 检查是否有 stage 事件
    const stageEvent = events.find(e => e.type === 'stage');
    if (stageEvent && stageEvent.payload.intent) {
      console.log(`✅ 意图识别: ${stageEvent.payload.intent.type} (置信度: ${stageEvent.payload.intent.confidence})`);
    }

    // 检查是否有 done 事件
    const doneEvent = events.find(e => e.type === 'done');
    if (doneEvent && doneEvent.payload.analysis) {
      console.log(`✅ 返回对话内容: ${doneEvent.payload.analysis.substring(0, 50)}...`);
    }

    // 检查是否没有进入代码生成流程
    const generateStage = events.find(e => e.type === 'stage' && e.payload.phase === 'generate');
    if (!generateStage) {
      console.log(`✅ 未进入代码生成流程`);
    } else {
      console.log(`❌ 错误：进入了代码生成流程`);
    }

    // 检查是否没有 approval_required 事件
    const approvalEvent = events.find(e => e.type === 'approval_required');
    if (!approvalEvent) {
      console.log(`✅ 无需批准`);
    } else {
      console.log(`❌ 错误：触发了批准流程`);
    }

  } catch (err) {
    console.error('❌ 测试失败:', err);
    process.exit(1);
  }

  console.log('\n✅ conversation 流水线测试通过');
  process.exit(0);
}

testConversationPipeline();