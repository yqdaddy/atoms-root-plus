# C 泳道验证证据：在线查询汇总 + 需求覆盖核对

- 日期：2026-09-25
- 执行者：dev-litpp-ai-engineer
- 独立验证：dev-litpp-reality-checker（两轮：主体验证 + MINOR 修复最小复验）
- 裁定：可交付（主体验证）→ 闭环（MINOR 复验）

## 提交链

| 提交 | 内容 | 验证 |
|------|------|------|
| a51e864 | feat: 新增在线查询汇总与需求覆盖核对能力（7 文件 +1325/-5） | 主体验证：可交付 |
| 21d9d10 | fix: 状态条补齐 search 阶段中文文案（MINOR-1 + 连带缺陷） | 最小复验：闭环 |
| 665d98d | fix: 需求覆盖核对拦截四字滑窗泛化词误报（MINOR-2） | 最小复验：闭环 |

## 能力 1：在线查询汇总

- 触发条件：`shouldTriggerWebSearch` 五类信号（external-library / external-api / version-uncertain / compatibility / complex-domain），server/utils/webSearch.ts:88-158
- 验证实证：three.js、echarts、高德地图、"最新版本 vue"、Safari 兼容 → 9/9 触发且归类正确；待办/计数器/计算器/记事本 CRUD → 全部不触发
- 调用时机：生成前（分析师 LLM 调用之前，llm.ts:913-936 搜索 → :964 分析师）
- 双注入：分析师 user message（llm.ts:959）+ 工程师首次生成 user message（llm.ts:1210-1213，经 PendingSession.searchContextBlock）
- SSE 通知：stage { phase: 'search' }（llm.ts:921）+ delta "正在查询相关资料..."（llm.ts:922-925）
- 降级矩阵四路径实证：WEB_SEARCH_ENABLED=false / 无 API key（duckduckgo 免 key 不受限）/ 单查询 8s 超时（AbortSignal.timeout）/ 全部失败静默跳过，均不抛异常不阻塞

## 能力 2：需求覆盖核对

- 提示词三层增强：分析师逐句阅读+列举独立成条+边界条件；工程师输出前自检 4 条；审查者第 3 维度逐条核对缺失即 fail
- 零 LLM 成本启发式：requirementCoverage.ts 四函数（extractRequirementItems / extractCoverageSignals / checkItemCoverage / buildCoverageNotice）
- 端到端实证："已实现 1/2 项需求，未覆盖：导出CSV（必须）。可补充说明后重试..."
- warning 事件（llm.ts:2024）+ done payload.coverage（llm.ts:2045）；只提醒不拦截（done 照常发出）
- 误报防线实证：无信号不误判（空需求 → covered=true）；动作词需命中代码痕迹（"删除任务"无痕迹 → 未覆盖，有 handleDelete → 覆盖）

## MINOR 缺陷闭环

### MINOR-1（前端，21d9d10）
- 原缺陷：liveEngine.ts STAGE_MAP 缺 'search' 条目 → 状态条显示"search 阶段"英文混排
- 修复：STAGE_MAP `search: 'analyzing'`（行 29）、STAGE_TO_PHASE `search: 'analyze'`（行 43）、STAGE_MESSAGES `search: '正在检索资料...'`（行 54）
- 连带修复：search delta 原经 `|| 'generate'` 回落混入代码面板，现归入思考区
- 新增 liveEngine.test.ts 4 用例（含多阶段时序回归、未知 phase 回落不抛错）

### MINOR-2（AI 泳道，665d98d）
- 原缺陷：4 字滑窗绕过仅 2 字的 GENERIC_NAME_WORDS，"任务清单管理"类泛化需求误报
- 修复：词表扩 4 字级（任务清单/清单管理/数据统计/信息管理/用户管理）+ 三道过滤（泛化区段相交排除 collectGenericCharSpans、双向包含匹配 hitsGenericNameWord、去缀形态比对）
- 防线完整性核查：ACTION_KEYWORDS 5 处引用未触碰，STOPWORDS/TECH_NOTICE/引号命名逻辑未动；新过滤逻辑为旧逻辑严格超集
- 反向对照："数据统计"仍走动作词防线（无统计痕迹 covered=false），证明修复是精准拦截而非放松检查
- 新增 7 回归用例

## 复验实测（2026-09-25 08:56-08:58）

- 全量测试：`npx vitest run` → Test Files 34 passed (34)，Tests 604 passed (604)，13.30s
- 类型检查：`npx tsc --noEmit` exit 0
- 提交链：665d98d → 21d9d10 → a51e864 → b704577，文件域零越界
- 被证伪宣称：无
- UNVERIFIED 项：无

## 协议向后兼容

- SSE phase 联合新增 'search'，done payload 新增 coverage 字段
- 前端对未知事件/字段安全忽略；liveEngine 三映射表为 Record<string,...> 带回落，向前兼容设计

## 配置说明（BYOK）

- WEB_SEARCH_ENABLED（默认 true）/ WEB_SEARCH_PROVIDER（duckduckgo 默认免 key / serpapi / bing）/ WEB_SEARCH_API_KEY / WEB_SEARCH_TIMEOUT_MS（默认 8000）/ WEB_SEARCH_MAX_RESULTS（默认 4）
- 未配置任何 provider 时优雅降级，不阻塞产品
