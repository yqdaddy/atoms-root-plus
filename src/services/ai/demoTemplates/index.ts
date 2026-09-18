/**
 * 演示模板注册表：关键词匹配器与模板实例化。
 * 匹配规则（docs/tech-ai-pipeline.md 6.3 + Iteration 3 任务约定）：
 * prompt 小写化后逐模板计分，strong 命中 +2、weak 命中 +1；
 * 英文词用词边界正则，中文词用包含匹配；得分并列或全零时回退默认模板 dashboard。
 */
import type { DemoTemplate, DemoTemplateConfig, DemoTemplateId } from './types';
import { DASHBOARD_TEMPLATE } from './dashboardTemplate';
import { LANDING_TEMPLATE } from './landingTemplate';
import { TODO_TEMPLATE } from './todoTemplate';
import { CHART_TEMPLATE } from './chartTemplate';
import { CHART_BAR_TEMPLATE } from './chartBarTemplate';
import { CHART_LINE_TEMPLATE } from './chartLineTemplate';
import { CHART_PIE_TEMPLATE } from './chartPieTemplate';
import { CHART_RADAR_TEMPLATE } from './chartRadarTemplate';

export type { DemoTemplate, DemoTemplateConfig, DemoTemplateId };

/** 全零分或并列时的回退模板（任务约定：默认 dashboard） */
export const DEFAULT_TEMPLATE_ID: DemoTemplateId = 'dashboard';

export const DEMO_TEMPLATES: readonly DemoTemplate[] = [
  DASHBOARD_TEMPLATE,
  LANDING_TEMPLATE,
  TODO_TEMPLATE,
  CHART_TEMPLATE,
  CHART_BAR_TEMPLATE,
  CHART_LINE_TEMPLATE,
  CHART_PIE_TEMPLATE,
  CHART_RADAR_TEMPLATE,
];

export function findTemplate(id: DemoTemplateId): DemoTemplate {
  const found = DEMO_TEMPLATES.find((t) => t.id === id);
  // 模板注册表为静态非空清单，断言安全
  return found ?? (DEMO_TEMPLATES[0] as DemoTemplate);
}

export interface TemplateMatch {
  template: DemoTemplate;
  /** 0 表示无任何关键词命中（已回退默认模板） */
  score: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hitWord(word: string, normalizedPrompt: string): boolean {
  if (/[a-z]/i.test(word)) {
    // 英文词按词边界匹配，避免 "todo" 误命中 "todorov" 这类子串
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    return pattern.test(normalizedPrompt);
  }
  return normalizedPrompt.includes(word);
}

export function matchTemplate(prompt: string): TemplateMatch {
  const normalized = prompt.toLowerCase();
  let best = DEMO_TEMPLATES[0] as DemoTemplate;
  let bestScore = 0;
  for (const template of DEMO_TEMPLATES) {
    let score = 0;
    for (const word of template.keywords.strong) {
      if (hitWord(word.toLowerCase(), normalized)) {
        score += 2;
      }
    }
    for (const word of template.keywords.weak) {
      if (hitWord(word.toLowerCase(), normalized)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }
  if (bestScore === 0) {
    return { template: findTemplate(DEFAULT_TEMPLATE_ID), score: 0 };
  }
  return { template: best, score: bestScore };
}

/** 将模板实例化为最终交付 HTML：仅替换三个约定占位符 */
export function instantiateTemplate(template: DemoTemplate, config: DemoTemplateConfig): string {
  return template.html
    .split('{{TITLE}}')
    .join(config.title)
    .split('{{ACCENT}}')
    .join(config.accent)
    .split('{{THEME}}')
    .join(config.dark ? 'dark' : 'light');
}
