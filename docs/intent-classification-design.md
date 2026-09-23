# 意图识别与智能体编排设计方案

> 实现状态：Phase 1-3 已完成，Phase 4 待前端 UI 纠正入口实现。

## 1. Claude Code 机制分析

### 1.1 意图识别方式

**关键发现**：Claude Code 没有"意图识别"层。它采用"描述驱动选择"模式：

```typescript
// 智能体定义核心结构
interface AgentDefinition {
  agentType: string;           // 智能体类型标识
  whenToUse: string;           // 描述何时使用该智能体
  tools?: string[];            // 可用工具列表
  disallowedTools?: string[];  // 禁用工具列表
  model?: 'haiku' | 'inherit'; // 模型选择
  getSystemPrompt: () => string;
}
```

**工作流程**：
1. Agent tool prompt 中列出所有智能体的 `whenToUse` 描述
2. LLM 阅读智能体列表，根据任务特征自主选择
3. 这不是规则匹配，而是 LLM 自主判断

**示例 whenToUse 设计模式**：
- 第一句：角色定位（"Fast agent specialized for..."）
- 中间：触发条件与使用场景
- 结尾：可选参数指导（"specify thoroughness level: quick/medium/very thorough"）

### 1.2 智能体选择逻辑

**内置智能体类型**：
- **Explore**：只读搜索智能体，快速查找文件与代码
- **Plan**：架构规划智能体，设计实现方案
- **verification**：验证智能体，执行测试与检查
- **general-purpose**：通用智能体，无明确匹配时的默认选择

**Fork vs Subagent 模式**：
- **Fork**（`subagent_type` 省略）：继承父会话上下文，共享缓存，适合调研任务
- **Subagent**（指定 `subagent_type`）：零上下文启动，需要完整 briefing

**关键代码片段**（`tools/AgentTool/prompt.ts:82-96`）：
```typescript
// Fork 触发条件（qualitative，非量化）
// "will I need this output again" — 不需要保留在上下文中的任务
// Research: 开放式问题，可并行 fork
// Implementation: 超过几次编辑的实现工作
```

---

## 2. Litpp Demo 设计

### 2.1 意图分类体系

根据代码生成平台的特性，设计 4 种核心意图：

| 意图类型 | 触发条件 | 流程差异 | 输出 |
|---|---|---|---|
| **创建应用** | "创建/做一个/帮我写" + 空项目状态 | 完整四角色流水线 | 新项目文件 |
| **修改迭代** | 已有项目文件 + 修改指令 | 跳过分析师与批准，直接工程师增量修改 → 审查者 | 增量修改的文件 |
| **功能分析** | "分析/检查/解释" + 项目文件 | 只跑分析师，结果经 done.analysis 返回 | 分析报告（JSON/文本） |
| **问题诊断** | "为什么/报错/问题" + 项目文件 | 分析师（诊断模式），结果经 done.analysis 返回 | 诊断报告 + 修复建议 |

### 2.2 意图识别实现方案

**两层识别策略**：

1. **关键词匹配（快速路径，已实现）**：
   - 创建关键词：`创建`、`做一个`、`帮我写`、`生成`、`实现`
   - 修改关键词：`修改`、`改`、`调整`、`优化`、`增加`、`删除` + 现有项目
   - 分析关键词：`分析`、`检查`、`解释`、`说明`、`什么`
   - 诊断关键词：`为什么`、`报错`、`问题`、`不工作`、`bug`

2. **LLM 分类（预留接口，默认未启用）**：
   - 关键词匹配失败或冲突时，可调用轻量级 LLM 分类器（当前策略：关键词未命中时按项目状态兜底，LLM 分类留给误判率超标后再启用）
   - 输入：用户 prompt + 项目状态
   - 输出：意图类型 + 置信度

### 2.3 各意图的流程差异（已实现）

**创建应用（CREATE）**：
```
用户输入 → 意图识别(CREATE) → 需求优化器(可选) → 分析师 → 批准 → 工程师 → 审查者 → 交付
```

**修改迭代（MODIFY）**：
```
用户输入 → 意图识别(MODIFY) → [跳过分析师与批准] → 工程师(带现有文件) → 审查者 → 交付
```
**关键**：工程师 prompt 携带现有文件内容，强调"增量修改"原则；复用 `continueAfterApproval` 流程，避免重复实现。

**功能分析（ANALYZE）**：
```
用户输入 → 意图识别(ANALYZE) → 分析师 → done.analysis 返回（不进入工程阶段）
```
**用途**：用户想了解项目功能、代码结构、潜在问题；前端将 analysis 字段作为 assistant 消息展示。

**问题诊断（DIAGNOSE）**：
```
用户输入 → 意图识别(DIAGNOSE) → 分析师(诊断模式) → done.analysis 返回
```
**用途**：用户遇到 bug 或行为不符合预期，需要定位原因；返回结构化诊断 JSON。

---

## 3. 实现建议（已完成）

### 3.1 修改文件列表

**新增文件**：
- ✅ `server/intentClassifier.ts` — 意图识别模块（关键词 + 状态兜底，LLM 预留）
- ✅ `src/types/intent.ts` — 意图类型定义（前端契约，与 server 同构镜像）

**修改文件**：
- ✅ `server/llm.ts` — 根据 intent 选择不同流水线，新增 diagnose prompt 与三路分发函数
- ✅ `server/routes/llm.ts` — 接入 intentOverride 参数（白名单校验）
- ✅ `src/services/ai/types.ts` — GenerateResult 增加 analysis 字段，DeltaPhase 增加 diagnose
- ✅ `src/services/ai/liveEngine.ts` — 映射 diagnose 阶段，透传 intentOverride
- ✅ `src/stores/chatStore.ts` — diagnose 文本累积到 analyzeText
- ✅ `src/pages/HomePage.tsx` — done 事件优先处理 analysis 字段，避免误报空产物错误

### 3.2 关键代码片段（已落地）

#### 3.2.1 意图识别函数（`server/intentClassifier.ts`）

```typescript
export async function classifyIntent(
  context: IntentContext,
  llmClassify?: (prompt: string) => Promise<string>
): Promise<IntentResult> {
  // 1. 关键词快速匹配
  const keywordResult = matchKeywords(context);
  if (keywordResult && keywordResult.confidence > 0.8) {
    return keywordResult;
  }

  // 2. LLM 精确分类（预留，当前调用方未启用）
  if (llmClassify) { /* ... */ }

  // 3. 默认：基于项目状态兜底
  return {
    type: context.hasExistingProject ? 'modify' : 'create',
    confidence: 0.5,
    reasoning: '关键词未命中，基于项目状态推断',
  };
}
```

#### 3.2.2 意图分发（`server/llm.ts:generateWithStages` 节选）

```typescript
// 意图识别：先于一切阶段执行
const intent = intentOverride
  ? { type: intentOverride, confidence: 1, reasoning: '用户手动指定意图' }
  : await classifyIntent({ ... });

// 意图分发
switch (intent.type) {
  case 'analyze':
    return await runAnalyzePipeline(...);
  case 'diagnose':
    return await runDiagnosePipeline(...);
  case 'modify':
    if (hasExistingFiles) {
      return await runDirectModifyPipeline(...);
    }
    // 回退完整流水线
  case 'create':
  default:
    // 原有完整流水线（分析师 → 批准 → 工程师 → 审查者）
    // ...
}
```

---

## 4. 上下文裁剪策略（待实现）

当前迭代模式每次全量重发所有文件（`server/llm.ts` 注"简化"）：

**优化方向**：
1. 从 features 中提取用户改动意图，识别目标文件
2. 分析文件依赖闭包（imports、references）
3. 只携带相关文件，减少 token 消耗

**状态**：P2 优先级，留待后续 token 经济学专项解决。

---

## 5. prompt 单一真源

**当前状态**：
- `server/prompts.ts` 已存在（优化器 prompt 镜像副本）
- `server/llm.ts` 内的定义（分析师/工程师/审查者）暂未收敛

**建议方案**：
- 统一收敛到 `server/prompts.ts`，并标注版本号
- 前端 `src/services/ai/prompts.ts` 仅做展示/预览用途，通过共享常量或 API 同步

---

## 6. 验证要求（完成工作后自证）

### 6.1 意图识别示例

```
用户：创建一个待办事项应用
→ 意图识别: { type: 'create', confidence: 0.9, reasoning: '创建关键词命中 1 次 + 空项目' }
→ SSE 事件：
  { type: 'stage', payload: { phase: 'analysis', intent: { type: 'create', ... } } }
  { type: 'delta', payload: { phase: 'analysis', text: '{"appTitle":...' } }
  { type: 'approval_required', payload: { features: [...] } }
  [用户批准]
  { type: 'stage', payload: { phase: 'generate' } }
  { type: 'delta', payload: { phase: 'generate', text: '...' } }
  { type: 'stage', payload: { phase: 'review' } }
  { type: 'done', payload: { files: {...} } }

用户：把按钮改成蓝色
→ 意图识别: { type: 'modify', confidence: 0.85, reasoning: '修改关键词命中 1 次 + 已有项目' }
→ SSE 事件（跳过 analysis 与 approval）：
  { type: 'stage', payload: { phase: 'generate', intent: { type: 'modify', ... } } }
  { type: 'delta', payload: { phase: 'generate', text: '...' } }
  { type: 'stage', payload: { phase: 'review' } }
  { type: 'done', payload: { files: {...} } }

用户：分析一下这个项目有什么功能
→ 意图识别: { type: 'analyze', confidence: 0.85, reasoning: '分析关键词命中 1 次 + 已有项目' }
→ SSE 事件：
  { type: 'stage', payload: { phase: 'analysis', intent: { type: 'analyze', ... } } }
  { type: 'delta', payload: { phase: 'analysis', text: '该项目是一个待办事项管理应用...' } }
  { type: 'done', payload: { analysis: '...' } }  // 无 files，前端展示为 assistant 消息

用户：为什么点击删除按钮没反应
→ 意图识别: { type: 'diagnose', confidence: 0.9, reasoning: '诊断关键词命中 1 次' }
→ SSE 事件：
  { type: 'stage', payload: { phase: 'diagnose', intent: { type: 'diagnose', ... } } }
  { type: 'delta', payload: { phase: 'diagnose', text: '{"problem":...}' } }
  { type: 'done', payload: { analysis: '{"problem":"删除按钮事件未绑定",...}' } }
```

### 6.2 意图纠正入口（前端待实现）

前端可在 SSE 的首个 stage 事件中读取 `payload.intent`，展示识别结果：
- 若 confidence < 0.7，显示提示："检测为修改请求，如果这不是您的意图，可以点击「重新生成」并选择正确的意图"
- 提供"改为创建/修改/分析/诊断"按钮，点击后重新调用 API 并传入 `intentOverride`

### 6.3 usage 解析字段映射

**上游协议**（OpenAI 兼容，最后一个 SSE chunk）：
```json
{
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801
  }
}
```

**内部 stats 结构**（`src/services/ai/types.ts:GenerateStats`）：
```typescript
interface GenerateStats {
  mode: EngineMode;
  inputTokens: number;      // ← prompt_tokens
  outputTokens: number;     // ← completion_tokens
  durationMs: number;
  rounds: number;
}
```

**当前状态**：`server/llm.ts` 已有 `streamChatCompletion`，待从上游最后一个 chunk 解析 usage 并回填到 stats（原硬编码为 0）。

---

## 7. 总结

本方案借鉴 Claude Code 的"描述驱动选择"模式，结合代码生成平台的特性，设计了四意图分类体系：

1. **意图识别**：关键词快速匹配优先，未命中时按项目状态兜底（LLM 分类预留接口，待误判率超标后启用）
2. **流程编排**：根据 intent 动态调整流水线，修改迭代跳过分析师与批准，显著提速
3. **前端适配**：新增 diagnose 阶段与 analysis 输出契约，前端正确处理无代码的分析结果
4. **纠正入口**：提供 `intentOverride` 参数，前端可在识别错误时手动纠正

**实施优先级**：
- ✅ P0：意图识别核心逻辑（`intentClassifier.ts`）
- ✅ P1：修改模式流水线（跳过分析师与批准）
- ✅ P1：分析/诊断模式流水线（只跑分析师，返回 analysis）
- ⏳ P2：前端 UI 纠正入口（展示识别结果 + 纠正按钮）
- ⏳ P3：上下文裁剪优化
- ⏳ P3：usage 解析与成本核算

**风险评估**：
- 意图识别错误时，提供纠正入口（intentOverride）让用户手动指定
- 修改模式可能遗漏依赖文件，先实现简化版，后续优化依赖分析
- 诊断模式依赖用户描述清晰度，复杂问题可能需要多轮对话