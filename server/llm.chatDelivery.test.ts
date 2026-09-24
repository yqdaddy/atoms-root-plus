/**
 * MAJOR-D1 服务端半边修复测试：聊天交付内容安全化。
 *
 * 缺陷（evidence/combined-regression-20260924/m1/gates-static.txt MAJOR-D1）：
 * 降级交付/策略切换路径把未围栏的原始 LLM JSON（实测 104,026 字符）整段
 * 持久化为 assistant 聊天消息。服务端根因：工程师阶段原始输出经 delta 流
 * 逐 token 出站，被前端累积为 generateText 并在 done 时入库。
 *
 * 修复：工程师阶段原始 JSON 不再作为 delta 出站（只累积进解析管线）；
 * 交付时以人话摘要（是否重试/策略切换 + 文件清单）落入聊天区；
 * analysis 回落原文路径经 sanitizeEngineerChatContent 安全化。
 *
 * 裸 JSON 判定启发式（与验证裁定一致）：去围栏后 trim，以 { 或 [ 开头
 * 且长度超阈值即判定为未围栏裸 JSON。
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE 流，走真实
 * generateWithStages → continueAfterApproval 链路（复用 parseRetry 测试基建）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateWithStages,
  continueAfterApproval,
  type LLMEvent,
} from './llm.js';
import {
  looksLikeBareJson,
  sanitizeEngineerChatContent,
  buildDeliverySummary,
  BARE_JSON_LENGTH_THRESHOLD,
  FENCED_PAYLOAD_MAX_CHARS,
} from './utils/chatDelivery.js';

// ── 基建（与 llm.parseRetry.test.ts 同款）─────────────────────────────

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

function makeSequentialFetch(responses: (string | Error)[]): {
  fetchMock: ReturnType<typeof vi.fn>;
  requestBodies: string[];
} {
  const requestBodies: string[] = [];
  let callIndex = 0;
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requestBodies.push(typeof init?.body === 'string' ? init.body : '');
    const idx = callIndex;
    callIndex += 1;
    let item: string | Error | undefined;
    for (let i = Math.min(idx, responses.length - 1); i >= 0; i--) {
      if (responses[i] !== undefined) {
        item = responses[i];
        break;
      }
    }
    if (item instanceof Error) throw item;
    return makeSSEResponse(item ?? '');
  });
  return { fetchMock, requestBodies };
}

async function runCreateFlow(options: {
  responses: (string | Error)[];
  framework?: 'html' | 'react-cdn';
}): Promise<{ events: LLMEvent[]; requestBodies: string[] }> {
  const { fetchMock, requestBodies } = makeSequentialFetch(options.responses);
  vi.stubGlobal('fetch', fetchMock);

  const stage1Events: LLMEvent[] = [];
  await generateWithStages({
    prompt: '做一个个人书架管理',
    framework: options.framework ?? 'react-cdn',
    intentOverride: 'create',
    onEvent: (e) => stage1Events.push(e),
    abortSignal: new AbortController().signal,
  });
  const approval = stage1Events.find((e) => e.type === 'approval_required');
  expect(approval).toBeDefined();
  const sessionId = approval!.payload.sessionId;
  expect(sessionId).toBeTruthy();

  const events: LLMEvent[] = [];
  await continueAfterApproval(sessionId!, (e) => events.push(e), new AbortController().signal);
  return { events, requestBodies };
}

// ── 断言工具 ──────────────────────────────────────────────────────────

/**
 * 裸 JSON 判定（验收启发式）：去围栏后 trim，以 { 或 [ 开头且长度超阈值。
 * 细化（与 server/utils/chatDelivery.ts 同口径）：[ 开头仅当形如 JSON 数组
 * （[{ 起始）才判定，排除管线自身的方括号进度标记（如 [自动重试中]）。
 */
function isUnfencedBareJson(text: string, threshold = BARE_JSON_LENGTH_THRESHOLD): boolean {
  let t = (text ?? '').trim();
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n');
    t = nl === -1 ? '' : t.slice(nl + 1);
  }
  if (t.endsWith('```')) {
    const nl = t.lastIndexOf('\n');
    t = nl === -1 ? '' : t.slice(0, nl);
  }
  t = t.trim();
  if (t.length <= threshold) return false;
  if (t.startsWith('{')) return true;
  return t.startsWith('[{');
}

/** 按阶段拼接 delta 文本（聊天区该阶段的累积显示与入库内容） */
function joinedDeltaText(events: LLMEvent[], phase?: string): string {
  return events
    .filter((e) => e.type === 'delta')
    .filter((e) => (phase ? (e.payload as { phase?: string }).phase === phase : true))
    .map((e) => (e.payload as { text?: string }).text ?? '')
    .join('');
}

function retryEvents(events: LLMEvent[]): LLMEvent[] {
  return events.filter((e) => e.type === 'retry');
}

type DonePayload = {
  html?: string;
  files?: Record<string, { path: string; content: string }>;
  analysis?: string;
};

function doneEvent(events: LLMEvent[]): LLMEvent | undefined {
  return events.find((e) => e.type === 'done');
}

// ── 夹具 ──────────────────────────────────────────────────────────────

const FEATURES_JSON = JSON.stringify({
  appTitle: '个人书架管理',
  appType: 'tool',
  summary: '管理个人藏书与阅读进度',
  features: [{ id: 'F1', name: '书架列表', description: '展示全部藏书', priority: 'must' }],
  interactions: ['点击书籍查看详情'],
  assumptions: [],
});

/** 哨兵标记：原始 JSON 中的唯一串，修复前会随 delta 出站入库 */
const SENTINEL = 'M1RC3_BARE_JSON_SENTINEL_X7QK';

/** 含 E_CDN_DOMAIN 违规（unpkg.com 非白名单）的工程师输出（复现 M1RC3 门禁拦截） */
function makeViolatingFilesJson(tag: string): string {
  return JSON.stringify({
    files: [
      {
        path: '/index.html',
        content: `<!DOCTYPE html>\n<html>\n<head>\n<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>\n</head>\n<body>\n<div id="root"></div>\n<!-- ${tag}: ${SENTINEL} -->\n</body>\n</html>`,
        language: 'html',
      },
      {
        path: '/src/App.jsx',
        content: `export default function App() { return <h1>${tag} 书架</h1>; }`,
        language: 'javascript',
      },
    ],
  });
}

/** 合规工程师输出（无外域引用，可过 E_CDN_DOMAIN） */
const GOOD_FILES_JSON = JSON.stringify({
  files: [
    {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<head><title>个人书架</title></head>\n<body><div id="root"></div></body>\n</html>',
      language: 'html',
    },
    {
      path: '/src/App.jsx',
      content: 'export default function App() { return <h1>个人书架</h1>; }',
      language: 'javascript',
    },
  ],
});

// ── 纯函数单测：chatDelivery.ts ───────────────────────────────────────

describe('looksLikeBareJson（未围栏裸 JSON 判定）', () => {
  it('大段裸 JSON（104K 量级样本）判定成立', () => {
    const big = JSON.stringify({ files: [{ path: '/index.html', content: 'x'.repeat(104_000) }] });
    expect(big.length).toBeGreaterThan(100_000);
    expect(looksLikeBareJson(big)).toBe(true);
  });

  it('只围栏不附说明的形态同样判定成立（围栏必须伴随说明）', () => {
    const big = `\`\`\`json\n${JSON.stringify({ a: 'x'.repeat(500) })}\n\`\`\``;
    expect(looksLikeBareJson(big)).toBe(true);
  });

  it('围栏附说明（先有说明文字）判定不成立', () => {
    const fenced = `说明：模型输出如下：\n\`\`\`json\n${JSON.stringify({ a: 'x'.repeat(500) })}\n\`\`\``;
    expect(looksLikeBareJson(fenced)).toBe(false);
  });

  it('对话文本判定不成立', () => {
    expect(looksLikeBareJson('你好，我想做一个待办事项应用，请帮我生成。')).toBe(false);
  });

  it('短 JSON（低于阈值）判定不成立', () => {
    expect(looksLikeBareJson('{"a":1}')).toBe(false);
  });

  it('方括号开头的散文进度标记不误判为裸 JSON', () => {
    const marker = `[输出格式不符合要求，自动重试中（第 1/2 次）] ${'补充说明'.repeat(100)}`;
    expect(marker.length).toBeGreaterThan(BARE_JSON_LENGTH_THRESHOLD);
    expect(looksLikeBareJson(marker)).toBe(false);
  });

  it('阈值常量为正且与验收口径一致', () => {
    expect(BARE_JSON_LENGTH_THRESHOLD).toBeGreaterThan(0);
    const justOver = `{${'x'.repeat(BARE_JSON_LENGTH_THRESHOLD)}}`;
    expect(looksLikeBareJson(justOver)).toBe(true);
  });
});

describe('sanitizeEngineerChatContent（工程阶段原文出站安全化）', () => {
  it('可解析 files 载荷：交付摘要，不粘贴原始 JSON', () => {
    const raw = makeViolatingFilesJson('v1');
    const out = sanitizeEngineerChatContent(raw);
    expect(out).toContain('文件');
    expect(out).toContain('/index.html');
    expect(out).not.toContain(SENTINEL);
    expect(out).not.toContain('"files"');
    expect(isUnfencedBareJson(out)).toBe(false);
  });

  it('不可解析的大段 JSON：围栏 + 截断 + 简短说明', () => {
    const raw = `{"files": [{"path": "/index.html", "content": "${'x'.repeat(FENCED_PAYLOAD_MAX_CHARS + 5000)}`;
    const out = sanitizeEngineerChatContent(raw);
    expect(out.startsWith('说明：')).toBe(true);
    expect(out).toContain('```json');
    expect(out).toContain('已截断');
    // 截断生效：输出长度远小于原文
    expect(out.length).toBeLessThan(FENCED_PAYLOAD_MAX_CHARS + 200);
    // 出站后不再是未围栏裸 JSON（以说明文字开头）
    expect(isUnfencedBareJson(out)).toBe(false);
  });

  it('不可解析但未超长的 JSON：围栏 + 说明，不截断', () => {
    const raw = `${'{'.repeat(1)}"files": [{"path": "/a.html", "content": "${'y'.repeat(300)}"`;
    const out = sanitizeEngineerChatContent(raw);
    expect(out.startsWith('说明：')).toBe(true);
    expect(out).toContain('```json');
    expect(out).not.toContain('已截断');
  });

  it('对话文本原样放行', () => {
    const prose = '这是一个待办事项应用的说明文本，不包含任何代码结构。';
    expect(sanitizeEngineerChatContent(prose)).toBe(prose);
  });

  it('空输入原样返回', () => {
    expect(sanitizeEngineerChatContent('')).toBe('');
  });
});

describe('buildDeliverySummary（人话交付摘要）', () => {
  it('create 模式：说明文件数与清单，超量聚合', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/src/file${i}.jsx`);
    const out = buildDeliverySummary({
      mode: 'create',
      deliveredFilePaths: paths,
      retriesUsed: 0,
      strategySwitchRetries: 2,
    });
    expect(out).toContain('已生成完整项目');
    expect(out).toContain('共 12 个文件');
    expect(out).toContain('等 12 个文件');
    expect(out).not.toContain('重试');
  });

  it('create 模式：经历格式重试时如实说明次数', () => {
    const out = buildDeliverySummary({
      mode: 'create',
      deliveredFilePaths: ['/index.html'],
      retriesUsed: 1,
      strategySwitchRetries: 2,
    });
    expect(out).toContain('1 次自动重试');
    expect(out).not.toContain('完整重生成策略');
  });

  it('create 模式：达到策略切换次数时说明已切换策略', () => {
    const out = buildDeliverySummary({
      mode: 'create',
      deliveredFilePaths: ['/index.html'],
      retriesUsed: 2,
      strategySwitchRetries: 2,
    });
    expect(out).toContain('完整重生成策略');
  });

  it('diff 模式：说明应用处数与涉及文件', () => {
    const out = buildDeliverySummary({
      mode: 'diff',
      deliveredFilePaths: ['/index.html'],
      changedFilePaths: ['/index.html', '/src/App.jsx'],
      appliedEdits: 3,
      changeSummary: '修改标题文案',
      retriesUsed: 0,
      strategySwitchRetries: 2,
    });
    expect(out).toContain('已应用 3 处修改');
    expect(out).toContain('/index.html');
    expect(out).toContain('/src/App.jsx');
    expect(out).toContain('修改标题文案');
  });
});

// ── 管线集成：降级交付与策略切换路径 ──────────────────────────────────

describe('MAJOR-D1：降级交付/策略切换路径不再出站原始 JSON', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('M1RC3 复现路径：多次尝试均违规 → 降级交付，聊天区无裸 JSON，交付人话摘要', async () => {
    const { events, requestBodies } = await runCreateFlow({
      responses: [
        FEATURES_JSON,
        makeViolatingFilesJson('attempt1'),
        makeViolatingFilesJson('attempt2'),
        makeViolatingFilesJson('attempt3'),
        makeViolatingFilesJson('attempt4'),
        makeViolatingFilesJson('attempt5'),
        '审查通过',
      ],
    });

    // 管线行为不回归：无 error、诚实重试 >= 2 次
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(retryEvents(events).length).toBeGreaterThanOrEqual(2);
    expect(retryEvents(events)[0]!.payload.retry?.errorMessage).toBe('项目结构不完整');

    // 产物照常交付（降级不丢产物）
    const done = doneEvent(events);
    expect(done).toBeDefined();
    const donePayload = done!.payload as unknown as DonePayload;
    expect(donePayload.files?.['/index.html']?.content).toContain(SENTINEL);

    // 工程师阶段（generate 相位）聊天文本：人话摘要 + 既有诚实降级文案，
    // 不再是未围栏裸 JSON，也不含任何原始输出哨兵
    const generateText = joinedDeltaText(events, 'generate');
    expect(generateText).toContain('已生成完整项目');
    expect(generateText).toContain('/index.html');
    expect(generateText).not.toContain(SENTINEL);
    expect(isUnfencedBareJson(generateText)).toBe(false);

    // 全部 delta（含分析相位）均不得携带原始输出哨兵
    expect(joinedDeltaText(events)).not.toContain(SENTINEL);

    // 事件协议不变：仅使用既有事件类型
    const allowedTypes = new Set(['delta', 'stage', 'done', 'error', 'warning', 'retry', 'approval_required']);
    for (const e of events) expect(allowedTypes.has(e.type)).toBe(true);
  });

  it('策略切换后成功：切换事实如实入聊天，原始 JSON 不出站，产物正常交付', async () => {
    const { events } = await runCreateFlow({
      responses: [
        FEATURES_JSON,
        makeViolatingFilesJson('attempt1'),
        makeViolatingFilesJson('attempt2'),
        GOOD_FILES_JSON,
        '审查通过',
      ],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(retryEvents(events)).toHaveLength(2);

    const done = doneEvent(events);
    const donePayload = done!.payload as unknown as DonePayload;
    expect(donePayload.files?.['/src/App.jsx']?.content).toContain('个人书架');

    const generateText = joinedDeltaText(events, 'generate');
    expect(generateText).toContain('已生成完整项目');
    expect(generateText).toContain('重试');
    expect(generateText).not.toContain(SENTINEL);
    expect(generateText).not.toContain('unpkg.com');
    expect(isUnfencedBareJson(generateText)).toBe(false);
    expect(joinedDeltaText(events)).not.toContain(SENTINEL);
  });

  it('首试成功（回归）：交付摘要出现，产物与流式协议不回归', async () => {
    const { events } = await runCreateFlow({
      responses: [FEATURES_JSON, GOOD_FILES_JSON, '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(retryEvents(events)).toHaveLength(0);

    const done = doneEvent(events);
    const donePayload = done!.payload as unknown as DonePayload;
    expect(Object.keys(donePayload.files ?? {}).length).toBeGreaterThanOrEqual(2);

    const generateText = joinedDeltaText(events, 'generate');
    expect(generateText).toContain('已生成完整项目');
    expect(generateText).toContain('/index.html');
    expect(isUnfencedBareJson(generateText)).toBe(false);
  });
});
