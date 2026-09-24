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

describe('componentName', () => {
  it('从路径提取 PascalCase 组件名', () => {
    expect(componentName('/src/components/Counter.jsx')).toBe('Counter');
    expect(componentName('/src/App.jsx')).toBe('App');
  });
});
