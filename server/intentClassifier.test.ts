/**
 * server/intentClassifier.ts 单元测试
 *
 * 覆盖三层识别链路：
 * 1. 语义向量相似度匹配（默认开启，向量阈值 0.7）
 * 2. 关键词匹配兜底（向量关闭时验证向后兼容）
 * 3. 项目状态推断最终兜底
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyIntent,
  detectFramework,
  isVectorSimilarityEnabled,
  INTENT_CONFIG,
  INTENT_LABELS,
  type IntentContext,
} from './intentClassifier.js';

/** 构造识别上下文的快捷函数 */
function makeContext(userPrompt: string, hasExistingProject = false): IntentContext {
  return {
    userPrompt,
    hasExistingProject,
    fileCount: hasExistingProject ? 3 : 0,
  };
}

/** 验收标准用例（任务验收表格逐条对照） */
describe('classifyIntent 验收标准', () => {
  it('「你好」识别为 conversation', async () => {
    const result = await classifyIntent(makeContext('你好'));
    expect(result.type).toBe('conversation');
    expect(result.confidence).toBeGreaterThanOrEqual(INTENT_CONFIG.VECTOR_CONFIDENCE_THRESHOLD);
  });

  it('「帮我做一个待办清单」识别为 create', async () => {
    const result = await classifyIntent(makeContext('帮我做一个待办清单'));
    expect(result.type).toBe('create');
  });

  it('「给这个应用添加搜索功能」识别为 modify', async () => {
    const result = await classifyIntent(makeContext('给这个应用添加搜索功能', true));
    expect(result.type).toBe('modify');
  });

  it('「解释一下这个代码做了什么」识别为 analyze', async () => {
    const result = await classifyIntent(makeContext('解释一下这个代码做了什么', true));
    expect(result.type).toBe('analyze');
  });

  it('「为什么点击没反应」识别为 diagnose', async () => {
    const result = await classifyIntent(makeContext('为什么点击没反应'));
    expect(result.type).toBe('diagnose');
  });

  it('「能不能帮我」识别为 conversation', async () => {
    const result = await classifyIntent(makeContext('能不能帮我'));
    expect(result.type).toBe('conversation');
  });
});

/** 语义向量相似度匹配的扩展用例（中英文、边界表达） */
describe('classifyIntent 向量相似度扩展用例', () => {
  it('英文问候 hello 识别为 conversation', async () => {
    const result = await classifyIntent(makeContext('hello'));
    expect(result.type).toBe('conversation');
  });

  it('英文创建 build a todo app 识别为 create', async () => {
    const result = await classifyIntent(makeContext('build a todo app'));
    expect(result.type).toBe('create');
  });

  it('英文诊断 fix the bug 识别为 diagnose', async () => {
    const result = await classifyIntent(makeContext('fix the bug'));
    expect(result.type).toBe('diagnose');
  });

  it('英文分析 explain the code 识别为 analyze', async () => {
    const result = await classifyIntent(makeContext('explain the code', true));
    expect(result.type).toBe('analyze');
  });

  it('「谢谢你的帮助」识别为 conversation', async () => {
    const result = await classifyIntent(makeContext('谢谢你的帮助'));
    expect(result.type).toBe('conversation');
  });

  it('向量命中时返回推理信息且置信度在 0-1 范围', async () => {
    const result = await classifyIntent(makeContext('帮我写一个计算器'));
    expect(result.type).toBe('create');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.reasoning).toBeTruthy();
  });
});

/** 向后兼容：关闭向量相似度后走原关键词 + 状态推断链路 */
describe('classifyIntent 向后兼容（INTENT_ENABLE_VECTOR=false）', () => {
  const originalEnv = process.env.INTENT_ENABLE_VECTOR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INTENT_ENABLE_VECTOR;
    } else {
      process.env.INTENT_ENABLE_VECTOR = originalEnv;
    }
  });

  it('关闭向量后验收用例仍全部正确（关键词兜底）', async () => {
    // isVectorSimilarityEnabled 运行时读取环境变量，直接切换即可
    process.env.INTENT_ENABLE_VECTOR = 'false';

    const cases: Array<{ input: string; expected: string; hasProject: boolean }> = [
      { input: '你好', expected: 'conversation', hasProject: false },
      { input: '帮我做一个待办清单', expected: 'create', hasProject: false },
      { input: '给这个应用添加搜索功能', expected: 'modify', hasProject: true },
      { input: '解释一下这个代码做了什么', expected: 'analyze', hasProject: true },
      { input: '为什么点击没反应', expected: 'diagnose', hasProject: true },
      { input: '能不能帮我', expected: 'conversation', hasProject: false },
    ];

    for (const c of cases) {
      const result = await classifyIntent(makeContext(c.input, c.hasProject));
      expect(result.type, `输入「${c.input}」`).toBe(c.expected);
    }
  });

  it('isVectorSimilarityEnabled 支持多种环境变量取值', () => {
    const original = process.env.INTENT_ENABLE_VECTOR;

    process.env.INTENT_ENABLE_VECTOR = 'false';
    expect(isVectorSimilarityEnabled()).toBe(false);

    process.env.INTENT_ENABLE_VECTOR = '0';
    expect(isVectorSimilarityEnabled()).toBe(false);

    process.env.INTENT_ENABLE_VECTOR = 'off';
    expect(isVectorSimilarityEnabled()).toBe(false);

    process.env.INTENT_ENABLE_VECTOR = 'true';
    expect(isVectorSimilarityEnabled()).toBe(true);

    delete process.env.INTENT_ENABLE_VECTOR;
    expect(isVectorSimilarityEnabled()).toBe(true);

    if (original === undefined) {
      delete process.env.INTENT_ENABLE_VECTOR;
    } else {
      process.env.INTENT_ENABLE_VECTOR = original;
    }
  });

  it('向量与关键词均未命中时按项目状态推断', async () => {
    // 无任何种子词与关键词的无意义输入
    const emptyProject = await classifyIntent(makeContext('xyzzy qqq'));
    expect(emptyProject.type).toBe('create');
    expect(emptyProject.confidence).toBe(INTENT_CONFIG.DEFAULT_CONFIDENCE);

    const existingProject = await classifyIntent(makeContext('xyzzy qqq', true));
    expect(existingProject.type).toBe('modify');
  });
});

/** 框架识别不受意图识别链路变更影响 */
describe('detectFramework', () => {
  it('React 关键词返回 react-cdn', () => {
    expect(detectFramework(makeContext('用 React 做一个待办清单'))).toBe('react-cdn');
  });

  it('Vue 关键词返回 vue-cdn', () => {
    expect(detectFramework(makeContext('用 vue 写一个计数器'))).toBe('vue-cdn');
  });

  it('默认返回 html', () => {
    expect(detectFramework(makeContext('做一个待办清单'))).toBe('html');
  });
});

/** 配置与元数据 */
describe('配置导出', () => {
  it('INTENT_CONFIG 包含向量阈值配置', () => {
    expect(INTENT_CONFIG.VECTOR_CONFIDENCE_THRESHOLD).toBe(0.7);
    // 原有配置保持不变（向后兼容）
    expect(INTENT_CONFIG.KEYWORD_CONFIDENCE_THRESHOLD).toBe(0.8);
    expect(INTENT_CONFIG.DEFAULT_CONFIDENCE).toBe(0.5);
  });

  it('INTENT_LABELS 覆盖全部意图类型', () => {
    expect(Object.keys(INTENT_LABELS)).toHaveLength(5);
  });
});
