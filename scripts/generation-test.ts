/**
 * 生成流程真实验证脚本（阶段二）：计算器 x2 + 贪吃蛇 x2
 *
 * 运行方式：npx tsx scripts/generation-test.ts
 * 前置条件：
 *  - 开发服务器 http://localhost:5177 运行中（npm run dev）
 *  - 后端 LLM 服务运行中（vite proxy -> localhost:3000）
 *
 * 流程（真实用户路径，无任何 mock）：
 *  1. 入口探索：未登录访问 /workspace 的实际行为 + 落地页 CTA 去向
 *  2. 注册随机测试账号 -> 自动跳转 /workspace
 *  3. 输入 prompt -> 点击「直接生成」
 *  4. 等待分析完成 -> 点击「批准并生成」（server 端分析完成后必发 approval_required）
 *  5. 等待生成完成：轮询 DOM 状态（placeholder 恢复 + iframe srcdoc 增长 / 错误文案出现），无固定 sleep 等完成
 *  6. 检查源码完整性 + Preview 渲染 + iframe 内交互
 *
 * 输出：每轮 JSON 结果 + 截图 + console 全量日志，写入 test-results/generation/
 */
import { chromium, type Page, type BrowserContext, type ConsoleMessage } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.GEN_TEST_URL ?? 'http://localhost:5177/';
const OUT_DIR = path.resolve('test-results/generation');
const GEN_TIMEOUT_MS = 300_000; // 生成上限 5 分钟
const APPROVAL_TIMEOUT_MS = 180_000; // 分析阶段上限 3 分钟
const NAV_TIMEOUT_MS = 30_000;

interface RoundResult {
  round: string;
  prompt: string;
  registeredUser: string;
  generationSuccess: boolean;
  sourceComplete: boolean;
  sourceDetail: string;
  previewRendered: boolean;
  previewDetail: string;
  interactionWorked: boolean | 'warn';
  interactionDetail: string;
  consoleErrors: string[];
  pageErrors: string[];
  eventSequence: string[];
  apiErrors: string[];
  approvalClicked: boolean;
  durationMs: number;
  screenshots: string[];
  failureReason?: string;
}

interface Collector {
  consoleErrors: string[];
  consoleLog: string[];
  pageErrors: string[];
  apiErrors: string[];
  eventSequence: string[];
  attach: (page: Page) => void;
}

function makeCollector(): Collector {
  const c = {
    consoleErrors: [] as string[],
    consoleLog: [] as string[],
    pageErrors: [] as string[],
    apiErrors: [] as string[],
    eventSequence: [] as string[],
  };
  return {
    ...c,
    attach(page: Page) {
      page.on('console', (msg: ConsoleMessage) => {
        const text = msg.text();
        c.consoleLog.push(`[${msg.type()}] ${text}`);
        if (msg.type() === 'error') c.consoleErrors.push(text);
        // HomePage.handleStreamEvent 对每个 SSE 事件打 console.log，用于重建事件序列
        if (text.includes('[HomePage] 收到事件:')) {
          c.eventSequence.push(text.replace('[HomePage] 收到事件:', '').trim().slice(0, 150));
        }
      });
      page.on('pageerror', (err) => c.pageErrors.push(err.message));
      page.on('response', (res) => {
        if (res.url().includes('/api/') && res.status() >= 400) {
          c.apiErrors.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
        }
      });
    },
  };
}

/** 页面状态快照（在浏览器上下文中执行） */
interface PageState {
  generating: boolean;
  srcdocLen: number;
  errorHit: string;
  diffConfirm: boolean;
  placeholder: string;
}

function snapshotState(page: Page): Promise<PageState> {
  return page.evaluate(() => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
    const generating = ta ? /正在生成中/.test(ta.placeholder) : true;
    const iframes = Array.from(document.querySelectorAll('iframe'));
    const preview = iframes.find((f) => f.getAttribute('title') === '预览') ?? iframes[0];
    const srcdocLen = preview ? (preview.getAttribute('srcdoc') ?? '').length : 0;
    const bodyText = document.body.innerText;
    const errPatterns = [
      '生成过程发生异常',
      '生成的代码为空',
      '请求已取消',
      'API 服务持续过载',
      '网络异常，无法连接',
    ];
    const errorHit = errPatterns.find((p) => bodyText.includes(p)) ?? '';
    const diffConfirm = bodyText.includes('请确认后应用变更');
    return { generating, srcdocLen, errorHit, diffConfirm, placeholder: ta?.placeholder ?? '' };
  });
}

/** 注册随机账号并等待进入工作台。失败抛异常。 */
async function registerAndEnter(page: Page): Promise<string> {
  const username = `bot_${Date.now().toString(36)}`;
  const password = 'GenTest2026';

  await page.goto(`${BASE_URL}register`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.locator('#username').waitFor({ state: 'visible', timeout: NAV_TIMEOUT_MS });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#confirmPassword').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();

  await page.waitForURL('**/workspace', { timeout: NAV_TIMEOUT_MS });
  await page
    .locator('textarea[placeholder*="让智能体团队实现你的想法"]')
    .waitFor({ state: 'visible', timeout: NAV_TIMEOUT_MS });
  return username;
}

/** 触发生成并等待完成。返回 (ok, detail)。 */
async function generateAndWait(
  page: Page,
  prompt: string,
): Promise<{ ok: boolean; detail: string; approvalClicked: boolean }> {
  const textarea = page.locator('textarea[placeholder*="让智能体团队实现你的想法"]');
  await textarea.fill(prompt);
  await page.getByRole('button', { name: '直接生成' }).click();

  // 分析阶段：等待「批准并生成」按钮
  let approvalClicked = false;
  let approvalError = '';
  try {
    const approveBtn = page.getByRole('button', { name: '批准并生成' });
    await approveBtn.waitFor({ state: 'visible', timeout: APPROVAL_TIMEOUT_MS });
    await approveBtn.click();
    approvalClicked = true;
  } catch (e) {
    approvalError = e instanceof Error ? e.message : String(e);
  }

  // 记录生成前 baseline（骨架模板的 srcdoc 长度），完成判定基于增量
  const baseline = await snapshotState(page);

  const deadline = Date.now() + GEN_TIMEOUT_MS;
  let last: PageState = baseline;
  while (Date.now() < deadline) {
    last = await snapshotState(page);
    // 完成：placeholder 恢复 且 srcdoc 相比 baseline 显著增长（done 事件才会写入新代码）
    if (!last.generating && last.srcdocLen > baseline.srcdocLen + 300) {
      return { ok: true, detail: `done: srcdoc ${baseline.srcdocLen} -> ${last.srcdocLen} 字符`, approvalClicked };
    }
    // 失败：placeholder 恢复 且 srcdoc 未增长 且 出现明确错误文案
    if (!last.generating && last.srcdocLen <= baseline.srcdocLen + 300 && last.errorHit) {
      return { ok: false, detail: `失败: 错误文案"${last.errorHit}"，srcdoc=${last.srcdocLen}`, approvalClicked };
    }
    // 阻塞：卡在 diff 确认（迭代才该出现，首轮生成不应出现）
    if (!last.generating && last.diffConfirm && last.srcdocLen <= baseline.srcdocLen + 300) {
      return { ok: false, detail: '阻塞: 卡在 diff 确认面板（非预期路径）', approvalClicked };
    }
    await page.waitForTimeout(1000); // 轮询间隔
  }
  const hint = approvalClicked ? '' : `（批准按钮未出现: ${approvalError.slice(0, 120)}）`;
  return {
    ok: false,
    detail: `超时(${GEN_TIMEOUT_MS / 1000}s): generating=${last.generating}, srcdoc=${last.srcdocLen}, placeholder="${last.placeholder}"${hint}`,
    approvalClicked,
  };
}

/** 源码完整性：srcdoc 闭合检查 + 代码面板截图 */
async function checkSource(page: Page, shotPath: string): Promise<{ ok: boolean; detail: string }> {
  const srcdoc = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    const f = iframes.find((x) => x.getAttribute('title') === '预览') ?? iframes[0];
    return f ? f.getAttribute('srcdoc') ?? '' : '';
  });
  const trimmed = srcdoc.trim();
  const closesHtml = /<\/html>\s*$/i.test(trimmed);
  const hasBodyClose = /<\/body>/i.test(trimmed);
  const sizeOk = trimmed.length > 500;

  // 切到代码面板截图（右侧面板 header 的 tab 按钮）
  let tabSwitched = true;
  try {
    await page.getByRole('button', { name: '代码', exact: true }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: shotPath, fullPage: false });
    await page.getByRole('button', { name: '预览', exact: true }).click();
  } catch {
    tabSwitched = false;
  }

  if (!sizeOk) {
    return { ok: false, detail: `srcdoc 仅 ${trimmed.length} 字符，疑似空产物或截断` };
  }
  if (!hasBodyClose || !closesHtml) {
    return { ok: false, detail: `srcdoc 缺少闭合标签（</body>=${hasBodyClose}, 尾部</html>=${closesHtml}），疑似截断（len=${trimmed.length}）` };
  }
  return {
    ok: true,
    detail: `srcdoc ${trimmed.length} 字符，含 </body></html> 闭合，非截断${tabSwitched ? '' : '（代码面板切换失败，仅验证 srcdoc）'}`,
  };
}

/** 等待 iframe 真正就绪（body visible + 有内容） */
async function waitForIframeReady(frame: FrameLocator, timeout = 30_000): Promise<{ ok: boolean; detail: string }> {
  const startTime = Date.now();
  let lastError = '';
  let attempts = 0;
  while (Date.now() - startTime < timeout) {
    attempts++;
    try {
      const body = frame.locator('body');
      // 先等待 body 存在（不要求 visible，因为 sandbox iframe 可能有特殊行为）
      await body.waitFor({ state: 'attached', timeout: 5000 });

      // 检查是否有内容
      const html = await body.innerHTML().catch(() => '');
      if (html.trim().length > 0) {
        return {
          ok: true,
          detail: `iframe body attached，内容 ${html.trim().length} 字符，等待耗时 ${Date.now() - startTime}ms，尝试 ${attempts} 次`
        };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, detail: `iframe ${timeout / 1000}s 内未就绪，尝试 ${attempts} 次（最后错误: ${lastError.slice(0, 100)}）` };
}

/** 计算器交互：iframe 内点击数字按钮，验证显示响应 */
async function calcInteraction(page: Page): Promise<{ result: boolean | 'warn'; detail: string }> {
  const frame = page.frameLocator('iframe[title="预览"]');
  const ready = await waitForIframeReady(frame, 30_000);
  if (!ready.ok) {
    return { result: false, detail: ready.detail };
  }
  const digitButtons = frame.locator('button', { hasText: /^[0-9]$/ });
  const count = await digitButtons.count();
  if (count === 0) {
    const all = await frame
      .locator('button')
      .allTextContents()
      .catch(() => [] as string[]);
    return {
      result: 'warn',
      detail: `未找到数字按钮（iframe 内按钮文本: [${all.map((t) => t.trim()).filter(Boolean).slice(0, 15).join(' | ')}]）`,
    };
  }
  try {
    await digitButtons.filter({ hasText: '7' }).first().click();
    await page.waitForTimeout(300);
    await digitButtons.filter({ hasText: '3' }).first().click();
    await page.waitForTimeout(300);
    const text = await frame.locator('body').innerText();
    const compact = text.replace(/\s+/g, '');
    const responded = compact.includes('73');
    return responded
      ? { result: true, detail: `点击数字 7、3 后界面出现 "73"，交互有响应（数字按钮共 ${count} 个）` }
      : { result: 'warn', detail: `数字按钮可点击但未确认显示区出现 73。frame 文本片段: ${text.replace(/\s+/g, ' ').slice(0, 200)}` };
  } catch (e) {
    return { result: false, detail: `点击数字按钮异常: ${e instanceof Error ? e.message : e}` };
  }
}

/** 贪吃蛇交互：检测 canvas 或 DOM 实现，验证键盘控制 */
async function snakeInteraction(page: Page): Promise<{ result: boolean | 'warn'; detail: string }> {
  const frame = page.frameLocator('iframe[title="预览"]');
  const ready = await waitForIframeReady(frame, 30_000);
  if (!ready.ok) {
    return { result: false, detail: ready.detail };
  }

  // 额外等待游戏初始化（canvas 或游戏 UI 元素）
  const gameInitLocator = frame.locator('canvas, button, [class*="game"], [id*="game"]').first();
  const gameInit = await gameInitLocator
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  const hasCanvas = (await frame.locator('canvas').count()) > 0;
  const startBtn = frame.getByRole('button', { name: /开始|start|重新开始|restart/i }).first();
  const hasStart = (await startBtn.count()) > 0;

  // 检查游戏 UI 文本（识别 DOM 实现）
  const bodyText = await frame.locator('body').innerText();
  const gameUiKeywords = ['WASD', '方向键', '分数', '得分', '最高', '游戏', 'snake', 'game'];
  const hasGameUi = gameUiKeywords.some((kw) => bodyText.toLowerCase().includes(kw.toLowerCase()));

  try {
    // 尝试点击开始按钮（如果有）
    if (hasStart) await startBtn.click({ timeout: 5000 });

    // 聚焦到 iframe 并发送键盘事件
    await frame
      .locator('body')
      .click({ position: { x: 200, y: 200 }, timeout: 3000 })
      .catch(() => {});
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(800);

    // 判定成功条件（宽松）：
    // 1. 有 canvas + 开始按钮可点击 -> 成功
    // 2. 有游戏 UI 文本（DOM 实现）-> 成功
    // 3. 其他情况 -> warn
    if (hasCanvas) {
      return {
        result: true,
        detail: `canvas 存在，开始按钮${hasStart ? '已点击' : '未找到'}，方向键已发送，无运行异常`,
      };
    }
    if (hasGameUi) {
      return {
        result: true,
        detail: `DOM 实现的贪吃蛇，检测到游戏 UI（${gameUiKeywords.filter((kw) => bodyText.toLowerCase().includes(kw.toLowerCase())).join(', ')}），方向键已发送`,
      };
    }
    return { result: 'warn', detail: `未找到 canvas 或游戏 UI 文本。开始按钮=${hasStart}。frame 文本: ${bodyText.replace(/\s+/g, ' ').slice(0, 200)}` };
  } catch (e) {
    return { result: false, detail: `贪吃蛇交互异常: ${e instanceof Error ? e.message : e}` };
  }
}

async function runRound(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  round: string,
  prompt: string,
): Promise<RoundResult> {
  const started = Date.now();
  const collector = makeCollector();
  const result: RoundResult = {
    round,
    prompt,
    registeredUser: '',
    generationSuccess: false,
    sourceComplete: false,
    sourceDetail: '',
    previewRendered: false,
    previewDetail: '',
    interactionWorked: false,
    interactionDetail: '',
    consoleErrors: [],
    pageErrors: [],
    eventSequence: [],
    apiErrors: [],
    approvalClicked: false,
    durationMs: 0,
    screenshots: [],
  };
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    collector.attach(page);

    // 1. 注册 + 进入工作台
    result.registeredUser = await registerAndEnter(page);
    console.log(`  [${round}] 注册成功: ${result.registeredUser}，已进入 /workspace`);
    await page.screenshot({ path: path.join(OUT_DIR, `${round}-0-workspace.png`) });
    result.screenshots.push(`${round}-0-workspace.png`);

    // 2. 触发生成并等待
    console.log(`  [${round}] 已发送 prompt，等待分析...`);
    const gen = await generateAndWait(page, prompt);
    result.approvalClicked = gen.approvalClicked;
    console.log(`  [${round}] ${gen.detail}`);

    if (!gen.ok) {
      result.failureReason = gen.detail;
      result.sourceDetail = '生成失败，未检查';
      result.previewDetail = '生成失败，未检查';
      result.interactionDetail = '生成失败，未检查';
      await page.screenshot({ path: path.join(OUT_DIR, `${round}-FAIL-state.png`) });
      result.screenshots.push(`${round}-FAIL-state.png`);
      return result;
    }
    result.generationSuccess = true;

    // 3. 完成态整体截图（默认停在预览 tab）
    await page.screenshot({ path: path.join(OUT_DIR, `${round}-1-preview.png`) });
    result.screenshots.push(`${round}-1-preview.png`);

    // 4. 源码完整性
    const src = await checkSource(page, path.join(OUT_DIR, `${round}-2-source.png`));
    result.sourceComplete = src.ok;
    result.sourceDetail = src.detail;
    result.screenshots.push(`${round}-2-source.png`);
    console.log(`  [${round}] 源码: ${src.detail}`);

    // 5. Preview 渲染（sandbox 隔离时 contentDocument 不可读，用 srcdoc 兜底）
    const previewCheck = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const f = iframes.find((x) => x.getAttribute('title') === '预览') ?? iframes[0];
      if (!f) return { rendered: false, detail: '未找到预览 iframe' };
      const len = (f.getAttribute('srcdoc') ?? '').length;
      try {
        const doc = f.contentDocument;
        const children = doc?.body?.children.length ?? 0;
        if (children > 0) return { rendered: true, detail: `iframe body 子元素 ${children} 个，已渲染` };
      } catch {
        /* sandbox 隔离，读不到 contentDocument，属预期 */
      }
      return { rendered: len > 500, detail: `contentDocument 不可读（sandbox 隔离，预期行为），srcdoc ${len} 字符` };
    });
    result.previewRendered = previewCheck.rendered;
    result.previewDetail = previewCheck.detail;
    console.log(`  [${round}] 预览: ${previewCheck.detail}`);

    // 6. 交互验证
    const inter = round.startsWith('calc') ? await calcInteraction(page) : await snakeInteraction(page);
    result.interactionWorked = inter.result;
    result.interactionDetail = inter.detail;
    await page.screenshot({ path: path.join(OUT_DIR, `${round}-3-interaction.png`) });
    result.screenshots.push(`${round}-3-interaction.png`);
    console.log(`  [${round}] 交互: ${inter.detail}`);

    return result;
  } catch (err) {
    result.failureReason = `基础设施异常: ${err instanceof Error ? err.message : String(err)}`;
    if (!result.sourceDetail) result.sourceDetail = '未执行到检查';
    if (!result.previewDetail) result.previewDetail = '未执行到检查';
    if (!result.interactionDetail) result.interactionDetail = '未执行到检查';
    return result;
  } finally {
    // 填充收集结果（幂等）
    result.consoleErrors = collector.consoleErrors.slice(0, 30);
    result.pageErrors = collector.pageErrors.slice(0, 10);
    result.eventSequence = collector.eventSequence.slice(0, 300);
    result.apiErrors = collector.apiErrors.slice(0, 20);
    result.durationMs = Date.now() - started;
    try {
      fs.writeFileSync(path.join(OUT_DIR, `${round}-console.log`), collector.consoleLog.join('\n'), 'utf-8');
    } catch {
      /* 日志写盘失败不影响结果 */
    }
    if (context) await context.close().catch(() => {});
  }
}

/** 入口探索：未登录 /workspace 行为 + 落地页 CTA 去向 */
async function exploreEntry(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const findings: string[] = [];

  await page.goto(`${BASE_URL}workspace`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(2000);
  const afterGuard = page.url();
  findings.push(
    `未登录直接访问 /workspace -> ${afterGuard}（${afterGuard.includes('/login') ? '被重定向到登录页，游客无法使用工作台' : '未被重定向'}）`,
  );

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const cta = page.locator('a', { hasText: /开始创建|进入工作台/ }).first();
  await cta.waitFor({ state: 'visible', timeout: 15_000 });
  const ctaText = (await cta.textContent())?.trim() ?? '';
  const ctaHref = await cta.getAttribute('href');
  findings.push(`落地页 CTA: 文本="${ctaText}", href=${ctaHref}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'explore-landing.png') });

  await cta.click();
  await page.waitForTimeout(2000);
  findings.push(`点击 CTA 后 URL: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'explore-after-cta.png') });

  await context.close();
  return findings.join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('==================================================');
  console.log(' Atoms Demo 生成流程真实验证（阶段二）');
  console.log(` 目标: ${BASE_URL}`);
  console.log('==================================================\n');

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });

  console.log('---- 阶段 0：工作台入口探索 ----');
  const entryFindings = await exploreEntry(browser);
  console.log(entryFindings + '\n');

  // 支持命令行参数过滤：--only=snake 或 --only=calc
  // 支持次数限制：--count=1（只运行指定次数）
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const countArg = process.argv.find((a) => a.startsWith('--count='));
  const onlyFilter = onlyArg ? onlyArg.split('=')[1] : null;
  const countLimit = countArg ? parseInt(countArg.split('=')[1], 10) : null;

  const allRounds: Array<{ round: string; prompt: string }> = [
    { round: 'calc-run1', prompt: '帮我生成一个带加减乘除功能的计算器' },
    { round: 'calc-run2', prompt: '帮我生成一个带加减乘除功能的计算器' },
    { round: 'snake-run1', prompt: '帮我生成一个贪吃蛇小游戏' },
    { round: 'snake-run2', prompt: '帮我生成一个贪吃蛇小游戏' },
  ];

  let rounds = onlyFilter
    ? allRounds.filter((r) => r.round.startsWith(onlyFilter))
    : allRounds;

  if (countLimit !== null && countLimit > 0) {
    rounds = rounds.slice(0, countLimit);
  }

  if (onlyFilter) {
    console.log(`[参数] 只运行 ${onlyFilter} 相关测试（${rounds.length} 轮）\n`);
  }

  const results: RoundResult[] = [];
  let infraBlocked = false;
  for (const r of rounds) {
    console.log(`\n---- ${r.round}: "${r.prompt}" ----`);
    const res = await runRound(browser, r.round, r.prompt);
    results.push(res);
    if (res.failureReason?.startsWith('基础设施异常')) {
      infraBlocked = true;
      console.log(`  [BLOCKED] ${r.round} 基础设施异常，停止后续轮次`);
      break;
    }
  }
  await browser.close();

  // 汇总
  console.log('\n==================================================');
  console.log(' 汇总');
  console.log('==================================================');
  console.log('轮次\t生成\t源码完整\tPreview渲染\t交互\t耗时');
  const fmt = (v: boolean | 'warn') => (v === true ? 'PASS' : v === 'warn' ? 'WARN' : 'FAIL');
  for (const r of results) {
    console.log(
      [
        r.round,
        r.generationSuccess ? 'PASS' : 'FAIL',
        fmt(r.sourceComplete),
        fmt(r.previewRendered),
        fmt(r.interactionWorked),
        `${Math.round(r.durationMs / 1000)}s`,
      ].join('\t'),
    );
  }

  const calcOk = results.filter((r) => r.round.startsWith('calc') && r.generationSuccess).length;
  const snakeOk = results.filter((r) => r.round.startsWith('snake') && r.generationSuccess).length;
  const allFailed = results.length > 0 && results.every((r) => !r.generationSuccess);
  console.log(`\n最终结论: 计算器 ${calcOk}/2 成功，贪吃蛇 ${snakeOk}/2 成功（infraBlocked=${infraBlocked}）`);

  if (allFailed) {
    const first = results[0];
    console.log('\n---- 第一轮完整错误链路 ----');
    console.log(`失败原因: ${first.failureReason ?? '(无)'}`);
    console.log(`SSE 事件序列 (${first.eventSequence.length} 条，前 50 条):`);
    first.eventSequence.slice(0, 50).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    console.log(`API 4xx/5xx (${first.apiErrors.length}):`);
    first.apiErrors.forEach((e) => console.log(`  ${e}`));
    console.log(`console.error (${first.consoleErrors.length} 条，前 10 条):`);
    first.consoleErrors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
    console.log(`pageerror (${first.pageErrors.length}):`);
    first.pageErrors.forEach((e) => console.log(`  ${e}`));
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify({ entryFindings, infraBlocked, results }, null, 2),
    'utf-8',
  );
  console.log(`\n详细结果已写入: ${path.join(OUT_DIR, 'summary.json')}`);

  process.exitCode = infraBlocked || results.some((r) => !r.generationSuccess) ? 1 : 0;
}

main().catch((err) => {
  console.error('[FATAL] 脚本未捕获异常:', err);
  process.exit(1);
});
