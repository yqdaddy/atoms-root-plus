# Atoms Demo 自升级迭代状态

> 本文件是自升级迭代的核心载体。每轮迭代结束后由主 agent 更新「next-iteration 指令」。
> 唤醒指令固定：「继续 atoms-root-plus 自升级迭代：读取本文件，执行 next-iteration 指令」

## 幂等保护（每次唤醒先读这里）

- 「当前迭代」状态只有三种：待启动 / 进行中 / 已完成
- 待启动 → 执行 next-iteration 指令（委派 agent），并把状态改为「进行中」
- 进行中 → 不重新委派；检查对话上下文中已委派 agent 是否已返回，返回则做闭环（契约核对→复盘→推进），未返回则本轮触发跳过
- 已完成 → 不执行；仅当下一步明确（如等待用户输入）则说明等待原因
- 状态翻转必须先改本文件再委派，防止重复触发导致重复委派

## 迭代总目标

按笔试要求重做产品：AI App Builder 外壳，通过 Prompt 生成、修改并预览应用。
核心闭环：输入需求 → Agent 流水线生成单文件 HTML 应用 → iframe 沙箱实时预览 → 对话迭代修改 → 持久化保存。

## 当前迭代

- 轮次：Iteration 14（端到端测试与发布）
- 状态：进行中
- 负责角色：dev-atoms-reality-checker（验证）+ 后端架构师（部署）

## 迭代历史

### Iteration 13（用户注册与登录 + LLM Key 配置，已完成）
- 产出（后端 4 文件 + 前端 6 文件，reality-checker 验证通过）：
  - server/auth.ts：scrypt 密码哈希 + session 管理 + requireAuth 中间件
  - server/routes/auth.ts：POST /api/auth/register、login、logout、GET /me 四端点
  - server/db.ts：users 表 + sessions 表 + createUser/getUserByUsername
  - server/llm.ts：修复 model/baseURL 硬编码，改为读取 LLM_MODEL/LLM_BASE_URL 环境变量
  - src/services/auth.ts：认证 API 封装（credentials: 'include'）
  - src/stores/authStore.ts：认证状态管理（checkAuth/login/register/logout/setUser）
  - src/pages/AuthPage.tsx：登录/注册页面（Tabs 切换、前端校验、四态完备）
  - src/components/AuthControls.tsx：HomeAuthControls（首页右上角）+ SidebarAuthControls（侧栏底部）
  - src/pages/HomePage.tsx：右上角认证入口集成
  - src/components/ProjectSidebar.tsx：底部登录/退出入口
  - .env：配置 Agnes API Key + AUTH_SESSION_SECRET
  - 新增 5 个本地图标：lucide:user、log-out、eye、eye-off、loader-circle
- 验证结果（reality-checker 独立验证）：
  - 后端文件检查：4/4 PASS
  - 后端 API 检查：5/5 PASS（curl 实测注册/登录/登出/me 全部通过）
  - 前端文件检查：4/4 PASS
  - 前端集成检查：3/3 PASS
  - server/llm.ts 修复：2/2 PASS
  - 构建验证：2/2 PASS
  - 设计铁律：4/4 PASS
  - 安全检查：2/2 PASS（scrypt 哈希 + .env 在 .gitignore）
  - 边界情况测试：4/4 PASS（用户名冲突 409、错误密码 401、短密码 400、短用户名 400）
  - 总体通过率：100%（24/24），无缺陷
- 架构变更：
  - 新增本地账号体系：users 表存储用户，sessions 表管理会话
  - 密码安全：scrypt 哈希 + HMAC-SHA256 pepper（AUTH_SESSION_SECRET 派生）
  - 游客模式保留：未登录可完整使用，登录后项目按用户隔离
  - LLM 配置：从硬编码改为环境变量（LLM_MODEL、LLM_BASE_URL）
- 经验总结：
  1. 认证系统需三层验证：代码存在性 + API 运行时 + 边界情况（用户名冲突、错误密码等）
  2. 密码哈希必须常量时间比较（timingSafeEqual），防止时序攻击
  3. session cookie 需 HttpOnly + SameSite，前端 credentials: 'include' 携带
  4. 前端路由新增 /login /register 时需同步更新 App.tsx 路由逻辑
  5. TypeScript exactOptionalPropertyTypes 要求可选属性赋 undefined 时需显式类型兼容
- 下轮 prompt 升级点：
  1. 部署上线（GitHub Pages / Vercel / Cloudflare）
  2. Git 初始化并推送 GitHub
  3. 端到端测试真实 LLM 生成流程

## 迭代历史

### Iteration 12（后端 LLM 代理模式，已完成）
- 产出（后端 3 文件 + 前端 2 文件 + 架构文档，reality-checker 验证通过）：
  - server/llm.ts：三阶段流水线（analysis → generate → review）、SSE 流式输出、AbortSignal 取消
  - server/routes/llm.ts：POST /api/llm/generate、POST /api/llm/cancel 端点
  - .env.example：LLM_API_KEY 环境变量配置示例
  - docs/backend-proxy-architecture.md：架构设计文档（15520 字节）
  - src/services/ai/liveEngine.ts：改造为调用本地后端 /api/llm/generate，移除 apiKey/baseURL 逻辑
  - src/services/ai/index.ts：保留 demoEngine 降级逻辑
- 验证结果（reality-checker 独立验证）：
  - 文件存在性：4/4 PASS
  - 后端路由：5/5 PASS（SSE 流实测通过）
  - 前端改造：4/4 PASS
  - 降级逻辑：3/3 PASS
  - 构建验证：4/4 PASS
  - 设计铁律：4/4 PASS
  - 总体通过率：100%，无缺陷
- 架构变更：
  - v1（BYOK）：用户 localStorage 持有 API Key，前端直调 LLM API
  - v2（后端代理）：服务端环境变量持有 Key，前端调本地后端代理
  - 前端事件处理逻辑不变，降级逻辑保留
- 经验总结：
  1. 后端代理模式让用户无需配置 API Key 即可使用，体验优先
  2. SSE 流式代理需双层解析：后端解析 LLM SSE → 发射自己的 SSE 事件 → 前端解析
  3. 降级逻辑是关键兜底：后端不可用时自动回退 demoEngine，用户无感知
  4. 三阶段流水线移植到后端后，前端代码大幅简化（移除 500+ 行 prompt/流水线代码）
  5. 环境变量管理需文档化：.env.example + README 说明
- 下轮 prompt 升级点：
  1. 需配置实际 API Key 并测试端到端生成流程
  2. 部署与 Git 推送仍待完成
  3. 可选：添加请求限流、多 Provider 切换配置

## 迭代历史

### Iteration 0（团队搭建，已完成）
- 产出：7 角色 agent 团队 + dev-atoms 协调 skill + 项目 CLAUDE.md，5 门禁验证通过
- 经验：Skill 必须目录结构；执行者与验证者分离；门禁需要命令证据

### Iteration 1（地基轮：文档与方案，已完成）
- 产出（4 份，共 2445 行，契约核对通过）：
  - docs/PRD.md：19 条用户故事（11 P0 / 6 P1 / 2 P2），P0 底线全覆盖，延展首选 F-013 模板库
  - docs/design-system.md：atom 绿主色 #16bf80、Space Grotesk + JetBrains Mono、五视图×四态矩阵、26 条可测验收点、三级等待阶梯
  - docs/tech-sandbox.md：40 项 TS 类型导出（project/sandbox/storage 三文件）、6 类 postMessage 消息、T1-T13 威胁面分析、quota 四级降级
  - docs/tech-ai-pipeline.md：双引擎同协议（Live + Demo）、三阶段 prompt 模板、4 模板演示库（dashboard/landing/todo/chart）、硬校验与软审查分离、全量重生成迭代策略
- 经验总结：
  1. 四路并行的文档轮效率高，Handoff 契约让各文档的接口天然对齐（如 ai-pipeline 的事件协议与 sandbox 的消息类型可对接）
  2. 演示模式（无 key 可完整走流程）已在方案层确立为双引擎同协议架构，前端实现时无需感知引擎差异，这是 Iteration 3 的关键输入
  3. design-system 给了 Tailwind v4 @theme 片段，脚手架轮直接采用 Tailwind v4，避免 v3/v4 配置歧义
  4. tech-sandbox 的类型定义标注"可直接复制进 src/types/"，脚手架轮落地时以此为准，不重新设计
- 下轮 prompt 升级点：
  1. Iteration 2 脚手架必须引用具体文档章节（design-system token 表、tech-sandbox 类型定义），不允许前端自由发挥样式与类型
  2. 明确包管理器与 Node 版本约定，写入 CLAUDE.md 开发规范（避免轮次间环境漂移）
  3. 每轮产出必须跑 tsc --noEmit 验证并留证据（为最终 reality-checker 验收建立"新鲜证据"习惯）

### Iteration 2（脚手架轮，已完成）
- 产出（14 个文件，验证通过）：
  - 项目配置：package.json、tsconfig.json（严格模式）、vite.config.ts（Tailwind v4 插件）、index.html
  - 入口与路由：src/main.tsx、src/App.tsx
  - 设计 token：src/index.css（atom 绿 #16bf80、Space Grotesk + JetBrains Mono、深色背景 #09090b）
  - 类型定义：src/types/project.ts、src/types/sandbox.ts、src/types/storage.ts（原文复制自 tech-sandbox.md）
  - 页面骨架：src/pages/HomePage.tsx（居中输入框 + 4 模板 chips）、src/pages/WorkspacePage.tsx（对话面板 + 预览面板 + 侧栏占位）
- 验证结果：tsc 零错误、build 通过（287KB JS + 31KB CSS）、dev 启动成功（localhost:5176）
- 设计铁律：无 Inter 字体 / 无紫渐变 / 无手撸 SVG / 无 Em-dash
- 经验总结：
  1. 目录非空时 `npm create vite` 会失败，需手动初始化 npm 再安装依赖
  2. Tailwind v4 使用 `@import "tailwindcss"; @theme {}` 语法，不是 v3 的 `@tailwind` 指令
  3. 类型定义原文复制比重新设计更快，且保证与文档一致
  4. 两页面的静态骨架不接 store，迭代轮次聚焦单一目标
- 下轮 prompt 升级点：
  1. Iteration 3 AI 流水线需实现双引擎（Live + Demo），前端调用层无需感知差异
  2. Zustand store 需按领域拆分，不要单一大 store
  3. 流式输出需处理 SSE/事件流，前端渲染需配合流式更新

### Iteration 3（AI 流水线与演示模式，已完成）
- 产出（AI 层 14 文件 + UI 层 11 文件，验证通过）：
  - AI 服务层：
    - src/services/ai/types.ts：状态机（idle/analyzing/generating/reviewing/done/error）、事件协议（stage/delta/done/error）、接口定义
    - src/services/ai/demoEngine.ts：演示引擎（本地模板流水线、关键词匹配、模拟流式输出）
    - src/services/ai/liveEngine.ts：真实引擎（OpenAI 兼容 SSE、重试逻辑、repair rounds）
    - src/services/ai/index.ts：统一入口（getEngine、getAIAPI、createAIAPI）
    - src/services/ai/prompts.ts：三阶段提示词（PM 分析 → 工程师生成 → 审查者检查）
    - src/services/ai/htmlValidator.ts：HTML 完整性校验器（标签闭合、CSP 白名单）
    - src/services/ai/activeRun.ts：模块级运行注册表（跨实例取消）
    - src/services/ai/demoTemplates/：4 套模板（dashboard/landing/todo/chart）
  - UI 层：
    - src/stores/projectStore.ts：项目状态（currentId、summaries、双层持久化）
    - src/stores/chatStore.ts：对话流式状态（StreamBuffer 按 phase 追加）
    - src/stores/settingsStore.ts：设置（apiKey 不持久化、deviceMode、isFullscreen）
    - src/components/ChatPanel.tsx：对话面板（流式渲染、事件处理）
    - src/components/SandboxFrame.tsx：iframe 沙箱预览（sandbox + srcdoc + CSP 注入）
    - src/components/MessageRenderer.tsx：Markdown 渲染（代码高亮、复制按钮）
    - src/components/ProjectSidebar.tsx：侧栏项目历史
    - src/pages/HomePage.tsx：首页（模板 chip、生成流程）
    - src/pages/WorkspacePage.tsx：工作台（三栏布局）
    - src/lib/icons.ts：本地图标注册（23 个 lucide SVG）
- 验证结果：tsc 零错误、build 通过（411 KB / gzip 130 KB）、演示流程完整走通
- 设计铁律：无 Inter / 无紫渐变 / 无手撸 SVG / 无 Em-dash（grep 全部确认）
- 本轮发现并修复的 bug：
  1. 项目详情持久化缺失（zustand persist 只保存 currentId/summaries，files/chat 未落盘）→ 新增 persistProjectDetail() 在五个写入点调用
  2. switchProject 孤儿摘要（详情已丢的旧索引点击无响应）→ loadProject 失败时 deleteProject 清理
  3. 代码块 HTML 注入（正则高亮后直投 innerHTML）→ 高亮前先 escape HTML 实体
- 经验总结：
  1. 双引擎架构正确分离了演示模式与真实 LLM，前端调用 `getAIAPI()` 无需感知差异
  2. 流式事件协议（stage/delta/done/error）设计清晰，UI 层按 phase 路由到不同文本缓冲区
  3. 持久化需要双层机制：zustand persist 仅索引，详情需显式调用 persistProjectDetail()
  4. 沙箱隔离必须用 srcdoc + sandbox="allow-scripts"，主文档无法访问 iframe.contentDocument
  5. 本地图标注册（icons.ts + ?raw 导入）实现零运行时网络依赖，符合离线可用要求
- 下轮 prompt 升级点：
  1. Iteration 4 持久化需考虑 Supabase 云同步方案（可选，localStorage 已可用）
  2. 沙箱安全需完善 CSP 策略与 postMessage 协议版本控制
  3. 多轮迭代的 prompt 需传递「当前 HTML」作为上下文

### Iteration 4（持久化与沙箱安全，已完成）
- 产出（持久化服务层 6 文件 + UI 层 4 文件，验证通过）：
  - 持久化服务层：
    - src/services/storage/types.ts：ExportData、ImportOptions、ImportResult 类型定义
    - src/services/storage/export.ts：exportAllProjects()、downloadExport() 函数
    - src/services/storage/import.ts：importProjects()、validateExportFile()，支持 merge/overwrite 模式
    - src/services/storage/migration.ts：数据迁移系统，支持 schema 版本升级
    - src/services/storage/quarantine.ts：隔离备份机制，处理损坏数据
    - docs/persistence.md：完整持久化文档（280 行）
  - UI 层：
    - src/components/Modal.tsx：通用弹窗组件（ESC 关闭、overlay 点击关闭、滚动锁定）
    - src/components/Toast.tsx：Toast 通知系统（success/error/info 三种类型，Portal 渲染）
    - src/components/SettingsPanel.tsx：设置面板（Provider 预设 + 自定义 baseURL + API Key 输入）
    - src/components/ProjectSidebar.tsx：底部集成导出/导入/设置/清除按钮
- 验证结果：
  - tsc 零错误、build 通过（430 KB JS / 39 KB CSS）
  - 运行时验证：导出功能 ✅、设置面板 ✅、清除数据 ✅
  - 导入功能：代码实现正确，运行时受 Chrome MCP 限制无法实测（建议 Playwright 补充）
  - 沙箱安全：CSP 策略完整、postMessage 协议版本控制完善
- 设计铁律：无 Inter / 无紫渐变 / 无手撸 SVG / 无 Em-dash
- 经验总结：
  1. 持久化需要 envelope 格式（schemaVersion + savedAt + data），便于后续迁移
  2. API Key 安全：只存内存不落盘，设置面板需明确提示用户
  3. Toast 系统用 Portal 渲染到 document.body，避免被父容器 overflow:hidden 裁剪
  4. Modal 组件需处理滚动锁定（body overflow），防止背景滚动
  5. 导入功能文件上传在无头浏览器中受限，E2E 测试需用 Playwright 替代 Chrome MCP
- 下轮 prompt 升级点：
  1. Iteration 5 延展功能需实现真实可用的数据分析场景（图表模板 + 示例数据）
  2. 用户要求"真实系统平台"，需把演示模式中的模板变成实际可用功能
  3. 考虑数据导入（CSV/JSON）到生成应用的能力

### Iteration 5（延展功能与真实可用，已完成）
- 产出（数据服务层 4 文件 + 图表模板 4 文件 + UI 层 1 文件，验证通过）：
  - 数据导入服务：
    - src/services/data/types.ts：DataImportOptions、DataImportResult 类型定义
    - src/services/data/csvParser.ts：CSV 解析器（支持逗号/分号分隔、引号转义、自动类型推断）
    - src/services/data/jsonParser.ts：JSON 数据解析与校验
    - src/services/data/index.ts：统一导出（parseCSV、parseJSON、importData、inferFormat）
  - Chart.js 图表模板：
    - src/services/ai/demoTemplates/chartBarTemplate.ts：柱状图模板
    - src/services/ai/demoTemplates/chartLineTemplate.ts：折线图模板
    - src/services/ai/demoTemplates/chartPieTemplate.ts：饼图/环形图模板
    - src/services/ai/demoTemplates/chartRadarTemplate.ts：雷达图模板
    - 更新 demoTemplates/types.ts：扩展 DemoTemplateId 支持 chart-bar/line/pie/radar
    - 更新 demoTemplates/index.ts：注册新模板，关键词路由逻辑
  - UI 层：
    - src/components/DataImportPanel.tsx：数据导入面板（拖拽上传 + 表格预览 + 确认导入）
    - 更新 ProjectSidebar.tsx：新增"导入数据"按钮
  - AI 服务优化：
    - 更新 liveEngine.ts：添加调试日志、支持多轮迭代（currentHtml 传递）
    - 更新 prompts.ts：新增 ANALYST_ITERATION_CONTEXT_BLOCK 模板
    - 更新 htmlValidator.ts：新增 Chart.js 引用与响应式布局校验
- 验证结果：
  - tsc 零错误、build 通过（457 KB JS / 39 KB CSS）
  - 运行时验证：图表模板路由正确（柱状图/折线图/饼图/雷达图均渲染）
  - 数据导入：CSV/JSON 解析正确，表格预览显示
  - SandboxFrame：设备切换（375/768/1280px）、刷新、全屏功能正常
  - 发现 1 个 Major 缺陷（D1：首页提交后对话无 AI 响应）已修复
- 设计铁律：无 Inter / 无紫渐变（图表模板使用紫色单色值 #7c3aed，非渐变）/ 无手撸 SVG / 无 Em-dash
- 经验总结：
  1. 图表模板使用 Chart.js CDN（jsdelivr 白名单），符合沙箱 CSP 策略
  2. 关键词路由设计：strong（+2 分）与 weak（+1 分）权重，支持中英文混合匹配
  3. 数据导入面板需要处理错误路径：格式错误、解析失败、文件过大
  4. 多轮迭代需要传递 currentHtml 到 AI 分析阶段，告知"当前代码"
  5. 首页提交后需要添加 assistant 消息，避免跳转工作台后对话区只有用户消息
- 下轮 prompt 升级点：
  1. Iteration 6 发布准备需要考虑性能优化（打包体积、首屏加载）
  2. 可考虑添加真实 LLM 调用测试指南（如何验证 DeepSeek/Moonshot 等 Provider）
  3. 沙箱 localStorage 不可用是预期行为，模板不应依赖 localStorage 持久化主题设置

### Iteration 6（发布准备与性能优化，已完成）
- 产出（文档 3 份，验证通过）：
  - README.md：项目介绍、功能特性、快速开始、技术栈、项目结构（5689 字节）
  - docs/Performance-Analysis.md：性能分析报告（5557 字节）
  - docs/PRD-Coverage.md：PRD 覆盖率报告（5494 字节）
- 验证结果：
  - 打包体积：155.82 KB gzipped（符合 < 500 KB 目标）
  - PRD 覆盖率：84%（P0 100%，11/11 项全部实现）
  - tsc 零错误、build 通过（674ms）
  - 设计铁律：PASS
  - 安全检查：PASS
- 遗留功能（P1/P2）：
  - F-015 预览增强：设备切换逻辑部分实现
  - F-016 代码查看面板：仅有导出功能
  - F-017 版本历史与回滚：存储存在但 UI 未实现
- 经验总结：
  1. 打包体积优化需检查 Tree-shaking 是否生效
  2. README 应包含完整的使用说明，让用户快速上手
  3. PRD 覆盖率报告有助于识别功能缺口
  4. 移动端响应式需要更多测试和优化
- 项目状态：核心功能已完成，可进入发布/展示阶段

### Iteration 7（可选延展功能，已完成）
- 产出（代码查看面板，验证通过）：
  - src/components/CodeViewer.tsx：代码查看面板（HTML 语法高亮、行号、复制、导出）
  - 更新 SandboxFrame.tsx：添加"查看代码"按钮
  - 新增 lucide:code 图标
- 验证结果：
  - tsc 零错误、build 通过（471 KB JS / 41 KB CSS）
  - PRD 用户故事覆盖率：F-016 100%（8/8）
  - 设计铁律：PASS
- 经验总结：
  1. 代码查看面板自实现语法高亮，避免引入第三方库
  2. 复制功能使用 navigator.clipboard API
  3. 导出使用 Blob + URL.createObjectURL 生成下载链接
- 遗留项：
  - Minor：图标使用在线 iconify 引用，建议后续统一为本地引用

### Iteration 8（可选延展功能，已完成）
- 产出（移动端响应式优化，验证通过）：
  - src/pages/WorkspacePage.tsx：移动端（<768px）单栏 + segmented Tab 条（对话/预览，role="tablist"）互斥切换；侧栏抽屉（fixed inset-0 z-40 + 遮罩/Escape/x 三种关闭）；生成完成自动切预览 Tab（惰性初始化 + prevStatusRef 双路径）
  - src/components/ProjectSidebar.tsx：新增可选 prop onClose，抽屉模式渲染收起按钮
  - src/components/SandboxFrame.tsx：设备切换按钮组 hidden sm:flex，预览区 p-2 sm:p-4
  - src/components/ChatPanel.tsx：气泡 ml-4 sm:ml-8，完成文案去方位词
  - 新增本地图标 lucide:menu、lucide:message-square
- 验证结果（reality-checker 两轮）：
  - 第一轮：发现 D-01（major，首页主路径自动切 Tab 因竞态失效）+ D-02（minor，"右侧预览"方位词误导）；证伪执行者"HomePage 375px 溢出"宣称（实测 0px / 0 offenders）
  - 修复：mobileView useState 惰性初始化（chatStore stage==='done' && status==='ready' → 初始 preview）
  - 第二轮复测：D-01 主路径自动切预览 ✅、工作台二次生成路径 ✅、刷新停留对话 ✅、桌面三栏 ✅、Tab 互斥 ✅，结论通过
  - tsc 零错误、build 通过（474.77 KB JS / 41.57 KB CSS）
- 经验总结：
  1. 跨页面生成流程的竞态：HomePage 先置 ready 再 navigate，目标页挂载时状态转换已错过。用 chatStore 内存信号（stage==='done'）做 useState 惰性初始化兜底，刷新场景（stage 重置 idle）自然不误触发
  2. 移动端溢出根源是固定 min-width，改为 min-w-0 md:min-w-[480px] 双断点
  3. Playwright（脚本化轮询、精确断言）比 Chrome MCP 更适合响应式验证；reality-checker 用双场景对照（首页链路 vs 工作台内链路）精准定位竞态
  4. 执行者宣称需逐条实测：本轮证伪了"HomePage 溢出"这条边界外宣称，避免了不必要的修复
- 下轮 prompt 升级点：
  1. 用户提出轻量化服务端部署诉求（SQLite），Iteration 9 方向待用户从方案选项中确认后启动
  2. 若引入后端，持久化层需保持"localStorage 优先 + 可选云同步"的双路径兼容

### Iteration 9（轻量化服务端部署，已完成）
- 产出（服务端 5 文件 + 前端同步层 + 部署配置，reality-checker 三轮验证通过）：
  - server/index.ts：Hono 入口 + 静态托管（SPA fallback）+ CORS（prod 同源、dev 白名单）
  - server/db.ts：better-sqlite3（WAL 模式、5 条预编译参数化语句、INSERT OR IGNORE 幂等创建）
  - server/routes/projects.ts：CRUD + 身份契约（客户端 id 随 POST 上送，UUID_PATTERN 校验后采用，非字符串 400）
  - server/routes/health.ts、server/types.ts：健康检查与共享类型（UUID_PATTERN）
  - src/services/storage/apiSync.ts：健康检查（30s 缓存）、静默降级（API 不可用纯本地）、last-write-wins 合并
  - 部署：Dockerfile（multi-stage node:20-alpine）、docs/deploy.md、tsconfig.server.json、scripts（build:server/start/typecheck）
  - 修复 D-4（major，reality-checker 端到端实测发现）：前端 POST 只传 name、服务端自行生成 id 且前端不回读，导致 PUT 404×5、SQLite 只有空壳记录，同步实际失效。修复：客户端 id 随 POST 上送 + 服务端校验采用 + 幂等防御
- 验证结果（reality-checker 三轮）：
  - 第一轮：服务端 100%（6 API curl 实测、WAL 生效、参数化查询、CORS），浏览器 E2E 因工具缺失 UNVERIFIED
  - 第二轮（补测）：4 项 UNVERIFIED 清零（端到端流程通、离线降级、响应式回归、路径穿越无泄露），但发现 D-4 major（假同步）
  - 第三轮（修复复测，清库后）：(a) POST id 与 localStorage 一致 (b) PUT 200×5 零 404 (c) SQLite 行 id 一致 (d) 行内容 16580 字节真实生成数据（status=ready + 完整 chat），降级回归无损，结论通过
  - tsc 零错误、build 通过、build:server 通过
- 经验总结：
  1. 假同步教训：POST 201 + SQLite 新增行 + localStorage 有数据三者同时为真，同步仍可能是断的（id 断裂的空壳行）。集成验证必须核对两侧身份一致性与内容完整性，不能只看"接口各自通"
  2. 分布式身份契约：客户端生成 id 随创建请求上送（服务端校验后采用）优于服务端生成后回读重命名：无重命名竞态、PUT/DELETE 天然命中；配套 INSERT OR IGNORE 防网络重试主键冲突
  3. 验证环境要沉淀复用：/tmp/atoms-rc8-pw（playwright-core + Chrome for Testing executablePath）跨轮复用解决验证者工具缺失，验证脚本按场景固化
  4. 部署形态决定测试设计：生产是前后端同进程（3000 端口），kill server 测降级在形态上不成立；真实降级场景是 dev 分离形态（vite 5174 + API 3000）
  5. 验证脚本自身也会错：(d) 判定误报系脚本硬编码 'index.html'（实际 ENTRY_FILE_PATH='/index.html'），验证者结论需对照原始数据二次核对
- 下轮 prompt 升级点：
  1. 用户已提供 LLM：agnes-ai agnes-3.0-flash（baseURL https://api.agnes-ai.cn/v1，OpenAI 兼容，Bearer，SSE 流式），主 agent 已用用户 key 实测非流式与流式均标准可用。Iteration 10 接入该 Provider
  2. key 安全铁律：仅经设置面板输入、内存保存不落盘、不写入任何仓库文件与提交
  3. 遗留 minor 不阻塞：deploy.md 的 sqlite3 json_extract 运维注记（本机 CLI 过旧）、SPA fallback 对未编码穿越返回 200+index.html 的语义观察（无安全影响）、导入重复 toast（Iteration 5 D2）、iconify 在线引用统一本地

### Iteration 10（接入 agnes-ai 真实 LLM，已完成）
- 产出（AI 服务接入 + 三缺陷修复，reality-checker 两轮验证通过）：
  - src/services/ai/liveEngine.ts：PROVIDER_PRESETS 增加 Agnes 预设（baseURL https://api.agnes-ai.cn/v1、defaultModel agnes-3.0-flash）；resolveDefaultModel 按 baseURL 匹配预设回填默认模型；STREAM_GAP_TIMEOUT_MS 30s → 90s（注释记录 Agnes 实测 38.9s 流停顿依据）
  - src/pages/WorkspacePage.tsx：两处原生 `<a href="/">` 改为 useNavigate SPA 导航（返回首页 + 新建项目）
  - src/components/ChatPanel.tsx + src/pages/HomePage.tsx：新增 revertProjectStatusAfterFailure()，error/catch/取消/校验失败分支统一回退项目状态（入口有有效 HTML 回 ready，否则 draft）
  - 设置面板：Provider 下拉可选 Agnes，key 仅内存保存（沿用安全模式）
- 验证结果（reality-checker 两轮）：
  - 第一轮：S2 刷新恢复 / S3 降级 / S4 key 卫生 PASS；S1 FAIL，三层归因（curl / 页面 raw fetch / 参数复刻探针）定位 D-5（major，原生锚点整页刷新清空内存 apiKey，"设置→回首页→生成"主路径静默降级 demo 且表面 toast 正常）+ D-6（major，Agnes 长输出存在 38.9s 流停顿且停顿后仍正常完成，30s 看门狗必杀导致端到端必失败）+ D-7（minor，失败后 status 永久卡 generating）
  - 修复后复测：S1 端到端首次全程 PASS（真实外呼 3 次全 200、done @44s/@53s 无超时、LLM 生成计数器 HTML 6618B 正确持久化 status=ready、主路径 配置→SPA返回→提交→真实生成→自动跳转 全通）；D-7 专项 PASS（无效 key → 401 → status 回退 ready）；S3/S4 回归无损
  - tsc 零错误、build 通过；key 明文零落盘（grep 仓库与脚本全干净）
- 两个假阳性插曲（均系验证脚本自身缺陷，产品无恙）：Toast 关闭按钮被 last() 选择器误中、localStorage 读取逻辑初值 bug
- 经验总结：
  1. 主路径假通过：设置面板保存成功 ≠ 主路径可用。D-5 让最自然的用户路径静默降级 demo 且表面完全正常（成功 toast 照出），功能点验证必须拼接成真实用户路径才有意义
  2. 内存态凭证 × 导航方式是隐式契约：apiKey 只存内存（安全设计）要求全站导航 SPA 化，任何原生锚点/整页刷新都是隐式清空凭证的 bug
  3. 传输层阈值要按 Provider 实测标定：对照实验三层归因（curl 同参数 / 页面内 raw fetch / 参数复刻探针）能快速定位"哪一层错"，避免盲目调参
  4. "协议层通了"≠"端到端通了"：第一轮验证前真实生成从未完整成功过（两次均超时），集成完成宣称必须以一次完整端到端成功为前提
  5. 测试失败先排除脚本自身：本轮两个假阳性均由验证脚本缺陷造成，归因产品前需脚本自证
- 遗留 minor（转入 Iteration 11 清理）：docs 两处流间隔旧值（Performance-Analysis.md、tech-ai-pipeline.md）；Toast 关闭按钮无 aria-label；Iteration 9 遗留（deploy.md sqlite3 注记、导入重复 toast、iconify 在线引用统一本地）

	### Iteration 11（文档同步与遗留 minor 清理，已完成）
	- 产出（三路并行，reality-checker 独立验证通过）：
	  - 文档同步（ai-engineer）：
	    - docs/Performance-Analysis.md:104 流间隔 30s → 90s，补充"相邻数据块间隔阈值、非总时长限制、38.9s 实测依据"完整说明
	    - docs/tech-ai-pipeline.md：流间隔 30s → 90s、429 重试 2 次、Retry-After 上限 60s、截断续写条件补"长度 > 800 字符"、三阶段参数表（分析师/审查者 max_tokens 2048、temperature 0.3/0.2/0）、Provider 表新增 Agnes 行
	    - 16 项参数审计与 liveEngine.ts 实际代码逐行对照一致；两文档 30s 旧值 grep 零残留
	    - 标记 2 个文档漂移（超出本轮边界，未修）：tech-ai-pipeline.md BYOK section 描述 `atoms.byok.v1` localStorage（实际为 `atoms:v1:settings` envelope）；4.2 设计预留功能（最近 5 条修改指令压缩 / HTML 超 40k 提示）未实现
	  - a11y 小修（frontend-developer）：
	    - src/components/Toast.tsx:61 关闭按钮 aria-label="关闭通知"，浏览器实测点击关闭生效
	    - src/components/Modal.tsx:77-90 role="dialog" + aria-modal="true" + aria-label={title} + 关闭按钮 aria-label="关闭"，ESC 实际关闭
	    - 仅记录未修（超出本轮范围）：Modal 无 focus trap 与初始焦点管理；Modal 无 title 时无可访问名称；Toast 容器无 role="status"/aria-live
	  - 遗留清单（frontend-developer + data-engineer）：
	    - src/components/ProjectSidebar.tsx handleDataImport 中重复 toast.success 已移除；DataImportPanel.tsx:112 为导入场景唯一来源，浏览器实测一次导入只出 1 个 toast
	    - src/lib/icons.ts 补 lucide:code 本地注册；assets/icons/index.json 从 2 条补全为 26 条，与 assets/icons/lucide/ 目录 26 个 SVG、icons.ts LOCAL_ICONS 三方程序化比对一致；Playwright 实测 iconify CDN 请求 0 条
	    - docs/deploy.md:165-189 新增"旧版 sqlite3 CLI 不支持 json_extract"排障节，本机 CLI 3.32.2 复现错误、Node better-sqlite3 替代方案验证通过
	- 验证结果（reality-checker 独立验收）：
	  - 文档与实现一致性：15/15 PASS（STREAM_GAP_TIMEOUT_MS、三阶段参数、Retry-After 上限、截断条件、Provider 表等逐项对照 liveEngine.ts）
	  - a11y 生效：7/7 PASS（Toast/Modal 标注与关闭行为浏览器实测）
	  - 遗留项关闭：9/9 PASS（导入 toast 唯一来源、iconify 三方一致 + 零 CDN、deploy.md 排障节）
	  - 新鲜构建：tsc 零错误、build 通过（851ms）
	  - 铁律不回退：无 Inter / 无紫渐变 / 无手撸 SVG / 无 Em-dash
	  - key 卫生：grep 仓库无 Agnes key 明文
	  - S1/S3 回归：S3 demo 降级 PASS；S1 Agnes 主路径 UNVERIFIED（验证脚本环境变量传递限制，非产品缺陷）
	  - 总体结论：P0 通过率 14/15 (93.3%)，无缺陷，可进入下一阶段
	- 经验总结：
	  1. 文档与代码同步需程序化对照，不能只靠执行者自述——本轮 16 项参数逐行 grep 验证，避免"看起来改了"实际遗漏
	  2. a11y 修复需浏览器实测：aria-label 存在不等于行为正确，关闭按钮点击后 toast 是否消失、ESC 后 modal 是否关闭都需要实测
	  3. iconify 本地化验证要三方一致：index.json / 目录 SVG / icons.ts LOCAL_ICONS 三方程序化 diff，单点检查会漏（fetch-icons.sh 按批重建导致历史丢失）
	  4. 验证环境复用提高效率：/tmp/atoms-rc8-pw 跨轮复用，验证脚本沉淀（iter11-verify.mjs），避免每次重建环境
	  5. 环境变量传递限制：Playwright 子进程默认不继承 process.env，需显式注入；无法注入时如实标注 UNVERIFIED，不伪造结果
	- 下轮 prompt 升级点（如有）：
	  1. ai-engineer 标记的 2 个文档漂移（BYOK localStorage 描述、4.2 设计预留功能）可纳入后续迭代范围
	  2. Modal focus trap / Toast aria-live 等进阶 a11y 可延后处理（当前三个使用方均传 title，基础标注已覆盖）

## next-iteration 指令

**项目核心功能已全部完成，架构已升级为后端代理模式。**

待完成项（笔试提交要求）：
1. 配置 `.env` 文件（填入实际 API Key）
2. 端到端测试真实生成流程
3. 部署上线（GitHub Pages / Vercel / Cloudflare）
4. Git 初始化并推送 GitHub


---

## 项目完成状态

**交付底线达成**：
- ✅ P0 功能 100% 实现（11/11）
- ✅ P1 延展功能：F-016 代码查看面板已实现
- ✅ 延展能力已交付 F-013 模板库 + F-014 图表场景
- ✅ 移动端响应式已交付（Tab 切换 + 侧栏抽屉，reality-checker 两轮验证通过）
- ✅ 轻量化服务端部署已交付（Node/Hono + SQLite + 可选同步 + Docker，reality-checker 三轮验证通过，D-4 假同步缺陷已修复复测）
- ✅ 真实 LLM 已接入（agnes-ai agnes-3.0-flash，主路径端到端验证通过：配置 → SPA 导航 → 三阶段流式生成 → 沙箱预览，D-5/D-6/D-7 已修复复测；无 key 时 demo 引擎降级保留）
- ✅ 后端代理模式已交付（Iteration 12：服务端持有 API Key，前端调用本地后端，reality-checker 验证通过 100%）
- ✅ 构建成功、设计规范通过、安全规范通过
- ✅ 文档完善（README + PRD 覆盖率 + 性能分析）

**可发布状态**：✅ 是（待配置 .env 与部署）
