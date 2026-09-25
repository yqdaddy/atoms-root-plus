/**
 * 在线查询汇总服务单测。
 *
 * 覆盖面：
 * - shouldTriggerWebSearch：五类触发信号逐类命中、纯 CRUD 不触发、
 *   空输入不触发、查询词提炼（领域 hint 优先）
 * - performWebSearch：未启用降级、无 provider key 降级、无查询词降级
 *   （全部为不发网络请求的纯降级路径）
 * - formatSearchResultsForContext：格式化结构、约束行在场、空结果空串
 * - buildSearchingNotice：有/无查询词的文案
 *
 * 真实网络请求路径（provider 分发）不在单测覆盖内：网络依赖不可离线回归，
 * 由 fetchWithTimeout 统一超时兜底（降级铁律在调用方已保证失败不阻塞）。
 */

import { describe, it, expect } from 'vitest';
import {
  shouldTriggerWebSearch,
  performWebSearch,
  formatSearchResultsForContext,
  buildSearchingNotice,
  readWebSearchConfig,
  type WebSearchConfig,
  type SearchOutcome,
} from './webSearch.js';

/** 本地构造配置（避免读进程环境变量造成测试顺序耦合） */
function makeConfig(overrides: Partial<WebSearchConfig> = {}): WebSearchConfig {
  return {
    enabled: true,
    provider: 'duckduckgo',
    timeoutMs: 1000,
    maxResults: 4,
    snippetMaxChars: 300,
    ...overrides,
  };
}

describe('shouldTriggerWebSearch：触发条件设计', () => {
  it('外部第三方库命中（external-library）', () => {
    for (const prompt of [
      '用 Three.js 做一个 3D 展示页',
      '做一个带 ECharts 图表的仪表盘',
      '集成 GSAP 动画库',
      '使用 matter.js 做物理弹球',
    ]) {
      const result = shouldTriggerWebSearch(prompt);
      expect(result.shouldSearch, prompt).toBe(true);
      expect(result.reasons).toContain('external-library');
    }
  });

  it('外部 API 集成命中（external-api）', () => {
    for (const prompt of [
      '接入高德地图 API 展示位置',
      '调用天气接口获取实时数据',
      '集成第三方支付 SDK',
      '做一个 OpenAI API 聊天机器人',
    ]) {
      const result = shouldTriggerWebSearch(prompt);
      expect(result.shouldSearch, prompt).toBe(true);
      expect(result.reasons).toContain('external-api');
    }
  });

  it('版本不确定信号命中（version-uncertain）', () => {
    for (const prompt of [
      '最新版本的 chart.js 怎么使用',
      'echarts 如何引入 CDN 地址',
      'Vue3 新版本语法写一个计数器',
    ]) {
      const result = shouldTriggerWebSearch(prompt);
      expect(result.shouldSearch, prompt).toBe(true);
      expect(result.reasons).toContain('version-uncertain');
    }
  });

  it('兼容性 / 可行性疑问命中（compatibility）', () => {
    for (const prompt of [
      '这个写法在 Safari 下兼容吗',
      'canvas 导出图片可行吗',
      'getUserMedia 能不能在移动端浏览器使用',
    ]) {
      const result = shouldTriggerWebSearch(prompt);
      expect(result.shouldSearch, prompt).toBe(true);
      expect(result.reasons).toContain('compatibility');
    }
  });

  it('复杂领域信号命中（complex-domain）', () => {
    for (const prompt of [
      '做一个 3D 立体魔方',
      '音频波形可视化播放器',
      '富文本编辑器',
      '数据可视化大屏',
    ]) {
      const result = shouldTriggerWebSearch(prompt);
      expect(result.shouldSearch, prompt).toBe(true);
      expect(result.reasons).toContain('complex-domain');
    }
  });

  it('纯 CRUD 常规需求不触发（避免无谓搜索成本）', () => {
    for (const prompt of [
      '做一个计数器，有加减按钮和重置',
      '待办清单，支持添加、删除、完成标记',
      '做一个番茄钟，25 分钟倒计时',
      '简单的计算器，支持加减乘除',
    ]) {
      const result = shouldTriggerWebSearch(prompt);
      expect(result.shouldSearch, prompt).toBe(false);
      expect(result.queries).toHaveLength(0);
    }
  });

  it('空输入与纯空白不触发', () => {
    expect(shouldTriggerWebSearch('').shouldSearch).toBe(false);
    expect(shouldTriggerWebSearch('   ').shouldSearch).toBe(false);
  });

  it('多类信号同时命中时 reasons 按类别顺序排列', () => {
    // three.js（external-library）+ 3D（complex-domain）
    const result = shouldTriggerWebSearch('用 three.js 做一个 3D 地球');
    expect(result.shouldSearch).toBe(true);
    expect(result.reasons).toContain('external-library');
    expect(result.reasons).toContain('complex-domain');
    const libIdx = result.reasons.indexOf('external-library');
    const domainIdx = result.reasons.indexOf('complex-domain');
    expect(libIdx).toBeLessThan(domainIdx);
  });
});

describe('shouldTriggerWebSearch：查询词提炼', () => {
  it('领域 hint 优先拼接（库名在前，需求摘要在后）', () => {
    const result = shouldTriggerWebSearch('使用 echarts 做一个销售数据图表页面，支持筛选');
    expect(result.shouldSearch).toBe(true);
    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.queries[0]).toContain('echarts');
  });

  it('无领域 hint 时直接用需求前 40 字符', () => {
    const prompt = '最新版本的 React 该怎么引入到纯 HTML 页面';
    const result = shouldTriggerWebSearch(prompt);
    expect(result.shouldSearch).toBe(true);
    expect(result.reasons).toContain('version-uncertain');
    expect(result.queries[0]).toBe(prompt.slice(0, 40));
  });

  it('查询词最多 2 条', () => {
    const result = shouldTriggerWebSearch('用 echarts 和 three.js 做可视化大屏');
    expect(result.queries.length).toBeLessThanOrEqual(2);
  });
});

describe('performWebSearch：降级路径（不发网络请求）', () => {
  it('enabled=false 时直接降级，不发起任何请求', async () => {
    const outcome = await performWebSearch(['chart.js 用法'], makeConfig({ enabled: false }));
    expect(outcome.ok).toBe(false);
    expect(outcome.results).toHaveLength(0);
    expect(outcome.error).toContain('WEB_SEARCH_ENABLED=false');
  });

  it('空查询词列表直接降级', async () => {
    const outcome = await performWebSearch([], makeConfig());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('无可用查询词');
  });

  it('serpapi/bing 无 API key 时降级（BYOK 未配置）', async () => {
    const serpapi = await performWebSearch(['q'], makeConfig({ provider: 'serpapi' }));
    expect(serpapi.ok).toBe(false);
    expect(serpapi.error).toContain('WEB_SEARCH_API_KEY');

    const bing = await performWebSearch(['q'], makeConfig({ provider: 'bing' }));
    expect(bing.ok).toBe(false);
  });

  it('duckduckgo 免 key：不因缺 key 降级（降级原因不含 API key 字样）', async () => {
    // 不真正联网：断网环境下 fetch 会抛错，但错误应被捕获为"所有查询均未
    // 获得结果"而非 key 缺失——用极短超时保证测试快速结束
    const outcome = await performWebSearch(['nonexistent-query-xyz'], makeConfig({ timeoutMs: 1 }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toContain('WEB_SEARCH_API_KEY');
  });
});

describe('readWebSearchConfig：环境变量解析', () => {
  it('缺省配置：启用 + duckduckgo + 默认参数', () => {
    const config = readWebSearchConfig({});
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe('duckduckgo');
    expect(config.maxResults).toBe(4);
  });

  it('WEB_SEARCH_ENABLED=false 关闭', () => {
    const config = readWebSearchConfig({ WEB_SEARCH_ENABLED: 'false' });
    expect(config.enabled).toBe(false);
  });

  it('非法 provider 回落 duckduckgo', () => {
    const config = readWebSearchConfig({ WEB_SEARCH_PROVIDER: 'unknown-provider' });
    expect(config.provider).toBe('duckduckgo');
  });

  it('合法 provider 与 key 透传', () => {
    const config = readWebSearchConfig({
      WEB_SEARCH_PROVIDER: 'serpapi',
      WEB_SEARCH_API_KEY: 'test-key',
    });
    expect(config.provider).toBe('serpapi');
    expect(config.apiKey).toBe('test-key');
  });
});

describe('formatSearchResultsForContext：上下文注入格式', () => {
  it('正常格式化：标题行、来源、摘要、约束行齐全', () => {
    const outcome: SearchOutcome = {
      ok: true,
      provider: 'duckduckgo',
      results: [
        { title: 'Chart.js 文档', url: 'https://example.com/chartjs', snippet: 'Chart.js 是一个开源图表库' },
        { title: 'ECharts 入门', url: 'https://example.com/echarts', snippet: 'ECharts 支持多种图表类型' },
      ],
    };
    const block = formatSearchResultsForContext(outcome, 'chart.js 用法');
    expect(block).toContain('## 在线查询参考资料');
    expect(block).toContain('查询词：chart.js 用法');
    expect(block).toContain('### 结果 1：Chart.js 文档');
    expect(block).toContain('来源：https://example.com/chartjs');
    expect(block).toContain('Chart.js 是一个开源图表库');
    expect(block).toContain('### 结果 2：ECharts 入门');
    // 产物铁律约束：禁止把来源 URL 引入生成代码
    expect(block).toContain('禁止把来源 URL 引入生成的代码');
  });

  it('失败结果返回空字符串（不注入空块）', () => {
    const failed: SearchOutcome = { ok: false, results: [], error: '网络超时' };
    expect(formatSearchResultsForContext(failed)).toBe('');
  });

  it('成功但零结果返回空字符串', () => {
    const empty: SearchOutcome = { ok: true, results: [] };
    expect(formatSearchResultsForContext(empty)).toBe('');
  });
});

describe('buildSearchingNotice：用户可见通知文案', () => {
  it('有查询词时携带查询内容', () => {
    const notice = buildSearchingNotice(['echarts 图表', 'three.js 3D']);
    expect(notice).toContain('正在查询相关资料');
    expect(notice).toContain('echarts 图表');
    expect(notice).toContain('three.js 3D');
  });

  it('无查询词时输出通用文案', () => {
    expect(buildSearchingNotice([])).toBe('正在查询相关资料...');
  });
});
