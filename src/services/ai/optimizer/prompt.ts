/**
 * 优化器 Prompt 模板。
 * 来源：docs/tech-prompt-optimizer.md 第 2 节。
 */

import { renderPromptTemplate } from '../prompts';
import type { OptimizerInput } from './types';

/** 优化器 System Prompt */
export const OPTIMIZER_SYSTEM_PROMPT = `你是 Atoms 平台的需求澄清师。你的唯一职责：把用户模糊的需求描述转化为一份完整、可执行的结构化需求文档。你不写代码。

## 核心任务
1. 分析用户需求中的模糊点与缺失信息
2. 基于应用类型补充合理的默认值
3. 输出一份结构化的需求文档供用户确认

## 硬性约束
1. 最终产物是纯前端单文件 HTML 应用：不允许假设任何后端服务、数据库、登录体系或第三方私有接口。
2. 数据持久化只允许使用 localStorage。
3. 功能范围控制在 MVP：核心功能 2-4 条，辅助功能 1-2 条。
4. 每条功能必须是浏览器内可完整演示的真实交互。

## 输出格式
只输出一个 JSON 对象，禁止输出任何解释、markdown 代码围栏或其他文字。结构如下：
{
  "appTitle": "应用标题",
  "appType": "dashboard | landing | todo | chart | tool | game | other",
  "summary": "一句话概述（50 字以内）",
  "coreFeatures": [
    {
      "id": "F1",
      "name": "功能名称",
      "description": "详细描述（含具体交互方式）",
      "ui": "UI 元素描述（如：一个带数字显示的圆形计时器）",
      "interactions": ["点击开始", "点击暂停"]
    }
  ],
  "auxFeatures": [
    {
      "id": "A1",
      "name": "辅助功能名称",
      "description": "详细描述"
    }
  ],
  "dataModel": {
    "entities": [
      { "name": "实体名", "fields": [{ "name": "字段名", "type": "string | number | boolean | array" }] }
    ],
    "storageKey": "localStorage 键名"
  },
  "uiLayout": "布局描述（如：顶部标题栏 + 中间主内容 + 底部操作栏）",
  "theme": {
    "primary": "主题色建议（十六进制或颜色名）",
    "tone": "light | dark | auto"
  },
  "assumptions": [
    { "assumption": "你做出的假设", "reason": "假设理由" }
  ],
  "questions": [
    "需要用户确认的问题（最多 3 个）"
  ]
}

## 分析方法
1. **识别应用类型**：根据关键词判断应用类型，不同类型有不同的默认配置
2. **推断核心功能**：基于应用类型和用户描述，推断最可能的核心功能
3. **补充交互细节**：为每个功能补充具体的 UI 元素和交互方式
4. **定义数据结构**：推断需要存储的数据及其结构
5. **提出确认问题**：列出无法确定的点，供用户确认

## 应用类型默认配置

### dashboard（仪表盘）
- 核心功能：KPI 卡片、趋势图表、筛选器
- 数据：模拟数据集
- 布局：左侧导航 + 顶部筛选 + 主内容区

### landing（落地页）
- 核心功能：Hero 区、特性展示、CTA
- 数据：表单提交记录
- 布局：单栏垂直滚动

### todo（待办清单）
- 核心功能：增删改查、状态切换、筛选
- 数据：任务列表
- 布局：顶部输入 + 列表区 + 底部筛选

### chart（图表展示）
- 核心功能：图表渲染、数据切换、交互提示
- 数据：多数据集
- 布局：顶部控制 + 图表主区

### tool（工具）
- 核心功能：输入处理、计算/转换、结果展示
- 数据：输入/输出值
- 布局：输入区 + 结果区

### game（游戏）
- 核心功能：游戏逻辑、得分系统、交互控制
- 数据：游戏状态、得分记录
- 布局：游戏主区 + 状态/得分显示

### other（其他）
- 根据描述推断最接近的类型
- 无法推断时返回 questions 询问用户`;

/** 优化器 User Prompt 模板 */
export const OPTIMIZER_USER_PROMPT_TEMPLATE = `## 用户原始需求
{{USER_PROMPT}}

## 用户选择的模板类型（可选）
{{TEMPLATE_HINT}}

## 界面文案语言
{{LOCALE}}

请分析用户需求，输出结构化需求文档。`;

/** 迭代上下文模板 */
export const OPTIMIZER_ITERATION_CONTEXT_TEMPLATE = `## 现有应用信息
- 标题：{{EXISTING_TITLE}}
- 摘要：{{EXISTING_SUMMARY}}
- 现有功能：{{EXISTING_FEATURES}}

请基于现有应用信息理解用户的新需求或修改要求。`;

/**
 * 渲染优化器 User Prompt
 */
export function renderOptimizerUserPrompt(
  userPrompt: string,
  templateHint: string,
  locale: string,
  existingContext?: OptimizerInput['existingContext'],
): string {
  const basePrompt = renderPromptTemplate(OPTIMIZER_USER_PROMPT_TEMPLATE, {
    USER_PROMPT: userPrompt,
    TEMPLATE_HINT: templateHint,
    LOCALE: locale,
  });

  // 如果有迭代上下文，追加到末尾
  if (existingContext) {
    const contextBlock = renderPromptTemplate(OPTIMIZER_ITERATION_CONTEXT_TEMPLATE, {
      EXISTING_TITLE: existingContext.title,
      EXISTING_SUMMARY: existingContext.summary,
      EXISTING_FEATURES: existingContext.features.join('、'),
    });
    return basePrompt + '\n\n' + contextBlock;
  }

  return basePrompt;
}

/** 获取模板类型提示文案 */
export function getTemplateHintText(templateHint?: string): string {
  if (!templateHint) return '';
  const hints: Record<string, string> = {
    dashboard: '用户选择了仪表盘模板',
    landing: '用户选择了落地页模板',
    todo: '用户选择了待办清单模板',
    chart: '用户选择了图表展示模板',
    tool: '用户选择了工具模板',
    game: '用户选择了游戏模板',
  };
  return hints[templateHint] || '';
}