/**
 * RC5 服务端管线缺陷回归测试（真实事故路径复刻）
 *
 * RC5-BUG-001：diff 空变更旁路（run d40ff5e7 实证）。
 * 真实模型在 diff 模式输出 { "changes": [], "summary": "请提供完整的新文件内容" }，
 * 命中"diff 输出为空变更，转对话模式"分支直接对话交付 done 终局。该分支不在
 * RC4 三个对话回落防护点（diff 解析回落/增强 JSON/parseOutput）覆盖范围内，
 * 形成"测试全绿但缺陷仍在"的旁路。修复：该分支同样接入预算内转格式重试
 * （retryCount 1..3 视为格式契约规避，提示词要求产出实际文件变更或全量文件），
 * 首轮澄清语义（a2d9eae 保护）与预算耗尽轮照旧诚实对话兜底。
 *
 * RC5-MINOR-002：diff 交付摘要统计失真（run 45d6b8f6 实证）。
 * 成功案例（action:create 新文件已应用、文件已更新）chat 末条仍写
 * "已应用 0 处修改"。根因：appliedEdits 误传 changeList 声明的 edits 数组
 * 长度，而 action:create 变更没有 edits 数组；修复后改传 applyChanges 的
 * 实际应用计数 appliedEditCount。
 *
 * 本文件全部以 diff 模式（runDirectModifyPipeline，真实事故路径）为模拟对象。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDirectModifyPipeline, type LLMEvent } from './llm.js';
import type { IntentResult } from './intentClassifier.js';

const MODIFY_INTENT: IntentResult = { type: 'modify', confidence: 1, reasoning: '测试固定意图' };

/** 测试项目文件（4 行，供行号编辑定位） */
const TEST_FILES = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>',
    language: 'html' as const,
  },
};

/** 意图升级的空变更输出（run d40ff5e7 的形态：借口要内容，不产出变更） */
const EMPTY_CHANGES_JSON = JSON.stringify({
  changes: [],
  summary: '请提供完整的新文件内容',
});

/** 必定解析失败的输出（changes 非数组，触发首试格式重试） */
const BROKEN_CHANGES_JSON = '{"changes": "not-an-array"}';

/** 真实行级编辑（old 与 TEST_FILES 第 3 行逐字匹配） */
const REAL_EDIT_JSON = JSON.stringify({
  changes: [
    {
      file: '/index.html',
      edits: [
        {
          line: 3,
          old: '<body><h1 id="title">标题</h1></body>',
          new: '<body><h1 id="title">新标题</h1></body>',
          type: 'replace',
        },
      ],
    },
  ],
  summary: '替换标题文案',
});

/** action:create 新文件（run 45d6b8f6 的形态：文件级变更，无 edits 数组） */
const CREATE_FILE_JSON = JSON.stringify({
  changes: [
    {
      file: '/src/main.js',
      action: 'create',
      content: 'console.log("计时器逻辑");\n'.repeat(40),
    },
  ],
  summary: '新增计时器脚本',
});

/** 构造伪造的 OpenAI 兼容 SSE 响应（单 chunk 输出 + usage） */
function makeSSEResponse(fullContent: string): Response {
  const encoder = new TextEncoder();
  const sseLines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const line of sseLines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 事件收集器 */
function collectEvents(): { events: LLMEvent[]; onEvent: (e: LLMEvent) => void } {
  const events: LLMEvent[] = [];
  return { events, onEvent: (e) => events.push(e) };
}

/** 拼接全部 delta 文本（用于断言交付摘要） */
function joinedDeltaText(events: LLMEvent[]): string {
  return events
    .filter((e) => e.type === 'delta')
    .map((e) => e.payload.text ?? '')
    .join('');
}

describe('RC5-BUG-001：diff 空变更旁路（run d40ff5e7 复刻）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('重试轮空变更转格式重试，最终真实变更经唯一 done 交付且 appliedEdits 非零', async () => {
    // 事故序列：首试格式失败 → 重试轮模型以空变更规避 → 修复后转格式重试
    // → 最终轮产出真实行级编辑
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(BROKEN_CHANGES_JSON))
      .mockResolvedValueOnce(makeSSEResponse(EMPTY_CHANGES_JSON))
      .mockResolvedValueOnce(makeSSEResponse(EMPTY_CHANGES_JSON))
      .mockResolvedValueOnce(makeSSEResponse(EMPTY_CHANGES_JSON))
      .mockImplementation(async () => makeSSEResponse(REAL_EDIT_JSON));
    vi.stubGlobal('fetch', fetchMock);

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '把标题改成新标题',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    // 空变更轮没有提前终局：唯一 done 携带真实产物
    const dones = events.filter((e) => e.type === 'done');
    expect(dones).toHaveLength(1);
    const done = dones[0]!;
    expect(done.payload.files?.['/index.html']?.content).toContain('新标题');
    expect(done.payload.changes?.changes).toHaveLength(1);

    // 空变更轮各触发一轮格式重试：attempt1-4 共 4 次协议 retry
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(4);

    // 工程师生成恰好 5 次（attempt0 失败 + 3 轮空变更重试 + 1 轮真实交付）；
    // diff 模式跳过审查者调用
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 无终局 error
    expect(events.find((e) => e.type === 'error')).toBeUndefined();

    // RC5-MINOR-002：交付摘要为实际应用口径（1 处行级编辑）
    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('已应用 1 处修改');
    expect(deltaText).not.toContain('已应用 0 处修改');
  });

  it('空变更打满重试预算后诚实对话兜底（done.analysis），不发 error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(BROKEN_CHANGES_JSON))
      .mockImplementation(async () => makeSSEResponse(EMPTY_CHANGES_JSON));
    vi.stubGlobal('fetch', fetchMock);

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '把标题改成新标题',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    // 预算耗尽：对话是诚实兜底而非报错
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.analysis).toContain('请提供完整的新文件内容');
    expect(Object.keys(done!.payload.files ?? {})).toHaveLength(0);

    // attempt0 失败 + attempt1-4 全部空变更 = 5 次工程师调用
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(4);
  });

  it('首轮空变更照旧对话交付（a2d9eae 澄清语义保护不回退）', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(EMPTY_CHANGES_JSON));
    vi.stubGlobal('fetch', fetchMock);

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '这个页面用了什么技术',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    // 首轮空变更 = 诚实的"未修改"反馈，不做格式重试
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.analysis).toContain('请提供完整的新文件内容');
    expect(events.find((e) => e.type === 'retry')).toBeUndefined();
  });
});

describe('RC5-MINOR-002：交付摘要实际应用口径（run 45d6b8f6 复刻）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('action:create 文件级变更首试成功：摘要显示已应用 1 处而非 0 处', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(CREATE_FILE_JSON));
    vi.stubGlobal('fetch', fetchMock);

    const { events, onEvent } = collectEvents();
    await runDirectModifyPipeline({
      prompt: '新增一个脚本文件',
      currentFiles: TEST_FILES,
      intent: MODIFY_INTENT,
      onEvent,
      signal: new AbortController().signal,
    });

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    // 新文件真实落盘
    expect(done!.payload.files?.['/src/main.js']?.content).toContain('计时器逻辑');
    expect(events.find((e) => e.type === 'error')).toBeUndefined();

    // create 变更没有 edits 数组：摘要必须报实际应用（1），不得报声明的 edits 数（0）
    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('已应用 1 处修改');
    expect(deltaText).not.toContain('已应用 0 处修改');
    expect(deltaText).toContain('/src/main.js');
  });
});
