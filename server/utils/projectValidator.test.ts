import { describe, it, expect } from 'vitest';
import { validateProject } from './projectValidator.js';

/** 合法的 react-cdn 最小项目（入口 + 真实 import 组件链 + 三件套，P1 形态） */
const REACT_PROJECT = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
  },
  '/src/main.jsx': {
    path: '/src/main.jsx',
    content:
      "import React from 'react';\nimport App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(null);",
  },
  '/src/App.jsx': {
    path: '/src/App.jsx',
    content: "import Counter from './components/Counter.jsx';\nfunction App() { return null; }\nexport default App;",
  },
  '/src/components/Counter.jsx': {
    path: '/src/components/Counter.jsx',
    content: "import React from 'react';\nfunction Counter() { return null; }\nexport default Counter;",
  },
  '/README.md': { path: '/README.md', content: '# 示例应用\n\n说明' },
  '/DESIGN.md': { path: '/DESIGN.md', content: '# 设计说明' },
  '/package.json': {
    path: '/package.json',
    content: '{"name":"demo","private":true,"dependencies":{"react":"^18","react-dom":"^18"}}',
  },
};

/** 合法的 html 最小项目 */
const HTML_PROJECT = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html><html><body><h1>hi</h1></body></html>',
  },
  '/src/main.js': { path: '/src/main.js', content: 'console.log(1);' },
  '/README.md': { path: '/README.md', content: '# 示例' },
};

describe('validateProject：E_ENTRY', () => {
  it('缺少 /index.html 报 E_ENTRY', () => {
    const { '/index.html': _dropped, ...rest } = HTML_PROJECT;
    const result = validateProject(rest, 'html');
    expect(result.errors.some((e) => e.code === 'E_ENTRY')).toBe(true);
  });

  it('入口内容为空报 E_ENTRY', () => {
    const result = validateProject(
      { ...HTML_PROJECT, '/index.html': { path: '/index.html', content: '   ' } },
      'html',
    );
    expect(result.errors.some((e) => e.code === 'E_ENTRY' && e.file === '/index.html')).toBe(true);
  });
});

describe('validateProject：E_SCAFFOLD', () => {
  it('html 缺 README.md 报 E_SCAFFOLD', () => {
    const { '/README.md': _dropped, ...rest } = HTML_PROJECT;
    const result = validateProject(rest, 'html');
    expect(result.errors.some((e) => e.code === 'E_SCAFFOLD' && e.file === '/README.md')).toBe(true);
  });

  it('react-cdn 缺 DESIGN.md 或 package.json 报 E_SCAFFOLD', () => {
    const { '/DESIGN.md': _d, ...withoutDesign } = REACT_PROJECT;
    const { '/package.json': _p, ...withoutPkg } = REACT_PROJECT;
    expect(validateProject(withoutDesign, 'react-cdn').errors.some((e) => e.code === 'E_SCAFFOLD' && e.file === '/DESIGN.md')).toBe(true);
    expect(validateProject(withoutPkg, 'react-cdn').errors.some((e) => e.code === 'E_SCAFFOLD' && e.file === '/package.json')).toBe(true);
  });

  it('三件套内容为空白同样报 E_SCAFFOLD', () => {
    const result = validateProject(
      { ...REACT_PROJECT, '/README.md': { path: '/README.md', content: '  \n  ' } },
      'react-cdn',
    );
    expect(result.errors.some((e) => e.code === 'E_SCAFFOLD' && e.file === '/README.md')).toBe(true);
  });

  it('三件套齐全无 E_SCAFFOLD', () => {
    expect(validateProject(REACT_PROJECT, 'react-cdn').errors.some((e) => e.code === 'E_SCAFFOLD')).toBe(false);
  });
});

describe('validateProject：P1 真实 import（E_NO_BARE_IMPORT / E_GLOBAL_REG 已退役）', () => {
  it('react-cdn 文件含真实 import/export 不再被打回（零 errors）', () => {
    const result = validateProject(REACT_PROJECT, 'react-cdn');
    expect(result.errors).toHaveLength(0);
    expect(result.errors.some((e) => e.code === 'E_NO_BARE_IMPORT')).toBe(false);
  });

  it('组件文件无 window.__components 注册不再报 E_GLOBAL_REG（注册约定校验已由 import 存在性取代）', () => {
    const result = validateProject(REACT_PROJECT, 'react-cdn');
    expect(result.errors.some((e) => e.code === 'E_GLOBAL_REG')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('window.__components');
  });

  it('存量 P0 形态（全局挂载无 import）同样零误报', () => {
    const legacy = {
      '/index.html': REACT_PROJECT['/index.html'],
      '/src/main.jsx': {
        path: '/src/main.jsx',
        content: 'const App = window.__components.App;\nReactDOM.createRoot(document.getElementById("root")).render(null);',
      },
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content: 'function App() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.App = App;',
      },
      '/README.md': REACT_PROJECT['/README.md'],
      '/DESIGN.md': REACT_PROJECT['/DESIGN.md'],
      '/package.json': REACT_PROJECT['/package.json'],
    };
    expect(validateProject(legacy, 'react-cdn').errors).toHaveLength(0);
  });
});

describe('validateProject：E_IMPORT_MISSING（P1 import 断链）', () => {
  it('import 不存在的本地文件报 E_IMPORT_MISSING，带说明符与 resolve 路径及拼写指引', () => {
    const broken = {
      ...REACT_PROJECT,
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content: "import Counter from './components/Couter.jsx';\nfunction App() { return null; }\nexport default App;",
      },
    };
    const result = validateProject(broken, 'react-cdn');
    const issue = result.errors.find((e) => e.code === 'E_IMPORT_MISSING');
    expect(issue?.file).toBe('/src/App.jsx');
    expect(issue!.message).toContain('./components/Couter.jsx');
    expect(issue!.message).toContain('/src/components/Couter.jsx');
    expect(issue!.message).toContain('完全一致');
  });

  it('delete 后悬空引用同形态拦截（被删文件仍被 import）', () => {
    // 模拟 diff delete 移除 /src/components/Counter.jsx 后 App.jsx 未同步清理 import
    const { '/src/components/Counter.jsx': _removed, ...dangling } = REACT_PROJECT;
    const issue = validateProject(dangling, 'react-cdn').errors.find((e) => e.code === 'E_IMPORT_MISSING');
    expect(issue?.file).toBe('/src/App.jsx');
    expect(issue!.message).toContain('./components/Counter.jsx');
  });

  it('相对路径 ./ ../ 与根绝对路径 resolve 成功均不报错', () => {
    const project = {
      ...REACT_PROJECT,
      '/src/hooks/useCount.js': {
        path: '/src/hooks/useCount.js',
        content: "export { default } from '../components/Counter.jsx';\nexport const version = '/src/hooks/useCount.js';",
      },
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content: "import Counter from '/src/components/Counter.jsx';\nimport useCount from './hooks/useCount.js';\nexport default function App() { return null; }",
      },
    };
    expect(validateProject(project, 'react-cdn').errors.some((e) => e.code === 'E_IMPORT_MISSING')).toBe(false);
  });

  it('扩展名候选兜底：缺扩展名的本地 import 对齐前端 mini-bundler 不误报', () => {
    const lenient = {
      ...REACT_PROJECT,
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content: "import Counter from './components/Counter';\nfunction App() { return null; }\nexport default App;",
      },
    };
    expect(validateProject(lenient, 'react-cdn').errors.some((e) => e.code === 'E_IMPORT_MISSING')).toBe(false);
  });

  it('注释中的伪 import 不误报（保守剥离注释，对齐 importScanner）', () => {
    const commented = {
      ...REACT_PROJECT,
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content:
          "import Counter from './components/Counter.jsx';\n// import Ghost from './components/Ghost.jsx';\n/* import Ghost2 from './Ghost2.jsx'; */\nfunction App() { return null; }\nexport default App;",
      },
    };
    expect(validateProject(commented, 'react-cdn').errors.some((e) => e.code === 'E_IMPORT_MISSING')).toBe(false);
  });

  it('JS 中 import CSS 不算断链（运行时 no-op，交由提示词与审查维度约束）', () => {
    const withCssImport = {
      ...REACT_PROJECT,
      '/src/App.jsx': {
        path: '/src/App.jsx',
        content: "import './styles/main.css';\nimport Counter from './components/Counter.jsx';\nexport default function App() { return null; }",
      },
    };
    const result = validateProject(withCssImport, 'react-cdn');
    expect(result.errors.some((e) => e.code === 'E_IMPORT_MISSING')).toBe(false);
  });

  it('html 框架不适用（规则仅 react-cdn）', () => {
    const result = validateProject(
      {
        ...HTML_PROJECT,
        '/src/main.js': { path: '/src/main.js', content: "import missing from './nope.js';" },
      },
      'html',
    );
    expect(result.errors.some((e) => e.code === 'E_IMPORT_MISSING')).toBe(false);
  });
});

describe('validateProject：E_PKG_DEPS（P1 bare 依赖白名单与声明一致性）', () => {
  it('import 白名单外的包（chart.js）报 E_PKG_DEPS，指引走 CDN script 全局', () => {
    const withChart = {
      ...REACT_PROJECT,
      '/src/components/Chart.jsx': {
        path: '/src/components/Chart.jsx',
        content: "import Chart from 'chart.js';\nexport default function ChartPanel() { return null; }",
      },
    };
    const issue = validateProject(withChart, 'react-cdn').errors.find((e) => e.code === 'E_PKG_DEPS');
    expect(issue?.file).toBe('/src/components/Chart.jsx');
    expect(issue!.message).toContain('chart.js');
    expect(issue!.message).toContain('CDN script');
  });

  it('react 未在 package.json dependencies 声明报 E_PKG_DEPS', () => {
    const undeclared = {
      ...REACT_PROJECT,
      '/package.json': { path: '/package.json', content: '{"name":"demo","private":true}' },
    };
    const issue = validateProject(undeclared, 'react-cdn').errors.find((e) => e.code === 'E_PKG_DEPS');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('react');
    expect(issue!.message).toContain('dependencies');
  });

  it('react 与 react-dom 声明齐全无 E_PKG_DEPS', () => {
    expect(validateProject(REACT_PROJECT, 'react-cdn').errors.some((e) => e.code === 'E_PKG_DEPS')).toBe(false);
  });

  it('子路径说明符取包名段：react-dom/client 视为 react-dom，声明后放行', () => {
    const withClient = {
      ...REACT_PROJECT,
      '/src/main.jsx': {
        path: '/src/main.jsx',
        content:
          "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(null);",
      },
    };
    const result = validateProject(withClient, 'react-cdn');
    expect(result.errors.some((e) => e.code === 'E_PKG_DEPS')).toBe(false);
    expect(result.errors.some((e) => e.code === 'E_IMPORT_MISSING')).toBe(false);
  });

  it('scoped 包取两段包名：@scope/pkg 不在白名单报错', () => {
    const withScoped = {
      ...REACT_PROJECT,
      '/src/utils.js': {
        path: '/src/utils.js',
        content: "import { helper } from '@scope/pkg';\nexport const wrapped = helper;",
      },
    };
    const issue = validateProject(withScoped, 'react-cdn').errors.find((e) => e.code === 'E_PKG_DEPS');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('@scope/pkg');
  });

  it('同一包多处违规只报一次（按首次出现文件定位）', () => {
    const duplicated = {
      ...REACT_PROJECT,
      '/src/utils/a.js': { path: '/src/utils/a.js', content: "import Chart from 'chart.js';\nexport const a = Chart;" },
      '/src/utils/b.js': { path: '/src/utils/b.js', content: "import Chart from 'chart.js';\nexport const b = Chart;" },
    };
    const issues = validateProject(duplicated, 'react-cdn').errors.filter((e) => e.code === 'E_PKG_DEPS');
    expect(issues).toHaveLength(1);
  });

  it('无 bare import 时 package.json 不可解析不误报 E_PKG_DEPS', () => {
    const noBareImportProject = {
      ...REACT_PROJECT,
      '/src/main.jsx': {
        path: '/src/main.jsx',
        content: "import App from './App.jsx';\nReactDOM.createRoot(document.getElementById('root')).render(null);",
      },
      '/src/App.jsx': { path: '/src/App.jsx', content: "import Counter from './components/Counter.jsx';\nexport default function App() { return null; }" },
      '/src/components/Counter.jsx': { path: '/src/components/Counter.jsx', content: 'export default function Counter() { return null; }' },
      '/package.json': { path: '/package.json', content: 'not-json{{{' },
    };
    const result = validateProject(noBareImportProject, 'react-cdn');
    expect(result.errors.some((e) => e.code === 'E_PKG_DEPS')).toBe(false);
  });
});

describe('validateProject：整体行为', () => {
  it('合法 react 项目零 errors，warnings 恒为数组', () => {
    const result = validateProject(REACT_PROJECT, 'react-cdn');
    expect(result.errors).toHaveLength(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('多规则同时失败时逐条报告', () => {
    const result = validateProject(
      { '/src/App.jsx': { path: '/src/App.jsx', content: "import x from 'chart.js';" } },
      'react-cdn',
    );
    const codes = new Set(result.errors.map((e) => e.code));
    expect(codes.has('E_ENTRY')).toBe(true);
    expect(codes.has('E_SCAFFOLD')).toBe(true);
    expect(codes.has('E_PKG_DEPS')).toBe(true);
    expect(codes.has('E_IMPORT_MISSING')).toBe(false);
  });
});

describe('validateProject：E_CDN_DOMAIN（D-8 资源域白名单）', () => {
  it('script src 引用 unpkg 报 E_CDN_DOMAIN，带文件与域名', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script></head><body>hi</body></html>',
      },
    };
    const result = validateProject(project, 'html');
    const issue = result.errors.find((e) => e.code === 'E_CDN_DOMAIN');
    expect(issue).toBeDefined();
    expect(issue!.file).toBe('/index.html');
    expect(issue!.message).toContain('unpkg.com');
    expect(issue!.message).toContain('cdn.jsdelivr.net');
  });

  it('jsdelivr 与 tailwindcss 白名单域名通过，不报错', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head>'
          + '<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>'
          + '<script src="https://cdn.tailwindcss.com"></script>'
          + '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css.min.css" rel="stylesheet">'
          + '</head><body>hi</body></html>',
      },
    };
    expect(validateProject(project, 'html').errors.some((e) => e.code === 'E_CDN_DOMAIN')).toBe(false);
  });

  it('同源 /vendor/ 路径（平台本地运行时，零外网依赖）放行，不报 E_CDN_DOMAIN', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head>'
          + '<script src="/vendor/react.vendor.js"></script>'
          + '<script src="/vendor/sucrase.vendor.js"></script>'
          + '<link rel="stylesheet" href="/vendor/theme.css">'
          + '</head><body>hi</body></html>',
      },
    };
    expect(validateProject(project, 'html').errors.some((e) => e.code === 'E_CDN_DOMAIN')).toBe(false);
  });

  it('/vendor/ 路径在 cdnScanPaths 限定扫描下同样放行', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head><script src="/vendor/react.vendor.js"></script></head><body>hi</body></html>',
      },
    };
    expect(
      validateProject(project, 'html', { cdnScanPaths: ['/index.html'] }).errors.some((e) => e.code === 'E_CDN_DOMAIN')
    ).toBe(false);
  });

  it('CSS @import 非白名单域名同样命中', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head><style>@import url("https://fonts.googleapis.com/css2?family=X");</style></head><body>hi</body></html>',
      },
    };
    const issue = validateProject(project, 'html').errors.find((e) => e.code === 'E_CDN_DOMAIN');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('fonts.googleapis.com');
  });

  it('误报面控制：相对路径、锚点、data URI、代码内普通字符串不报错', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head>'
          + '<link rel="icon" href="/favicon.ico">'
          + '<script src="./app.js"></script>'
          + '</head><body><a href="#top">top</a>'
          + '<script>const apiDocs = "https://unpkg.com/just-a-string-not-a-ref";</script>'
          + '</body></html>',
      },
    };
    expect(validateProject(project, 'html').errors.some((e) => e.code === 'E_CDN_DOMAIN')).toBe(false);
  });

  it('协议相对 //host 形态视为外部引用并命中白名单检查', () => {
    const project = {
      ...HTML_PROJECT,
      '/index.html': {
        path: '/index.html',
        content: '<!DOCTYPE html><html><head><script src="//unpkg.com/react@18/umd/react.min.js"></script></head><body>hi</body></html>',
      },
    };
    const issue = validateProject(project, 'html').errors.find((e) => e.code === 'E_CDN_DOMAIN');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('unpkg.com');
  });

  it('cdnScanPaths 限定扫描范围：存量文件的历史引用不阻塞本次产出校验', () => {
    const legacy = {
      path: '/legacy.html',
      content: '<!DOCTYPE html><html><head><script src="https://unpkg.com/old-lib.js"></script></head><body>old</body></html>',
    };
    const fresh = {
      path: '/index.html',
      content: '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/x/index.js"></script></head><body>hi</body></html>',
    };
    // 只扫本次产出的 /index.html：存量 /legacy.html 的 unpkg 引用不报
    const scoped = validateProject(
      { '/index.html': fresh, '/legacy.html': legacy },
      'html',
      { cdnScanPaths: ['/index.html'] },
    );
    expect(scoped.errors.some((e) => e.code === 'E_CDN_DOMAIN')).toBe(false);

    // 不传 cdnScanPaths：全量扫描，存量引用命中
    const full = validateProject({ '/index.html': fresh, '/legacy.html': legacy }, 'html');
    const issue = full.errors.find((e) => e.code === 'E_CDN_DOMAIN');
    expect(issue?.file).toBe('/legacy.html');
  });
});

describe('validateProject：E_INLINE_VOLUME（F1 html 单文件体量）', () => {
  /** 生成 n 行的单文件 html（真实事故样本：731 行单文件计算器，此处构造同形态） */
  function oversizedHtml(lines: number): string {
    const body = Array.from({ length: lines - 2 }, (_, i) => `<div class="row" data-i="${i}">${i}</div>`);
    return ['<!DOCTYPE html>', ...body, '</html>'].join('\n');
  }

  it('超 150 行且无任何拆分代码文件 → 报 E_INLINE_VOLUME 并给拆分指引', () => {
    const result = validateProject(
      {
        '/index.html': { path: '/index.html', content: oversizedHtml(160) },
        '/README.md': { path: '/README.md', content: '# 说明' },
      },
      'html',
      { enforceInlineVolume: true },
    );
    const issue = result.errors.find((e) => e.code === 'E_INLINE_VOLUME');
    expect(issue).toBeDefined();
    expect(issue?.file).toBe('/index.html');
    expect(issue?.message).toContain('160 行');
    expect(issue?.message).toContain('/styles/main.css');
    expect(issue?.message).toContain('/src/main.js');
  });

  it('恰 150 行 → 通过（阈值语义为超过才触发）', () => {
    const result = validateProject(
      {
        '/index.html': { path: '/index.html', content: oversizedHtml(150) },
        '/README.md': { path: '/README.md', content: '# 说明' },
      },
      'html',
      { enforceInlineVolume: true },
    );
    expect(result.errors.some((e) => e.code === 'E_INLINE_VOLUME')).toBe(false);
  });

  it('已拆分出 styles/main.css → 不触发（拆分形态交审查维度把关）', () => {
    const result = validateProject(
      {
        '/index.html': { path: '/index.html', content: oversizedHtml(200) },
        '/styles/main.css': { path: '/styles/main.css', content: '.row { color: red; }' },
        '/README.md': { path: '/README.md', content: '# 说明' },
      },
      'html',
      { enforceInlineVolume: true },
    );
    expect(result.errors.some((e) => e.code === 'E_INLINE_VOLUME')).toBe(false);
  });

  it('仅存在空内容的拆分文件 → 仍触发（空文件不算拆分）', () => {
    const result = validateProject(
      {
        '/index.html': { path: '/index.html', content: oversizedHtml(200) },
        '/src/main.js': { path: '/src/main.js', content: '   ' },
        '/README.md': { path: '/README.md', content: '# 说明' },
      },
      'html',
      { enforceInlineVolume: true },
    );
    expect(result.errors.some((e) => e.code === 'E_INLINE_VOLUME')).toBe(true);
  });

  it('enforceInlineVolume: false（存量 modify 作用域）→ 不触发', () => {
    const result = validateProject(
      {
        '/index.html': { path: '/index.html', content: oversizedHtml(200) },
        '/README.md': { path: '/README.md', content: '# 说明' },
      },
      'html',
      { enforceInlineVolume: false },
    );
    expect(result.errors.some((e) => e.code === 'E_INLINE_VOLUME')).toBe(false);
  });

  it('react-cdn 框架不适用（规则仅 html）', () => {
    const result = validateProject(
      {
        ...REACT_PROJECT,
        '/index.html': { path: '/index.html', content: oversizedHtml(200) },
      },
      'react-cdn',
      { enforceInlineVolume: true },
    );
    expect(result.errors.some((e) => e.code === 'E_INLINE_VOLUME')).toBe(false);
  });
});
