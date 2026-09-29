/**
 * liveEngine SSE 事件映射回归测试。
 * 覆盖后端 stage/delta 事件到前端协议的转换，重点回归：
 * search 阶段（在线查询）的状态条中文文案与 delta 思考区相位（MINOR-1）。
 * 修复前：状态条回落显示 "search 阶段"（英文混排），查询通知 delta 回落 generate 相位混入代码面板。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../apiClient', () => ({
  apiFetch: apiFetchMock,
}));

import { createLiveEngine } from './liveEngine';
import type { StreamEvent } from './types';

/** 构造携带 SSE 文本流的真实 Response（Node 22 全局 ReadableStream/Response） */
function sseResponse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const text = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, statusText: 'OK' });
}

describe('liveEngine SSE 事件映射', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('search 阶段 stage 事件映射为 analyzing 态与中文文案', async () => {
    apiFetchMock.mockResolvedValue(
      sseResponse([
        { event: 'stage', data: { phase: 'search' } },
        { event: 'done', data: { html: '<p>ok</p>' } },
      ]),
    );

    const events: StreamEvent[] = [];
    await createLiveEngine().generateStream('做个待办应用', (e) => events.push(e));

    const stageEvents = events.filter((e) => e.type === 'stage');
    expect(stageEvents).toHaveLength(1);
    const stage = stageEvents[0];
    expect(stage.type === 'stage' && stage.payload.stage).toBe('analyzing');
    expect(stage.type === 'stage' && stage.payload.message).toBe('正在检索资料...');
    expect(stage.type === 'stage' && stage.payload.attempt).toBe(1);
  });

  it('search 阶段 delta 事件归入 analyze 相位（思考区），不混入代码面板', async () => {
    apiFetchMock.mockResolvedValue(
      sseResponse([
        { event: 'stage', data: { phase: 'search' } },
        { event: 'delta', data: { phase: 'search', text: '正在查询相关资料...' } },
        { event: 'done', data: { html: '<p>ok</p>' } },
      ]),
    );

    const events: StreamEvent[] = [];
    await createLiveEngine().generateStream('做个待办应用', (e) => events.push(e));

    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas).toHaveLength(1);
    const delta = deltas[0];
    expect(delta.type === 'delta' && delta.payload.phase).toBe('analyze');
    expect(delta.type === 'delta' && delta.payload.text).toBe('正在查询相关资料...');
  });

  it('既有阶段映射不受影响，事件时序保持 stage/delta/done 有序', async () => {
    apiFetchMock.mockResolvedValue(
      sseResponse([
        { event: 'stage', data: { phase: 'search' } },
        { event: 'delta', data: { phase: 'search', text: '正在查询相关资料...' } },
        { event: 'stage', data: { phase: 'analysis' } },
        { event: 'delta', data: { phase: 'analysis', text: '分析内容' } },
        { event: 'done', data: { html: '<p>ok</p>' } },
      ]),
    );

    const events: StreamEvent[] = [];
    await createLiveEngine().generateStream('做个待办应用', (e) => events.push(e));

    expect(events.map((e) => e.type)).toEqual(['stage', 'delta', 'stage', 'delta', 'done']);

    const [, searchDelta, , analysisDelta, done] = events;
    expect(searchDelta?.type === 'delta' && searchDelta.payload.phase).toBe('analyze');
    expect(analysisDelta?.type === 'delta' && analysisDelta.payload.phase).toBe('analyze');
    const analysisStage = events[2];
    expect(analysisStage?.type === 'stage' && analysisStage.payload.message).toBe('正在分析需求...');
    expect(done?.type === 'done' && done.payload.html).toBe('<p>ok</p>');
  });

  it('未知 phase 仍走回落路径（analyzing 态 + 原样提示），不抛错', async () => {
    apiFetchMock.mockResolvedValue(
      sseResponse([
        { event: 'stage', data: { phase: 'future-stage' } },
        { event: 'done', data: { html: '<p>ok</p>' } },
      ]),
    );

    const events: StreamEvent[] = [];
    await createLiveEngine().generateStream('做个待办应用', (e) => events.push(e));

    const stage = events[0];
    expect(stage?.type === 'stage' && stage.payload.stage).toBe('analyzing');
    expect(stage?.type === 'stage' && stage.payload.message).toBe('future-stage 阶段');
  });
});

describe('liveEngine 用户取消终态（RC3-BUG-004）', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  /**
   * 构造可控 SSE 流：分块由测试体手动注入，用于模拟"取消瞬间事件仍在途"的时序。
   * 测试环境的 ReadableStream 未与 abort 信号联动（pending read 不拒绝），
   * 恰好能确定性复现"取消先生效、终局事件后到达"的真实竞态。
   */
  function controllableStream(): {
    enqueueEvent: (event: string, data: Record<string, unknown>) => void;
    close: () => void;
  } {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    apiFetchMock.mockResolvedValue(new Response(stream, { status: 200, statusText: 'OK' }));
    return {
      enqueueEvent(event, data) {
        controller!.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      },
      close() {
        controller!.close();
      },
    };
  }

  it('用户取消后，迟到的服务端终局 error（格式重试耗尽文案）不再派发', async () => {
    const stream = controllableStream();
    stream.enqueueEvent('stage', { phase: 'generate' });

    const events: StreamEvent[] = [];
    const engine = createLiveEngine();
    const pipeline = engine.generateStream('做个待办应用', (e) => events.push(e));

    // 等待首个事件派发完成，确保取消发生在流消费中途
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'stage')).toBe(true);
    });

    engine.cancelGeneration();

    // 取消后注入服务端在途事件：格式重试耗尽的终局 error 与迟到增量
    stream.enqueueEvent('delta', { phase: 'generate', text: '迟到的增量文本' });
    stream.enqueueEvent('error', {
      message: '生成结果格式不符合要求，已自动重试 4 次仍未成功。请点击重试再次生成，或换一种描述方式。',
    });
    stream.close();

    await pipeline;

    // 取消前的事件保留；取消后的终局 error 与增量一律静默，
    // 终态交由停止入口本地收尾，引擎层不补写任何消息
    expect(events.map((e) => e.type)).toEqual(['stage']);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('用户取消后，迟到的 done 交付结果不再应用（放弃交付）', async () => {
    const stream = controllableStream();
    stream.enqueueEvent('stage', { phase: 'generate' });

    const events: StreamEvent[] = [];
    const engine = createLiveEngine();
    const pipeline = engine.generateStream('做个待办应用', (e) => events.push(e));

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'stage')).toBe(true);
    });

    engine.cancelGeneration();

    // 取消瞬间服务端恰好完成交付：迟到 done 不应覆盖用户已放弃的会话
    stream.enqueueEvent('done', { html: '<!DOCTYPE html><html></html>' });
    stream.close();

    await pipeline;

    expect(events.map((e) => e.type)).toEqual(['stage']);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });
});
