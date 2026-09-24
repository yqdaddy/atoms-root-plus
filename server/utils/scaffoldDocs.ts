/**
 * 工程化三件套脚手架文档生成（方案 §4.4 决策丙：服务端模板生成，零 LLM token）
 *
 * README.md / DESIGN.md / package.json 由平台在 done 事件前注入，
 * 模型禁止自行生成（提示词声明 + projectValidator E_SCAFFOLD 兜底）。
 * README 定位为"初始说明"，不随 modify 重生成（§10 决议 2）。
 *
 * 纯函数：输入分析师 JSON 摘要 + 生成文件树 + 框架，输出文件 Map。
 */

/** 分析师 JSON 的结构化摘要（宽松可选，解析失败字段回退占位） */
export interface AnalystBlueprint {
  appTitle: string;
  appType: string;
  summary: string;
  features: Array<{ name: string; description: string; priority: string }>;
  interactions: string[];
}

/** 脚手架文件（language 取 multiFileParser 合法值子集：md → text） */
export interface ScaffoldFile {
  path: string;
  content: string;
  language: 'text' | 'json';
}

/** 从分析师原始 JSON 安全提取蓝图（未知结构逐字段收窄，不抛错） */
export function parseBlueprint(raw: unknown): AnalystBlueprint {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const featuresRaw = Array.isArray(obj.features) ? obj.features : [];
  const features = featuresRaw
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      name: typeof f.name === 'string' ? f.name : '未命名功能',
      description: typeof f.description === 'string' ? f.description : '',
      priority: f.priority === 'nice' ? 'nice' : 'must',
    }));
  return {
    appTitle: typeof obj.appTitle === 'string' && obj.appTitle.trim() ? obj.appTitle.trim() : '未命名应用',
    appType: typeof obj.appType === 'string' ? obj.appType : 'other',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    features,
    interactions: Array.isArray(obj.interactions)
      ? obj.interactions.filter((i): i is string => typeof i === 'string')
      : [],
  };
}

/** appTitle 转 npm 安全 kebab-case；无 ASCII 字符时回退 litpp-app */
export function toKebabCase(title: string): string {
  const kebab = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kebab.length > 0 ? kebab : 'litpp-app';
}

/** README 运行方式固定声明（方案 §2.1：不承诺本地构建通过） */
const RUN_SECTION = `## 运行方式

- 预览由 Litpp 内置沙箱运行，无需安装依赖。
- npm 方式需 Node 18+：\`npm install\` 后作为工程起点使用（本产物为 CDN 运行时形态，不承诺本地构建通过）。`;

/** 生成 README.md：项目说明 + 运行方式 + 功能清单 */
export function buildReadme(blueprint: AnalystBlueprint): string {
  const featureLines =
    blueprint.features.length > 0
      ? blueprint.features
          .map((f) => `- [${f.priority}] **${f.name}**：${f.description || '见应用内实现'}`)
          .join('\n')
      : '- 见应用内实现';
  return `# ${blueprint.appTitle}

> ${blueprint.summary || '由 Litpp 生成的应用'}

- 应用类型：${blueprint.appType}

${RUN_SECTION}

## 功能清单

${featureLines}
`;
}

/** 按目录分组归纳文件树，输出模块划分描述（DESIGN.md 素材） */
export function describeModules(filePaths: string[]): string {
  if (filePaths.length === 0) return '- 暂无文件';

  const DIR_LABELS: Array<[RegExp, string]> = [
    [/^\/src\/components\//, '视图组件（每文件一组件）'],
    [/^\/src\/hooks\//, '状态逻辑（hooks）'],
    [/^\/src\/utils\//, '纯逻辑（utils，无框架依赖）'],
    [/^\/src\//, '应用源码'],
    [/^\/styles\//, '全局样式'],
  ];

  const groups = new Map<string, string[]>();
  for (const p of [...filePaths].sort()) {
    const matched = DIR_LABELS.find(([re]) => re.test(p));
    const label = matched ? matched[1] : p === '/index.html' ? '入口（HTML 挂载点 / 页面结构）' : '其他';
    const list = groups.get(label) ?? [];
    list.push(p);
    groups.set(label, list);
  }

  return [...groups.entries()]
    .map(([label, paths]) => `- ${label}：${paths.join('、')}`)
    .join('\n');
}

/** 生成 DESIGN.md：应用概况、模块划分（真实文件树）、数据流（interactions 推导）、演进占位 */
export function buildDesignDoc(blueprint: AnalystBlueprint, filePaths: string[]): string {
  const interactionLines =
    blueprint.interactions.length > 0
      ? blueprint.interactions.map((i) => `- ${i}`).join('\n')
      : '- 见功能清单中的交互细节';
  return `# ${blueprint.appTitle} 设计说明

## 应用概况

${blueprint.summary || '由 Litpp 生成的应用'}（类型：${blueprint.appType}）。

## 模块划分

${describeModules(filePaths)}

## 数据流

用户交互触点：

${interactionLines}

交互事件更新状态，状态变化驱动视图渲染，持久化数据写入 localStorage（如适用）。

## 后续演进建议

（占位：可在此记录重构方向、性能优化点与新功能规划。）
`;
}

/** 生成 package.json：依赖按框架固定，name 由 appTitle 转 kebab-case */
export function buildPackageJson(blueprint: AnalystBlueprint, framework: 'react-cdn' | 'vue-cdn'): string {
  const dependencies =
    framework === 'react-cdn'
      ? { react: '^18', 'react-dom': '^18' }
      : { vue: '^3.4' };
  const pkg = {
    name: toKebabCase(blueprint.appTitle),
    private: true,
    version: '0.1.0',
    description: blueprint.summary || `${blueprint.appTitle} - 由 Litpp 生成`,
    dependencies,
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * 构建三件套文件 Map：
 * - react-cdn / vue-cdn：README.md + DESIGN.md + package.json
 * - html：仅 README.md
 *
 * @param blueprint 分析师蓝图（parseBlueprint 产物）
 * @param filePaths LLM 实际生成的文件路径集合（模块划分按真实文件树归纳）
 */
export function buildScaffoldDocs(
  blueprint: AnalystBlueprint,
  filePaths: string[],
  framework: 'html' | 'react-cdn' | 'vue-cdn',
): Map<string, ScaffoldFile> {
  const files = new Map<string, ScaffoldFile>();
  files.set('/README.md', {
    path: '/README.md',
    content: buildReadme(blueprint),
    language: 'text',
  });
  if (framework === 'react-cdn' || framework === 'vue-cdn') {
    files.set('/DESIGN.md', {
      path: '/DESIGN.md',
      content: buildDesignDoc(blueprint, filePaths),
      language: 'text',
    });
    files.set('/package.json', {
      path: '/package.json',
      content: buildPackageJson(blueprint, framework),
      language: 'json',
    });
  }
  return files;
}
