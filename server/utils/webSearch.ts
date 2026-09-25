/**
 * 在线查询汇总服务：在生成管线中接入网络搜索。
 *
 * 设计要点（对应 AI 工程师 Handoff 契约）：
 * 1. 触发条件（shouldTriggerWebSearch）：需求文本命中外部技术信号
 *    （陌生库 / API 集成 / 最新版本 / 兼容性疑问）时触发；纯 CRUD
 *    常规需求不触发，避免为每次生成都付出搜索延迟与 token 成本。
 * 2. 调用时机（生成前）：在分析师阶段之前执行，搜索结果作为
 *    "参考资料上下文块" 注入分析师与工程师的用户消息。
 * 3. 降级铁律：搜索失败（网络错误 / 无 provider 配置 / 超时）不阻塞
 *    生成管线，静默降级为无搜索上下文的普通生成。
 * 4. Provider 可插拔：环境变量配置（BYOK），未配置时优雅跳过。
 */

/** 搜索触发信号类型 */
export type SearchTriggerReason =
  | 'external-library'   // 陌生第三方库
  | 'external-api'       // 外部 API 集成
  | 'version-uncertain'  // 版本 / 最新用法不确定
  | 'compatibility'      // 兼容性 / 可行性疑问
  | 'complex-domain';    // 复杂领域（图表 / 地图 / 3D 等）

/** 搜索触发检测结果 */
export interface SearchTriggerResult {
  /** 是否触发搜索 */
  shouldSearch: boolean;
  /** 触发原因（可多个） */
  reasons: SearchTriggerReason[];
  /** 建议的搜索关键词（从需求中提炼，最多 2 条） */
  queries: string[];
}

/** 单条搜索结果 */
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索执行结果 */
export interface SearchOutcome {
  /** 是否成功获取到结果 */
  ok: boolean;
  /** 结果列表（ok=false 时为空数组） */
  results: SearchResultItem[];
  /** 失败原因（ok=false 时有值，仅日志用，不透传给用户） */
  error?: string;
  /** 实际使用的 provider */
  provider?: string;
}

/** 搜索服务配置（从环境变量读取） */
export interface WebSearchConfig {
  /** 是否启用在线查询（默认 true，WEB_SEARCH_ENABLED=false 关闭） */
  enabled: boolean;
  /** 搜索 provider：duckduckgo（默认，无需 key）/ serpapi / bing */
  provider: 'duckduckgo' | 'serpapi' | 'bing';
  /** provider 的 API key（BYOK） */
  apiKey?: string;
  /** 搜索单条超时（毫秒），默认 8000 */
  timeoutMs: number;
  /** 最多返回的结果条数，默认 4 */
  maxResults: number;
  /** 结果摘要单条字符上限，默认 300 */
  snippetMaxChars: number;
}

/**
 * 从环境变量读取搜索配置。
 * 缺省行为：duckduckgo 无需 key 可直接用；未配置任何 provider 时 enabled 仍为
 * true，但执行时按"无可用 provider"降级（不阻塞生成）。
 */
export function readWebSearchConfig(env: NodeJS.ProcessEnv = process.env): WebSearchConfig {
  const providerRaw = (env.WEB_SEARCH_PROVIDER || 'duckduckgo').toLowerCase();
  const provider: WebSearchConfig['provider'] =
    providerRaw === 'serpapi' || providerRaw === 'bing' ? providerRaw : 'duckduckgo';
  return {
    enabled: env.WEB_SEARCH_ENABLED !== 'false',
    provider,
    apiKey: env.WEB_SEARCH_API_KEY || undefined,
    timeoutMs: Number(env.WEB_SEARCH_TIMEOUT_MS) || 8000,
    maxResults: Number(env.WEB_SEARCH_MAX_RESULTS) || 4,
    snippetMaxChars: Number(env.WEB_SEARCH_SNIPPET_MAX_CHARS) || 300,
  };
}

/** 外部库信号：命名即信号的库 / 框架（大小写不敏感） */
const EXTERNAL_LIBRARY_PATTERNS: RegExp[] = [
  /\bthree\.?js\b/i,
  /\bd3\.?js\b/i,
  /\becharts?\b/i,
  /\bchart\.?js\b/i,
  /\bleaflet\b/i,
  /\bmapbox\b/i,
  /\bgsap\b/i,
  /\banime\.?js\b/i,
  /\bmatter\.?js\b/i,
  /\bpixi\.?js\b/i,
  /\bswiper\b/i,
  /\blottie\b/i,
  /\bxlsx\b/i,
  /\bpdf\.?js\b/i,
  /\btensorflow\.?js\b/i,
  /\bml5\b/i,
  /\bkonva\b/i,
  /\bfabric\.?js\b/i,
  /\bquill\b/i,
  /\bmonaco\b/i,
  /\bmarked\b/i,
  /\bhighlight\.?js\b/i,
];

/** 外部 API 信号：集成 / 调用第三方服务的意图词 */
const EXTERNAL_API_PATTERNS: RegExp[] = [
  /\bAPI\b/,
  /\bSDK\b/,
  /第三方/,
  /接口(调用|对接|集成)/,
  /(接入|集成|调用).{0,8}(地图|天气|支付|登录|短信|翻译|语音|视频|AI|模型|汇率|股票)/,
  /(高德|百度|腾讯|google)\s*(地图|地图API)/i,
  /(openai|claude|gemini|deepseek|通义|文心|讯飞)\s*(API|接口)?/i,
  /web\s*socket/i,
  /\bOAuth\b/i,
  /\bRESTful?\b/i,
  /\bGraphQL\b/i,
];

/** 版本不确定信号 */
const VERSION_UNCERTAIN_PATTERNS: RegExp[] = [
  /最新(版本|用法|文档)/,
  /怎么(使用|用|写)/,
  /如何(使用|用|集成|引入)/,
  /\bv?\d+\.\d+\s*(版本|语法)/i,
  /(新|旧)版(本)?(语法|写法|API)/,
  /(CDN|引入|import).{0,10}(地址|链接|路径)/,
];

/** 兼容性 / 可行性信号 */
const COMPATIBILITY_PATTERNS: RegExp[] = [
  /兼容/,
  /可行(性|吗)?/,
  /(支持|能不能|能否).{0,6}(浏览器|移动端|Safari|iOS|微信)/i,
  /报错|不生效|不工作|失效/,
  /注(意|入)点|坑/,
];

/** 复杂领域信号（生成质量依赖领域知识的场景） */
const COMPLEX_DOMAIN_PATTERNS: RegExp[] = [
  /(3D|三维|立体)/i,
  /物理(引擎|仿真)/,
  /(音频|声音|波形)(处理|可视化|分析)?/,
  /(视频|摄像头|麦克风)(播放|录制|捕捉)?/,
  /(手势|触摸|拖拽)(交互|操作)?/,
  /数据可视化/,
  /大屏/,
  /(富文本|markdown)(编辑器)?/i,
  /(动画|动效)(库|引擎)?/,
];

/** 生成搜索查询的领域关键词池（用于从需求中提炼更精准的 query） */
const DOMAIN_QUERY_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\bthree\.?js\b/i, hint: 'three.js' },
  { pattern: /\bd3\.?js\b/i, hint: 'd3.js' },
  { pattern: /\becharts?\b/i, hint: 'echarts' },
  { pattern: /\bchart\.?js\b/i, hint: 'chart.js' },
  { pattern: /\bleaflet\b/i, hint: 'leaflet' },
  { pattern: /\bmapbox\b/i, hint: 'mapbox' },
  { pattern: /\bgsap\b/i, hint: 'gsap' },
  { pattern: /\bmatter\.?js\b/i, hint: 'matter.js' },
  { pattern: /\bswiper\b/i, hint: 'swiper' },
  { pattern: /\blottie\b/i, hint: 'lottie' },
  { pattern: /地图/, hint: 'web 地图' },
  { pattern: /天气/, hint: '天气 API' },
  { pattern: /图表|可视化/, hint: '数据可视化' },
];

/**
 * 检测用户需求是否需要在线搜索。
 *
 * 判定逻辑：任一信号类别命中即触发；命中多个类别时 reasons 按类别枚举顺序排列。
 * 查询词提炼：优先用领域关键词池匹配出的 hint 拼接需求前 40 字符，
 * 无 hint 时直接用需求前 40 字符。最多产出 2 条 query（第二条取
 * 需求的 40-80 字符窗口，避免两条 query 重复）。
 *
 * 纯函数，可离线测试。
 */
export function shouldTriggerWebSearch(prompt: string): SearchTriggerResult {
  const reasons: SearchTriggerReason[] = [];
  const text = (prompt || '').trim();

  if (text.length === 0) {
    return { shouldSearch: false, reasons: [], queries: [] };
  }

  const categoryHits: Array<{ reason: SearchTriggerReason; patterns: RegExp[] }> = [
    { reason: 'external-library', patterns: EXTERNAL_LIBRARY_PATTERNS },
    { reason: 'external-api', patterns: EXTERNAL_API_PATTERNS },
    { reason: 'version-uncertain', patterns: VERSION_UNCERTAIN_PATTERNS },
    { reason: 'compatibility', patterns: COMPATIBILITY_PATTERNS },
    { reason: 'complex-domain', patterns: COMPLEX_DOMAIN_PATTERNS },
  ];

  for (const { reason, patterns } of categoryHits) {
    if (patterns.some((p) => p.test(text))) {
      reasons.push(reason);
    }
  }

  if (reasons.length === 0) {
    return { shouldSearch: false, reasons: [], queries: [] };
  }

  // 提炼查询词：领域 hint 优先
  const hints = DOMAIN_QUERY_HINTS.filter((h) => h.pattern.test(text)).map((h) => h.hint);
  const promptHead = text.slice(0, 40);
  const queries: string[] = [];
  if (hints.length > 0) {
    queries.push(`${hints[0]} ${promptHead}`.trim());
  } else {
    queries.push(promptHead);
  }
  // 第二条 query 用提示窗，避免重复
  if (hints.length > 1) {
    queries.push(`${hints[1]} 用法 示例`);
  }

  return { shouldSearch: true, reasons, queries: queries.slice(0, 2) };
}

/**
 * 执行在线搜索（provider 可插拔）。
 *
 * 降级铁律：任何失败（无 key、网络错误、超时、解析失败）都返回
 * ok=false 而不抛错，由调用方决定静默跳过；绝不因搜索失败阻塞生成。
 */
export async function performWebSearch(
  queries: string[],
  config: WebSearchConfig
): Promise<SearchOutcome> {
  if (!config.enabled) {
    return { ok: false, results: [], error: 'WEB_SEARCH_ENABLED=false，已跳过' };
  }
  if (queries.length === 0) {
    return { ok: false, results: [], error: '无可用查询词' };
  }
  // serpapi / bing 需要 key，未配置时降级（duckduckgo 免 key）
  if (config.provider !== 'duckduckgo' && !config.apiKey) {
    return { ok: false, results: [], error: `provider=${config.provider} 需要 WEB_SEARCH_API_KEY` };
  }

  const collected: SearchResultItem[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    try {
      const items = await searchWithProvider(query, config);
      for (const item of items) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        collected.push({
          title: truncate(item.title, 120),
          url: item.url,
          snippet: truncate(item.snippet, config.snippetMaxChars),
        });
        if (collected.length >= config.maxResults) break;
      }
      if (collected.length >= config.maxResults) break;
    } catch (error) {
      // 单条 query 失败不中断：继续下一条，最终按已有结果判定成败
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[performWebSearch] 查询失败（跳过）: ${msg}`);
    }
  }

  if (collected.length === 0) {
    return { ok: false, results: [], error: '所有查询均未获得结果', provider: config.provider };
  }
  return { ok: true, results: collected, provider: config.provider };
}

/** 按 provider 分发搜索请求（超时用 AbortSignal.timeout 控制） */
async function searchWithProvider(query: string, config: WebSearchConfig): Promise<SearchResultItem[]> {
  switch (config.provider) {
    case 'duckduckgo':
      return searchDuckDuckGo(query, config);
    case 'serpapi':
      return searchSerpApi(query, config);
    case 'bing':
      return searchBing(query, config);
    default:
      return [];
  }
}

/** fetch + 超时封装（搜索请求统一走这里，超时/网络错误统一抛出） */
async function fetchWithTimeout(url: string, config: WebSearchConfig, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`搜索 HTTP ${response.status}`);
  }
  return response;
}

/** DuckDuckGo Instant Answer API（免 key；结果为相关主题列表） */
async function searchDuckDuckGo(query: string, config: WebSearchConfig): Promise<SearchResultItem[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const response = await fetchWithTimeout(url, config);
  const data = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };

  const items: SearchResultItem[] = [];
  if (data.AbstractText && data.AbstractURL) {
    items.push({ title: data.Heading || query, url: data.AbstractURL, snippet: data.AbstractText });
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (items.length >= config.maxResults) break;
    if (topic.Text && topic.FirstURL) {
      items.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text });
    }
  }
  return items;
}

/** SerpAPI（Google 结果代理，需 key） */
async function searchSerpApi(query: string, config: WebSearchConfig): Promise<SearchResultItem[]> {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(config.apiKey!)}`;
  const response = await fetchWithTimeout(url, config);
  const data = (await response.json()) as {
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return (data.organic_results ?? [])
    .filter((r) => r.link)
    .slice(0, config.maxResults)
    .map((r) => ({ title: r.title || query, url: r.link!, snippet: r.snippet || '' }));
}

/** Bing Web Search API（需 key） */
async function searchBing(query: string, config: WebSearchConfig): Promise<SearchResultItem[]> {
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${config.maxResults}`;
  const response = await fetchWithTimeout(url, config, {
    headers: { 'Ocp-Apim-Subscription-Key': config.apiKey! },
  });
  const data = (await response.json()) as {
    webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
  };
  return (data.webPages?.value ?? [])
    .filter((r) => r.url)
    .slice(0, config.maxResults)
    .map((r) => ({ title: r.name || query, url: r.url!, snippet: r.snippet || '' }));
}

/** 截断字符串（超长加省略号） */
function truncate(text: string, max: number): string {
  const t = (text || '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * 将搜索结果格式化为可注入 LLM 上下文的文本块。
 *
 * 格式约定（prompt 模板化铁律）：固定标题行 + 每条结果三行
 * （标题 / URL / 摘要），末尾附使用约束（搜索结果仅供参考，
 * 不得照抄 URL 引用到生成代码中——产物只允许 jsdelivr CDN）。
 * 空结果返回空字符串（调用方按"无注入"处理，不产生空块）。
 */
export function formatSearchResultsForContext(outcome: SearchOutcome, query?: string): string {
  if (!outcome.ok || outcome.results.length === 0) return '';

  const lines: string[] = ['## 在线查询参考资料', ''];
  if (query) {
    lines.push(`查询词：${query}`);
    lines.push('');
  }
  outcome.results.forEach((item, i) => {
    lines.push(`### 结果 ${i + 1}：${item.title}`);
    lines.push(`来源：${item.url}`);
    lines.push(item.snippet);
    lines.push('');
  });
  lines.push('> 以上为网络摘要，仅作背景参考：技术选型与 API 用法以此为据，但禁止把来源 URL 引入生成的代码（外部资源仅限 jsdelivr CDN）。');
  return lines.join('\n');
}

/**
 * 构建面向用户的"正在查询"通知文本。
 * 单独导出便于单测覆盖文案与查询词的拼接格式。
 */
export function buildSearchingNotice(queries: string[]): string {
  if (queries.length === 0) return '正在查询相关资料...';
  return `正在查询相关资料（${queries.join('；')}）...`;
}
