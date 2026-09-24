/**
 * ZIP 导出服务：把项目虚拟文件系统打包为 ZIP 并触发浏览器下载。
 * 纯浏览器端实现（JSZip + file-saver），不经过服务端，不触碰沙箱边界。
 *
 * 输出结构（工程化生成计划决议 5，方案 B）：
 *   {项目名}-{日期}.zip
 *   ├── index.html          （源码入口，对应虚拟路径 /index.html）
 *   ├── src/...             （多文件模式下的其余源码文件）
 *   ├── styles/...          （样式文件）
 *   ├── dist/index.html     （平台物化的浏览器端编译产物，双击即可运行）
 *   └── README.md           （自动生成的运行说明，中文）
 *
 * dist 物化失败（组装两级链路都失败）时中止导出，不产出下载。
 */
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ENTRY_FILE_PATH } from '../../types/project';
import type { Project, FileNode } from '../../types/project';
import { materializeDistIndex, DIST_INDEX_PATH } from './distMaterializer';

/** 项目名转安全文件名：替换文件系统非法字符，压缩空白；无有效字符时兜底 */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  // 全部由占位连字符/点构成（如输入 "///"）视为无有效名称
  if (cleaned.length === 0 || /^[-. ]+$/.test(cleaned)) {
    return '未命名项目';
  }
  return cleaned;
}

/** 本地日期转 YYYY-MM-DD（补零） */
function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * 生成 ZIP 下载文件名：项目名 + 日期（本地时区），如"计数器-2026-09-24.zip"。
 * 项目名中的文件系统非法字符转义为连字符。
 */
export function buildZipFileName(projectName: string, now: Date = new Date()): string {
  return `${sanitizeFileName(projectName)}-${formatDate(now)}.zip`;
}

/**
 * 虚拟路径转 zip 内相对路径。
 * 剥离单个前导 "/"；拒绝空段与 ".." 段（防路径穿越，双保险：
 * 虚拟文件系统本身受控，但导出物会落到用户磁盘，此处不信任输入）。
 * 返回 null 表示该文件不安全或不可导出，调用方跳过。
 */
function toZipPath(virtualPath: string): string | null {
  const normalized = virtualPath.replace(/^\//, '');
  if (normalized.length === 0) return null;
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

/**
 * 已知 CDN 依赖识别表：[URL 匹配子串, 库名, 用途]。
 * 与沙箱 CDN 白名单体系对应，识别结果仅用于 README 展示。
 */
const KNOWN_CDNS: ReadonlyArray<readonly [string, string, string]> = [
  ['cdn.tailwindcss.com', 'Tailwind CSS', '原子化样式'],
  ['cdn.jsdelivr.net/npm/chart.js', 'Chart.js', '图表绘制'],
  ['cdn.jsdelivr.net/npm/echarts', 'ECharts', '图表绘制'],
  ['react', 'React', 'UI 框架'],
  ['vue', 'Vue', 'UI 框架'],
  ['lodash', 'lodash', '工具函数'],
  ['dayjs', 'Day.js', '日期处理'],
  ['axios', 'axios', 'HTTP 请求'],
  ['d3js', 'D3.js', '数据可视化'],
  ['three', 'Three.js', '3D 渲染'],
];

/**
 * 从全部文件内容中识别引用的外部 CDN 依赖（按识别表顺序去重）。
 */
function detectDependencies(files: Record<string, FileNode>): Array<{ name: string; usage: string }> {
  const all = Object.values(files)
    .map((f) => f.content)
    .join('\n');
  const found = new Map<string, string>();
  for (const [needle, lib, usage] of KNOWN_CDNS) {
    if (all.includes(needle) && !found.has(lib)) {
      found.set(lib, usage);
    }
  }
  return Array.from(found.entries()).map(([name, usage]) => ({ name, usage }));
}

/** 识别主框架：按优先级返回第一个命中的框架名，否则为原生三件套 */
function detectFramework(files: Record<string, FileNode>): string {
  const entry = files[ENTRY_FILE_PATH]?.content ?? '';
  const all = Object.values(files)
    .map((f) => f.content)
    .join('\n');
  if (all.includes('react') || all.includes('React')) return 'React（经 CDN 以 UMD 方式引入，无需构建）';
  if (all.includes('vue') || all.includes('Vue')) return 'Vue（经 CDN 引入，无需构建）';
  if (entry.includes('cdn.tailwindcss.com')) return '原生 HTML/CSS/JavaScript + Tailwind CSS（CDN 版）';
  return '原生 HTML/CSS/JavaScript，无需构建工具';
}

/** 生成 README.md（中文） */
export function buildReadme(project: Project): string {
  const name = project.name || '未命名项目';
  const description = project.description.trim().length > 0
    ? project.description.trim()
    : `${name}：由 Litpp（AI 应用生成平台）生成的 Web 应用。`;

  const deps = detectDependencies(project.files);
  const framework = detectFramework(project.files);
  const fileCount = Object.keys(project.files).length;
  const exportedAt = new Date().toLocaleString('zh-CN');

  const dependencySection = deps.length > 0
    ? deps.map((d) => `- ${d.name}（${d.usage}，经 CDN 引入）`).join('\n')
    : '- 无第三方依赖，全部为原生实现';

  return `# ${name}

> ${description}

本项目由 [Litpp](https://litpp.dev)（AI 应用生成平台）生成，导出时间：${exportedAt}。

## 运行方式

### 方式一：双击 dist/index.html（最简单）

解压后双击 \`dist/index.html\`，即可在浏览器中打开应用。
这是平台在导出时生成的浏览器端编译产物（自包含单文件），无需任何构建步骤。
引用 CDN 的外部库（如图表库）需要联网加载。

### 方式二：源码作为工程起点

源码目录（\`index.html\`、\`src/\`、\`styles/\` 等）是规范的工程起点。
如果应用包含多文件拆分、ES Module 导入或本地数据请求，建议在源码目录用静态服务器运行，
避免 \`file://\` 协议下的跨域限制：

\`\`\`bash
# 使用 Node.js（任选其一）
npx serve .
npx http-server .

# 使用 Python
python3 -m http.server 8080
\`\`\`

然后按提示在浏览器打开（如 http://localhost:3000 或 http://localhost:8080）。

预览由 Litpp 内置沙箱运行；npm 方式需 Node 18+，作为工程起点使用。

## 技术说明

- **框架**：${framework}
- **源码入口**：\`index.html\`
- **可运行产物**：\`dist/index.html\`（双击即可运行）
- **文件数量**：${fileCount} 个

## 依赖列表

${dependencySection}

## 目录结构

\`\`\`
.
${Object.keys(project.files)
  .map((p) => `├── ${p.replace(/^\//, '')}`)
  .join('\n')}
├── dist/index.html
└── README.md
\`\`\`
`;
}

/**
 * 把项目构建为 ZIP Blob（不触发下载）。
 *
 * 结构 = 全部源码文件按原路径 + dist/index.html（物化产物）+ README.md。
 * dist 物化失败（组装两级链路都失败）时抛错中止，不产出半成品。
 *
 * @throws 项目无文件、缺少入口文件、路径不安全或 dist 物化失败时抛出 Error
 */
export async function buildProjectZipBlob(project: Project): Promise<Blob> {
  const fileNodes = Object.values(project.files);
  if (fileNodes.length === 0) {
    throw new Error('项目暂无可导出的文件');
  }

  const zip = new JSZip();
  let exportedCount = 0;
  let hasEntry = false;

  for (const node of fileNodes) {
    const zipPath = toZipPath(node.path);
    if (zipPath === null) {
      console.warn('[zipExporter] 跳过不安全的虚拟路径', node.path);
      continue;
    }
    zip.file(zipPath, node.content);
    exportedCount += 1;
    if (node.path === ENTRY_FILE_PATH) {
      hasEntry = true;
    }
  }

  if (exportedCount === 0) {
    throw new Error('项目文件路径均不安全，已中止导出');
  }
  if (!hasEntry) {
    throw new Error(`缺少入口文件 ${ENTRY_FILE_PATH}，无法导出`);
  }

  // dist 物化（方案 B）：失败即中止导出，宁可不给，不给坏的。
  // 物化写在源码之后：若源码树恰好含 dist/index.html，平台产物覆盖之（产物以平台物化为准）
  const materialized = await materializeDistIndex(project.files, project.framework ?? 'html');
  if (materialized.warnings.length > 0) {
    console.warn('[zipExporter] dist 物化警告:', materialized.warnings);
  }
  zip.file(DIST_INDEX_PATH, materialized.html);

  zip.file('README.md', buildReadme(project));

  return zip.generateAsync({ type: 'blob' });
}

/**
 * 把项目导出为 ZIP 并触发浏览器下载。
 *
 * @throws 项目无文件或打包失败时抛出 Error，由调用方负责用户提示
 */
export async function exportProjectAsZip(project: Project): Promise<void> {
  const blob = await buildProjectZipBlob(project);
  saveAs(blob, buildZipFileName(project.name));
}
