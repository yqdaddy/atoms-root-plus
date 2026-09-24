import { describe, it, expect } from 'vitest';
import { validateProject, componentName } from './projectValidator.js';

/** 合法的 react-cdn 最小项目（入口 + 组件 + 三件套，组件含注册） */
const REACT_PROJECT = {
  '/index.html': {
    path: '/index.html',
    content: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
  },
  '/src/main.jsx': {
    path: '/src/main.jsx',
    content: 'const App = window.__components.App;\nReactDOM.createRoot(document.getElementById("root")).render(null);',
  },
  '/src/App.jsx': {
    path: '/src/App.jsx',
    content: 'function App() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.App = App;',
  },
  '/src/components/Counter.jsx': {
    path: '/src/components/Counter.jsx',
    content: 'function Counter() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.Counter = Counter;',
  },
  '/README.md': { path: '/README.md', content: '# 示例应用\n\n说明' },
  '/DESIGN.md': { path: '/DESIGN.md', content: '# 设计说明' },
  '/package.json': { path: '/package.json', content: '{"name":"demo","private":true}' },
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

describe('validateProject：E_GLOBAL_REG', () => {
  it('react 组件缺 window.__components 注册报 E_GLOBAL_REG', () => {
    const broken = {
      ...REACT_PROJECT,
      '/src/components/Badge.jsx': {
        path: '/src/components/Badge.jsx',
        content: 'function Badge() { return null; }\nexport default Badge;',
      },
    };
    const result = validateProject(broken, 'react-cdn');
    const issue = result.errors.find((e) => e.code === 'E_GLOBAL_REG');
    expect(issue?.file).toBe('/src/components/Badge.jsx');
    expect(issue?.message).toContain('window.__components');
  });

  it('入口 main.jsx 不要求注册', () => {
    const result = validateProject(REACT_PROJECT, 'react-cdn');
    expect(result.errors.some((e) => e.code === 'E_GLOBAL_REG' && e.file === '/src/main.jsx')).toBe(false);
  });

  it('html 模式不检查注册约定', () => {
    const result = validateProject(HTML_PROJECT, 'html');
    expect(result.errors.some((e) => e.code === 'E_GLOBAL_REG')).toBe(false);
  });
});

describe('validateProject：整体行为', () => {
  it('合法 react 项目零 errors，warnings 恒为数组', () => {
    const result = validateProject(REACT_PROJECT, 'react-cdn');
    expect(result.errors).toHaveLength(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('多规则同时失败时逐条报告', () => {
    const result = validateProject({ '/src/App.jsx': { path: '/src/App.jsx', content: 'x' } }, 'react-cdn');
    const codes = new Set(result.errors.map((e) => e.code));
    expect(codes.has('E_ENTRY')).toBe(true);
    expect(codes.has('E_SCAFFOLD')).toBe(true);
    expect(codes.has('E_GLOBAL_REG')).toBe(true);
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

describe('componentName', () => {
  it('从路径提取 PascalCase 组件名', () => {
    expect(componentName('/src/components/Counter.jsx')).toBe('Counter');
    expect(componentName('/src/App.jsx')).toBe('App');
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

describe('validateProject：E_NO_BARE_IMPORT（P0 过渡，react-cdn 恒开）', () => {
  it('/src 组件文件行首 import → 报 E_NO_BARE_IMPORT 并给全局挂载指引', () => {
    const result = validateProject(
      {
        ...REACT_PROJECT,
        '/src/App.jsx': {
          path: '/src/App.jsx',
          content: 'import { useState } from "react";\nfunction App() { return null; }\nwindow.__components = window.__components || {};\nwindow.__components.App = App;',
        },
      },
      'react-cdn',
    );
    const issue = result.errors.find((e) => e.code === 'E_NO_BARE_IMPORT');
    expect(issue?.file).toBe('/src/App.jsx');
    expect(issue?.message).toContain('window.__components');
  });

  it('/src 工具文件行首 export 同样命中（含缩进）', () => {
    const result = validateProject(
      {
        ...REACT_PROJECT,
        '/src/utils.js': {
          path: '/src/utils.js',
          content: '  export function fmt(n) { return n; }',
        },
      },
      'react-cdn',
    );
    expect(result.errors.some((e) => e.code === 'E_NO_BARE_IMPORT' && e.file === '/src/utils.js')).toBe(true);
  });

  it('行中出现 import 字样的代码不误报（仅行首语句命中）', () => {
    const result = validateProject(
      {
        ...REACT_PROJECT,
        '/src/data.js': {
          path: '/src/data.js',
          content: '// 负责数据的 import 解析\nconst importedCount = 1;\nwindow.__utils = window.__utils || {};',
        },
      },
      'react-cdn',
    );
    expect(result.errors.some((e) => e.code === 'E_NO_BARE_IMPORT')).toBe(false);
  });

  it('html 框架不适用（规则仅 react-cdn）', () => {
    const result = validateProject(
      {
        '/index.html': { path: '/index.html', content: '<!DOCTYPE html><html><body><script type="module">import x from "./a.js";</script></body></html>' },
        '/src/main.js': { path: '/src/main.js', content: 'import a from "./a.js";' },
        '/README.md': { path: '/README.md', content: '# 说明' },
      },
      'html',
    );
    expect(result.errors.some((e) => e.code === 'E_NO_BARE_IMPORT')).toBe(false);
  });

  it('非 /src 路径不查（入口内联脚本不受约束）', () => {
    const result = validateProject(REACT_PROJECT, 'react-cdn');
    expect(result.errors.some((e) => e.code === 'E_NO_BARE_IMPORT')).toBe(false);
  });
});
