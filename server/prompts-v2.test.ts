/**
 * P1 批次 2 提示词切换断言（方案 §3.4 / §4.2 / §4.3）
 *
 * - react-cdn 框架段：真实 ESM import 规则在场、window.__components 过渡
 *   注册约定已删除
 * - 审查者第 8 维度：注册约定检查替换为"import 目标文件必须存在"
 * - html / vue-cdn 段不受本次切换影响（回归锚点）
 * - token 增量观测：chars/4 近似口径（方案 §4.5），输出供批次报告引用
 */

import { describe, it, expect } from 'vitest';
import {
  ANALYST_SYSTEM_PROMPT_V2,
  ENGINEER_BASE_PROMPT_V2,
  REVIEWER_SYSTEM_PROMPT_V2,
  buildEngineerSystemPromptV2,
  getFrameworkPromptV2,
} from './prompts-v2.js';

const REACT_PROMPT = getFrameworkPromptV2('react-cdn');

describe('getFrameworkPromptV2（react-cdn）：真实 import 规则在场', () => {
  it('声明使用真实 ESM import', () => {
    expect(REACT_PROMPT).toContain('真实 ESM import');
  });

  it('要求 import 路径与生成文件路径完全一致（含扩展名）', () => {
    expect(REACT_PROMPT).toContain('完全一致（含扩展名）');
    expect(REACT_PROMPT).toContain("./components/Counter.jsx");
  });

  it('bare import 白名单：仅 react 与 react-dom', () => {
    expect(REACT_PROMPT).toContain('仅允许 react 与 react-dom');
  });

  it('图表库走 index.html script 用全局变量且必须带 defer，禁止 import', () => {
    expect(REACT_PROMPT).toContain('window.Chart');
    expect(REACT_PROMPT).toContain('window.echarts');
    expect(REACT_PROMPT).toContain('禁止 import');
    // defer：离线/弱网环境图表 CDN 加载失败不阻塞页面解析，仅图表区空
    expect(REACT_PROMPT).toContain('defer');
  });

  it('React 运行时由平台同源 vendor 注入，生成应用禁止自带 react script', () => {
    expect(REACT_PROMPT).toContain('/vendor/react.vendor.js');
    expect(REACT_PROMPT).toContain('禁止引用 react/react-dom 的任何 script 标签');
    // 零外网依赖：模板不得再指引 jsdelivr 上的 react UMD（离线超时 90s+ 的元凶）
    expect(REACT_PROMPT).not.toContain('cdn.jsdelivr.net/npm/react');
    expect(REACT_PROMPT).not.toContain('unpkg.com/react');
  });

  it('禁止在 JS 中 import CSS', () => {
    expect(REACT_PROMPT).toContain('禁止在 JS 中 import CSS');
  });

  it('示例为两文件 + import + export 的极简锚点', () => {
    expect(REACT_PROMPT).toContain("import Counter from './components/Counter.jsx'");
    expect(REACT_PROMPT).toContain('export default Counter');
    expect(REACT_PROMPT).toContain('export default App');
  });
});

describe('getFrameworkPromptV2（react-cdn）：过渡注册约定已删除', () => {
  it('不再包含 window.__components 注册约定', () => {
    expect(REACT_PROMPT).not.toContain('window.__components');
  });

  it('不再包含"禁止 import"式的 P0 全局挂载表述', () => {
    expect(REACT_PROMPT).not.toContain('禁止写任何 import');
    expect(REACT_PROMPT).not.toContain('过渡注册约定');
  });
});

describe('REVIEWER_SYSTEM_PROMPT_V2：第 8 维度同步', () => {
  it('注册约定检查替换为"import 目标文件必须存在"', () => {
    expect(REVIEWER_SYSTEM_PROMPT_V2).toContain('import 目标文件必须存在');
    expect(REVIEWER_SYSTEM_PROMPT_V2).not.toContain('window.__components');
  });

  it('维度 8 携带 bare 白名单与图表库 CDN 用法的一致性检查点', () => {
    expect(REVIEWER_SYSTEM_PROMPT_V2).toContain('仅允许 react 与 react-dom');
    expect(REVIEWER_SYSTEM_PROMPT_V2).toContain('package.json 声明一致');
  });

  it('维度 7/8 资源合规口径与 vendor 化一致：同源 /vendor/ 放行、CSS 框架 CDN 禁止、图表 script 带 defer', () => {
    expect(REVIEWER_SYSTEM_PROMPT_V2).toContain('同源 /vendor/ 路径');
    expect(REVIEWER_SYSTEM_PROMPT_V2).toContain('无 CSS 框架 CDN');
    expect(REVIEWER_SYSTEM_PROMPT_V2).toContain('须带 defer');
    expect(REVIEWER_SYSTEM_PROMPT_V2).not.toContain('cdn.tailwindcss.com');
  });
});

describe('不受本次切换影响的回归锚点', () => {
  it('html 段保留 window.AppUtils 命名空间约定与平台注入声明', () => {
    const htmlPrompt = getFrameworkPromptV2('html');
    expect(htmlPrompt).toContain('window.AppUtils');
    expect(htmlPrompt).toContain('由平台注入');
  });

  it('html 段示例已去除 Tailwind CDN 引用（切换手写 CSS）', () => {
    const htmlPrompt = getFrameworkPromptV2('html');
    expect(htmlPrompt).not.toContain('cdn.tailwindcss.com');
    expect(htmlPrompt).toContain('./styles/main.css');
    expect(htmlPrompt).toContain('/styles/main.css');
  });

  it('工程师 base 铁律不再指引 Tailwind CDN，仅允许 jsdelivr 与同源 /vendor/ 路径', () => {
    expect(ENGINEER_BASE_PROMPT_V2).not.toContain('cdn.tailwindcss.com');
    expect(ENGINEER_BASE_PROMPT_V2).toContain('/vendor/');
    expect(ENGINEER_BASE_PROMPT_V2).toContain('jsdelivr');
    expect(ENGINEER_BASE_PROMPT_V2).toContain('手写原生 CSS');
  });

  it('vue-cdn 段保持全局 Vue 用法（模块运行时 P2）', () => {
    const vuePrompt = getFrameworkPromptV2('vue-cdn');
    expect(vuePrompt).toContain('Vue.createApp');
    expect(vuePrompt).toContain('由平台注入');
  });

  it('vue-cdn 段禁止生成应用自带 vue script（平台运行时注入，避免离线双重加载）', () => {
    const vuePrompt = getFrameworkPromptV2('vue-cdn');
    expect(vuePrompt).toContain('禁止自行引用 vue 的 script 标签');
  });

  it('工程师 base 段仍含输出顺序与禁 import 样式的工程化规范', () => {
    expect(ENGINEER_BASE_PROMPT_V2).toContain('文件输出顺序');
    expect(ENGINEER_BASE_PROMPT_V2).toContain('禁止在 JS 中 import 样式文件');
  });

  it('buildEngineerSystemPromptV2 = base + 框架段', () => {
    const composed = buildEngineerSystemPromptV2('react-cdn');
    expect(composed).toContain(ENGINEER_BASE_PROMPT_V2);
    expect(composed).toContain('真实 ESM import');
  });
});

describe('token 增量观测（chars/4 近似，方案 §4.5 口径）', () => {
  it('单次生成系统提示词合计在可控区间（防稀释护栏）', () => {
    const approxTokens = (s: string) => Math.ceil(s.length / 4);
    const total =
      approxTokens(ANALYST_SYSTEM_PROMPT_V2) +
      approxTokens(buildEngineerSystemPromptV2('react-cdn')) +
      approxTokens(REVIEWER_SYSTEM_PROMPT_V2);
    const reactFramework = approxTokens(REACT_PROMPT);
    // 观测值输出（vitest 运行报告可见），护栏：总量不超过 2600 tokens
    console.log(
      `[token 观测] react框架段=${reactFramework} 分析师=${approxTokens(ANALYST_SYSTEM_PROMPT_V2)} ` +
        `工程师base=${approxTokens(ENGINEER_BASE_PROMPT_V2)} 审查者=${approxTokens(REVIEWER_SYSTEM_PROMPT_V2)} 合计=${total}`,
    );
    expect(total).toBeLessThanOrEqual(2600);
  });
});
