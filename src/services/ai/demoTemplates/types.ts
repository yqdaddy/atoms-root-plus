/**
 * 演示模板库共享类型（docs/tech-ai-pipeline.md 6.2）。
 * 模板 html 为完整单文件 HTML，含 {{TITLE}} / {{ACCENT}} / {{THEME}} 三个占位符，
 * 由 instantiateTemplate 在交付前实例化；其余内容禁止占位符。
 */
import type { FeatureList } from '../types';

export type DemoTemplateId = 'dashboard' | 'landing' | 'todo' | 'chart' | 'chart-bar' | 'chart-line' | 'chart-pie' | 'chart-radar' | 'calculator' | 'snake';

/** 模板实例化配置：标题、主题色、深浅色，支持演示模式下的迭代修改 */
export interface DemoTemplateConfig {
  title: string;
  accent: string;
  dark: boolean;
}

export interface DemoTemplate {
  id: DemoTemplateId;
  /** 展示名，如「数据仪表盘」 */
  name: string;
  description: string;
  keywords: {
    /** 强指向词，命中 +2 */
    strong: readonly string[];
    /** 弱关联词，命中 +1 */
    weak: readonly string[];
  };
  /** 预写好的分析 JSON，analyzing 阶段流式吐出 */
  analystScript: FeatureList;
  /** 默认实例化配置 */
  defaults: DemoTemplateConfig;
  /** 完整模板 HTML，含三个占位符 */
  html: string;
}
