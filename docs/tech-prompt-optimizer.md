# 提示词工程优化器设计文档

> Owner: dev-atoms-ai-engineer
> 版本: v1
> 关联: `docs/tech-ai-pipeline.md`、`src/services/ai/prompts.ts`、`src/services/ai/types.ts`

## 1. 概述

### 1.1 问题背景

用户的需求描述往往是模糊的：

| 用户输入 | 问题 |
|---------|------|
| "做一个番茄钟" | 未说明是否有计时器、是否有休息提醒、是否有统计功能 |
| "做一个数据仪表盘" | 未说明数据来源、图表类型、筛选维度 |
| "做一个登录页面" | 未说明是否有社交登录、是否有验证码、是否有记住密码 |

直接进入三阶段流水线会导致：
1. 分析师被迫假设，可能与用户真实意图不符
2. 生成结果不符合预期，需要多轮迭代
3. token 浪费在无效尝试上

### 1.2 设计目标

设计一个"提示词优化器"模块，在进入三阶段流水线之前：

1. **分析需求完整性** - 识别用户输入中的模糊点
2. **补充缺失细节** - 基于应用类型补充合理的默认值
3. **生成结构化需求文档** - 让用户确认后再进入流水线
4. **支持两种确认模式** - "一键接受"和"手动编辑"

### 1.3 与现有流水线的关系

```
用户输入 → [提示词优化器] → 结构化需求文档 → 用户确认 → [三阶段流水线] → HTML
                 ↑                                              ↓
                 ←────────── 迭代修改时复用 ←───────────────────┘
```

提示词优化器是一个**可选的前置阶段**：
- 用户可直接提交简单需求，跳过优化器进入流水线
- 用户也可主动要求"帮我完善需求"，触发优化器
- 首次生成完成后，迭代修改时可复用优化器的结构化文档作为上下文

---

## 2. 系统提示词设计

### 2.1 优化器角色定义

优化器是一个独立于三阶段流水线的角色，命名为 **需求澄清师（Requirements Clarifier）**。

**System Prompt:**

```text
你是 Atoms 平台的需求澄清师。你的唯一职责：把用户模糊的需求描述转化为一份完整、可执行的结构化需求文档。你不写代码。

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
- 无法推断时返回 questions 询问用户
```

**User Prompt 模板:**

```text
## 用户原始需求
{{USER_PROMPT}}

## 用户选择的模板类型（可选）
{{TEMPLATE_HINT}}

## 界面文案语言
{{LOCALE}}

请分析用户需求，输出结构化需求文档。
```

### 2.2 占位符说明

| 占位符 | 来源 | 说明 |
|-------|------|------|
| `{{USER_PROMPT}}` | 用户输入 | 用户原始需求原文 |
| `{{TEMPLATE_HINT}}` | 可选 | 用户选择的模板类型提示，如"用户选择了 dashboard 模板"或空字符串 |
| `{{LOCALE}}` | 系统设置 | 固定值 `zh-CN` 或 `en` |

### 2.3 输出说明

优化器输出一个 JSON 对象，包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `appTitle` | string | 应用标题 |
| `appType` | enum | 应用类型 |
| `summary` | string | 一句话概述 |
| `coreFeatures` | array | 核心功能列表（2-4 条） |
| `auxFeatures` | array | 辅助功能列表（0-2 条） |
| `dataModel` | object | 数据结构定义 |
| `uiLayout` | string | 布局描述 |
| `theme` | object | 主题配置建议 |
| `assumptions` | array | 假设列表及理由 |
| `questions` | array | 需要用户确认的问题 |

---

## 3. 输入输出数据结构

### 3.1 输入结构

```typescript
/** 提示词优化器输入 */
export interface PromptOptimizerInput {
  /** 用户原始需求 */
  userPrompt: string;

  /** 用户选择的模板类型（可选） */
  templateHint?: AppType;

  /** 界面文案语言 */
  locale: 'zh-CN' | 'en';

  /** 迭代上下文（可选）：如果有现有应用，提供其信息 */
  existingContext?: {
    /** 现有应用的标题 */
    title: string;
    /** 现有应用的摘要 */
    summary: string;
    /** 现有应用的功能列表 */
    features: string[];
  };
}

/** 应用类型枚举 */
export type AppType = 'dashboard' | 'landing' | 'todo' | 'chart' | 'tool' | 'game' | 'other';
```

### 3.2 输出结构

```typescript
/** 提示词优化器输出 */
export interface OptimizedRequirement {
  /** 应用标题 */
  appTitle: string;

  /** 应用类型 */
  appType: AppType;

  /** 一句话概述 */
  summary: string;

  /** 核心功能列表 */
  coreFeatures: CoreFeature[];

  /** 辅助功能列表 */
  auxFeatures: AuxFeature[];

  /** 数据结构定义 */
  dataModel: DataModel;

  /** 布局描述 */
  uiLayout: string;

  /** 主题配置 */
  theme: ThemeConfig;

  /** 假设列表 */
  assumptions: Assumption[];

  /** 需要确认的问题 */
  questions: string[];
}

/** 核心功能 */
export interface CoreFeature {
  id: string;
  name: string;
  description: string;
  ui: string;
  interactions: string[];
}

/** 辅助功能 */
export interface AuxFeature {
  id: string;
  name: string;
  description: string;
}

/** 数据模型 */
export interface DataModel {
  entities: DataEntity[];
  storageKey: string;
}

/** 数据实体 */
export interface DataEntity {
  name: string;
  fields: DataField[];
}

/** 数据字段 */
export interface DataField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
}

/** 主题配置 */
export interface ThemeConfig {
  primary: string;
  tone: 'light' | 'dark' | 'auto';
}

/** 假设 */
export interface Assumption {
  assumption: string;
  reason: string;
}
```

### 3.3 用户确认结构

用户收到优化后的需求文档后，可以：

1. **一键接受** - 直接进入三阶段流水线
2. **手动编辑** - 修改结构化文档后提交

```typescript
/** 用户确认后的需求文档（传递给三阶段流水线） */
export interface ConfirmedRequirement {
  /** 原始用户输入 */
  originalPrompt: string;

  /** 优化后的需求文档 */
  optimized: OptimizedRequirement;

  /** 用户是否进行了手动编辑 */
  userEdited: boolean;

  /** 用户编辑的内容（如果有） */
  editNotes?: string;
}
```

---

## 4. 与三阶段流水线的集成方案

### 4.1 集成架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户交互层                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────────────┐ │
│  │ 输入框      │───→│ 提示词优化器      │───→│ 需求确认面板                │ │
│  │ "做一个番茄钟"│    │ (可选，可跳过)    │    │ - 显示结构化需求           │ │
│  └─────────────┘    └──────────────────┘    │ - 一键接受 / 手动编辑       │ │
│                              │              └──────────────┬──────────────┘ │
│                              │                             │                │
│                              │ 跳过优化器                   │ 确认后         │
│                              └─────────────┬───────────────┘                │
│                                            │                                │
└────────────────────────────────────────────┼────────────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           三阶段流水线                                       │
│                                                                             │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────────────┐ │
│  │ 分析师      │───→│ 工程师           │───→│ 审查者                      │ │
│  │ 分析需求    │    │ 生成 HTML        │    │ 校验代码                    │ │
│  │ 输出 JSON   │    │ 流式输出         │    │ 通过/修复                   │ │
│  └─────────────┘    └──────────────────┘    └─────────────────────────────┘ │
│         │                                        │                          │
│         │ 接收结构化需求文档作为输入              │                          │
│         ▼                                        ▼                          │
│  输入: ConfirmedRequirement              输出: GenerateResult               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 分析师阶段的输入改造

分析师阶段现在接收两种输入：

1. **原始用户输入** - 用户跳过优化器，直接提交
2. **结构化需求文档** - 用户经过优化器确认后提交

**分析师输入类型:**

```typescript
/** 分析师阶段输入 */
export interface AnalystInput {
  /** 用户原始需求 */
  userPrompt: string;

  /** 结构化需求文档（可选） */
  structuredRequirement?: ConfirmedRequirement;

  /** 语言设置 */
  locale: 'zh-CN' | 'en';

  /** 迭代上下文（可选） */
  recentContext?: string;
}
```

**分析师 System Prompt 扩展:**

在现有 System Prompt 末尾追加以下块（当存在结构化需求文档时）：

```text
## 用户已提供结构化需求文档
用户已经通过需求澄清师梳理了需求，以下为确认后的结构化文档：
{{STRUCTURED_REQUIREMENT_JSON}}

你的任务是：
1. 验证结构化文档与用户原始需求的一致性
2. 将 coreFeatures 和 auxFeatures 转换为 features 格式
3. 如果发现文档与原始需求有明显冲突，在 assumptions 中标注
```

**分析师 User Prompt 扩展:**

```text
## 用户原始需求
{{USER_PROMPT}}

{{STRUCTURED_BLOCK}}

界面文案语言：{{LOCALE}}

补充上下文（可为空）：{{RECENT_CONTEXT}}
```

其中 `{{STRUCTURED_BLOCK}}` 的内容为：

```text
## 用户确认的结构化需求文档
{{STRUCTURED_REQUIREMENT_JSON}}

请基于此文档输出功能清单。如果文档已足够完整，可直接转换格式；如有冲突或疑问，在 assumptions 中说明。
```

### 4.3 流程控制

```typescript
/** 生成流程控制 */
export interface GenerationFlow {
  /** 是否启用提示词优化器 */
  useOptimizer: boolean;

  /** 优化器结果 */
  optimizerResult?: OptimizedRequirement;

  /** 用户确认状态 */
  confirmationStatus: 'pending' | 'accepted' | 'edited' | 'skipped';
}

/** 生成流程状态机 */
export type FlowState =
  | { type: 'idle' }
  | { type: 'optimizing'; input: PromptOptimizerInput }
  | { type: 'confirming'; result: OptimizedRequirement }
  | { type: 'pipeline'; input: AnalystInput }
  | { type: 'done'; result: GenerateResult }
  | { type: 'error'; error: ErrorEventPayload };
```

### 4.4 事件协议扩展

在现有流式事件协议基础上，增加优化器相关事件：

```typescript
/** 优化器阶段事件 */
export type OptimizerStage = 'optimizing' | 'confirming';

/** 优化器 stage 事件负载 */
export interface OptimizerStagePayload {
  runId: string;
  stage: OptimizerStage;
  message: string;
}

/** 优化器完成事件负载 */
export interface OptimizerDonePayload {
  runId: string;
  result: OptimizedRequirement;
}

/** 扩展后的流式事件 */
export type StreamEvent =
  | { type: 'stage'; payload: StageEventPayload }
  | { type: 'delta'; payload: DeltaEventPayload }
  | { type: 'approval_required'; payload: ApprovalRequiredPayload }
  | { type: 'optimizer_stage'; payload: OptimizerStagePayload }
  | { type: 'optimizer_done'; payload: OptimizerDonePayload }
  | { type: 'done'; payload: GenerateResult }
  | { type: 'error'; payload: ErrorEventPayload };
```

### 4.5 时序示例

**场景：用户输入"做一个番茄钟"，启用优化器**

```jsonc
// t+0000ms  用户提交，优化器启动
{"type":"optimizer_stage","payload":{"runId":"r_7f3a","stage":"optimizing","message":"正在分析需求，补充细节…"}}

// t+0150ms ~ t+2800ms  优化器 JSON 流式输出
{"type":"delta","payload":{"runId":"r_7f3a","phase":"optimize","text":"{\"appTitle\":\"番茄时钟\""}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"optimize","text":",\"appType\":\"tool\""}}
// ... 更多 delta

// t+2900ms  优化器完成，进入确认阶段
{"type":"optimizer_done","payload":{"runId":"r_7f3a","result":{...}}}

// 用户在 UI 中查看结构化需求文档
// 用户点击"一键接受"

// t+5000ms  用户确认，进入三阶段流水线
{"type":"stage","payload":{"runId":"r_7f3a","stage":"analyzing","attempt":1,"message":"正在分析需求，拆解功能清单…"}}

// ... 后续与现有流水线相同
```

---

## 5. 代码实现思路

### 5.1 目录结构

```
src/services/ai/
├── prompts/                    # Prompt 模板（现有）
│   └── index.ts
├── optimizer/                  # 提示词优化器（新增）
│   ├── index.ts                # 导出入口
│   ├── types.ts                # 类型定义
│   ├── prompt.ts               # 优化器 Prompt 模板
│   ├── optimizer.ts            # 优化器核心逻辑
│   └── validator.ts            # 输出校验器
├── pipeline/                   # 流水线（现有）
├── adapter/                    # 模型适配器（现有）
└── demo/                       # 演示模式（现有）
```

### 5.2 核心类设计

```typescript
// src/services/ai/optimizer/types.ts

/** 优化器配置 */
export interface OptimizerConfig {
  /** 使用的模型 */
  model: string;
  /** 最大输出 token */
  maxTokens: number;
  /** 温度 */
  temperature: number;
  /** 超时时间（毫秒） */
  timeout: number;
}

/** 优化器默认配置 */
export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  model: 'gpt-4o-mini',  // 使用小型模型，节省成本
  maxTokens: 2048,
  temperature: 0.3,
  timeout: 30000,
};
```

```typescript
// src/services/ai/optimizer/prompt.ts

import { renderPromptTemplate } from '../prompts';

/** 优化器 System Prompt */
export const OPTIMIZER_SYSTEM_PROMPT = `...`;  // 见 2.1 节

/** 优化器 User Prompt 模板 */
export const OPTIMIZER_USER_PROMPT_TEMPLATE = `
## 用户原始需求
{{USER_PROMPT}}

## 用户选择的模板类型（可选）
{{TEMPLATE_HINT}}

## 界面文案语言
{{LOCALE}}

请分析用户需求，输出结构化需求文档。
`;

/** 渲染优化器 User Prompt */
export function renderOptimizerUserPrompt(
  userPrompt: string,
  templateHint: string,
  locale: string,
): string {
  return renderPromptTemplate(OPTIMIZER_USER_PROMPT_TEMPLATE, {
    USER_PROMPT: userPrompt,
    TEMPLATE_HINT: templateHint,
    LOCALE: locale,
  });
}
```

```typescript
// src/services/ai/optimizer/optimizer.ts

import type { ChatMessage, ModelAdapter } from '../adapter';
import type { OptimizerInput, OptimizedRequirement } from './types';
import { OPTIMIZER_SYSTEM_PROMPT, renderOptimizerUserPrompt } from './prompt';
import { validateOptimizerOutput } from './validator';

/** 提示词优化器 */
export class PromptOptimizer {
  private adapter: ModelAdapter;
  private config: OptimizerConfig;

  constructor(adapter: ModelAdapter, config: Partial<OptimizerConfig> = {}) {
    this.adapter = adapter;
    this.config = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
  }

  /**
   * 优化用户需求，输出结构化文档
   * @param input 用户输入
   * @param onDelta 流式输出回调
   * @returns 优化后的结构化需求文档
   */
  async optimize(
    input: OptimizerInput,
    onDelta?: (text: string) => void,
  ): Promise<OptimizedRequirement> {
    const messages: ChatMessage[] = [
      { role: 'system', content: OPTIMIZER_SYSTEM_PROMPT },
      { role: 'user', content: renderOptimizerUserPrompt(
        input.userPrompt,
        input.templateHint ?? '',
        input.locale,
      )},
    ];

    let rawOutput = '';

    const finishReason = await this.adapter.chatStream(
      messages,
      {
        model: this.config.model,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        signal: new AbortController().signal,
      },
      {
        onDelta: (text) => {
          rawOutput += text;
          onDelta?.(text);
        },
        onUsage: () => {},  // 优化器不关心 token 统计
      },
    );

    if (finishReason === 'aborted') {
      throw new Error('优化器被取消');
    }

    // 校验输出
    const result = validateOptimizerOutput(rawOutput);
    return result;
  }
}
```

```typescript
// src/services/ai/optimizer/validator.ts

import type { OptimizedRequirement, AppType } from './types';

/** 校验并解析优化器输出 */
export function validateOptimizerOutput(rawOutput: string): OptimizedRequirement {
  // 1. 尝试解析 JSON
  let parsed: unknown;
  try {
    // 移除可能的 markdown 代码围栏
    const cleaned = rawOutput.replace(/^```json\s*/i, '').replace(/\s*```$/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new OptimizerError('PARSE_FAILED', '优化器输出不是有效的 JSON');
  }

  // 2. 校验结构
  if (!isOptimizedRequirement(parsed)) {
    throw new OptimizerError('INVALID_STRUCTURE', '优化器输出结构不符合预期');
  }

  // 3. 校验字段内容
  if (!parsed.appTitle || parsed.appTitle.length > 20) {
    throw new OptimizerError('INVALID_TITLE', '应用标题必须为 1-20 个字符');
  }

  if (!isValidAppType(parsed.appType)) {
    throw new OptimizerError('INVALID_TYPE', `无效的应用类型: ${parsed.appType}`);
  }

  if (parsed.coreFeatures.length < 2 || parsed.coreFeatures.length > 4) {
    throw new OptimizerError('INVALID_FEATURES', '核心功能数量必须为 2-4 条');
  }

  // 4. 返回校验后的结果
  return parsed;
}

/** 类型守卫 */
function isOptimizedRequirement(value: unknown): value is OptimizedRequirement {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.appTitle === 'string' &&
    typeof obj.appType === 'string' &&
    typeof obj.summary === 'string' &&
    Array.isArray(obj.coreFeatures) &&
    Array.isArray(obj.auxFeatures) &&
    typeof obj.dataModel === 'object' &&
    typeof obj.uiLayout === 'string' &&
    typeof obj.theme === 'object' &&
    Array.isArray(obj.assumptions) &&
    Array.isArray(obj.questions)
  );
}

function isValidAppType(type: string): type is AppType {
  return ['dashboard', 'landing', 'todo', 'chart', 'tool', 'game', 'other'].includes(type);
}

/** 优化器错误 */
export class OptimizerError extends Error {
  constructor(
    public code: 'PARSE_FAILED' | 'INVALID_STRUCTURE' | 'INVALID_TITLE' | 'INVALID_TYPE' | 'INVALID_FEATURES',
    message: string,
  ) {
    super(message);
    this.name = 'OptimizerError';
  }
}
```

```typescript
// src/services/ai/optimizer/index.ts

export { PromptOptimizer } from './optimizer';
export type {
  OptimizerInput,
  OptimizedRequirement,
  OptimizerConfig,
  CoreFeature,
  AuxFeature,
  DataModel,
  ThemeConfig,
  Assumption,
} from './types';
export { DEFAULT_OPTIMIZER_CONFIG } from './types';
export { OptimizerError } from './validator';
```

### 5.3 与分析师阶段的集成

```typescript
// src/services/ai/pipeline/analyst.ts

import type { AnalystInput, FeatureList } from '../types';
import type { ConfirmedRequirement } from '../optimizer/types';
import { ANALYST_SYSTEM_PROMPT, ANALYST_USER_PROMPT_TEMPLATE, renderPromptTemplate } from '../prompts';

/** 构建分析师消息 */
export function buildAnalystMessages(input: AnalystInput): ChatMessage[] {
  const systemPrompt = input.structuredRequirement
    ? ANALYST_SYSTEM_PROMPT + '\n\n' + ANALYST_STRUCTURED_BLOCK
    : ANALYST_SYSTEM_PROMPT;

  const userPrompt = renderPromptTemplate(
    ANALYST_USER_PROMPT_TEMPLATE,
    {
      USER_PROMPT: input.userPrompt,
      LOCALE: input.locale,
      RECENT_CONTEXT: input.recentContext ?? '',
      STRUCTURED_BLOCK: input.structuredRequirement
        ? renderStructuredBlock(input.structuredRequirement)
        : '',
      ITERATION_CONTEXT: '',
    },
  );

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

/** 结构化需求文档块 */
const ANALYST_STRUCTURED_BLOCK = `
## 用户已提供结构化需求文档
用户已经通过需求澄清师梳理了需求，以下为确认后的结构化文档：
{{STRUCTURED_REQUIREMENT_JSON}}

你的任务是：
1. 验证结构化文档与用户原始需求的一致性
2. 将 coreFeatures 和 auxFeatures 转换为 features 格式
3. 如果发现文档与原始需求有明显冲突，在 assumptions 中标注
`;

/** 渲染结构化需求文档块 */
function renderStructuredBlock(requirement: ConfirmedRequirement): string {
  return `## 用户确认的结构化需求文档
${JSON.stringify(requirement.optimized, null, 2)}

请基于此文档输出功能清单。如果文档已足够完整，可直接转换格式；如有冲突或疑问，在 assumptions 中说明。`;
}
```

### 5.4 前端集成

```typescript
// src/stores/optimizerStore.ts

import { create } from 'zustand';
import type { OptimizedRequirement } from '../services/ai/optimizer';

interface OptimizerState {
  /** 是否启用优化器 */
  enabled: boolean;

  /** 优化结果 */
  result: OptimizedRequirement | null;

  /** 是否正在优化 */
  isOptimizing: boolean;

  /** 用户确认状态 */
  confirmationStatus: 'pending' | 'accepted' | 'edited' | 'skipped';

  /** 用户编辑内容 */
  editNotes: string;

  /** 开始优化 */
  startOptimize: (input: string) => Promise<void>;

  /** 确认（一键接受） */
  accept: () => void;

  /** 确认（手动编辑后） */
  acceptWithEdits: (edited: OptimizedRequirement, notes: string) => void;

  /** 跳过优化器 */
  skip: () => void;

  /** 重置 */
  reset: () => void;
}

export const useOptimizerStore = create<OptimizerState>((set, get) => ({
  enabled: true,
  result: null,
  isOptimizing: false,
  confirmationStatus: 'pending',
  editNotes: '',

  startOptimize: async (input: string) => {
    set({ isOptimizing: true, confirmationStatus: 'pending' });
    // 调用优化器服务...
  },

  accept: () => {
    set({ confirmationStatus: 'accepted' });
  },

  acceptWithEdits: (edited, notes) => {
    set({
      result: edited,
      confirmationStatus: 'edited',
      editNotes: notes,
    });
  },

  skip: () => {
    set({ confirmationStatus: 'skipped', result: null });
  },

  reset: () => {
    set({
      result: null,
      isOptimizing: false,
      confirmationStatus: 'pending',
      editNotes: '',
    });
  },
}));
```

---

## 6. 成本控制

### 6.1 Token 估算

优化器使用小型模型（如 `gpt-4o-mini`），单次调用成本极低：

| 组成部分 | 估算 |
|---------|------|
| System Prompt | 约 1.5k 字符 ≈ 0.5k tokens |
| User Prompt（含用户输入） | 约 100-500 字符 ≈ 0.1k tokens |
| Output JSON | 约 1k-2k 字符 ≈ 0.5k tokens |
| **总计** | 约 1k tokens |

对比三阶段流水线一次完整生成（约 11k tokens），优化器成本不到 10%。

### 6.2 省下的迭代成本

假设用户需求模糊，直接进入流水线：

- 第一次生成：11k tokens（结果不符合预期）
- 第二次迭代：14k tokens（用户修改需求）
- **总计**：25k tokens

如果先经过优化器：

- 优化器：1k tokens
- 第一次生成：11k tokens（结果符合预期）
- **总计**：12k tokens

节省约 50% token 成本。

---

## 7. 用户体验设计

### 7.1 UI 流程

```
┌─────────────────────────────────────────────────────────────────┐
│  输入框                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 做一个番茄钟                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [高级选项 ▼]  [直接生成]  [帮我完善需求]                        │
└─────────────────────────────────────────────────────────────────┘

                           ↓ 点击"帮我完善需求"

┌─────────────────────────────────────────────────────────────────┐
│  需求分析结果                                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 应用标题：番茄时钟                                        │   │
│  │ 类型：工具                                               │   │
│  │ 概述：一个专注于番茄工作法的计时器，支持工作/休息交替      │   │
│  │                                                          │   │
│  │ 核心功能：                                                │   │
│  │  ✓ F1: 25分钟工作计时器 - 圆形倒计时显示，开始/暂停按钮   │   │
│  │  ✓ F2: 5分钟休息计时器 - 自动切换，提示音提醒             │   │
│  │  ✓ F3: 番茄计数器 - 显示完成的番茄数                      │   │
│  │                                                          │   │
│  │ 辅助功能：                                                │   │
│  │  ○ A1: 统计记录 - 每日完成的番茄数统计                    │   │
│  │                                                          │   │
│  │ 假设：                                                    │   │
│  │  • 默认采用 25/5 分钟的番茄时间配置                        │   │
│  │                                                          │   │
│  │ 需要确认：                                                │   │
│  │  • 是否需要自定义番茄时间长度？                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [编辑修改]  [一键接受，开始生成]                                │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 交互细节

1. **默认启用优化器**：输入框下方默认显示"帮我完善需求"按钮
2. **可选跳过**：用户可点击"直接生成"跳过优化器
3. **一键接受**：绿色高亮按钮，默认焦点
4. **编辑模式**：点击"编辑修改"进入表单编辑模式
5. **问题快速回答**：如果优化器提出了问题，用户可快速回答

---

## 8. 自验证清单

- [x] 系统提示词设计完整，包含角色定义、硬性约束、输出格式、分析方法
- [x] 输入输出数据结构清晰，TypeScript 类型定义完整
- [x] 与现有三阶段流水线的集成方案明确，包括输入改造、事件协议扩展
- [x] 代码实现思路清晰，包含目录结构、核心类设计、前端集成
- [x] 成本控制方案合理，使用小型模型，token 估算有数据支撑
- [x] 用户体验设计完整，UI 流程图清晰

---

## 9. 待讨论

1. **优化器是否默认启用？** 建议：是，但提供跳过选项
2. **优化器使用什么模型？** 建议：`gpt-4o-mini` 或同等级别小型模型
3. **是否支持用户自定义问题回答？** 建议：是，用户可在确认面板回答问题
4. **迭代修改时是否复用优化器？** 建议：是，可作为可选功能