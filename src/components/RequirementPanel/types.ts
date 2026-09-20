/**
 * 需求确认面板类型定义。
 * 面板为纯展示组件：所有状态由父级（HomePage）通过 props 注入，
 * 与 optimizerStore 的耦合只发生在页面层。
 */
import type { OptimizedRequirement } from '../../services/ai/optimizer';

/** 需求确认面板 Props */
export interface RequirementPanelProps {
  /** 优化后的结构化需求（null 表示尚无结果，仅在优化中或出错时出现） */
  requirement: OptimizedRequirement | null;
  /** 是否正在优化（展示 loading 态） */
  isOptimizing: boolean;
  /** 优化器流式输出的原始文本（loading 态尾部展示） */
  streamText: string;
  /** 优化失败信息（非空时展示错误态与重试入口） */
  error: string | null;
  /** 触发优化的原始用户输入（错误态回显与重试使用） */
  originalPrompt: string;

  /** 一键接受：按当前需求直接进入生成 */
  onAccept: () => void;
  /** 编辑后提交：携带修改后的需求与修改说明进入生成 */
  onAcceptWithEdits: (edited: OptimizedRequirement, notes: string) => void;
  /** 取消：优化中取消请求，或确认阶段放弃本次需求 */
  onCancel: () => void;
  /** 优化失败后重试 */
  onRetry: () => void;
}

/** 应用类型中文标签（优化器 appType 枚举的唯一展示映射） */
export const APP_TYPE_LABELS: Record<string, string> = {
  dashboard: '仪表盘',
  landing: '落地页',
  todo: '待办清单',
  chart: '图表',
  tool: '工具',
  game: '游戏',
  other: '其他',
};

/** 主题色调中文标签 */
export const THEME_TONE_LABELS: Record<string, string> = {
  light: '浅色',
  dark: '深色',
  auto: '跟随系统',
};

/** 数据字段类型的中文标签 */
export const FIELD_TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数字',
  boolean: '布尔',
  array: '数组',
  object: '对象',
};
