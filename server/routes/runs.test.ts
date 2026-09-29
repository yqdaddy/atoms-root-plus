/**
 * 生成任务恢复（background runs）路由测试。
 *
 * 场景：
 * 1. 任务创建：/generate 创建 generations 任务行，SSE 首个事件携带 runId，
 *    approval_required 时任务 running + stage=waiting_approval（等待点标注）
 * 2. 断连继续执行：客户端取消 SSE 读取后，生成继续、经 /approve 走到 succeeded
 * 3. 恢复端点：/runs/active 查询 running 任务；/runs/:runId/events 按after 游标
 *    回放事件；succeeded 时回放 done 无重载荷、resultFiles 完整返回
 * 4. 取消：/cancel 按 runId 取消 → 任务行 cancelled，abort 引发的 error 事件
 *    不把状态改写为 failed；归属校验；旧 requestId 兼容
 * 5. 并发同项目：新 /generate 启动时旧 running 任务被取消（抢占语义）
 * 6. 服务器重启：遗留 running 任务被标记为 failed（"服务重启中断"）
 * 7. 录制器恢复：getOrCreateRecorder 从任务行恢复事件序列与 seq 游标；归属拒绝
 *
 * 隔离：顶层在动态 import 之前设置 ATOMS_DATA_DIR 指向临时目录，
 * db.ts 按该目录初始化 SQLite，绝不触碰真实 data/atoms.db。
 * 认证：走真实 authRouter 注册流程拿会话 cookie，requireAuth 全链路真实生效。
 * LLM：stub 全局 fetch 返回伪造 SSE 流，走真实 /generate → /approve 链路。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'atoms-runs-test-'));
process.env.ATOMS_DATA_DIR = tmpDataDir;
process.env.LLM_API_KEY = 'test-key';

// 环境变量就位后再加载被测模块（db.ts 在模块加载期打开数据库）
const { llmRouter } = await import('./llm.js');
const { authRouter } = await import('./auth.js');
const runsModule = await import('../runs.js');
const dbModule = await import('../db.js');

/* ---------------- 测试数据（与 llm.scaffoldWiring.test.ts 同款三段响应） ---------------- */

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

const REVIEW_PASS_TEXT = '审查通过';

/* ---------------- 工具函数 ---------------- */

/** 注册用户并返回会话令牌与用户 ID */
async function registerUser(username: string): Promise<{ token: string; userId: string }> {
  const res = await authRouter.request('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'test-password-123' }),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /atoms_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error('注册响应缺少会话 cookie');
  const body = (await res.json()) as { user: { id: string } };
  return { token: match[1], userId: body.user.id };
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Cookie: `atoms_session=${token}` };
}

function makeSSEResponse(fullContent: string): Response {
  const encoder = new TextEncoder();
  const sseLines = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: fullContent } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
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

/** 顺序响应的 fetch mock：三次调用分别命中 分析师 / 工程师 / 审查者 */
function makeSequentialFetch(): ReturnType<typeof vi.fn> {
  const responses = [FEATURES_JSON, HTML_FILES_JSON, REVIEW_PASS_TEXT];
  let callIndex = 0;
  return vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const content = responses[callIndex] ?? '';
    callIndex += 1;
    return makeSSEResponse(content);
  });
}

/** 永不完成的 fetch mock（模拟长时间无响应的上游），感知 abort 信号 */
function makeAbortAwareBlockingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const abortError = (): Error => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return error;
      };
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      // 正常路径永不 resolve
    });
  });
}

interface SSERecord {
  event: string;
  data: string;
}

/** 消费 SSE 响应流，解析为事件记录数组 */
async function consumeSSE(res: Response): Promise<SSERecord[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const records: SSERecord[] = [];
  const feed = (text: string) => {
    buffer += text.replaceAll('\r\n', '\n');
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const lines = block.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event:'));
      const dataLine = lines.find((l) => l.startsWith('data:'));
      records.push({
        event: eventLine ? eventLine.slice('event:'.length).trim() : '',
        data: dataLine ? dataLine.slice('data:'.length).trim() : '',
      });
      sep = buffer.indexOf('\n\n');
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
  feed(decoder.decode());
  return records;
}

/** 轮询等待条件成立（异步落库与生成完成均有延迟） */
async function waitFor(check: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function generateBody(projectId: string | null): Record<string, unknown> {
  return {
    prompt: '做一个科学计算器',
    options: {
      ...(projectId ? { projectId } : {}),
      intentOverride: 'create',
    },
  };
}

async function postJson(path: string, token: string, body: Record<string, unknown>): Promise<Response> {
  return await llmRouter.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: authHeaders(token),
  });
}

afterAll(() => {
  try {
    rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    // 尽力清理，失败不影响测试结论
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('生成任务恢复：认证', () => {
  it('未登录 → /generate、/runs/active、/runs/:runId/events 全部 401', async () => {
    const genRes = await llmRouter.request('/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: '做一个计算器' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(genRes.status).toBe(401);

    const activeRes = await llmRouter.request('/runs/active?projectId=p1', { method: 'GET' });
    expect(activeRes.status).toBe(401);

    const eventsRes = await llmRouter.request('/runs/some-run/events', { method: 'GET' });
    expect(eventsRes.status).toBe(401);
  });
});

describe('生成任务恢复：全流程（创建 / 等待点 / 恢复 / 完成）', () => {
  const alice = { token: '', userId: '' };
  const projectId = 'proj-recover-1';
  let runId = '';
  let approvalSessionId = '';

  it('前置：注册用户 alice', async () => {
    const session = await registerUser('runs_alice');
    alice.token = session.token;
    alice.userId = session.userId;
  });

  it('POST /generate：首个事件携带 runId，approval_required 关闭 SSE，任务行 running', async () => {
    vi.stubGlobal('fetch', makeSequentialFetch());
    const res = await postJson('/generate', alice.token, generateBody(projectId));
    expect(res.status).toBe(200);

    const records = await consumeSSE(res);
    const first = records[0];
    expect(first?.event).toBe('stage');
    const firstPayload = JSON.parse(first!.data) as { runId?: string; phase?: string };
    expect(typeof firstPayload.runId).toBe('string');
    runId = firstPayload.runId!;

    const approval = records.find((r) => r.event === 'approval_required');
    expect(approval).toBeDefined();
    const approvalPayload = JSON.parse(approval!.data) as { sessionId?: string; runId?: string };
    approvalSessionId = approvalPayload.sessionId!;
    expect(approvalSessionId).toBeTruthy();
    expect(approvalPayload.runId).toBe(runId);
  });

  it('任务行已创建且 running；/runs/active 返回等待点标注', async () => {
    const row = runsModule.getRunRow(runId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('running');
    expect(row!.userId).toBe(alice.userId);
    expect(row!.projectId).toBe(projectId);

    const activeRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    expect(activeRes.status).toBe(200);
    const body = (await activeRes.json()) as {
      run: { runId: string; status: string; stage: string; latestSeq: number } | null;
    };
    expect(body.run).not.toBeNull();
    expect(body.run!.runId).toBe(runId);
    expect(body.run!.status).toBe('running');
    expect(body.run!.stage).toBe('waiting_approval');
  });

  it('bob 查询 alice 的任务：active 为 null，events 为 404；批准他人会话 403', async () => {
    const bob = await registerUser('runs_bob');

    const activeRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(bob.token),
    });
    const activeBody = (await activeRes.json()) as { run: unknown };
    expect(activeBody.run).toBeNull();

    const eventsRes = await llmRouter.request(`/runs/${runId}/events`, {
      method: 'GET',
      headers: authHeaders(bob.token),
    });
    expect(eventsRes.status).toBe(404);

    const approveRes = await postJson('/approve', bob.token, { sessionId: approvalSessionId });
    expect(approveRes.status).toBe(403);
  });

  it('POST /approve：续写同一任务，done 后任务 succeeded 且 result_files 落库', async () => {
    vi.stubGlobal('fetch', makeSequentialFetch());
    const res = await postJson('/approve', alice.token, { sessionId: approvalSessionId });
    expect(res.status).toBe(200);

    const records = await consumeSSE(res);
    const done = records.find((r) => r.event === 'done');
    expect(done).toBeDefined();

    await waitFor(() => runsModule.getRunRow(runId)?.status === 'succeeded', '任务行进入 succeeded');

    const row = runsModule.getRunRow(runId);
    expect(row!.stage).toBe('done');
    expect(row!.resultFilesRaw).not.toBeNull();
    const stored = JSON.parse(row!.resultFilesRaw!) as Record<string, { path: string; content: string }>;
    expect(stored['/index.html']?.content).toContain('科学计算器');
  });

  it('GET /runs/:runId/events：回放关键事件，done 无重载荷，resultFiles 完整', async () => {
    const res = await llmRouter.request(`/runs/${runId}/events?after=0`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      status: string;
      stage: string;
      events: Array<{ seq: number; type: string; payload: Record<string, unknown> }>;
      resultFiles: Record<string, { path: string; content: string }> | null;
      error: string | null;
    };
    expect(body.runId).toBe(runId);
    expect(body.status).toBe('succeeded');
    expect(body.stage).toBe('done');
    expect(body.error).toBeNull();

    const types = body.events.map((e) => e.type);
    expect(types).toContain('stage');
    expect(types).toContain('approval_required');
    expect(types).toContain('done');

    // delta 细粒度文本合并为进度摘要（有内容、有界、带 summary 标记）
    const deltaSummaries = body.events.filter((e) => e.type === 'delta');
    expect(deltaSummaries.length).toBeGreaterThan(0);
    for (const d of deltaSummaries) {
      const text = d.payload.text;
      expect(typeof text).toBe('string');
      expect((text as string).length).toBeGreaterThan(0);
      expect((text as string).length).toBeLessThanOrEqual(600);
      expect(d.payload.summary).toBe(true);
    }

    // done 事件剥掉重载荷 files/html，完整结果走 resultFiles
    const done = body.events.find((e) => e.type === 'done');
    expect(done!.payload.files).toBeUndefined();
    expect(done!.payload.html).toBeUndefined();
    expect(body.resultFiles).not.toBeNull();
    expect(body.resultFiles!['/index.html']?.content).toContain('科学计算器');
  });

  it('after 游标：after=latestSeq 返回空事件，状态仍可见', async () => {
    const allRes = await llmRouter.request(`/runs/${runId}/events?after=0`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const all = (await allRes.json()) as { events: Array<{ seq: number }> };
    const latestSeq = all.events[all.events.length - 1]!.seq;

    const tailRes = await llmRouter.request(`/runs/${runId}/events?after=${latestSeq}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const tail = (await tailRes.json()) as { status: string; events: unknown[] };
    expect(tail.status).toBe('succeeded');
    expect(tail.events).toHaveLength(0);
  });

  it('终态未领取任务以 finishedUnclaimed 出现，ack 后不再出现', async () => {
    // 离开期间完成的任务（最常见恢复时序）：active 必须提供回放通道
    let activeRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    expect(activeRes.status).toBe(200);
    let body = (await activeRes.json()) as {
      run: { runId: string; status: string; finishedUnclaimed?: boolean; recentEventTypes?: string[] } | null;
    };
    expect(body.run).not.toBeNull();
    expect(body.run!.runId).toBe(runId);
    expect(body.run!.status).toBe('succeeded');
    expect(body.run!.finishedUnclaimed).toBe(true);
    expect(Array.isArray(body.run!.recentEventTypes)).toBe(true);

    // 领取（幂等）：重复 ack 仍返回 success
    const ackRes = await postJson(`/runs/${runId}/ack`, alice.token, {});
    expect(ackRes.status).toBe(200);
    const ackBody = (await ackRes.json()) as { success: boolean };
    expect(ackBody.success).toBe(true);
    const ackAgainRes = await postJson(`/runs/${runId}/ack`, alice.token, {});
    expect(((await ackAgainRes.json()) as { success: boolean }).success).toBe(true);

    activeRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    body = (await activeRes.json()) as { run: { runId: string; status: string; finishedUnclaimed?: boolean; recentEventTypes?: string[] } | null };
    expect(body.run).toBeNull();
  });
});

describe('生成任务恢复：断连继续执行', () => {
  const alice = { token: '', userId: '' };
  const projectId = 'proj-disconnect-1';

  it('前置：注册用户', async () => {
    const session = await registerUser('runs_disc_alice');
    alice.token = session.token;
    alice.userId = session.userId;
  });

  it('客户端取消 SSE 读取后，生成继续执行并可恢复完成', async () => {
    vi.stubGlobal('fetch', makeSequentialFetch());

    const res = await postJson('/generate', alice.token, generateBody(projectId));
    expect(res.status).toBe(200);

    // 模拟客户端断连：立即取消响应流读取（不消费任何事件）
    const reader = res.body!.getReader();
    await reader.cancel();

    // 断连只影响观察：任务仍在服务端推进，经 /runs/active 恢复入口找到任务
    await waitFor(() => {
      const view = runsModule.getActiveRunView(projectId, alice.userId);
      return view !== null && view.stage === 'waiting_approval';
    }, '任务推进到 waiting_approval');

    const view = runsModule.getActiveRunView(projectId, alice.userId);
    expect(view).not.toBeNull();
    const recoveredRunId = view!.runId;

    // 回放事件拿到 sessionId（断连期间产生的关键事件可恢复）
    const eventsRes = await llmRouter.request(`/runs/${recoveredRunId}/events?after=0`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const events = (await eventsRes.json()) as {
      events: Array<{ type: string; payload: { sessionId?: string } }>;
    };
    const approval = events.events.find((e) => e.type === 'approval_required');
    expect(approval).toBeDefined();
    const sessionId = approval!.payload.sessionId!;
    expect(sessionId).toBeTruthy();

    // 续跑至完成
    vi.stubGlobal('fetch', makeSequentialFetch());
    const approveRes = await postJson('/approve', alice.token, { sessionId });
    expect(approveRes.status).toBe(200);
    const approveRecords = await consumeSSE(approveRes);
    expect(approveRecords.some((r) => r.event === 'done')).toBe(true);

    await waitFor(() => runsModule.getRunRow(recoveredRunId)?.status === 'succeeded', '断连任务进入 succeeded');
  });
});

describe('生成任务恢复：取消', () => {
  const alice = { token: '', userId: '' };
  const projectId = 'proj-cancel-1';

  it('前置：注册用户', async () => {
    const session = await registerUser('runs_cancel_alice');
    alice.token = session.token;
    alice.userId = session.userId;
  });

  it('/cancel 按 runId 取消：任务行 cancelled，abort 的 error 事件不改写状态', async () => {
    vi.stubGlobal('fetch', makeAbortAwareBlockingFetch());

    const resPromise = postJson('/generate', alice.token, generateBody(projectId));
    const recordsPromise = resPromise.then((r) => consumeSSE(r));

    // 等待任务注册并可被恢复入口发现
    await waitFor(() => runsModule.getActiveRunView(projectId, alice.userId) !== null, '任务出现');
    const view = runsModule.getActiveRunView(projectId, alice.userId)!;
    const runId = view.runId;

    const cancelRes = await postJson('/cancel', alice.token, { runId });
    expect(cancelRes.status).toBe(200);
    const cancelBody = (await cancelRes.json()) as { success: boolean };
    expect(cancelBody.success).toBe(true);

    // 状态立即落库为 cancelled
    expect(runsModule.getRunRow(runId)!.status).toBe('cancelled');

    // 生成链路收到 abort：RC4-BUG-002 修复后取消不发终局 error 事件
    //（error 事件会把任务行污染为 failed），SSE 流凭泵的 isRunTerminal
    // 探测在录制器终态后收尾（recordsPromise 能 resolve 即流已关闭）
    const records = await recordsPromise;
    expect(records.find((r) => r.event === 'error')).toBeUndefined();

    // 关键不变量：取消后任务行保持 cancelled，不被迟到事件改写
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runsModule.getRunRow(runId)!.status).toBe('cancelled');
  });

  it('归属校验：bob 取消 alice 的任务 → 403；旧 requestId 未知 → success false', async () => {
    const bob = await registerUser('runs_cancel_bob');

    // alice 的任务行仍在（上一用例 cancelled 状态），runId 归属 alice
    const row = dbModule.db
      .prepare(`SELECT run_id FROM generations WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(alice.userId, projectId) as { run_id: string } | undefined;
    expect(row).toBeDefined();

    const forbidden = await postJson('/cancel', bob.token, { runId: row!.run_id });
    expect(forbidden.status).toBe(403);

    const legacy = await postJson('/cancel', alice.token, { requestId: 'no-such-request' });
    expect(legacy.status).toBe(200);
    const legacyBody = (await legacy.json()) as { success: boolean };
    expect(legacyBody.success).toBe(false);
  });
});

describe('生成任务恢复：并发同项目抢占', () => {
  const alice = { token: '', userId: '' };
  const projectId = 'proj-concurrent-1';

  it('前置：注册用户并手工种子一个 running 任务', async () => {
    const session = await registerUser('runs_conc_alice');
    alice.token = session.token;
    alice.userId = session.userId;
    runsModule.createRunRow({ runId: 'seed-running-old', projectId, userId: alice.userId, stage: 'generate' });
  });

  it('新 /generate 启动时旧 running 任务被取消，新任务正常运行', async () => {
    vi.stubGlobal('fetch', makeSequentialFetch());

    const res = await postJson('/generate', alice.token, generateBody(projectId));
    expect(res.status).toBe(200);
    const records = await consumeSSE(res);
    const first = records[0];
    const firstPayload = JSON.parse(first!.data) as { runId?: string };
    const newRunId = firstPayload.runId!;
    expect(newRunId).not.toBe('seed-running-old');

    // 旧任务被抢占标记 cancelled，新任务 running
    expect(runsModule.getRunRow('seed-running-old')!.status).toBe('cancelled');
    expect(runsModule.getRunRow(newRunId)!.status).toBe('running');

    // 新任务可继续走到完成（不留悬挂 running 任务）
    const approval = records.find((r) => r.event === 'approval_required');
    expect(approval).toBeDefined();
    const { sessionId } = JSON.parse(approval!.data) as { sessionId: string };

    vi.stubGlobal('fetch', makeSequentialFetch());
    const approveRes = await postJson('/approve', alice.token, { sessionId });
    await consumeSSE(approveRes);
    await waitFor(() => runsModule.getRunRow(newRunId)?.status === 'succeeded', '新任务 succeeded');
  });
});

describe('生成任务恢复：录制器恢复与归属', () => {
  const alice = { token: '', userId: '' };

  it('前置：注册用户并构造带历史事件的种子任务行', async () => {
    const session = await registerUser('runs_resume_alice');
    alice.token = session.token;
    alice.userId = session.userId;
    runsModule.createRunRow({ runId: 'seed-resume-1', projectId: null, userId: alice.userId });
    const seedEvents = [
      { seq: 1, type: 'stage', payload: { phase: 'analysis' }, at: new Date().toISOString() },
      { seq: 7, type: 'approval_required', payload: { sessionId: 's-1' }, at: new Date().toISOString() },
    ];
    dbModule.db.prepare(`UPDATE generations SET events = ? WHERE run_id = ?`).run(JSON.stringify(seedEvents), 'seed-resume-1');
  });

  it('bob 恢复他人任务 → RunAccessError（无活跃录制器时按行归属拒绝）', () => {
    expect(() => runsModule.getOrCreateRecorder({ runId: 'seed-resume-1', userId: 'not-alice' })).toThrow(
      runsModule.RunAccessError,
    );
  });

  it('resume 恢复事件历史与 seq 游标，新事件接续编号', () => {
    const recorder = runsModule.getOrCreateRecorder({ runId: 'seed-resume-1', userId: alice.userId });
    const before = recorder.snapshot();
    expect(before.latestSeq).toBe(7);
    expect(before.events).toHaveLength(2);

    recorder.record({ type: 'stage', payload: { phase: 'generate' } });
    const after = recorder.snapshot();
    expect(after.latestSeq).toBe(8);
    expect(after.events[after.events.length - 1]!.seq).toBe(8);

    // 收尾：进入终态，注销录制器（避免残留计时器与 running 状态）
    recorder.finish('failed', { error: '测试收尾' });
    expect(runsModule.getRunRow('seed-resume-1')!.status).toBe('failed');
  });
});

describe('生成任务恢复：终态结果领取（finishedUnclaimed / ack）', () => {
  const alice = { token: '', userId: '' };
  const projectId = 'proj-claim-1';

  it('前置：注册用户并种子未领取的 succeeded 与 failed 任务行', async () => {
    const session = await registerUser('runs_claim_alice');
    alice.token = session.token;
    alice.userId = session.userId;

    runsModule.createRunRow({ runId: 'seed-claim-ok', projectId, userId: alice.userId });
    runsModule.createRunRow({ runId: 'seed-claim-err', projectId, userId: alice.userId });

    // 终态 + 固定 updated_at（保证"最近终态"排序确定性）
    dbModule.db
      .prepare(`UPDATE generations SET status = 'succeeded', stage = 'done', result_files = ?, updated_at = ? WHERE run_id = ?`)
      .run(
        JSON.stringify({ '/index.html': { path: '/index.html', content: '<html>ok</html>', language: 'html', updatedAt: '2026-01-01T00:00:00.000Z' } }),
        '2026-01-01T00:00:01.000Z',
        'seed-claim-ok',
      );
    dbModule.db
      .prepare(`UPDATE generations SET status = 'failed', stage = 'error', error = 'LLM API 错误', updated_at = ? WHERE run_id = ?`)
      .run('2026-01-01T00:00:02.000Z', 'seed-claim-err');
  });

  it('无 running 时 active 返回最近的未领取终态任务，failed 的 error 经 events 取回', async () => {
    const activeRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const body = (await activeRes.json()) as {
      run: { runId: string; status: string; stage: string; finishedUnclaimed: boolean; recentEventTypes: string[] } | null;
    };
    expect(body.run).not.toBeNull();
    expect(body.run!.finishedUnclaimed).toBe(true);
    // 最近终态：err 行 updated_at 更晚
    expect(body.run!.runId).toBe('seed-claim-err');
    expect(body.run!.status).toBe('failed');

    // 回放通道：error 信息可取（重试入口所需）
    const eventsRes = await llmRouter.request('/runs/seed-claim-err/events?after=0', {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const events = (await eventsRes.json()) as { status: string; error: string | null; resultFiles: unknown };
    expect(events.status).toBe('failed');
    expect(events.error).toBe('LLM API 错误');
    expect(events.resultFiles).toBeNull();
  });

  it('ack 幂等领取后，active 回落到次新未领取终态任务', async () => {
    const ackRes = await postJson('/runs/seed-claim-err/ack', alice.token, {});
    expect(((await ackRes.json()) as { success: boolean }).success).toBe(true);

    const activeRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const body = (await activeRes.json()) as {
      run: { runId: string; status: string; finishedUnclaimed: boolean } | null;
    };
    expect(body.run).not.toBeNull();
    expect(body.run!.runId).toBe('seed-claim-ok');
    expect(body.run!.status).toBe('succeeded');
    expect(body.run!.finishedUnclaimed).toBe(true);
  });

  it('ack 归属校验：非属主 403、不存在 404', async () => {
    const bob = await registerUser('runs_claim_bob');

    const forbidden = await postJson('/runs/seed-claim-ok/ack', bob.token, {});
    expect(forbidden.status).toBe(403);

    const missing = await postJson('/runs/no-such-run/ack', alice.token, {});
    expect(missing.status).toBe(404);
  });

  it('全部领取后 active 回 null；running 优先于终态未领取；cancelled 也可被 ack', async () => {
    // 领取 succeeded 行 → 该项目无未领取
    await postJson('/runs/seed-claim-ok/ack', alice.token, {});
    const emptyRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    expect(((await emptyRes.json()) as { run: unknown }).run).toBeNull();

    // running 优先：seed 一个 running 行，active 返回 running 视图（无 finishedUnclaimed）
    runsModule.createRunRow({ runId: 'seed-claim-running', projectId, userId: alice.userId, stage: 'analysis' });
    const runningRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    const runningView = (await runningRes.json()) as {
      run: { status: string; finishedUnclaimed?: boolean } | null;
    };
    expect(runningView.run).not.toBeNull();
    expect(runningView.run!.status).toBe('running');
    expect(runningView.run!.finishedUnclaimed).toBeUndefined();

    // cancelled（用户主动取消的 running 行）可被 ack 清掉，但不会作为
    // finishedUnclaimed 推送（取消是用户在场时发生的）
    expect(runsModule.cancelRunTask('seed-claim-running')).toBe(true);
    const afterCancelRes = await llmRouter.request(`/runs/active?projectId=${projectId}`, {
      method: 'GET',
      headers: authHeaders(alice.token),
    });
    expect(((await afterCancelRes.json()) as { run: unknown }).run).toBeNull();
    const ackCancelled = await postJson('/runs/seed-claim-running/ack', alice.token, {});
    expect(((await ackCancelled.json()) as { success: boolean }).success).toBe(true);
  });
});

describe('生成任务恢复：服务器重启孤儿清理', () => {
  it('遗留 running 任务标记为 failed（服务重启中断），终态任务不受影响', () => {
    runsModule.createRunRow({ runId: 'seed-orphan-1', projectId: null, userId: 'orphan-user' });
    runsModule.createRunRow({ runId: 'seed-orphan-2', projectId: null, userId: 'orphan-user' });

    const changed = runsModule.markOrphanedRunsFailed('服务重启中断');
    expect(changed).toBeGreaterThanOrEqual(2);

    const orphan1 = runsModule.getRunRow('seed-orphan-1');
    expect(orphan1!.status).toBe('failed');
    expect(orphan1!.error).toBe('服务重启中断');
    const orphan2 = runsModule.getRunRow('seed-orphan-2');
    expect(orphan2!.status).toBe('failed');

    // 重复执行幂等：没有新的 running 行可清理
    expect(runsModule.markOrphanedRunsFailed('服务重启中断')).toBe(0);
  });
});
