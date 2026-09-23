# Litpp Demo：LLM 集成与生成流水线方案 v1

> Owner：dev-litpp-ai-engineer
> 版本：v1（Iteration 1 地基轮）
> 关联：`docs/iterations/state.md`、项目 `CLAUDE.md` 技术栈与设计铁律

## 0. 总体架构

### 0.1 核心决策

1. **整条流水线跑在浏览器端，v1 无自有后端**。用户在设置里配置 BYOK（自备 API key），前端直接向用户指定的 OpenAI 兼容接口发起流式请求。key 只存 localStorage，除用户自己配置的 baseURL 外不发给任何第三方。
2. **双引擎同协议**：`LivePipeline`（真实 LLM）与 `DemoPipeline`（本地模板）实现同一个事件发射接口。前端只消费统一事件流，不感知引擎差异。这保证无 key 用户走完「输入 → 阶段动画 → 出预览 → 对话迭代」完整闭环。
3. **产物铁律**：最终产物永远是单个自包含 HTML 文件（可内联 CSS/JS，外部资源仅限 CDN 白名单），交付前必过程序化校验。

### 0.2 目录结构建议

```
src/services/ai/
├── adapter/        # ModelAdapter 接口 + OpenAI 兼容实现（SSE 解析）
├── pipeline/       # 状态机、编排器、事件发射
├── prompts/        # 三角色 prompt 模板（版本化常量，禁止散落拼接）
├── validators/     # 程序化 HTML 校验（结构、闭合、语法、白名单）
└── demo/           # 演示模式：模板库、关键词匹配器、节奏模拟
```

### 0.3 BYOK 配置与安全边界

- localStorage 键名：`atoms.byok.v1`，结构：
  `{ "baseURL": string, "apiKey": string, "model": string }`
- 预设 provider（baseURL 可自由覆盖，兼容国内中转/聚合服务）：

| 预设 | baseURL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 阿里百炼（兼容模式） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| SiliconFlow | `https://api.siliconflow.cn/v1` |
| Agnes（agnes-ai） | `https://api.agnes-ai.cn/v1` |
| 自定义 | 任意用户填写 URL |

- 安全边界：key 不进任何日志、不进 error message、不进遥测；请求仅由浏览器直发用户配置的 baseURL。注意：部分中转不支持 CORS，报错时按降级矩阵给出解释与演示模式入口。

### 0.4 ModelAdapter 接口

```ts
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ModelAdapter {
  chatStream(
    messages: ChatMessage[],
    opts: { model: string; maxTokens?: number; temperature?: number; signal: AbortSignal },
    on: { onDelta(text: string): void; onUsage(u: { inputTokens: number; outputTokens: number }): void }
  ): Promise<{ finishReason: 'stop' | 'length' | 'aborted' | string }>
}
```

`OpenAICompatAdapter` 是 v1 唯一必做实现：`POST {baseURL}/chat/completions`，`stream: true`，`stream_options: { include_usage: true }`，用 `fetch` + `response.body.getReader()` 解析 SSE：逐行取 `data: {...}`，拼 `choices[0].delta.content`，`data: [DONE]` 结束，末尾 chunk 的 `usage` 字段回填真实 token 数（provider 不回填时用第 7 节估算器兜底）。`AnthropicAdapter` 为可选扩展，接口不变。

---

## 1. 生成流水线状态机

### 1.1 状态定义

| 状态 | 含义 | 入口动作 | 退出动作 |
|---|---|---|---|
| `idle` | 空闲，等待用户输入 | 清空运行上下文 | 分配 runId，构建本次运行的输入 |
| `analyzing` | 分析师拆解需求 | 发射 stage(analyzing)，开始流式接收分析 JSON | 解析并校验 featureList JSON |
| `generating` | 工程师生成 HTML | 发射 stage(generating)，流式接收 HTML | 累积完整 HTML，跑程序化校验 |
| `reviewing` | 审查者校验 | 发射 stage(reviewing)，跑 LLM 审查 | 产出 pass / fail + repairInstructions |
| `done` | 交付完成 | 发射 done 事件（含最终 HTML 与统计） | 无 |
| `error` | 失败终止 | 发射 error 事件 | 无 |

### 1.2 合法迁移

| 迁移 | 触发条件 | 前端收到的事件 |
|---|---|---|
| idle → analyzing | 用户提交 prompt | `stage` (analyzing, attempt=1) |
| analyzing → generating | 分析 JSON 解析成功且 features 非空 | `stage` (generating, attempt=1) |
| generating → reviewing | HTML 累积完成且程序化硬校验通过 | `stage` (reviewing, attempt=1) |
| reviewing → done | 审查 pass，或仅软性问题（见 1.4） | `done` |
| reviewing → generating | 审查 fail，进入修复轮（attempt=2，最多 1 次） | `stage` (generating, attempt=2, meta.repairReason) |
| error → idle | 用户点击重试或重新输入 | （无事件，新 run 开始时发 stage） |
| done → analyzing | 用户对话迭代修改 | `stage` (analyzing, 新 runId) |

### 1.3 异常迁移

| 迁移 | 触发条件 | 事件 |
|---|---|---|
| analyzing → error | 分析 JSON 连续 2 次解析失败 / 网络故障 | `error` (PARSE_FAILED / NETWORK_TIMEOUT 等) |
| generating → error | 流中断、截断不可恢复、程序化硬校验连续 2 轮失败 | `error` (TRUNCATED / PARSE_FAILED) |
| reviewing → error | 修复轮后程序化硬校验仍失败 | `error` (PARSE_FAILED, fallbackToDemo=true) |
| 任意活跃态 → idle | 用户点击停止（AbortController.abort） | `error` (CANCELLED, retryable=false)，保留已生成内容但不计入 done |

幂等保护：每次运行分配 `runId`，事件 payload 携带 `runId`；store 收到非当前 runId 的事件直接丢弃，防止取消后残留旧事件污染 UI。

### 1.4 审查分级（硬校验与软审查分离）

- **程序化硬校验**（validators，确定性，先跑）：DOCTYPE/html/body 完整、script 标签闭合、脚本语法可编译、长度边界、CDN 白名单。硬校验不过不发 LLM 审查，直接构造 repairInstructions 进修复轮。
- **LLM 软审查**（reviewer 角色）：功能覆盖、交互真实性、体验底线。软审查 fail 且修复轮后仍 fail → **按现状交付 done + warnings**（不阻塞交付），只有硬校验连续失败才走 error。理由：演示场景下「有一个能跑的应用 + 一条警告」远好于「报错」。

### 1.5 各状态对前端的 stage 事件

| 状态 | stage 事件示例 payload |
|---|---|
| analyzing | `{ stage: 'analyzing', attempt: 1, message: '正在分析需求，拆解功能清单…' }` |
| generating | `{ stage: 'generating', attempt: 1, message: '正在生成应用代码…' }` |
| generating（修复轮） | `{ stage: 'generating', attempt: 2, message: '审查未通过，正在修复：标签未闭合、缺少图表初始化', meta: { repairReason: string[] } }` |
| reviewing | `{ stage: 'reviewing', attempt: 1, message: '正在校验代码完整性与功能覆盖…' }` |

---

## 2. 三阶段角色 Prompt 模板

全部模板存于 `src/services/ai/prompts/`，以版本化常量导出，占位符用双花括号显式命名。渲染函数只做占位符替换，不做任何字符串拼接逻辑。

### 2.1 分析师（Analyst）：需求拆解，输出 JSON

**System：**

```text
你是 Litpp 平台的需求分析师。你的唯一职责：把用户的一句话需求拆解为一份可在浏览器内完整演示的前端应用功能清单。你不写代码。

## 硬性约束
1. 最终产物是纯前端单文件 HTML 应用：不允许假设任何后端服务、数据库、登录体系或第三方私有接口。
2. 数据持久化只允许使用 localStorage。
3. 功能最多 6 条，按 MVP 裁剪：priority 为 must 的功能最多 4 条。
4. 每条功能必须是浏览器内可完整演示的真实交互，禁止出现"等待接口返回""调用服务端"这类无法演示的描述。

## 输出格式
只输出一个 JSON 对象，禁止输出任何解释、markdown 代码围栏或其他文字。结构如下：
{
  "appTitle": "应用标题，12 字以内",
  "appType": "dashboard | landing | todo | chart | tool | other 中最贴近的一个",
  "summary": "一句话概述，40 字以内",
  "features": [
    { "id": "F1", "name": "功能名，10 字以内", "description": "功能描述，30 字以内", "priority": "must 或 nice" }
  ],
  "interactions": ["关键交互列表，最多 6 条，每条一句话"],
  "assumptions": ["你做出的假设，最多 3 条，可为空数组"]
}
```

**User：**

```text
用户需求：{{USER_PROMPT}}

界面文案语言：{{LOCALE}}
（{{LOCALE}} 为 zh-CN 时 appTitle 与全部界面文案用中文，否则用英文）

补充上下文（可为空）：{{RECENT_CONTEXT}}
（迭代修改时填入此前应用的一句话摘要；首次生成填空字符串）
```

占位符说明：`{{USER_PROMPT}}` 用户原始输入原文；`{{LOCALE}}` 固定值 `zh-CN` 或 `en`；`{{RECENT_CONTEXT}}` 迭代时传入此前 done 应用的 summary，首次传空串。

### 2.2 工程师（Engineer）：生成单文件 HTML

**System：**

```text
你是 Litpp 平台的前端工程师。你根据功能清单生成一个可直接运行的单文件 HTML 应用。你只输出 HTML，不输出任何解释文字。

## 产物铁律
1. 单文件自包含：全部 HTML/CSS/JS 在一个文件内，浏览器直接打开或写入 iframe srcdoc 即可运行。
2. 输出第一行是 <!DOCTYPE html>，最后一行是 </html>，中间不夹任何解释，不使用 markdown 代码围栏。
3. 禁止任何后端网络请求。数据持久化只用 localStorage。
4. 外部资源只允许以下 CDN 白名单，白名单之外禁止任何 src/href 引用：
   - https://cdn.jsdelivr.net（Chart.js、ECharts、iconify 等）
   - https://cdnjs.cloudflare.com
5. 图标一律用 iconify（如 <span class="iconify" data-icon="mdi:check">）或白名单内图标库 CDN，禁止手写 SVG 图标。

## 设计规范（必须遵守）
- 字体禁用 Inter，使用系统字体栈：system-ui, "PingFang SC", "Microsoft YaHei", sans-serif
- 禁用紫色渐变；配色使用一个明确主题色加中性灰阶，保证文字对比度
- 布局响应式，移动端不塌陷；间距与圆角成体系
- CSS 全部集中在 <style>，JS 全部集中在 </body> 前的一个 <script>
- 中文文案使用中文标点

## 交互与数据要求
- 必须真实可交互：按钮可点、表单可填、列表可增删改查，禁止纯静态展示
- 首屏必须有完整可见内容，不允许白屏或加载占位
- 事件绑定放在脚本末尾或 DOMContentLoaded 回调中，确保元素已存在
- 使用 localStorage 时以固定 key 存储，并在页面加载时恢复

## 输出前自检
输出结束前逐条确认：所有标签闭合；<script> 内无语法错误；功能清单中 priority 为 must 的功能全部有对应实现；无白名单外资源。有问题先修正再输出。
```

**User（首次生成）：**

```text
## 应用功能清单
{{FEATURE_LIST_JSON}}

## 用户原始需求
{{USER_PROMPT}}

请生成这个应用。
```

**User（修复轮，attempt=2）：**

```text
## 当前应用完整 HTML
{{CURRENT_HTML}}

## 必须修复的问题（逐条修复）
{{REPAIR_INSTRUCTIONS}}

## 用户原始需求
{{USER_PROMPT}}

输出修复后的完整 HTML（全量输出，不是片段），未涉及的部分保持原样。
```

占位符说明：`{{FEATURE_LIST_JSON}}` 分析师输出的 JSON 原文；`{{USER_PROMPT}}` 用户原始输入；`{{CURRENT_HTML}}` 当前最新完整 HTML；`{{REPAIR_INSTRUCTIONS}}` 换行分隔的修复条目（来自程序化校验错误或审查者 repairInstructions）。

### 2.3 审查者（Reviewer）：校验与修复指令

**System：**

```text
你是 Litpp 平台的质量审查者。你审查一个单文件 HTML 应用是否合格交付。你不重写代码，只输出审查结论。

## 审查维度（按顺序逐条检查）
1. 结构完整：有 <!DOCTYPE html>、<html>、<head>、<body> 且标签全部闭合
2. 脚本可执行：<script> 内无明显语法错误；JS 中引用的 DOM id/class 在 HTML 中真实存在
3. 功能覆盖：功能清单中 priority 为 must 的每条功能在代码中有对应实现
4. 交互真实：按钮与表单有事件绑定和对应处理逻辑，不是纯静态
5. 资源合规：外部资源只来自 cdn.jsdelivr.net 与 cdnjs.cloudflare.com 两个白名单域名
6. 体验底线：首屏有可见内容；无紫色渐变；未使用 Inter 字体

## 输出格式
只输出一个 JSON 对象，禁止输出其他任何文字：
{
  "pass": true 或 false,
  "checks": [
    { "item": "结构完整", "pass": true, "note": "一句话说明，20 字以内" }
  ],
  "repairInstructions": []
}
约束：checks 必须覆盖上述 6 个维度，item 名称依次为：结构完整、脚本可执行、功能覆盖、交互真实、资源合规、体验底线。
pass 为 false 时 repairInstructions 必填：最多 3 条，每条是一个具体、可独立执行的修复指令（指明改哪里、怎么改）。
pass 为 true 时 repairInstructions 必须是空数组。
```

**User：**

```text
## 功能清单
{{FEATURE_LIST_JSON}}

## 待审查的完整 HTML
{{GENERATED_HTML}}
```

占位符说明：`{{FEATURE_LIST_JSON}}` 同工程师；`{{GENERATED_HTML}}` 待审查的完整 HTML 原文。

### 2.4 迭代修改时的分析师变体（附加指令块）

迭代轮次中，分析师模板在 System 末尾追加以下块，产出「修改计划」（同 JSON 结构，features 描述的是变更项）：

```text
## 本次为迭代修改任务
用户会对现有应用提出修改要求。你的 features 列表描述的是"本次需要落地的变更项"而非全新功能；
must 条目即本次必须完成的修改。请在 assumptions 中列出你无法从描述中确定的点。
```

---

## 3. 流式事件协议

### 3.1 事件类型定义

统一信封：`{ type: 'delta' | 'stage' | 'done' | 'error', payload }`。

```ts
type StagePayload = {
  runId: string
  stage: 'analyzing' | 'generating' | 'reviewing'
  attempt: number                       // 第几轮，1 起始；修复轮为 2
  message: string                       // 前端直接展示的中文提示
  meta?: Record<string, unknown>        // 如 repairReason、matchedTemplate
}

type DeltaPayload = {
  runId: string
  phase: 'analyze' | 'generate' | 'repair'   // 决定渲染位置：分析流进思考区，代码流进代码面板
  text: string                          // 原始增量文本，前端只做追加，不解析
}

type DonePayload = {
  runId: string
  html: string                          // 最终完整 HTML
  warnings: string[]                    // 软性问题警告，如"功能覆盖不完整，已按现状交付"
  stats: {
    mode: 'live' | 'demo'
    inputTokens: number                 // 无 usage 时为估算值
    outputTokens: number
    durationMs: number
    rounds: number                      // 实际执行轮数（含修复）
  }
}

type ErrorPayload = {
  runId: string
  code: 'NETWORK_TIMEOUT' | 'RATE_LIMITED' | 'TRUNCATED' | 'PARSE_FAILED'
      | 'AUTH_FAILED' | 'CORS_BLOCKED' | 'CANCELLED'
  message: string                       // 面向用户的中文友好文案，禁止包含 key
  retryable: boolean
  fallbackToDemo: boolean               // true 时前端展示"改用演示模式"入口
  detail?: string                       // 原始错误，仅调试面板展示
}
```

时序约定：一个 run 内事件严格有序；`done` 与 `error` 互斥且必为末事件；`delta.phase` 与当前 stage 对应（repair 阶段的 delta 属于 generating 态的 attempt=2）。

### 3.2 完整时序示例

场景：用户输入「做一个销售数据仪表盘，带图表和筛选」，首次生成，一轮通过。

```jsonc
// t+0000ms  用户提交，流水线启动
{"type":"stage","payload":{"runId":"r_7f3a","stage":"analyzing","attempt":1,"message":"正在分析需求，拆解功能清单…"}}

// t+0210ms ~ t+2300ms  分析师 JSON 流式输出（前端渲染在"思考"区）
{"type":"delta","payload":{"runId":"r_7f3a","phase":"analyze","text":"{\"appTitle\":\"销售数据仪表盘\""}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"analyze","text":",\"appType\":\"dashboard\",\"summary\":\"含 KPI 卡片、趋势图表与维度筛选的销售概览\""}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"analyze","text":",\"features\":[{\"id\":\"F1\",\"name\":\"KPI 概览\",\"description\":\"展示总销售额等核心指标\",\"priority\":\"must\"},"}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"analyze","text":"{\"id\":\"F2\",\"name\":\"趋势折线图\",\"description\":\"按月销售额趋势\",\"priority\":\"must\"},{\"id\":\"F3\",\"name\":\"维度筛选\",\"description\":\"按地区与时间筛选\",\"priority\":\"must\"}]"}}

// t+2400ms  分析 JSON 完成，本地解析通过
{"type":"stage","payload":{"runId":"r_7f3a","stage":"generating","attempt":1,"message":"正在生成应用代码…"}}

// t+2450ms ~ t+14800ms  工程师 HTML 流式输出（前端代码面板逐段滚动）
{"type":"delta","payload":{"runId":"r_7f3a","phase":"generate","text":"<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">"}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"generate","text":"\n<style>\n:root{--accent:#0e7490;--bg:#f8fafc}\nbody{font-family:system-ui,\"PingFang SC\",\"Microsoft YaHei\",sans-serif}"}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"generate","text":"\n…（KPI 卡片与图表容器 markup，略）…"}}
{"type":"delta","payload":{"runId":"r_7f3a","phase":"generate","text":"\n<script src=\"https://cdn.jsdelivr.net/npm/chart.js@4\"><\/script>\n<script>\nconst data=JSON.parse(localStorage.getItem('sales-demo')||'null')||seed;\n…（渲染与筛选逻辑，略）…\n<\/script>\n</body>\n</html>"}}

// t+14900ms  生成完成，程序化硬校验通过
{"type":"stage","payload":{"runId":"r_7f3a","stage":"reviewing","attempt":1,"message":"正在校验代码完整性与功能覆盖…"}}

// t+16800ms  LLM 审查 pass
{"type":"done","payload":{"runId":"r_7f3a","html":"<!DOCTYPE html>…完整 HTML…","warnings":[],"stats":{"mode":"live","inputTokens":7120,"outputTokens":3940,"durationMs":16800,"rounds":1}}}
```

异常时序（审查 fail 触发修复轮）：

```jsonc
{"type":"stage","payload":{"runId":"r_9b2c","stage":"reviewing","attempt":1,"message":"正在校验代码完整性与功能覆盖…"}}
{"type":"stage","payload":{"runId":"r_9b2c","stage":"generating","attempt":2,"message":"审查未通过，正在修复：图表未初始化、筛选按钮无事件绑定","meta":{"repairReason":["图表 canvas 存在但未调用 new Chart 初始化","#filter-bar 内按钮未绑定 click 事件"]}}}
{"type":"delta","payload":{"runId":"r_9b2c","phase":"repair","text":"<!DOCTYPE html>…"}}
{"type":"stage","payload":{"runId":"r_9b2c","stage":"reviewing","attempt":2,"message":"正在校验修复后的代码…"}}
{"type":"done","payload":{"runId":"r_9b2c","html":"…","warnings":[],"stats":{"mode":"live","inputTokens":15800,"outputTokens":7100,"durationMs":32400,"rounds":2}}}
```

### 3.3 前端消费与预览刷新策略

- delta(analyze) 追加到聊天气泡的思考区（折叠展示）；delta(generate/repair) 追加到右侧代码面板并自动滚动。
- iframe 预览仅在 `done` 时用 `srcdoc` 整体刷新，生成过程中不刷新（避免半成品 HTML 反复报错、性能抖动）。流式可见性由代码面板承担。

---

## 4. 迭代修改策略

### 4.1 决策：v1 采用全量重生成，不做增量补丁

| 维度 | 全量重生成（选定） | 增量补丁（search/replace 或 JSON Patch） |
|---|---|---|
| 产物一致性 | 高：单 artifact，无合并态 | 低：补丁打错即双版本漂移 |
| 失败模式 | 与首次生成相同，已有校验链覆盖 | 新增"锚点匹配失败"类故障，需再兜底回全量 |
| 流式体验 | 代码面板持续追加，预览一次刷新 | 需先攒全补丁再应用，流式意义弱 |
| 输出 token | 高（重发整个 HTML，约 2.5k~4.5k） | 低（仅改动区，约 0.3k~1k） |
| 实现复杂度 | 低：复用首次生成链路 | 高：补丁协议设计、应用器、冲突处理 |

选择理由：增量补丁省下的 token，抵不过锚点匹配失败带来的新增故障面与实现成本；演示产品的第一优先级是"每次迭代都成功出预览"，全量重生成把失败模式收敛到已有降级链内。输出 token 成本用 4.2 的上下文裁剪控制在可接受范围。

### 4.2 上下文携带策略（成本控制）

**已实现的多轮上下文传递：**

- **前端采集**：迭代请求时，前端从 `currentProject.chat` 提取最近 12 条对话（过滤 system 消息），每条消息预裁剪至 2000 字符；同时传递当前项目文件 `currentFiles` 与原始需求（首条用户消息）。
- **服务端压缩**：`buildChatContextBlock` 函数从传入的对话中选取最近 5 条用户指令及其对应的助手回复摘要，应用字符上限（用户 200 字符，助手 120 字符）和总块上限（1600 字符），生成"对话上下文"文本块。
- **Prompt 注入位置**：
  - 分析师阶段：对话上下文块追加到用户消息 `## 此前的对话上下文` 节。
  - 工程师阶段（迭代模式）：对话上下文块追加到用户消息 `## 用户修改需求` 之后。
- **当前文件携带**：迭代模式下，前端发送 `currentFiles`（项目文件映射），服务端工程师阶段以此构建"当前项目文件"节，输出仅变更文件，未变更文件通过 `toFileNodeRecord` 合并保留。
- **首轮生成**：`chatTurns` 为空，无上下文注入，行为不变。

**预算参数与理由：**

| 参数 | 值 | 理由 |
|---|---|---|
| MAX_USER_TURNS | 5 | 4.2 设计：最近 5 条修改指令，覆盖典型迭代场景 |
| USER_MSG_CAP | 200 字符 | 用户指令通常简短，200 字符足够保留语义 |
| ASSISTANT_MSG_CAP | 120 字符 | 助手回复为摘要/确认，无需全文 |
| TOTAL_BLOCK_CAP | 1600 字符 | 约 1000 tokens，相对工程师 input（含文件内容 10k+ 字符）占比 <10% |

**预检算力（未实现）**：40k 字符提示功能未实现，属于 v2 演进项。

### 4.3 v2 演进路径（本次不实现）

若迭代成本成为瓶颈，升级为结构化编辑协议：模型输出 `{ anchor: 精确原文片段, replacement: 新片段 }` 数组，应用器逐条精确匹配替换；任一条匹配失败即整体回退全量重生成。收益是常态轮次输出 token 降约 60%，代价是保留全量链路作为兜底。

### 4.4 演示模式下的迭代

演示模式迭代按 6.4 的小规则集变更模板配置（改色、深色模式、改标题），不可识别的指令重发同一模板并在聊天中如实说明"演示模式已按当前模板重新生成"。

---

## 5. 降级矩阵

| 故障类型 | 检测方式 | 降级动作 |
|---|---|---|
| 网络超时 | fetch 层：AbortController 计时，首字节超 20s 或相邻数据块间隔超 90s 主动 abort（流间隔为相邻 chunk 间隔阈值，每收到 chunk 即重置，非总时长限制；取值依据：实测 Agnes 长输出存在约 38.9s 服务端流停顿且停顿后流仍正常完成，故取实测最大值的 2 倍以上余量）；fetch reject 且非人为 abort | 指数退避重试 2 次（1s、3s）→ 仍失败发 `error(NETWORK_TIMEOUT, retryable=true, fallbackToDemo=true)`，UI 给重试按钮与"改用演示模式"入口 |
| 429 限流 | HTTP status 429；优先读 Retry-After 响应头 | 有 Retry-After 按其值等待（单次上限 60s）重试至多 2 次；无则退避 5s、15s 重试至多 2 次 → 仍 429 发 `error(RATE_LIMITED, retryable=true, fallbackToDemo=true)`，文案提示"请求过于频繁，稍后重试或切换演示模式" |
| 内容截断 | finish_reason === 'length'；或流未收到 [DONE] 即断；或累积 HTML 缺 `</html>` | 若已含完整 body、script 配平且长度 > 800 字符：按现状降级交付 done + warning"内容被截断，已按可用部分交付"；否则自动发起 1 次续写请求（携带已生成文本，maxTokens 沿用工程师阶段的 8192）→ 续写后仍不完整发 `error(TRUNCATED, retryable=true, fallbackToDemo=true)` |
| HTML 解析失败 | 程序化硬校验：DOCTYPE/html/body 缺失、script 未闭合、`new Function` 编译脚本抛 SyntaxError、白名单外资源 | 校验错误转 repairInstructions 进修复轮（attempt=2）→ 修复轮硬校验仍失败发 `error(PARSE_FAILED, retryable=true, fallbackToDemo=true)`，UI 提供"用演示模板代替"一键切换 |
| 无效 key / 鉴权失败 | HTTP 401 或 403 | 发 `error(AUTH_FAILED, retryable=false, fallbackToDemo=true)`，文案提示检查设置中的 key，提供跳转设置与切换演示模式入口 |
| CORS 拦截 | fetch reject TypeError 且无响应体、非超时 | 发 `error(CORS_BLOCKED, retryable=false, fallbackToDemo=true)`，解释"该接口不允许浏览器直连，请更换支持 CORS 的中转地址"，提供演示模式入口 |
| 用户取消 | 用户点击停止，AbortController.abort | 发 `error(CANCELLED, retryable=false, fallbackToDemo=false)`，状态回 idle，保留已生成代码于代码面板，不计为失败 |

设计原则：任何 `error` 都不裸抛；payload 必含中文友好文案，`fallbackToDemo=true` 时前端必须给出进入演示模式的操作入口，保证"失败可降级、无 key 可演示"。

---

## 6. 演示模式设计

### 6.1 触发条件

1. 用户提交 prompt 时检测到 localStorage 无有效 key；
2. 用户在任意 error 入口主动切换；
3. 设置面板显式开关。

### 6.2 模板库结构

```ts
interface DemoTemplate {
  id: 'dashboard' | 'landing' | 'todo' | 'chart'
  name: string                    // 展示名，如"数据仪表盘"
  description: string
  keywords: {
    strong: string[]              // 权重 2：强指向词
    weak: string[]                // 权重 1：弱关联词
  }
  analystScript: FeatureListJSON  // 预写好的分析 JSON，analyzing 阶段流式吐出
  config: {
    title: string                 // {{TITLE}} 注入
    accent: string                // {{ACCENT}} 主题色注入
    dark: boolean                 // {{THEME}} 注入
  }
  html: string                    // 完整模板 HTML，含 {{TITLE}}/{{ACCENT}}/{{THEME}} 占位符
}
```

模板库（4 个，均满足：自包含、真实交互、无白名单外资源、遵守设计铁律）：

| id | 名称 | 内容与交互 | 持久化 |
|---|---|---|---|
| `dashboard` | 数据仪表盘 | 侧边栏 + 4 张 KPI 卡 + 折线/柱状图（Chart.js）+ 可排序数据表；时间范围筛选联动图表与表格 | localStorage 存筛选状态与数据快照 |
| `landing` | 产品落地页 | Hero + 特性卡 + 定价三档 + FAQ 手风琴 + CTA；滚动显隐动画；CTA 弹出表单可提交 | localStorage 存表单提交记录 |
| `todo` | 待办清单 | 增删改查、勾选完成、优先级标签、分类筛选、全部/已完成视图切换、清空已完成 | localStorage 完整持久化任务列表 |
| `chart` | 图表展示 | ECharts 多图（折线、柱状、饼图、散点）；数据集切换器、图表类型切换、悬浮提示 | localStorage 记住上次选择的数据集 |

### 6.3 关键词匹配规则

对 prompt 做小写化后逐模板计分：命中 strong 词 +2，命中 weak 词 +1；英文词用词边界正则（如 `/\btodo\b/`），中文词用包含匹配。得分最高者胜；并列或全为 0 分时回退 `todo`（交互与持久化展示最完整，最能撑起演示）。

| 模板 | strong（权重 2） | weak（权重 1） |
|---|---|---|
| dashboard | 仪表盘、dashboard、监控、后台管理 | 数据、统计、概览、报表、工作台 |
| landing | 落地页、landing、官网、主页、产品介绍页 | 宣传、营销、发布页、品牌页 |
| todo | 待办、todo、任务清单、清单 | 计划、日程、事项、打卡 |
| chart | 图表、chart、可视化大屏 | 折线、柱状、饼图、趋势、数据分析 |

匹配结果会在 analyzing 阶段的聊天流中如实展示（如"识别为：数据仪表盘"），演示模式不伪装成真实分析。

### 6.4 阶段节奏模拟（真实感延迟）

演示管线复用同一状态机与事件协议，仅数据来源为本地。所有延迟带 ±15% 随机抖动，且每步检查 AbortSignal 保证可取消：

| 阶段 | 时长 | 行为 |
|---|---|---|
| analyzing | 1.2s ~ 1.8s | 把 `analystScript` JSON 切成 40~90 字符小块，每 60~120ms 吐一个 delta(analyze) |
| generating | 2.5s ~ 4.5s（与模板长度成正比） | 把实例化后的 HTML 切成 30~80 字符块，每 15~40ms 吐一个 delta(generate) |
| reviewing | 0.8s ~ 1.2s | 只有 stage 事件；内部真实跑一遍程序化硬校验（模板必过，兼作模板回归测试） |
| done | 即时 | 交付实例化 HTML，`stats.mode='demo'`，inputTokens/outputTokens 置 0 |

迭代修改（演示模式）：识别"换色/蓝色/绿色等色词"改 `config.accent`；"深色/暗色"切 `config.dark`；引号文本改 `config.title`；其余指令重发当前模板并如实说明。保证迭代闭环可演示且不虚假承诺。

---

## 7. Token 成本估算

### 7.1 估算方法

真实值优先取响应 `usage` 字段（`stream_options.include_usage`）；估算器仅在预检（发请求前算预算、控截断风险）与 provider 不回填时使用：

```text
中文文本 tokens ≈ 字符数 × 0.6        （约 1.7 字符/token）
英文与代码 tokens ≈ 字符数 / 3.5
混合段分类别计算后求和；prompt 模板本身按字符数计入 input
```

### 7.2 一次典型生成的估算示例

场景：「做一个销售数据仪表盘，带图表和筛选」，生成 HTML 约 11k 字符，一轮通过：

| 阶段 | input 构成 | input 估算 | output 构成 | output 估算 |
|---|---|---|---|---|
| 分析师 | 模板约 1.4k 字符（中文为主）+ prompt 30 字符 ≈ 0.9k tok | 0.9k | 分析 JSON 约 700 字符混合 | 0.35k |
| 工程师 | 模板约 2.6k 字符 + featureList JSON 约 0.8k + prompt ≈ 2.0k tok | 2.0k | HTML 11k 字符 ≈ 3.2k tok | 3.2k |
| 审查者 | 模板约 1.5k 字符 + featureList 0.4k + HTML 11k ≈ 4.3k tok | 4.3k | 审查 JSON 约 500 字符 | 0.3k |
| 合计 | | 约 7.2k | | 约 3.9k |

- 首次生成一轮：约 11k tokens（in 7.2k + out 3.9k）。
- 含一次修复轮：审查者重跑 + 工程师携带全量 HTML 重生成，约 17k~19k tokens。
- 一次迭代轮：input 增加当前 HTML（约 +3.5k），output 与首次相当，单轮约 14k~16k tokens。
- 截断防护：工程师阶段 `maxTokens` 设 8192（分析师与审查者阶段为 2048；temperature：分析师 0.3、工程师 0.2、审查者 0）；预检估算 output > maxTokens 的 90% 时，在分析师约束下进一步裁剪 nice 功能并提示用户（预检为设计预留，当前 liveEngine 实现未包含）。

### 7.3 成本语义

BYOK 模式下费用由用户自己的 key 承担，产品侧不垫付；演示模式 0 token 成本。该估算方法用于：设置面板展示"本次会话预计消耗"、截断风险预检、以及迭代轮次膨胀监控。

---

## 8. 自验证清单（对照角色契约）

- [x] 流式事件协议含从首个 delta 到 done 的完整时序（3.2 节，含正常与修复轮两条）
- [x] 三角色 prompt 模板可直接复制使用，占位符（`{{USER_PROMPT}}`、`{{LOCALE}}`、`{{RECENT_CONTEXT}}`、`{{FEATURE_LIST_JSON}}`、`{{CURRENT_HTML}}`、`{{REPAIR_INSTRUCTIONS}}`、`{{GENERATED_HTML}}`）均有定义与填充来源
- [x] 降级矩阵覆盖网络超时、429 限流、内容截断、HTML 解析失败，另补鉴权失败、CORS、用户取消
- [x] 输出约定：最终产物为单文件自包含 HTML，程序化校验规则明确（DOCTYPE/闭合/语法编译/长度/CDN 白名单，见 1.4 与第 5 节）
- [x] 演示模式保证无 key 用户走完核心闭环：同一状态机与事件协议，4 模板 + 关键词匹配 + 节奏模拟（第 6 节）
- [x] token 消耗估算方法与典型值（第 7 节）
