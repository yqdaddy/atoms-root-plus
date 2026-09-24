# 软件工程化生成策略设计方案

状态：方案设计（待评审）
作者：dev-litpp-ai-engineer
日期：2026-09-24
关联：docs/generation-quality-report.md、docs/tech-multi-file-generation.md、docs/tech-sandbox.md

---

## 1. 背景与问题定位

当前生成管线（server/llm.ts 四角色流水线：意图分类 → 分析 → 生成 → 审查）产出的项目是"文件集合"而非"软件工程"：

| 问题 | 证据 | 影响 |
|------|------|------|
| 无工程元文件 | 提示词（server/prompts-v2.ts）文件清单里没有 README.md、DESIGN.md、package.json | 不符合 npm 工程规范，用户拿到代码无法理解项目结构与运行方式 |
| React 组件拆分是"假"的 | prompts-v2.ts 要求 `/src/components/` 按功能拆分，但 src/services/sandbox/jsxCompiler.ts 的 `__compileAndRun` 对每个文件单独 `new Function('React','ReactDOM', code)` 执行； Sucrase 只做 `['jsx']` transform，输出中的 `import` 语句留在函数体内直接语法错误 | 组件文件一旦互相引用，预览必然黑屏。模型要么被迫全写进 main.jsx（拆分失效），要么输出 import（预览崩溃） |
| 审查无工程维度 | REVIEWER_SYSTEM_PROMPT_V2 七个维度全是"单应用质量"，没有文档、依赖一致性、拆分合理性 | 工程化缺失不会被审查拦截 |
| 迭代无法新增文件 | llm.ts 的 ENGINEER_DIFF_PROMPT 要求 `changes[].file` "与输入中的文件路径完全一致"，applyChanges 对不存在的文件报错 | 工程化结构下的高频变更（新增组件文件）在 modify 意图下不可达 |

atoms.dev 参照产物（计算器示例）：DESIGN.md、calculator.ts 纯逻辑、use-calculator.ts 状态 hook、CalculatorKey/CalculatorDisplay/TapePanel 组件、Index.tsx 主页面、index.css、README.md。核心特征是：文档齐全、逻辑/状态/视图三层分离、组件粒度细。

**方案总原则：同一份代码，既能在沙箱预览里跑，又满足 npm 工程规范。不为预览妥协产物质量，也不为规范输出预览跑不了的代码。**

---

## 2. 目标产物规范

### 2.1 "能运行"的定义（两级）

| 级别 | 定义 | 校验方式 |
|------|------|---------|
| L1 预览可运行（硬性） | 生成的项目经 assembler 组装后在 iframe 沙箱中可交互，核心主流程可用 | 程序化校验（第 5.1 节）+ 人工冒烟 |
| L2 npm 工程一致（软性） | 目录结构、package.json 依赖声明、import 语句三者互相一致；用户 `npm install` 后具备开发起点 | 程序化校验（依赖一致性、import 断链） |

明确不做的事：不承诺用户本地 `npm run build` 构建通过（生成的是 CDN 运行时形态的 JSX，无 tsconfig/vite 配置）。README 中注明"预览由 Litpp 内置沙箱运行；npm 方式需 Node 18+，作为工程起点使用"。

### 2.2 文件清单标准

**html 模式**（改动最小）：

```
/index.html          # 入口（完整页面，按序引用 css/js）
/styles/main.css     # 全局样式
/src/main.js         # 入口脚本：初始化 + 事件绑定
/src/utils.js        # 纯逻辑函数（中大型项目才出现，可单测）
/README.md           # 新增：项目说明、运行方式、功能清单
```

跨文件引用约定（P0 过渡期）：html 模式的脚本按序内联进同一文档，经典 script 共享全局作用域，utils.js 以 `window.AppUtils.formatTime = ...` 形式暴露，main.js 直接调用。提示词显式写出这条约定（当前未写，模型可能写 import 导致断链）。

**react-cdn 模式**（工程化主战场，对标 atoms 结构）：

```
/index.html          # 入口（挂载点 root + CDN 引用，不含业务代码）
/package.json        # 真实依赖声明（react ^18、react-dom ^18）
/README.md           # 项目说明、运行方式、功能清单
/DESIGN.md           # 设计说明（结构、数据流、拆分理由）
/src/main.jsx        # createRoot 挂载，只做挂载
/src/App.jsx         # 根组件：布局与组装
/src/components/*.jsx# 视图组件（每文件一个组件，PascalCase.jsx）
/src/hooks/*.js      # 状态逻辑（useXxx 前缀，可单测）
/src/utils/*.js      # 纯逻辑（无 React 依赖，可单测）
/styles/main.css     # 全局样式（index.html 引用，禁止在 JS 里 import）
```

拆分粒度基准（写入提示词，避免过度拆分）：存在 2 个以上独立交互区域（如计数器键盘 + 显示区 + 历史记录）必须拆组件；纯展示型小应用（如简单计数器）允许 App.jsx 单文件，但 hooks/utils 分离仍适用（状态进 hooks，计算进 utils）。

**vue-cdn 模式**：跟随 react-cdn 的目录规范（components/hooks/utils 命名改为 kebab-case.js），模块运行时升级排 P2（见第 8 节）。

### 2.3 文件树元信息约束

- 所有路径以 `/` 开头（multiFileParser.ts isValidPath 已强制）。
- language 字段：md 推断为 text、json 为 json，parser 已支持，无需改动。
- done 事件契约不变：files Record 天然容纳新文件类型，前端文件树直接展示（工程化观感的主要来源）。

---

## 3. 模块 import 策略（核心决策点）

### 3.1 现状确认

- html 模式：脚本按序内联，全局作用域天然共享，**现状可用**，只需提示词固化约定。
- react-cdn 模式：`__compileAndRun` 逐文件 `new Function` 执行，文件间零共享；Sucrase 未开 imports transform，`import` 语句在输出中残留为语法错误。**组件拆分 + 互相引用当前不可用。**

### 3.2 候选方案对比

| 方案 | 做法 | 产物质量 | 预览可靠性 | 改动量 | 结论 |
|------|------|---------|-----------|--------|------|
| A. 单文件组件分节 | 提示词要求全部代码写进 main.jsx，注释分节 | 差（放弃拆分目标） | 高（现状路径） | 零 | 否决：与工程化目标矛盾 |
| B. 全局命名空间注册 | 组件文件末尾 `window.__components.X = X`，使用方读取 | 差（产物无 import，npm 规范不成立，依赖一致性无从校验） | 中 | 小 | 否决：污染产物，为预览牺牲规范 |
| C. 预览端模块运行时 | Sucrase 开 `imports` transform 转 CJS + 自写迷你 require 注册表 | 好（产物保留真实 ESM import，与 npm 规范完全一致） | 高（可控） | 中 | **采用，作为目标方案** |

### 3.3 方案 C 设计（目标方案，P1 实施）

**编译链路**：

```
/src/components/Counter.jsx
  import React from 'react';            （源码：真实 ESM import）
        │ Sucrase transforms: ['jsx', 'imports']
        ▼
  var _react = require('react'); ... React.createElement(...)
        │ 包装为模块注册
        ▼
__defineModule('/src/components/Counter.jsx', function(module, exports, require) {
  <编译产物>
});
...
__requireModule('/src/main.jsx');       （入口最后执行）
```

**运行时（assembler 注入的内联脚本，约 100 行）**：

1. `__defineModule(path, factory)`：注册模块到 `window.__modules` 表。
2. `__requireModule(path)`：惰性执行 + 缓存（CJS 语义），循环依赖按 CJS 部分导出处理并 console.warn。
3. bare import 白名单 shim：
   - `require('react')` → `Object.assign({ default: window.React, Fragment: window.React.Fragment }, window.React)`（React UMD 全局自带 useState 等 hooks 顶层属性）
   - `require('react-dom')` → 同构 shim，暴露 createRoot
   - 白名单外的 bare import → 抛带路径说明的错误（走 window error 桥接上报，提示语明确"该依赖未在白名单"）
4. 本地路径 require：以当前模块路径为基准 resolve（复用 assembler.resolvePath 的规则），注册表查不到 → 抛"模块不存在：/src/components/Xxx.jsx（检查 import 拼写）"。

**assembler 改动（src/services/sandbox/assembler.ts）**：

1. 新增依赖图解析：正则提取每个 jsx/js 文件的 `from '...'` 与裸导入，构建模块表。
2. `inlineJsScripts` 在 react-cdn 框架下改为"注册式"输出：所有 JSX 文件编译包装为 `__defineModule`，尾部追加 `__requireModule('/src/main.jsx')`。注册顺序 = 依赖拓扑序（惰性 require 下顺序非必需，但确定性顺序利于排查循环依赖）。
3. CSS 不参与模块系统：维持 `<link href="./styles/main.css">` 内联路径（提示词禁止在 JS 里 import css）。
4. Chart.js/ECharts 类图表库：仍走 index.html 的 CDN `<script>`，代码中直接用 `window.Chart`，禁止 import（提示词固化，与产品要求"图表默认引 CDN"一致）。

**Spike（P1 开工前必须验证，约半天）**：

- S1：Sucrase `['jsx','imports']` 组合下 jsx runtime 行为。若 imports transform 强制 automatic runtime（注入 `require('react/jsx-runtime')`），则补一个 jsx-runtime shim（`jsx/jsxs` 用 `React.createElement(type, {...props, key: key ?? props.key}, children)` 实现）；否则保持 classic pragma + 每文件显式 `import React from 'react'`。两种都可落地，以实测为准写进提示词与运行时。
- S2：opaque origin（srcdoc 沙箱）下无新增网络依赖（运行时是内联脚本，Sucrase 已在 esm.sh 白名单），确认 CSP 零改动。

### 3.4 过渡方案（P0，运行时升级前的空窗期）

P0 期间 react-cdn 提示词退一档：允许组件拆分到 `/src/components/`，但**每个组件文件必须以 `window.__components = window.__components || {}; window.__components.Counter = Counter;` 结尾注册，使用方 `const Counter = window.__components.Counter;`**，禁止写 import。这条约定：

- 预览可靠（全局注册在逐文件 new Function 模型下成立）；
- 产物是"半工程"（无 import），因此 P0 只作为过渡，P1 上线模块运行时后提示词切换为真实 import，并删除注册约定；
- 审查者在 P0 阶段校验"组件文件必须含 window.__components 注册"，P1 切换后该校验替换为"import 目标文件必须存在"。

html 模式无空窗期问题，P0 直接按 2.2 的 window.AppUtils 约定执行（该约定长期有效，html 模式不引入模块运行时）。

---

## 4. 提示词改造方案

### 4.1 改造原则

- 只加"结构性约定"，不加解释性文字；每个规范一条规则，不做长示例。
- 工程化规范注入工程师系统提示词（框架段）与审查者提示词；分析师提示词不动（其 features/interactions 输出已是 DESIGN.md 模板的素材）。

### 4.2 工程师提示词改动明细

**ENGINEER_BASE_PROMPT_V2 新增一节（约 120 tokens）**：

```
## 工程化规范
- 文件输出顺序：/index.html 最先，其次入口脚本，再次组件，hooks/utils 随后，样式最后
- 逻辑/状态/视图分离：纯计算进 utils（不依赖 DOM 与框架），状态逻辑进 hooks，渲染进组件
- 命名：组件 PascalCase，hooks useXxx，utils 驼峰
- 每个文件单一职责，单文件不超过 150 行
- 禁止在 JS 中 import 样式文件，样式一律由 index.html 引用
```

**getFrameworkPromptV2('react-cdn') 重写（约 480 tokens，现约 300）**：

- 更新文件清单（2.2 的完整树，含 package.json/README/DESIGN 声明由平台注入，模型不得自行生成这三个文件，见 4.4 决策）；
- import 规则（P0 为 window.__components 过渡约定，P1 为真实 import + 白名单 + 路径含扩展名且必须与已生成文件一致）；
- 拆分粒度基准（2.2 末段）；
- 示例改为"App.jsx + Counter.jsx 两文件 + import"的极简示例（比现在的单文件示例多约 80 tokens，但这是 import 语义的最小锚点，保留）。

**getFrameworkPromptV2('html') 增补（约 60 tokens）**：utils.js 的 window.AppUtils 命名空间约定 + README 平台注入声明。

**getFrameworkPromptV2('vue-cdn')**：P1 仅增补工程化目录规范，import 运行时 P2。

### 4.3 审查者提示词改动明细（约 120 tokens）

REVIEWER_SYSTEM_PROMPT_V2 的七个维度后追加第 8 维度：

```
8. **工程化**：README/DESIGN/package.json 由平台注入不检查；检查：
   - 组件/逻辑/状态三层分离（纯计算不在组件内、状态不在渲染函数内）
   - 组件拆分与交互复杂度匹配（2 个以上交互区域未拆分为缺陷；单文件超 150 行为缺陷）
   - import 路径与实际文件一致（缺失即 fail 并列入 repairInstructions）
   - package.json 声明与实际 import 一致（只允许 react/react-dom）
```

### 4.4 决策点：README/DESIGN/package.json 由谁生成

| 选项 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| 甲：LLM 生成 | 提示词要求工程师输出三件套 | 文档个性化、深度接近 atoms | 输出 token +800~1500，8192 上限截断风险显著上升；截断抢救（repairTruncatedMultiFileOutput）只认 /index.html，文档丢失不可控；格式错误面扩大 |
| 乙：服务端模板生成 | 新建 server/utils/scaffoldDocs.ts，从 features JSON 填充 README/DESIGN 模板；package.json 按框架固定生成 | 零 LLM token、100% 存在、内容与功能清单强一致、可单测 | 深度是"模板级"（结构说明 + 功能清单 + 运行方式），无设计洞察 |
| 丙：混合（乙 + P2 增强层） | P0/P1 用乙；P2 增加一次小预算 LLM 调用（输入 features + 文件树，maxTokens 约 800）专写 README/DESIGN，失败静默回退模板 | 成本可控、质量可渐进提升 | P2 才有 |

**采用丙**。理由：截断风险是硬约束（当前 8192 上限受模型输出上限约束，见 llm.ts 注释），文档类内容模板化收益最大；atoms 级文档深度靠 P2 增强层渐进逼近。

模板填充素材已具备：features.appTitle/appType/summary/features/interactions（分析师 JSON）+ 文件树（generateFileTreeSummary）。DESIGN.md 模板结构：应用概况、模块划分（按实际文件树生成）、数据流说明（从 interactions 推导）、后续演进建议占位。

### 4.5 token 预算估算

估算方法沿用 prompts-v2.ts comparePromptTokens 的 chars/4 近似。当前基线（实机运行 comparePromptTokens 可得精确值，以下为估算）：

| 提示词 | 现状（估） | 改造后（估） | 增量 |
|--------|-----------|-------------|------|
| 分析师 | 约 700 | 约 700 | 0 |
| 工程师 base | 约 700 | 约 820 | +120 |
| 工程师 react 框架段 | 约 300 | 约 480 | +180 |
| 工程师 html 框架段 | 约 180 | 约 240 | +60 |
| 审查者 | 约 450 | 约 570 | +120 |
| 单次生成系统提示合计（react） | 约 1850 | 约 2270 | +420 |

可控性判断：总提示词回到 3060 以下的路径不追求，因为 V2 精简验证的是"注意力稀释主因是重复表格与冗余示例"，本次增量全部是结构化规则（清单式、无重复），稀释风险远低于同 token 的原版。P1 上线后用评测集（dev-litpp-ai-evaluator 的 golden prompts）回归确认质量不降。

---

## 5. 审查者升级：确定性校验 + LLM 审查双层

### 5.1 确定性校验器（零 token，先于 LLM 审查执行）

新建 `server/utils/projectValidator.ts`（纯函数，配套单测 projectValidator.test.ts）：

```
validateProject(files, framework) → {
  errors: [{ code, file, message }],   // 硬失败，触发修复
  warnings: [...],                     // 软提示，仅记录
}
```

| 规则 | code | 级别 | 说明 |
|------|------|------|------|
| 入口存在 | E_ENTRY | error | /index.html 存在（parser 已兜底，此处双保险） |
| 三件套存在且非空 | E_SCAFFOLD | error | 由服务端注入保证，校验兜底防注入逻辑回归 |
| package.json 可解析 | E_PKG_JSON | error | JSON.parse 通过 |
| 依赖一致性 | E_PKG_DEPS | error | import 的 bare 包必须 ⊆ {react, react-dom} 且在 dependencies 中声明 |
| import 断链 | E_IMPORT_MISSING | error | 本地 import 路径 resolve 后必须存在于 files 集合 |
| import 空悬 | E_IMPORT_UNUSED | warning | 文件存在但无人引用（提示垃圾文件） |
| 引用闭环 | E_REF_MISSING | error | index.html 的 script/link 引用文件必须存在（assembler warnings 已有，收编进统一报告） |
| 注册约定（P0 过渡） | E_GLOBAL_REG | error | react 组件文件须含 window.__components 注册；P1 移除 |
| 拆分超限 | W_FILE_SIZE | warning | 单文件超 150 行 |

修复路径：errors 非空时，**先走一次带错误清单的重新生成（复用现有 formatErrorHint 重试机制，maxRetries 1）**，仍失败则降级交付（附 warnings 面板提示），不阻塞 done 事件。这条规则与"任何失败不让用户面对裸报错"一致。

diff/modify 模式当前跳过 LLM 审查，但**确定性校验必须执行**（在 applyChanges 之后跑，修复走一次重试）。

### 5.2 LLM 审查维度

即 4.3 的第 8 维度，负责定性判断（拆分合理性、三层分离），与确定性校验互补：程序管"存在性与一致性"，模型管"合理性与品味"。

---

## 6. 迭代模式兼容

### 6.1 变更语义矩阵（工程化结构下）

| 修改请求类型 | 现有能力 | P1 方案 |
|-------------|---------|--------|
| 改组件内部逻辑/样式 | diff 模式行级编辑，可用 | 不变 |
| 新增组件/hook/util 文件 | **不可达**（diff 只能改已存在文件） | ChangeList 扩展 `"action": "create"`（含完整 content）与 `"delete"`；旧格式（无 action）默认 "edit"，向后兼容 |
| 删除文件 | 不可达 | 同上 delete |
| 修改 README/DESIGN | 不可达（文档不在 LLM 视野） | P0/P1：模板文档不随 modify 变更（功能清单变了 README 会失真，接受，README 定位为"初始说明"）；P2 文档增强层可重生成 |
| 大规模结构调整 | diff 行级编辑易碎 | 启发式升级：分析师/意图判断不出（modify 直通无分析师），改用确定性启发，diff 应用失败率 > 30% 或用户请求含"重构/重新组织/拆分"关键词时回退全量文件模式（现有 ENGINEER_ITERATION_PROMPT 路径，已支持输出完整变更文件） |

### 6.2 applyChanges 扩展（llm.ts + types.ts）

```
FileChange 增加可选字段 action?: 'edit' | 'create' | 'delete'
- create：file 不要求已存在，content 作为完整内容写入（edits 忽略）
- delete：从文件集合移除
- ENGINEER_DIFF_PROMPT 增补 create/delete 的输出说明与示例（约 +150 tokens）
- parseChangeList 校验扩展；applyChanges 分支处理
```

删除文件时联动校验：若被删文件仍被其他文件 import，确定性校验报 E_IMPORT_MISSING，走一次修复重试。

### 6.3 迭代提示词增补（约 40 tokens）

ENGINEER_DIFF_PROMPT 增加一条：新增文件时优先遵循现有目录约定（components/hooks/utils），命名延续现有风格。

---

## 7. 与现有降级链的兼容

| 故障 | 现有机制 | 工程化改造后 |
|------|---------|-------------|
| 输出截断（finish_reason=length） | repairTruncatedMultiFileOutput 抢救含 /index.html 的完整文件 | 不变。文档由服务端注入，截断只可能丢代码文件；提示词的输出顺序约定（入口在前）保证抢救结果可预览 |
| 多文件 JSON 格式错误 | 格式错误提示 + 重试 1 次 → 抢救 → error | 不变。新增 import 断链复用同一重试通道 |
| Sucrase 加载失败 | 15 秒超时兜底报错 | 不变。模块运行时是内联脚本，无新网络依赖 |
| 连续容量错误 | DegradationTriggeredError 降级 | 不变 |
| 模块运行时本身有 bug | 无 | assembler 注入运行时前检测 `window.__modules` 定义成功与否，失败时回退"全内联拼接"组装（register 失败路径 catch 后直接顺序执行编译产物，等价现状行为） |

---

## 8. 分阶段实施计划

### P0（今天可做，约 1 天）

改动文件：

| 文件 | 改动 |
|------|------|
| server/utils/scaffoldDocs.ts（新建） | README/DESIGN/package.json 模板生成，纯函数 |
| server/utils/projectValidator.ts（新建） | 5.1 确定性校验（P0 先做三件套/入口/注册约定三项） |
| server/llm.ts | continueAfterApproval 在 done 前注入三件套（LLM 已生成同名非空文件时不覆盖；仅 create 全量流水线注入，modify 不注入）；组装确定性校验调用 |
| server/prompts-v2.ts | 4.2 的工程师增补（html 命名空间约定、react 过渡注册约定、输出顺序）、4.3 审查者第 8 维度（P0 子集） |
| server/utils/scaffoldDocs.test.ts、projectValidator.test.ts（新建） | 单测 |

验收标准：

1. 任意新 create 项目交付的 files 含 README.md（html）或三件套（react/vue），内容含功能清单且与分析师输出一致。
2. react-cdn 生成含多组件的项目在预览中可交互（过渡注册约定生效，无 import）。
3. 现有测试全绿；localStorage 存量项目打开不受影响（旧文件无 README 不补）。
4. token 增量实测：单次生成系统提示词总增量 ≤ 300 tokens。

### P1（本周）

改动文件：

| 文件 | 改动 |
|------|------|
| src/services/sandbox/jsxCompiler.ts | Sucrase transforms 增加 imports（Spike S1 结论落点）；新增 generateModuleRuntime()（__defineModule/__requireModule/shim） |
| src/services/sandbox/assembler.ts | 依赖图解析、react-cdn 注册式组装、运行时回退路径 |
| server/prompts-v2.ts | react-cdn 段切换真实 import 规则，删除过渡注册约定 |
| server/llm.ts + server/types.ts | ChangeList create/delete 扩展、applyChanges 分支、ENGINEER_DIFF_PROMPT 增补、diff 模式接入确定性校验 |
| server/utils/projectValidator.ts | 补齐 import 断链、依赖一致性规则 |
| 配套单测 | 模块运行时（vitest + jsdom 沙箱装配断言）、applyChanges create/delete、validator 新规则 |

验收标准：

1. Spike S1/S2 结论文档化（jsxCdnModuleRuntime 验证记录）。
2. 输入"做一个计算器（键盘 + 显示区 + 历史记录）"选 react-cdn：生成项目含 ≥2 个组件文件且互相 import，预览可交互，文件树含三件套。
3. import 拼错的用例：确定性校验拦截并自动重试修复一次；两次失败时交付并在 warning 中说明。
4. modify 请求"新增一个 XX 组件"：diff create 语义生效，新文件落盘并可预览。
5. 评测集回归：golden prompts 通过率不低于 P0 基线。

### P2（后续）

1. 文档增强层：小预算 LLM 调用重写 README/DESIGN（maxTokens 约 800，失败回退模板），决策点：触发条件（首次生成后异步 or 用户点击"深化文档"）。
2. vue-cdn 模块运行时同构升级（Vue UMD shim，方案 C 同构复用）。
3. utils 可单测演示：为生成的 /src/utils/*.js 附带示例测试文件（README 声明测试框架约定，demo 不真跑）。
4. 多阶段生成评估（scaffold → code → docs 分次调用）：仅当单次 8192 上限成为产出质量瓶颈时启动，当前判断不需要。
5. 代码级功能完整性检查器（承接 generation-quality-report.md 的 Phase 3）。

---

## 9. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| Sucrase imports transform 与 jsx transform 组合行为与预期不符 | 中 | Spike S1 前置；两种 runtime（classic pragma / automatic + jsx-runtime shim）都设计好了落点 |
| 模型写出自创 import 路径（大小写、缺扩展名）导致断链 | 高 | 确定性校验 E_IMPORT_MISSING 拦截 + 一次修复重试；提示词显式要求"import 路径必须与生成文件路径完全一致（含扩展名）" |
| 提示词增量稀释注意力，质量回退 | 中 | 增量控制在 +420 tokens 内且全为清单式规则；评测集回归门禁 |
| 文档模板与实际产出不一致（如拆分和 DESIGN 描述不符） | 低 | 模板从真实文件树生成而非分析师预设；DESIGN 措辞用"模块划分"事实描述 |
| 过渡注册约定（window.__components）被模型遗忘 | 中 | 确定性校验 E_GLOBAL_REG 拦截（P0）；P1 切换后该风险消失 |
| diff create/delete 扩展引入格式回归 | 中 | parseChangeList 向后兼容（无 action 默认 edit）+ llm.changesTolerance.test.ts 扩展用例 |

---

## 10. 待决策清单（评审时确认）

1. P0 过渡期 react 组件全局命名空间名：`window.__components`（本文默认）或复用 `window.App`。
2. README 定位：初始说明（不随迭代更新，本文默认）还是随 modify 重生成（P2 增强层一并解决）。
3. W_FILE_SIZE 的 150 行阈值是否合理（atoms 参照物单文件普遍 100 行内）。
4. P2 文档增强层的触发方式（异步自动 or 用户显式触发）。
