import { describe, it, expect } from 'vitest';
import {
  parseBlueprint,
  toKebabCase,
  buildReadme,
  buildDesignDoc,
  buildPackageJson,
  buildScaffoldDocs,
  describeModules,
} from './scaffoldDocs.js';

const BLUEPRINT_RAW = {
  appTitle: '科学计算器',
  appType: 'tool',
  summary: '支持常用科学计算的计数器应用',
  features: [
    { id: 'F1', name: '科学计算', description: '支持三角函数与幂运算', priority: 'must' },
    { id: 'F2', name: '历史记录', description: '保存最近 10 条计算', priority: 'nice' },
  ],
  interactions: ['点击数字键输入', '点击运算符计算'],
};

const FILE_PATHS = [
  '/index.html',
  '/src/main.jsx',
  '/src/App.jsx',
  '/src/components/Counter.jsx',
  '/src/components/History.jsx',
  '/src/hooks/useCalculator.js',
  '/src/utils/format.js',
  '/styles/main.css',
];

describe('parseBlueprint（宽松解析）', () => {
  it('从完整分析师 JSON 提取蓝图', () => {
    const bp = parseBlueprint(BLUEPRINT_RAW);
    expect(bp.appTitle).toBe('科学计算器');
    expect(bp.features).toHaveLength(2);
    expect(bp.features[0]).toMatchObject({ name: '科学计算', priority: 'must' });
    expect(bp.interactions).toHaveLength(2);
  });

  it('非法输入回退占位值，不抛错', () => {
    const bp = parseBlueprint(null);
    expect(bp.appTitle).toBe('未命名应用');
    expect(bp.features).toHaveLength(0);
    expect(parseBlueprint({ features: 'not-array' }).features).toHaveLength(0);
    expect(parseBlueprint({ interactions: [1, '点击'] }).interactions).toEqual(['点击']);
  });
});

describe('toKebabCase', () => {
  it('ASCII 标题转 kebab-case', () => {
    expect(toKebabCase('Sci Calc Pro')).toBe('sci-calc-pro');
  });

  it('纯中文标题回退 litpp-app', () => {
    expect(toKebabCase('科学计算器')).toBe('litpp-app');
  });

  it('混合标题保留 ASCII 部分', () => {
    expect(toKebabCase('Todo 清单 App')).toBe('todo-app');
  });
});

describe('buildScaffoldDocs（按框架出三件套/单件）', () => {
  it('react-cdn 返回 README.md + DESIGN.md + package.json', () => {
    const files = buildScaffoldDocs(parseBlueprint(BLUEPRINT_RAW), FILE_PATHS, 'react-cdn');
    expect([...files.keys()].sort()).toEqual(['/DESIGN.md', '/README.md', '/package.json']);
  });

  it('vue-cdn 返回三件套', () => {
    const files = buildScaffoldDocs(parseBlueprint(BLUEPRINT_RAW), FILE_PATHS, 'vue-cdn');
    expect(files.size).toBe(3);
  });

  it('html 仅返回 README.md', () => {
    const files = buildScaffoldDocs(parseBlueprint(BLUEPRINT_RAW), FILE_PATHS, 'html');
    expect([...files.keys()]).toEqual(['/README.md']);
  });
});

describe('README.md 内容', () => {
  it('含标题、摘要、运行方式与功能清单（priority 标记）', () => {
    const readme = buildReadme(parseBlueprint(BLUEPRINT_RAW));
    expect(readme).toContain('# 科学计算器');
    expect(readme).toContain('支持常用科学计算的计数器应用');
    expect(readme).toContain('Litpp 内置沙箱');
    expect(readme).toContain('Node 18+');
    expect(readme).toContain('- [must] **科学计算**：支持三角函数与幂运算');
    expect(readme).toContain('- [nice] **历史记录**');
  });
});

describe('DESIGN.md 内容', () => {
  it('模块划分按真实文件树分组，数据流来自 interactions，含演进占位', () => {
    const design = buildDesignDoc(parseBlueprint(BLUEPRINT_RAW), FILE_PATHS);
    expect(design).toContain('## 模块划分');
    expect(design).toContain('视图组件');
    expect(design).toContain('/src/components/Counter.jsx、/src/components/History.jsx');
    expect(design).toContain('状态逻辑（hooks）');
    expect(design).toContain('- 点击数字键输入');
    expect(design).toContain('## 后续演进建议');
  });

  it('空文件树输出占位不抛错', () => {
    expect(describeModules([])).toContain('暂无文件');
  });
});

describe('package.json 内容', () => {
  it('react-cdn 固定 react ^18 / react-dom ^18，name 为 kebab-case，private true', () => {
    const pkg = JSON.parse(buildPackageJson(parseBlueprint(BLUEPRINT_RAW), 'react-cdn')) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ react: '^18', 'react-dom': '^18' });
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe('litpp-app');
  });

  it('vue-cdn 声明 vue ^3.4', () => {
    const pkg = JSON.parse(buildPackageJson(parseBlueprint(BLUEPRINT_RAW), 'vue-cdn')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ vue: '^3.4' });
  });
});
