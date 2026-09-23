/**
 * Smoke Test：Litpp Demo 基础冒烟测试（独立脚本，非 test runner）
 *
 * 前置条件：开发服务器已在 http://localhost:5177 运行（npm run dev）
 * 运行方式：npx tsx scripts/smoke-test.ts
 *
 * 检查项：
 *  1. 页面可访问（HTTP 状态 < 400）
 *  2. <div id="root"> 下有实际渲染的子元素（不是空白页）
 *  3. 页面标题包含 "Litpp"
 *  4. 关键 DOM 结构存在（落地页主要区块，或工作台的对话/预览面板）
 *  5. 无 JS 运行错误（pageerror 与 console.error，全部列出）
 *
 * 任何一项失败，进程退出码为 1。
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.SMOKE_URL ?? 'http://localhost:5177/';
const NAV_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500; // 内容渲染后再观察一会儿，捕获迟到的报错

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface PageMetrics {
  rootChildren: number;
  rootTextLength: number;
  title: string;
  headerCount: number;
  mainCount: number;
  footerCount: number;
  sectionCount: number;
  h1Texts: string[];
  interactiveCount: number;
  textareaCount: number;
  iframeCount: number;
}

/** 首屏加载期 SPA 的通用占位（App.tsx 的 PageLoader），不算"实际内容" */
const LOADER_SELECTOR = '#root header, #root h1, #root textarea, #root form';

function pad(name: string, width = 46): string {
  return name.length >= width ? name : name + '.'.repeat(width - name.length);
}

function printCheck(index: number, total: number, result: CheckResult): void {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`[${index}/${total}] ${pad(result.name)} ${status}  ${result.detail}`);
}

/** 启动系统 Chrome；失败时打印原因并以退出码 1 终止 */
async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (err) {
    console.error('[FATAL] 无法启动系统 Chrome（channel: chrome）:', err);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('==================================================');
  console.log(' Litpp Demo Smoke Test');
  console.log(` 目标: ${BASE_URL}`);
  console.log('==================================================');

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const results: CheckResult[] = [];

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    // ---- 检查 1：页面可访问 ----
    let response: Awaited<ReturnType<typeof page.goto>> = null;
    try {
      response = await page.goto(BASE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
    } catch (err) {
      results.push({
        name: '页面可访问',
        passed: false,
        detail: `导航失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    if (response) {
      const status = response.status();
      results.push({
        name: '页面可访问',
        passed: status < 400,
        detail: `HTTP ${status}`,
      });
    }

    // ---- 等待应用真正渲染出内容（跳过懒加载/鉴权期的 spinner 占位）----
    try {
      await page.waitForSelector(LOADER_SELECTOR, {
        state: 'attached',
        timeout: RENDER_TIMEOUT_MS,
      });
    } catch {
      // 找不到内容选择器不直接退出，交给下面的检查项给出具体失败细节
    }
    await page.waitForTimeout(SETTLE_MS);

    // ---- 收集页面指标 ----
    const metrics = await page.evaluate<PageMetrics>(() => {
      const root = document.querySelector('#root');
      return {
        rootChildren: root ? root.children.length : 0,
        rootTextLength: root ? (root.textContent ?? '').trim().length : 0,
        title: document.title,
        headerCount: document.querySelectorAll('#root header').length,
        mainCount: document.querySelectorAll('#root main').length,
        footerCount: document.querySelectorAll('#root footer').length,
        sectionCount: document.querySelectorAll('#root section').length,
        h1Texts: Array.from(document.querySelectorAll('#root h1'))
          .map((el) => (el.textContent ?? '').trim())
          .filter(Boolean),
        interactiveCount: document.querySelectorAll('#root button, #root a').length,
        textareaCount: document.querySelectorAll('#root textarea').length,
        iframeCount: document.querySelectorAll('#root iframe').length,
      };
    });

    // ---- 检查 2：#root 有实际渲染的子元素 ----
    results.push({
      name: '#root 已渲染实际内容',
      passed: metrics.rootChildren > 0 && metrics.rootTextLength > 0,
      detail: `${metrics.rootChildren} 个子元素, 可见文本 ${metrics.rootTextLength} 字符`,
    });

    // ---- 检查 3：页面标题包含 Litpp ----
    results.push({
      name: '页面标题包含 "Litpp"',
      passed: metrics.title.includes('Litpp'),
      detail: `title = "${metrics.title}"`,
    });

    // ---- 检查 4：关键 DOM 结构 ----
    // 场景 A：落地页（/）—— header + main + footer + h1 + 可交互元素
    const landingOk =
      metrics.headerCount > 0 &&
      metrics.mainCount > 0 &&
      metrics.footerCount > 0 &&
      metrics.h1Texts.length > 0 &&
      metrics.interactiveCount > 0;
    // 场景 B：工作台 —— 对话输入（textarea）+ 预览沙箱（iframe）
    const workspaceOk = metrics.textareaCount > 0 && metrics.iframeCount > 0;

    if (landingOk || workspaceOk) {
      const scene = landingOk ? '落地页' : '工作台';
      const parts = [
        `header x${metrics.headerCount}`,
        `main x${metrics.mainCount}`,
        `footer x${metrics.footerCount}`,
        `h1: ${metrics.h1Texts.map((t) => `"${t.slice(0, 24)}"`).join(' / ') || '(无)'}`,
        `section x${metrics.sectionCount}`,
        `button/a x${metrics.interactiveCount}`,
        `textarea x${metrics.textareaCount}`,
        `iframe x${metrics.iframeCount}`,
      ];
      results.push({
        name: '关键 DOM 结构存在',
        passed: true,
        detail: `[${scene}] ${parts.join(', ')}`,
      });
    } else {
      results.push({
        name: '关键 DOM 结构存在',
        passed: false,
        detail:
          `未匹配任何已知场景。落地页需 header/main/footer/h1/交互元素，` +
          `工作台需 textarea+iframe。实际: header x${metrics.headerCount}, ` +
          `main x${metrics.mainCount}, footer x${metrics.footerCount}, ` +
          `h1 x${metrics.h1Texts.length}, section x${metrics.sectionCount}, ` +
          `button/a x${metrics.interactiveCount}, textarea x${metrics.textareaCount}, ` +
          `iframe x${metrics.iframeCount}`,
      });
    }

    // ---- 检查 5：JS 运行错误 ----
    const jsConsoleErrors = consoleErrors.filter(
      (text) => !text.startsWith('Failed to load resource'),
    );
    const networkConsoleErrors = consoleErrors.filter((text) =>
      text.startsWith('Failed to load resource'),
    );
    const jsErrorFree = pageErrors.length === 0 && jsConsoleErrors.length === 0;
    results.push({
      name: '无 JS 运行错误',
      passed: jsErrorFree,
      detail:
        `pageerror x${pageErrors.length}, console.error x${consoleErrors.length}` +
        `（其中网络资源加载失败 x${networkConsoleErrors.length}）`,
    });

    // ---- 汇总 ----
    console.log('');
    console.log('---- 逐项结果 ----');
    results.forEach((r, i) => printCheck(i + 1, results.length, r));

    console.log('');
    if (pageErrors.length > 0) {
      console.log(`---- pageerror 明细（${pageErrors.length} 条）----`);
      pageErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }
    if (consoleErrors.length > 0) {
      console.log(`---- console.error 明细（${consoleErrors.length} 条）----`);
      consoleErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    } else {
      console.log('---- console.error 明细 ----');
      console.log('  (无)');
    }

    const failed = results.filter((r) => !r.passed);
    console.log('');
    console.log('==================================================');
    if (failed.length === 0) {
      console.log(` RESULT: PASS  (${results.length}/${results.length} 项通过)`);
    } else {
      console.log(
        ` RESULT: FAIL  (${results.length - failed.length}/${results.length} 项通过，` +
          `${failed.length} 项失败)`,
      );
      failed.forEach((r) => console.log(`   失败项: ${r.name} —— ${r.detail}`));
    }
    console.log('==================================================');

    await context.close();
    process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[FATAL] 脚本未捕获异常:', err);
  process.exit(1);
});
