import { test, expect, Page } from '@playwright/test';

/**
 * Smoke Test - 基础冒烟测试
 * 验证应用的核心功能是否可用
 */

// 监听 console 错误
let consoleErrors: string[] = [];
let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
});

test.describe('页面基础渲染', () => {
  test('应该正确加载首页并显示关键元素', async ({ page }) => {
    // 访问首页
    await page.goto('/');

    // 验证页面标题包含 "Litpp Demo"
    await expect(page).toHaveTitle(/Litpp Demo/);

    // 验证关键 DOM 元素存在
    // 等待页面加载完成
    await page.waitForLoadState('networkidle');

    // 验证有内容渲染（不是空白页）
    const rootElement = await page.locator('#root');
    await expect(rootElement).not.toBeEmpty();

    // 验证页面有可见内容
    const bodyContent = await page.locator('body').innerHTML();
    expect(bodyContent.length).toBeGreaterThan(100); // 页面应该有足够的内容

    // 验证无 console error（排除一些已知的、非致命的错误）
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('Warning:') && // React 警告不算错误
        !err.includes('DevTools') && // 开发工具提示
        !err.includes('[HMR]') && // 热更新提示
        !err.includes('Download the React DevTools') && // React DevTools 提示
        !err.includes('401') && // 未授权错误（可能是正常的用户未登录）
        !err.includes('Failed to load resource') // 资源加载失败（可能是正常的 API 调用）
    );
    expect(criticalErrors).toHaveLength(0);

    // 验证无页面错误（JavaScript 运行时错误）
    expect(pageErrors).toHaveLength(0);
  });

  test('应该正确渲染落地页', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 验证落地页的关键元素
    // 检查是否有 CTA 按钮（可能是"开始创建"或"登录"）
    const ctaButtons = await page.locator('button, a').all();
    expect(ctaButtons.length).toBeGreaterThan(0);

    // 验证页面有标题或描述文字
    const headings = await page.locator('h1, h2, h3').all();
    expect(headings.length).toBeGreaterThan(0);
  });

  test('应该能够导航到登录页', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 直接访问登录页
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // 验证登录页有登录表单
    const inputs = await page.locator('input').all();
    expect(inputs.length).toBeGreaterThan(0);

    // 验证有提交按钮（使用 first() 避免 strict mode）
    const submitButton = page.locator('button[type="submit"]').first();
    await expect(submitButton).toBeVisible();
  });
});

test.describe('生成功能可用性', () => {
  // 注意：这个测试需要登录，这里只验证页面元素存在
  test('工作台应该有输入区域', async ({ page }) => {
    // 先访问首页
    await page.goto('/');

    // 尝试访问工作台（会重定向到登录页）
    await page.goto('/workspace');
    await page.waitForLoadState('networkidle');

    // 应该在登录页
    await expect(page).toHaveURL(/\/login/);

    // 验证有登录表单
    const emailInput = page.locator('input[type="email"], input[type="text"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    // 至少应该有一个输入框
    const inputs = await page.locator('input').all();
    expect(inputs.length).toBeGreaterThan(0);
  });
});

test.describe('响应式设计', () => {
  test('应该在移动端正常显示', async ({ page }) => {
    // 设置移动端视口
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 验证页面加载成功
    const rootElement = await page.locator('#root');
    await expect(rootElement).not.toBeEmpty();

    // 验证无 console error
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('Warning:') &&
        !err.includes('DevTools') &&
        !err.includes('[HMR]') &&
        !err.includes('401') &&
        !err.includes('Failed to load resource')
    );
    expect(criticalErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });
});

test.describe('性能检查', () => {
  test('页面应该在合理时间内加载', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loadTime = Date.now() - startTime;

    // 页面应该在 5 秒内加载完成
    expect(loadTime).toBeLessThan(5000);
  });
});