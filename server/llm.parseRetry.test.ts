/**
 * server/llm.ts 解析失败重试放宽 + 文案动态化 + D-5 复审降级 测试
 *
 * 背景（用户报障）：界面显示"已自动重试 2 次仍未成功"，实际一次重试都没发生。
 * 根因：shouldRetry 判定过窄（仅"输出格式错误：期望包含 files 数组"一种消息
 * 可重试），截断/非法 JSON/文件级格式错误零重试直接终局，终局文案谎报重试次数。
 *
 * 用例：
 * a. 截断 JSON 首试 → 重试后成功交付（修复前：零重试直接 error）
 * b. 文件级格式错误（content 为数字）→ 重试后成功交付
 * c. diff 模式 edits.type 非法 → 带错误清单重试后成功交付
 * d. 混合失败（结构校验 + 解析失败）→ 预算封顶 3 次，retry 文案按来源区分
 * e. 终局文案与真实重试次数一致（零重试不得声称已重试）
 * f. D-5：复审调用网络失败 → 保留修复产物降级交付，无 error 事件
 * g. D-6：单轮收敛，结构化修复指令行级定位进修复请求
 * h. D-6：两轮收敛，复审 fail 携带新指令进入第 2 轮
 * i. D-6：两轮耗尽仍 fail → 降级交付（预算封顶表：总计 ≤9 次调用）
 * j. D-6：行级定位新旧格式兼容（旧字符串指令原样渲染）
 * k. D-6：修复自检字段存在性（selfCheck 声明未修复项出 warning，不阻塞交付）
 *
 * 验证方式：stub 全局 fetch 返回伪造 SSE 流，走真实
 * generateWithStages / runDirectModifyPipeline → continueAfterApproval 链路。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateWithStages,
  continueAfterApproval,
  runDirectModifyPipeline,
  buildFinalParseErrorMessage,
  parseSelfCheck,
  type LLMEvent,
} from './llm.js';
import type { IntentResult } from './intentClassifier.js';

const MODIFY_INTENT: IntentResult = { type: 'modify', confidence: 1, reasoning: '测试固定意图' };

const FEATURES_JSON = JSON.stringify({
  appTitle: '科学计算器',
  appType: 'tool',
  summary: '支持常用科学计算的计数器应用',
  features: [{ id: 'F1', name: '科学计算', description: '支持三角函数与幂运算', priority: 'must' }],
  interactions: ['点击数字键输入'],
  assumptions: [],
});

const HTML_FILES_JSON = JSON.stringify({
  files: [
    {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<head><title>科学计算器</title></head>\n<body><h1>科学计算器</h1></body>\n</html>',
      language: 'html',
    },
  ],
});

/** content 为数字（非法）：normalizeFile 拒绝 → "文件 0 格式错误" */
const NUM_CONTENT_JSON = JSON.stringify({
  files: [{ path: '/index.html', content: 12345, language: 'html' }],
});

/** 截断的 files JSON：index.html 的 content 字符串未闭合（模拟 max_tokens 截断）。
 *  含 CSS 花括号保证 looksLikeConversation 不误判为对话（有代码标记），
 *  字符串未闭合使括号配平失败、且首个文件未完成使截断抢救失败 → 必然重试 */
const TRUNCATED_JSON = '{"files": [{"path": "/index.html", "content": "<!DOCTYPE html><html><head><style>body { margin: 0; }</style></head><body><h1>计算器</h1>';

/** diff 模式测试项目 */
const TEST_FILES = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>',
    language: 'html' as const,
  },
};

/** 缺 type 字段的编辑（parseChangeList 抛"编辑 type 非法"） */
const BAD_CHANGES_JSON = JSON.stringify({
  changes: [
    {
      file: '/index.html',
      edits: [
        {
          line: 3,
          old: '<body><h1 id="title">标题</h1></body>',
          new: '<body><h1 id="title">新标题</h1></body>',
        },
      ],
    },
  ],
  summary: '修改标题文案',
});

/** 合法的 replace 编辑 */
const GOOD_CHANGES_JSON = JSON.stringify({
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
  summary: '修改标题文案',
});

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

/** 顺序 fetch mock：responses 项为 Error 时该次及之后所有调用持续抛错
 *  （模拟持续网络失败，供传输层重试耗尽），字符串项正常返回 SSE */
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
    // 找最近一次声明的响应项（Error 项持续生效）
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

function joinedDeltaText(events: LLMEvent[]): string {
  return events
    .filter((e) => e.type === 'delta')
    .map((e) => e.payload.text ?? '')
    .join('');
}

function retryEvents(events: LLMEvent[]): LLMEvent[] {
  return events.filter((e) => e.type === 'retry');
}

/** create 流程：分析师 → approval → 工程师阶段 */
async function runCreateFlow(options: {
  responses: (string | Error)[];
  framework?: 'html' | 'react-cdn';
}): Promise<{ events: LLMEvent[]; requestBodies: string[]; fetchMock: ReturnType<typeof vi.fn> }> {
  const { fetchMock, requestBodies } = makeSequentialFetch(options.responses);
  vi.stubGlobal('fetch', fetchMock);

  const stage1Events: LLMEvent[] = [];
  await generateWithStages({
    prompt: '做一个科学计算器',
    framework: options.framework ?? 'html',
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
  return { events, requestBodies, fetchMock };
}

/** diff 修改流程：单阶段直通；currentFiles 可注入自定义存量项目（D-9 用），prompt 可自定义（F4 用） */
async function runModifyFlow(
  responses: (string | Error)[],
  currentFiles?: Record<string, { path: string; content: string; language: 'html' | 'javascript' }>,
  prompt = '把标题改成新标题',
  framework?: 'html' | 'react-cdn',
): Promise<{
  events: LLMEvent[];
  requestBodies: string[];
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const { fetchMock, requestBodies } = makeSequentialFetch(responses);
  vi.stubGlobal('fetch', fetchMock);
  const events: LLMEvent[] = [];
  await runDirectModifyPipeline({
    prompt,
    currentFiles: currentFiles ?? TEST_FILES,
    intent: MODIFY_INTENT,
    framework,
    onEvent: (e) => events.push(e),
    signal: new AbortController().signal,
  });
  return { events, requestBodies, fetchMock };
}

describe('解析失败重试放宽（报障修复：不再零重试谎报）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('a. 截断 JSON 首试 → 重试后成功交付（修复前零重试直接 error）', async () => {
    const { events, fetchMock } = await runCreateFlow({
      responses: [FEATURES_JSON, TRUNCATED_JSON, HTML_FILES_JSON, '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师×2 + 审查者
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const retries = retryEvents(events);
    expect(retries).toHaveLength(1);
    expect(retries[0]!.payload.retry?.errorMessage).toBe('输出格式不符合要求');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']).toBeDefined();
    expect(done!.payload.files?.['/README.md']).toBeDefined();
  });

  it('b. 文件级格式错误（content 为数字）→ 重试请求带错误详情后成功交付', async () => {
    const { events, requestBodies, fetchMock } = await runCreateFlow({
      responses: [FEATURES_JSON, NUM_CONTENT_JSON, HTML_FILES_JSON, '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 重试请求（index 2）携带首次失败的错误详情
    expect(requestBodies[2]).toContain('文件 0 格式错误');

    const retries = retryEvents(events);
    expect(retries).toHaveLength(1);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']).toBeDefined();
  });

  it('e1. 终局文案纯函数：零重试不声称已重试，非零重试次数与真实一致', () => {
    const zero = buildFinalParseErrorMessage(0);
    expect(zero).toContain('未能解析为有效的项目文件');
    expect(zero).not.toContain('已自动重试');

    const twice = buildFinalParseErrorMessage(2);
    expect(twice).toContain('已自动重试 2 次');
  });

  it('e2. 三次全部解析失败 → error 文案声称的重试次数与 retry 事件数一致', async () => {
    const { events, fetchMock } = await runCreateFlow({
      // 5 次尝试都失败
      responses: [FEATURES_JSON, TRUNCATED_JSON, TRUNCATED_JSON, TRUNCATED_JSON, TRUNCATED_JSON, TRUNCATED_JSON],
    });

    // 分析师 + 工程师×5（MAX_PARSE_ATTEMPTS=5，无审查：error 提前返回）
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(retryEvents(events).length).toBeGreaterThanOrEqual(2);

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(error!.payload.message).toContain('已自动重试');
    expect(events.find((e) => e.type === 'done')).toBeUndefined();
  });
});

describe('diff 模式解析失败重试（edits.type 非法）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('c. edits.type 非法 → 带错误清单重试 → 第二次合法 changes 成功交付', async () => {
    const { events, requestBodies, fetchMock } = await runModifyFlow([
      BAD_CHANGES_JSON,
      GOOD_CHANGES_JSON,
    ]);

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 工程师×2（diff 模式跳过审查）
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 重试请求携带首次的解析错误详情
    expect(requestBodies[1]).toContain('type 非法');

    const retries = retryEvents(events);
    expect(retries).toHaveLength(1);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']?.content).toContain('新标题');
    expect(joinedDeltaText(events)).toContain('重试');
  });
});

describe('混合失败预算封顶与 retry 文案区分', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('d. 结构校验失败 + 解析失败混合 → 预算封顶 3 次，retry 文案按来源区分', async () => {
    // react 项目：第 1 次 import 断链（结构校验失败，P1 触发器）；
    // 第 2 次截断（解析失败）；第 3 次合法 → 审查通过 → 交付
    const reactApp = (brokenImport: boolean) => JSON.stringify({
      files: [
        { path: '/index.html', content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', language: 'html' },
        {
          path: '/src/main.jsx',
          content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(null);",
          language: 'javascript',
        },
        {
          path: '/src/App.jsx',
          content: brokenImport
            ? "import Badge from './components/Badge.jsx';\nfunction App() { return null; }\nexport default App;"
            : 'function App() { return null; }\nexport default App;',
          language: 'javascript',
        },
      ],
    });

    const { events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, reactApp(true), TRUNCATED_JSON, reactApp(false), '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师×3 + 审查者
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 两次 retry：第 1 次结构校验（文案区分），第 2 次解析失败（策略切换）
    const retries = retryEvents(events);
    expect(retries).toHaveLength(2);
    expect(retries[0]!.payload.retry?.errorMessage).toBe('项目结构不完整');
    expect(retries[1]!.payload.retry?.errorMessage).toBe('输出格式不符合要求');

    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('项目结构不完整');
    expect(deltaText).toContain('第 1/');
    expect(deltaText).toContain('输出格式不符合要求');
    expect(deltaText).toContain('第 2/');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/DESIGN.md']).toBeDefined();
  });
});

describe('D-5 复审网络失败降级', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('f. 复审调用持续网络失败 → 保留修复产物降级交付，无 error 事件', async () => {
    const brokenCalc = JSON.stringify({
      files: [
        { path: '/index.html', content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', language: 'html' },
        { path: '/src/main.jsx', content: 'const App = window.__components.App;', language: 'javascript' },
        { path: '/src/App.jsx', content: 'function App() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.App = App;', language: 'javascript' },
        { path: '/src/components/Calculator.jsx', content: 'function Calculator() { return null; }\nconst dangling = ;\nwindow.__components = window.__components || {};\nwindow.__components.Calculator = Calculator;', language: 'javascript' },
      ],
    });
    const fixedCalc = JSON.stringify({
      files: [
        { path: '/index.html', content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', language: 'html' },
        { path: '/src/main.jsx', content: 'const App = window.__components.App;', language: 'javascript' },
        { path: '/src/App.jsx', content: 'function App() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.App = App;', language: 'javascript' },
        { path: '/src/components/Calculator.jsx', content: 'function Calculator() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.Calculator = Calculator;', language: 'javascript' },
      ],
    });
    const reviewFail = JSON.stringify({
      pass: false,
      checks: [{ item: '脚本可执行', pass: false, note: 'Calculator.jsx 存在悬空 const' }],
      repairInstructions: ['修复 /src/components/Calculator.jsx 中第 10 行的悬空 const 声明'],
      missingFiles: [],
    });

    const { events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      // 分析师 → 工程师（缺陷） → 审查 fail → 修复成功 → 复审网络失败
      responses: [FEATURES_JSON, brokenCalc, reviewFail, fixedCalc, new Error('复审网络持续失败')],
    });

    // D-5 核心断言：无 error 事件（修复产物不丢失），done 正常交付
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // fetch 次数：4 次应用层调用（分析师/工程师/审查/修复）+ 复审至少 1 次；
    // 复审的持续网络失败会被传输层 withRetry 追加重试（至多 DEFAULT_MAX_RETRIES 次），
    // 故只断言下界，不与传输层重试常量耦合
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    // 修复产物保留（悬空 const 已移除）
    expect(done!.payload.files?.['/src/components/Calculator.jsx']?.content).not.toContain('dangling');

    // 降级提示走 warning + delta 通道
    const warnings = events.filter((e) => e.type === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    expect(joinedDeltaText(events)).toContain('按修复后版本交付');
  });
});

describe('D-6 多轮修复、行级定位与修复自检', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  /** react 计算器：broken=true 时 Calculator.jsx 含悬空 const（审查者可检出） */
  const calcProject = (broken: boolean, selfCheckNote?: string): string => {
    const calcBody = broken
      ? 'function Calculator() { return null; }\nconst dangling = ;\nwindow.__components = window.__components || {};\nwindow.__components.Calculator = Calculator;'
      : 'function Calculator() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.Calculator = Calculator;';
    const files = [
      { path: '/index.html', content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', language: 'html' },
      { path: '/src/main.jsx', content: 'const App = window.__components.App;', language: 'javascript' },
      { path: '/src/App.jsx', content: 'function App() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.App = App;', language: 'javascript' },
      { path: '/src/components/Calculator.jsx', content: calcBody, language: 'javascript' },
    ];
    // selfCheck 自检声明（D-6）：顶层字段，与 files 并列
    return JSON.stringify(
      selfCheckNote === undefined
        ? { files }
        : { files, selfCheck: JSON.parse(selfCheckNote) },
    );
  };

  /** 审查 fail：结构化修复指令（D-6 行级定位新格式） */
  const REVIEW_FAIL_STRUCT = JSON.stringify({
    pass: false,
    checks: [{ item: '脚本可执行', pass: false, note: 'Calculator.jsx 存在悬空 const' }],
    repairInstructions: [{ file: '/src/components/Calculator.jsx', line: 10, issue: '悬空 const 声明导致语法错误' }],
    missingFiles: [],
  });

  /** 审查 fail（第 2 轮）：指向另一文件的新缺陷 */
  const REVIEW_FAIL_STRUCT_R2 = JSON.stringify({
    pass: false,
    checks: [{ item: '交互真实', pass: false, note: 'App 缺少空状态' }],
    repairInstructions: [{ file: '/src/App.jsx', line: 3, issue: '缺少空状态展示' }],
    missingFiles: [],
  });

  /** 审查 fail：旧格式纯字符串指令（D-6 兼容） */
  const REVIEW_FAIL_LEGACY = JSON.stringify({
    pass: false,
    checks: [{ item: '脚本可执行', pass: false, note: 'Calculator.jsx 存在悬空 const' }],
    repairInstructions: ['修复 /src/components/Calculator.jsx 中第 10 行的悬空 const 声明'],
    missingFiles: [],
  });

  const REVIEW_PASS = JSON.stringify({
    pass: true,
    checks: [{ item: '结构完整', pass: true, note: '全部通过' }],
    repairInstructions: [],
    missingFiles: [],
  });

  it('g. 单轮收敛：结构化指令行级定位进修复请求，复审 pass 正常交付', async () => {
    const { events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, calcProject(true), REVIEW_FAIL_STRUCT, calcProject(false), REVIEW_PASS],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师 + 审查者 + 修复 + 复审 = 5 次（第 1 轮收敛）
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 修复请求（index 3）携带行级定位：文件 + 第 N 行 + 缺陷描述，且约定 selfCheck 输出
    expect(requestBodies[3]).toContain('/src/components/Calculator.jsx 第 10 行：悬空 const 声明导致语法错误');
    expect(requestBodies[3]).toContain('selfCheck');

    // 只进入第 1 轮（收敛即停），无降级提示
    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('第 1/2 轮');
    expect(deltaText).not.toContain('第 2/2 轮');
    expect(deltaText).not.toContain('仍未全部解决');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/src/components/Calculator.jsx']?.content).not.toContain('dangling');
  });

  it('h. 两轮收敛：复审 fail 携带新指令进入第 2 轮，第 2 轮复审 pass 交付', async () => {
    const { events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      // 分析师 → 工程师 → 审查 fail → 修复1 → 复审 fail(新缺陷) → 修复2 → 复审 pass
      responses: [
        FEATURES_JSON,
        calcProject(true),
        REVIEW_FAIL_STRUCT,
        calcProject(false),
        REVIEW_FAIL_STRUCT_R2,
        calcProject(false),
        REVIEW_PASS,
      ],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师 + 审查者 + 修复×2 + 复审×2 = 7 次
    expect(fetchMock).toHaveBeenCalledTimes(7);

    // 两轮 delta 都出现，且第 2 轮修复请求携带复审者的新缺陷定位
    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('第 1/2 轮');
    expect(deltaText).toContain('第 2/2 轮');
    expect(requestBodies[5]).toContain('/src/App.jsx 第 3 行：缺少空状态展示');

    // 收敛交付，无降级
    expect(deltaText).not.toContain('仍未全部解决');
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });

  it('i. 两轮耗尽仍 fail → 降级交付，无 error 事件，文案声明真实轮数', async () => {
    const { events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        calcProject(true),
        REVIEW_FAIL_STRUCT,
        calcProject(false),
        REVIEW_FAIL_STRUCT_R2,
        calcProject(false),
        REVIEW_FAIL_STRUCT_R2,
      ],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师 + 审查者 + 修复×2 + 复审×2 = 7 次（封顶，不追加第 3 轮）
    expect(fetchMock).toHaveBeenCalledTimes(7);

    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('2 轮后仍未全部解决');
    expect(deltaText).toContain('按现状交付');
    expect(deltaText).not.toContain('第 3');

    // 降级交付的是最后一轮修复产物（悬空 const 已移除），不是最初带伤产物
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/src/components/Calculator.jsx']?.content).not.toContain('dangling');
  });

  it('j. 行级定位新旧格式兼容：旧字符串指令原样渲染进修复请求', async () => {
    const { events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, calcProject(true), REVIEW_FAIL_LEGACY, calcProject(false), REVIEW_PASS],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 旧格式纯字符串：带序号原样渲染，不做文件/行号重组
    expect(requestBodies[3]).toContain('1. 修复 /src/components/Calculator.jsx 中第 10 行的悬空 const 声明');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });

  it('k. 修复自检字段存在性：parseSelfCheck 解析声明，未修复项出 warning 不阻塞交付', () => {
    // 纯函数：有 selfCheck 字段 → 结构化解析
    const withCheck = parseSelfCheck(JSON.stringify({
      files: [],
      selfCheck: { fixed: [1], unfixed: [2], summary: '部分修复' },
    }));
    expect(withCheck).toEqual({ fixed: [1], unfixed: [2], summary: '部分修复' });

    // 旧格式：无 selfCheck 字段 → null（容忍，不视为错误）
    expect(parseSelfCheck(JSON.stringify({ files: [] }))).toBeNull();
    // 非法 JSON → null
    expect(parseSelfCheck('不是 JSON')).toBeNull();
  });

  it('k2. 自检声明未修复项 → warning 事件如实告知，复审 pass 仍正常交付', async () => {
    const { events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [
        FEATURES_JSON,
        calcProject(true),
        REVIEW_FAIL_STRUCT,
        calcProject(false, JSON.stringify({ fixed: [], unfixed: [1], summary: '悬空 const 未能修复' })),
        REVIEW_PASS,
      ],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 自检未修复项走 warning 通道（覆盖面参考，非硬闸门）
    const warnings = events.filter((e) => e.type === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    const warnMessages = warnings.map((e) => e.payload.message ?? '').join('');
    expect(warnMessages).toContain('自检声明仍有 1 项缺陷未能修复');
    expect(warnMessages).toContain('悬空 const 未能修复');

    // 复审 pass 照常收敛交付，自检不阻塞 done
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });

  it('l. O-4 修复未应用：文案区分"未能应用"，不声称"仍未全部解决"', async () => {
    const { events, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      // 修复调用返回对话文本 → 输出不可解析 → repair-not-applied，不做复审
      responses: [FEATURES_JSON, calcProject(true), REVIEW_FAIL_STRUCT, '抱歉，我无法完成这次修复。', REVIEW_PASS],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师 + 审查者 + 修复（失败）= 4 次，修复未应用不做复审
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('自动修复未能应用');
    expect(deltaText).toContain('按现状交付');
    expect(deltaText).not.toContain('仍未全部解决');

    // 保留原产物降级交付（不吞 done）
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });
});

describe('D-9 CDN 扫描范围：diff/容错路径不误伤存量文件', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  /** 存量项目：index.html 干净（可被 GOOD_CHANGES_JSON 编辑），legacy.html 含 unpkg */
  const D9_FILES = {
    '/index.html': {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>',
      language: 'html' as const,
    },
    '/legacy.html': {
      path: '/legacy.html',
      content: '<!DOCTYPE html><html><head><script src="https://unpkg.com/old-lib.js"></script></head><body>old</body></html>',
      language: 'html' as const,
    },
  };

  /** 触碰文件自身含 unpkg（行结构兼容 GOOD_CHANGES_JSON 的第 3 行编辑） */
  const D9_TOUCHED_FILES = {
    '/index.html': {
      path: '/index.html',
      content: '<!DOCTYPE html>\n<html>\n<body><h1 id="title">标题</h1></body>\n</html>\n<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>',
      language: 'html' as const,
    },
  };

  it('m. 存量文件含 unpkg 但不在触碰集 → 不触发 CDN 重试，正常交付', async () => {
    const { events, fetchMock } = await runModifyFlow([GOOD_CHANGES_JSON], D9_FILES);

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 仅 1 次工程师调用：/legacy.html 的历史引用不进入扫描范围
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retryEvents(events)).toHaveLength(0);
    expect(joinedDeltaText(events)).not.toContain('结构问题');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']?.content).toContain('新标题');
  });

  it('n. 触碰文件含 unpkg → 报 E_CDN_DOMAIN 走重试，耗尽后降级交付', async () => {
    const { events, requestBodies, fetchMock } = await runModifyFlow(
      // 5 次尝试都含 unpkg
      [GOOD_CHANGES_JSON, GOOD_CHANGES_JSON, GOOD_CHANGES_JSON, GOOD_CHANGES_JSON, GOOD_CHANGES_JSON],
      D9_TOUCHED_FILES,
    );

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 预算封顶 5 次尝试：unpkg 持续存在 → 4 次 CDN 重试后降级
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
    const retries = retryEvents(events);
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(retries[0]!.payload.retry?.errorMessage).toBe('项目结构不完整');

    // 重试请求携带违规域名与改用 jsdelivr 指引
    expect(requestBodies[1]).toContain('unpkg.com');
    expect(requestBodies[1]).toContain('cdn.jsdelivr.net');

    // 耗尽降级：结构问题提示 + 按现状交付（不吞 done、无 error）
    const deltaText = joinedDeltaText(events);
    expect(deltaText).toContain('重试');
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
  });
});

describe('F2 诚实匹配（集成）：diff 编辑与现有内容不符时不盲改', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('o. 全部编辑 old 不匹配 → 不交付伪修改，转对话模式明示未应用', async () => {
    // 模型把历史摘要里的片段幻觉成现有内容写进 old（用户事故形态）
    const MISMATCH_CHANGES_JSON = JSON.stringify({
      changes: [
        {
          file: '/index.html',
          edits: [
            { line: 3, old: '历史摘要里幻觉出来的旧代码', new: '<body><h1>乱改后</h1></body>', type: 'replace' },
          ],
        },
      ],
      summary: '修改标题',
    });

    const { events, fetchMock } = await runModifyFlow([MISMATCH_CHANGES_JSON]);

    // 修复前：按行号盲改，files 里交付被幻觉 new 覆盖的"改得很乱"内容
    // 修复后：appliedCount 0 → 诚实转对话，无文件交付、无重试消耗
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(retryEvents(events)).toHaveLength(0);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.html).toBe('');
    expect(done!.payload.files).toEqual({});
    expect(done!.payload.analysis).toContain('1 处修改因与现有内容不符未应用');
    expect(done!.payload.analysis).toContain('修改标题');
  });

  it('p. 混合编辑部分应用 → 匹配的生效，跳过的出 warning 明示数量', async () => {
    const PARTIAL_CHANGES_JSON = JSON.stringify({
      changes: [
        {
          file: '/index.html',
          edits: [
            // 第 4 行实际是 </html>，模型幻觉为 </body> → 应跳过
            { line: 4, old: '</body>', new: '', type: 'replace' },
            // 第 3 行真实匹配 → 应应用
            { line: 3, old: '<body><h1 id="title">标题</h1></body>', new: '<body><h1 id="title">新标题</h1></body>', type: 'replace' },
          ],
        },
      ],
      summary: '修改标题并清理闭合标签',
    });

    const { events, fetchMock } = await runModifyFlow([PARTIAL_CHANGES_JSON]);

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 部分应用：匹配编辑生效
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']?.content).toContain('新标题');
    // 幻觉编辑未污染第 4 行
    expect(done!.payload.files?.['/index.html']?.content).toContain('</html>');

    // warning 明示跳过数量与位置
    const warnings = events.filter((e) => e.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.payload.message).toContain('1 处因与现有内容不符未应用');
    expect(warnings[0]!.payload.message).toContain('/index.html:4');
  });
});

describe('F1 E_INLINE_VOLUME（集成）：html 单文件超体量确定性打回重试', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('q. 160 行单文件无拆分 → 带拆分指引重试 → 拆分产物交付', async () => {
    // 真实事故样本形态：731 行单文件计算器（此处同形态缩样为 160 行过阈值）
    const OVERSIZED_HTML = JSON.stringify({
      files: [
        {
          path: '/index.html',
          content: [
            '<!DOCTYPE html>',
            ...Array.from({ length: 158 }, (_, i) => `<div class="row">${i}</div>`),
            '</html>',
          ].join('\n'),
          language: 'html',
        },
      ],
    });

    // 拆分产物：入口仅结构 + css/js 各自承载
    const SPLIT_FILES_JSON = JSON.stringify({
      files: [
        {
          path: '/index.html',
          content: '<!DOCTYPE html>\n<html>\n<head><link rel="stylesheet" href="/styles/main.css"></head>\n<body><div id="app"></div><script src="/src/main.js"></script></body>\n</html>',
          language: 'html',
        },
        { path: '/styles/main.css', content: '.row { padding: 4px; }', language: 'css' },
        { path: '/src/main.js', content: 'document.getElementById("app").textContent = "ok";', language: 'javascript' },
      ],
    });

    const { events, requestBodies, fetchMock } = await runCreateFlow({
      responses: [FEATURES_JSON, OVERSIZED_HTML, SPLIT_FILES_JSON, '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师×2 + 审查者
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 重试请求（index 2，分析师后第 2 次工程师调用）携带 E_INLINE_VOLUME 拆分指引
    expect(requestBodies[2]).toContain('单文件 160 行超过 150 行');
    expect(requestBodies[2]).toContain('/styles/main.css');
    expect(requestBodies[2]).toContain('/src/main.js');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']).toBeDefined();
    expect(done!.payload.files?.['/src/main.js']).toBeDefined();
    expect(done!.payload.files?.['/styles/main.css']).toBeDefined();
  });
});

describe('F3 防幻觉提示词约束（diff 模式事实来源）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('r. diff 请求系统提示与用户消息均含事实来源约束', async () => {
    const { requestBodies } = await runModifyFlow([GOOD_CHANGES_JSON]);

    const firstCall = JSON.parse(requestBodies[0]!) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemContent = firstCall.messages.find((m) => m.role === 'system')!.content;
    const userContent = firstCall.messages.find((m) => m.role === 'user')!.content;

    // 系统提示：事实来源约束块 + 不匹配即跳过的诚实语义
    expect(systemContent).toContain('唯一事实来源');
    expect(systemContent).toContain('禁止当作');
    expect(systemContent).toContain('不按行号盲改');
    // 自检清单含摘抄来源确认
    expect(systemContent).toContain('而非记忆、历史摘要或想象');
    // 用户消息：尾行强化
    expect(userContent).toContain('唯一事实依据');
    // 用户消息不含历史摘要（diff 模式纯接地，防幻觉源头隔离）
    expect(userContent).not.toContain('迭代摘要');
  });
});

describe('F4 多文件裁剪保底（字面路径强制附带 + 未附带清单注入）', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  it('s. 裁剪后未附带文件 → 请求注入未附带清单，入口与匹配文件照常附带', async () => {
    // 3 文件项目：标题在 index.html；format/chart 与需求无关，会被裁掉
    const files = {
      ...TEST_FILES,
      '/src/format.js': {
        path: '/src/format.js',
        content: 'function formatNumber(n) {\n  return String(n);\n}',
        language: 'javascript' as const,
      },
      '/src/chart.js': {
        path: '/src/chart.js',
        content: 'function drawChart(el) {\n  el.textContent = "chart";\n}',
        language: 'javascript' as const,
      },
    };

    const { events, requestBodies } = await runModifyFlow([GOOD_CHANGES_JSON], files);

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const userContent = (JSON.parse(requestBodies[0]!) as { messages: Array<{ role: string; content: string }> })
      .messages.find((m) => m.role === 'user')!.content;

    // 入口照常附带（带行号区块存在）
    expect(userContent).toContain('当前项目文件（带行号）');
    // 未附带清单注入：模型明确知道没看到哪些文件
    expect(userContent).toContain('未附带内容');
    expect(userContent).toContain('/src/format.js');
    expect(userContent).toContain('/src/chart.js');
    expect(userContent).toContain('禁止猜测或编造其内容');

    // 交付正常（GOOD_CHANGES_JSON 应用到 index.html）
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/index.html']?.content).toContain('新标题');
  });

  it('t. 用户字面提及的路径强制附带（关键词匹配漏掉也不裁掉）', async () => {
    // /src/a.js 无法被关键词匹配命中（src+js 两关键词摊薄后 0.333 < 0.35 阈值），
    // 但 prompt 字面包含该路径 → F4 强制附带
    const files = {
      '/index.html': TEST_FILES['/index.html']!,
      '/src/a.js': {
        path: '/src/a.js',
        content: 'const a = 1;',
        language: 'javascript' as const,
      },
      '/src/chart.js': {
        path: '/src/chart.js',
        content: 'function drawChart(el) {\n  el.textContent = "chart";\n}',
        language: 'javascript' as const,
      },
    };
    const CHANGES = JSON.stringify({
      changes: [
        {
          file: '/src/a.js',
          edits: [{ line: 1, old: 'const a = 1;', new: 'const a = 2;', type: 'replace' }],
        },
      ],
      summary: '补全常量',
    });

    const { events, requestBodies } = await runModifyFlow([CHANGES], files, '修改 /src/a.js：把内容补全');

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    const userContent = (JSON.parse(requestBodies[0]!) as { messages: Array<{ role: string; content: string }> })
      .messages.find((m) => m.role === 'user')!.content;

    // 字面提及的 /src/a.js 内容确实附带（修复前会被裁掉，模型只能编造）
    expect(userContent).toContain('const a = 1;');
    // 无关文件照旧进未附带清单
    expect(userContent).toContain('/src/chart.js');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/src/a.js']?.content).toContain('const a = 2;');
  });
});

describe('P1 真实 import 切换（集成）：E_NO_BARE_IMPORT 退役与 E_IMPORT_MISSING 重试', () => {
  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LLM_API_KEY;
  });

  /** react-cdn 工程师产出（withImport 控制是否真实 import） */
  const reactApp = (withImport: boolean) => JSON.stringify({
    files: [
      { path: '/index.html', content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', language: 'html' },
      {
        path: '/src/main.jsx',
        content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(null);",
        language: 'javascript',
      },
      {
        path: '/src/App.jsx',
        content: withImport
          ? "import { useState } from 'react';\nfunction App() { return null; }\nexport default App;"
          : 'function App() { return null; }',
        language: 'javascript',
      },
    ],
  });

  it('u. react-cdn 含真实 import 的文件不再被打回（E_NO_BARE_IMPORT 已退役，一次通过）', async () => {
    const { events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, reactApp(true), '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 无重试：分析师 + 工程师 + 审查者 = 3 次调用
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(retryEvents(events)).toHaveLength(0);
    // import 语句原样交付（不要求全局挂载改写）
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done!.payload.files?.['/src/App.jsx']?.content).toContain("from 'react'");
    // 平台注入的 package.json 含 react 依赖（E_PKG_DEPS 声明一致）
    expect(done!.payload.files?.['/package.json']?.content).toContain('react-dom');
    // 请求体不再出现 E_NO_BARE_IMPORT 指引
    expect(requestBodies.join('\n')).not.toContain('import/export 语句');
  });

  it('v. import 断链（E_IMPORT_MISSING）→ 带 hint 重试一次 → 修复后交付', async () => {
    const dangling = JSON.stringify({
      files: [
        { path: '/index.html', content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>', language: 'html' },
        {
          path: '/src/main.jsx',
          content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(null);",
          language: 'javascript',
        },
        {
          path: '/src/App.jsx',
          content: "import Badge from './components/Badge.jsx';\nfunction App() { return null; }\nexport default App;",
          language: 'javascript',
        },
      ],
    });

    const { events, requestBodies, fetchMock } = await runCreateFlow({
      framework: 'react-cdn',
      responses: [FEATURES_JSON, dangling, reactApp(false), '审查通过'],
    });

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // 分析师 + 工程师（断链打回）+ 工程师重试 + 审查者 = 4 次调用
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(retryEvents(events)).toHaveLength(1);

    // 重试请求（index 2）携带 E_IMPORT_MISSING 错误清单与拼写指引
    expect(requestBodies[2]).toContain('import 的本地模块');
    expect(requestBodies[2]).toContain('./components/Badge.jsx');
    expect(requestBodies[2]).toContain('完全一致');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    // 重试产物无悬空 import，正常交付
    expect(done!.payload.files?.['/src/App.jsx']?.content).not.toContain('./components/Badge.jsx');
  });

  it('w. diff delete 后悬空 import → E_IMPORT_MISSING 拦截 → 重试清理引用后交付', async () => {
    const reactFiles = {
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
        language: 'html' as const,
      },
      '/src/main.jsx': {
        path: '/src/main.jsx',
        content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(null);",
        language: 'javascript' as const,
      },
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content: "import Counter from './components/Counter.jsx';\nfunction App() { return null; }\nexport default App;",
        language: 'javascript' as const,
      },
      '/src/components/Counter.jsx': {
        path: '/src/components/Counter.jsx',
        content: 'export default function Counter() { return null; }',
        language: 'javascript' as const,
      },
    };
    // 第一轮：只删 Counter.jsx（悬空引用未清理）→ 校验打回
    const deleteOnly = JSON.stringify({
      changes: [{ file: '/src/components/Counter.jsx', action: 'delete' }],
      summary: '删除 Counter 组件',
    });
    // 第二轮：对同一 merge base 重新输出完整修正清单（删除 + 清理引用，行 1 整行删除）
    const deleteWithCleanup = JSON.stringify({
      changes: [
        { file: '/src/components/Counter.jsx', action: 'delete' },
        {
          file: '/src/App.jsx',
          edits: [
            {
              line: 1,
              old: "import Counter from './components/Counter.jsx';",
              new: '',
              type: 'delete',
            },
          ],
        },
      ],
      summary: '删除 Counter 并清理引用',
    });

    const { events, requestBodies, fetchMock } = await runModifyFlow(
      [deleteOnly, deleteWithCleanup],
      reactFiles,
      '删除 Counter 组件',
      'react-cdn',
    );

    expect(events.find((e) => e.type === 'error')).toBeUndefined();
    // diff/modify 跳过 LLM 审查（§5.1）：工程师 + 工程师重试 = 2 次调用
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryEvents(events)).toHaveLength(1);

    // 重试请求携带悬空 import 的错误清单（含被删文件路径与拼写指引）
    expect(requestBodies[1]).toContain('import 的本地模块');
    expect(requestBodies[1]).toContain('./components/Counter.jsx');

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    // 被删文件不在交付集合中，悬空 import 已清理
    expect(done!.payload.files?.['/src/components/Counter.jsx']).toBeUndefined();
    expect(done!.payload.files?.['/src/App.jsx']?.content).not.toContain('Counter.jsx');
  });
});
