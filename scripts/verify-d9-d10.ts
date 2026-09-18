/**
 * 验证 D-9、D-10 缺陷修复
 * 使用 Puppeteer 进行真实浏览器测试
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const EVIDENCE_DIR = './evidence/iteration15';
const BASE_URL = 'http://localhost:5176';
const API_URL = 'http://localhost:3000';

interface TestResult {
  step: string;
  pass: boolean;
  evidence: string;
  error?: string;
}

const results: TestResult[] = [];

function log(step: string, message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${step}: ${message}`);
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page: puppeteer.Page, name: string): Promise<string> {
  const filepath = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

async function main() {
  // 确保证据目录存在
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // 收集控制台消息
  const consoleMessages: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // 收集网络请求
  const networkRequests: string[] = [];
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    networkRequests.push(`${request.method()} ${request.url()}`);
    request.continue();
  });

  try {
    // ========== S1: 注册主路径（验证 D-9） ==========
    log('S1', '访问注册页面');
    await page.goto(`${BASE_URL}/register`, { waitUntil: 'networkidle2', timeout: 10000 });

    // 断言：页面不白屏，显示登录/注册 Tabs
    await page.waitForSelector('button[role="tab"]', { timeout: 5000 });
    const tabButtons = await page.$$eval('button[role="tab"]', (buttons) =>
      buttons.map((btn) => btn.textContent?.trim())
    );

    if (tabButtons.length === 2 && tabButtons.includes('登录') && tabButtons.includes('注册')) {
      log('S1', '✅ 登录/注册 Tabs 显示正常');
      results.push({
        step: 'S1-Tabs',
        pass: true,
        evidence: await takeScreenshot(page, 's1-register-page'),
      });
    } else {
      throw new Error(`Tabs 异常: ${JSON.stringify(tabButtons)}`);
    }

    // 断言：显示用户名、密码输入框
    const usernameInput = await page.$('input#username');
    const passwordInput = await page.$('input#password');
    const confirmPasswordInput = await page.$('input#confirmPassword');

    if (usernameInput && passwordInput && confirmPasswordInput) {
      log('S1', '✅ 用户名、密码、确认密码输入框显示正常');
      results.push({ step: 'S1-Inputs', pass: true, evidence: 'DOM 检查通过' });
    } else {
      throw new Error('输入框缺失');
    }

    // 填写注册表单
    log('S1', '填写注册表单');
    const uniqueUsername = `e2e_${Date.now()}`;
    await page.type('input#username', uniqueUsername, { delay: 50 });
    await page.type('input#password', 'test123456', { delay: 50 });
    await page.type('input#confirmPassword', 'test123456', { delay: 50 });

    // 提交
    log('S1', '提交注册');
    await page.click('button[type="submit"]');

    // 等待跳转或 toast
    await delay(3000);

    // 截图
    const screenshotPath = await takeScreenshot(page, 's1-after-submit');

    // 检查是否跳转到首页（注册成功）
    const currentUrl = page.url();
    if (currentUrl === `${BASE_URL}/` || currentUrl === `${BASE_URL}`) {
      log('S1', '✅ 注册成功，跳转到首页');
      results.push({
        step: 'S1-Register',
        pass: true,
        evidence: screenshotPath,
      });
    } else {
      // 检查是否有错误提示
      const errorVisible = await page.$('div[class*="danger"]');
      if (errorVisible) {
        const errorText = await page.evaluate(
          (el) => el.textContent,
          errorVisible
        );
        throw new Error(`注册失败: ${errorText}`);
      }
      throw new Error(`未跳转到首页，当前 URL: ${currentUrl}`);
    }

    // ========== S2: 生成主路径（验证 D-8b + D-10） ==========
    log('S2', '回到首页');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

    // 断言：首页有输入框
    const chatInput = await page.$('textarea[placeholder*="描述"]');
    if (chatInput) {
      log('S2', '✅ 找到对话输入框');
    } else {
      throw new Error('未找到对话输入框');
    }

    // 输入需求
    log('S2', '输入需求: 做一个计数器');
    await page.type('textarea[placeholder*="描述"]', '做一个计数器', { delay: 50 });

    // 提交（通过 Enter 键）
    await page.keyboard.press('Enter');
    await delay(500);
    log('S2', '已提交需求（Enter 键）');

    // 等待生成流程（最多等待 60 秒）
    log('S2', '等待生成流程...');
    const startTime = Date.now();
    const maxWaitTime = 60000;

    let generationComplete = false;
    while (Date.now() - startTime < maxWaitTime) {
      await delay(1000);

      // 检查是否跳转到 workspace
      const url = page.url();
      if (url.includes('/workspace')) {
        generationComplete = true;
        log('S2', '✅ 跳转到 workspace');
        break;
      }

      // 检查是否有阶段消息
      const statusMessage = await page.$('[class*="status"]');
      if (statusMessage) {
        const text = await page.evaluate((el) => el.textContent, statusMessage);
        log('S2', `状态: ${text}`);
      }
    }

    if (!generationComplete) {
      throw new Error('生成超时（60秒）');
    }

    // 截图 workspace
    const workspaceScreenshot = await takeScreenshot(page, 's2-workspace');

    // 检查 iframe 内容
    const iframe = await page.$('iframe');
    if (iframe) {
      const iframeContent = await iframe.contentFrame();
      if (iframeContent) {
        const bodyText = await iframeContent.evaluate(() => document.body?.textContent || '');
        log('S2', `iframe 内容长度: ${bodyText.length}`);
        results.push({
          step: 'S2-Generation',
          pass: bodyText.length > 0,
          evidence: workspaceScreenshot,
        });
      }
    } else {
      throw new Error('未找到 iframe');
    }

    // ========== CORS 检查 ==========
    log('CORS', '检查控制台 CORS 错误');
    const corsErrors = consoleErrors.filter((msg) =>
      msg.toLowerCase().includes('cors') || msg.includes('localhost:3000')
    );

    if (corsErrors.length === 0) {
      log('CORS', '✅ 无 CORS 错误');
      results.push({
        step: 'CORS',
        pass: true,
        evidence: '控制台无 CORS 错误',
      });
    } else {
      log('CORS', `❌ 发现 CORS 错误: ${corsErrors.join(', ')}`);
      results.push({
        step: 'CORS',
        pass: false,
        evidence: corsErrors.join('\n'),
        error: '发现 CORS 错误',
      });
    }

    // ========== S3: 持久化 ==========
    log('S3', '刷新 workspace 页面');
    await page.reload({ waitUntil: 'networkidle2' });

    // 等待页面加载
    await delay(2000);

    // 检查项目是否仍然存在
    const projectList = await page.$$eval('[class*="project"]', (items) => items.length);
    log('S3', `项目列表长度: ${projectList}`);

    const persistenceScreenshot = await takeScreenshot(page, 's3-after-refresh');

    if (projectList > 0) {
      log('S3', '✅ 项目持久化成功');
      results.push({
        step: 'S3-Persistence',
        pass: true,
        evidence: persistenceScreenshot,
      });
    } else {
      // 检查 iframe 是否有内容（可能只有一个项目）
      const iframeAfterRefresh = await page.$('iframe');
      if (iframeAfterRefresh) {
        const iframeContent = await iframeAfterRefresh.contentFrame();
        if (iframeContent) {
          const bodyText = await iframeContent.evaluate(() => document.body?.textContent || '');
          if (bodyText.length > 0) {
            log('S3', '✅ iframe 内容持久化');
            results.push({
              step: 'S3-Persistence',
              pass: true,
              evidence: persistenceScreenshot,
            });
          } else {
            throw new Error('刷新后项目丢失');
          }
        }
      } else {
        throw new Error('刷新后项目丢失');
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('ERROR', errorMessage);
    results.push({
      step: 'ERROR',
      pass: false,
      evidence: await takeScreenshot(page, 'error'),
      error: errorMessage,
    });
  } finally {
    // 输出网络请求（检查是否有直连 localhost:3000）
    const directApiCalls = networkRequests.filter((req) =>
      req.includes('localhost:3000/api')
    );

    if (directApiCalls.length > 0) {
      log('Network', `⚠️ 发现直连 localhost:3000: ${directApiCalls.join('\n')}`);
      results.push({
        step: 'Network',
        pass: false,
        evidence: directApiCalls.join('\n'),
        error: '发现直连 localhost:3000',
      });
    } else {
      log('Network', '✅ 所有 API 请求走相对路径');
      results.push({
        step: 'Network',
        pass: true,
        evidence: '所有 API 请求走相对路径',
      });
    }

    // 输出控制台错误
    if (consoleErrors.length > 0) {
      const errorLogPath = path.join(EVIDENCE_DIR, 'console-errors.txt');
      fs.writeFileSync(errorLogPath, consoleErrors.join('\n'));
      log('Console', `控制台错误已保存到 ${errorLogPath}`);
    }

    // 保存网络请求日志
    const networkLogPath = path.join(EVIDENCE_DIR, 'network-requests.txt');
    fs.writeFileSync(networkLogPath, networkRequests.join('\n'));

    await browser.close();
  }

  // ========== 输出验证报告 ==========
  console.log('\n========== 验证报告 ==========\n');
  results.forEach((result) => {
    const status = result.pass ? '✅ PASS' : '❌ FAIL';
    console.log(
      `【${result.step}】${status}\n  证据: ${result.evidence}${result.error ? `\n  错误: ${result.error}` : ''}\n`
    );
  });

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  console.log(`\n总结: ${passCount} PASS, ${failCount} FAIL`);
  console.log(`\n结论: ${failCount === 0 ? '✅ 通过' : '❌ 不通过'}`);
}

main().catch((error) => {
  console.error('验证脚本执行失败:', error);
  process.exit(1);
});