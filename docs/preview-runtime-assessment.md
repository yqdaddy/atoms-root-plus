# 预览运行时技术路线评估：工程化多文件模块的沙箱内执行

- 评估人：dev-litpp-backend-architect（只读分析，未改动任何代码）
- 日期：2026-09-24
- 结论速览：推荐路线 B（浏览器内 mini-bundler），预估 14 至 16 小时；路线 A 可行为但需关键修正且放宽 CSP；路线 C 与零基础设施架构冲突，不推荐用于笔试 Demo。

---

## 1. 背景与问题定义

生成管线升级为软件工程化产出：项目包含 package.json、README.md、src/components/ 多组件（jsx）、src/hooks/、src/utils/，组件间以 ES module import 相互引用。预览必须继续在 iframe sandbox（sandbox 属性 + srcdoc + postMessage）中运行。

核心技术问题：**工程化项目的多文件模块依赖如何在浏览器沙箱内预览运行？**

现有执行模型（下节核实）是"逐文件独立编译执行"，没有 import 解析。工程化产出要求跨文件 `import { useCounter } from '../hooks/useCounter'` 与 `import { useState } from 'react'` 语义成立，这是本次升级的真正缺口。

## 2. 现状核实（亲自读码，证据带文件与行号）

### 2.1 执行链路

1. `src/components/SandboxFrame.tsx:335-341`：`<iframe srcDoc={previewHtml} sandbox={sandboxAttr}>`，沙箱属性经 `buildSandboxAttribute()` 生成（`src/types/sandbox.ts:27-34`），默认仅 `allow-scripts`，`allow-same-origin` 等禁止标志在代码层直接抛错（`sandbox.ts:19-24`）。
2. `src/services/sandbox/assembler.ts`：读取入口 HTML，内联 `<link>` CSS（125-158 行）与 `<script src>` JS（165-203 行）；react-cdn 框架下含 JSX 的文件被包装为 `__compileAndRun(code, path)` 内联块（195-197 行）。
3. `src/services/sandbox/jsxCompiler.ts:88-116`：`__compileAndRun` 调用 Sucrase（仅 `transforms: ['jsx']`，classic runtime）后经 `new Function('React', 'ReactDOM', compiled.code)` 执行。React 18 UMD 从 jsdelivr 加载（13-15 行），Sucrase 从 esm.sh 以 module script 加载（28 行）。

### 2.2 与新需求的三个缺口

1. **无 import 解析**：`__compileAndRun` 逐文件独立执行，编译产物中的 `import`/`export` 语句原样保留，而 `new Function` 体内出现 import 语句是语法错误。即当前模型下生成代码被约定禁止使用 ESM 语法（`jsxCompiler.ts:161-191` 的代码示例明确写"无需 import React"，走全局 React + UMD）。组件间相互引用完全不支持。
2. **无依赖图**：assembler 只处理 HTML 中显式 `<script src>` 引用到的文件；src/hooks/、src/utils/ 中未被 HTML 直接引用的文件根本不会进入预览。
3. ** Sucrase 输出模式**：jsx transform 保留 ESM 语法不动，因此"改 import React 来源"不是一个开关问题，而是需要一套模块装载机制（三条路线的分野所在）。

### 2.3 esm.sh 定性：平台基础设施例外，非用户白名单违规

- 用户代码白名单（铁律 4）仍由 `src/types/sandbox.ts:10-13` 的 `DEFAULT_CDN_HOSTS`（cdn.jsdelivr.net、cdn.tailwindcss.com）与提示词（`src/services/ai/prompts.ts:100,175`）、校验器（`htmlValidator.ts:162-185`）共同强制为 jsdelivr 单域。
- esm.sh 是平台自用：Sucrase 的 ESM 构建从 esm.sh 加载，理由有实测记录（`jsxCompiler.ts:20-28`：jsdelivr +esm 端点 CJS 互操作有 bug，sourcemap-codec 缺失 named export encode；esm.sh 产物链路全通），且仅在 react-cdn 框架时并入 CSP（`SandboxFrame.tsx:196-204`）。
- **但需指出两点既有事实**：(1) CSP 是页面级而非 script 级，esm.sh 进入 script-src 后生成代码同样可以从 esm.sh 加载脚本，白名单在事实上已被放宽；(2) react-cdn 模式同时开放了 `unsafe-eval`（new Function 必需）。当前沙箱 CSP 处于历史最宽状态。后文将说明路线 B 可同时收回这两项。

### 2.4 关键浏览器事实（决定路线 A 形态）

- `docs/tech-sandbox.md:493` 已记录：**blob URL 与创建它的 origin 绑定，不透明来源（opaque origin）的 iframe 加载不了父页面创建的 blob**。srcdoc + sandbox（无 allow-same-origin）的 iframe 是不透明 origin，因此路线 A 的 blob 必须在沙箱内部创建，不能在父页面创建后引用。这是本评估对任务书中路线 A 描述的关键修正。
- CSP `connect-src 'none'`（`sandbox.ts:186-204`）禁止沙箱内 fetch，但模块脚本的加载归 `script-src` 管，不受影响。
- srcdoc 文档的 import map 与 blob 模块加载均在不透明 origin 下成立（import map 是 realm 局部的，无 origin 要求）。

## 3. 三条路线评估

### 3.1 路线 A：import map + blob URL（原生 ESM）

**可行性结论：可行，但任务书原描述有一处致命细节必须修正。**

修正后的正确形态：

1. 编译位置二选一：父页面内编译（需新增 sucrase 为 npm 依赖，当前未安装，已核实 package-lock 无 sucrase）或维持沙箱内 esm.sh 加载 Sucrase。推荐前者，理由见安全对比。
2. 编译产物（纯 JS 字符串）以 JSON 字符串内联进 srcdoc（延续 `wrapJsxScript` 的既有模式，`jsxCompiler.ts:144-148`）。
3. **沙箱内部**的运行时脚本逐模块 `URL.createObjectURL(new Blob([js], {type:'text/javascript'}))`，再动态注入 `<script type="importmap">`（必须先于入口 module script），最后以 module script 加载入口 blob。
4. **导入说明符必须重写**：blob URL 是 cannot-be-a-base URL，模块内的相对导入 `./utils/math.js` 无法相对解析，必须改写为裸说明符（如 `__vfs_/utils/math.js`）并写入 import map 精确键。Sucrase 不做说明符重写，需自研正则改写器，覆盖 `import ... from '...'`、`export ... from '...'`、`export * from '...'`、静态字符串 `import('...')`，并做扩展名补全与 /index.js 归一。
5. React 来源：Sucrase 切到 `jsxRuntime: 'automatic'`，产物 import react/jsx-runtime；import map 映射 `react` 与 `react-dom/client` 至 esm.sh（jsdelivr +esm 互操作已被本项目实测否决，见 2.3）。第三方库（chart.js 等）同理经 import map 映射。

| 评估项 | 结论 |
|---|---|
| blob URL 在 srcdoc 沙箱内 | 仅沙箱内自建的 blob 可用；父页面创建的 blob 被不透明 origin 拒载（2.4） |
| import map 兼容性 | 2026 年全绿（Chrome 89+ / Firefox 108+ / Safari 16.4+），srcdoc 下成立 |
| 循环依赖 | 原生 ESM live binding，处理最正确，三路线最佳 |
| React 来源 | esm.sh import map 映射，esm.sh 必须留在 script-src |
| CSP 影响 | script-src 需新增 `blob:`；esm.sh 保留；若编译移入父页面可去掉 unsafe-eval |

**工作量估计：16 至 18 小时**。共享的依赖图与路径解析器约 4 小时；沙箱内 blob + import map 运行时约 3 小时；说明符重写器（含边界与单测）约 5 小时；automatic runtime 与映射约 1 小时；assembler 集成约 2 小时；联调与 e2e 约 3 小时。

**风险清单**：

- 说明符重写器是最大风险点：正则对多行 import、注释中的伪 import、模板字符串中的 import( 有误伤可能；AST 方案（引入 acorn）更稳但再加 3 小时。
- blob:UUID 出现在报错堆栈中，错误定位退化为不可读（与现有 new Function 相当，但无 sourceURL 缓解手段）。
- import map 注入时序与 module script 的解析顺序在个别浏览器组合下有边缘行为，只能真实浏览器 e2e 验证，单测覆盖不了。
- CSP 新增 `blob:` 与保留 esm.sh、automatic runtime，安全面比现状多一项 `blob:`。

**演示效果差异**：与现状无可见差异。报错面板中源文件名显示为 blob:UUID，观感略差。

### 3.2 路线 B：浏览器内 mini-bundler（拓扑排序拼接）

**可行性结论：可行，且是安全姿态最紧、可测性最好的方案。**

机制：

1. 父页面构建依赖图：从入口 `/src/main.jsx` 出发解析全部相对 import（与路线 A 共享同一个路径解析器），bare 说明符（react、chart.js 等）查 shim 表。
2. 逐文件 Sucrase 编译，transforms 为 `['jsx', 'imports']`：imports transform 将 ESM 转为 CJS（`require`/`exports`），JSX 保持 classic runtime。Sucrase 会将 JSX pragma 重写到本地 React 绑定（Jest 同款用法，成熟度高）；对未写 `import React from 'react'` 的文件由 bundler 自动注入该行（Vite 惯例）。
3. 拼接为单一 IIFE：每个模块注册为 `__def('/src/utils/math.js', function(module, exports, require){ ... })`，运行时约 30 行（带缓存的 require），入口最后 `__require('/src/main.jsx')`。
4. bare 依赖 shim：`require('react')` 返回 `__interop(window.React)`，`react-dom/client` 返回 `{ createRoot: ReactDOM.createRoot }`，chart.js 返回 `window.Chart`，echarts 返回 `window.echarts`。React 保持 UMD 从 jsdelivr 加载，现状不变。
5. 产物以普通内联 `<script>` 注入 srcdoc（`unsafe-inline` 已在 CSP 中），**无需 new Function**。

| 评估项 | 结论 |
|---|---|
| 实现复杂度 | bundler 核心约 200 至 300 行，全部为纯字符串变换，vitest 无浏览器单测全覆盖 |
| ESM/CJS 混用 | imports transform 统一收敛为 CJS，无混用问题；default/named 互操作由 `__interop` 助手处理 |
| 命名冲突 | 每模块包裹在独立 function 作用域内，模块间零冲突；注册表键为项目绝对路径，无重名 |
| 错误定位 | 弱点：单脚本拼接后行号错位。缓解：模块包装层 try/catch 捕获后重抛并附加模块路径前缀，走既有 error 桥接上报 |

**工作量估计：14 至 16 小时**。共享解析器约 4 小时；bundler 核心（拓扑排序、包装、require 运行时、shim 表）约 6 小时；Sucrase imports transform 集成与互操作约 2 小时；assembler 集成与 CSP 收回约 1 小时；单测与 e2e 约 3 小时。

**风险清单**：

- imports transform 的边界：`import.meta`、顶层 await 不支持，遇之报明确构建错误进入既有 AI 修复循环，可接受。
- 动态 `import('./x')` 默认不支持，重写器可将其转换为 require（仅静态字符串），非静态形式报错。
- 循环依赖为 CJS 语义（部分导出），与 Node 心智一致，对 Demo 场景足够。
- shim 表是闭集：生成代码 import 了表外的 bare 包名将得到明确构建错误，由 AI 层修正（现有修复循环可承接）。

**演示效果差异**：与现状无可视差异；错误面板可附带模块路径（优于路线 A 的 blob:UUID）。单一拼接产物对代码查看面板、分享页、导出均更友好（一个自包含产物）。

### 3.3 路线 C：服务端预构建（esbuild）

**可行性结论：技术上可行，但与本项目架构原则冲突，不推荐。**

现状核实：`server/routes/deploy.ts` 是登录态强制（159 行）的文件落盘 + Nginx 静态托管通道，仅接受文本静态资源白名单（46-60 行），**无任何构建步骤**；全仓无 esbuild 依赖。若走此路线需新增：esbuild 服务端依赖（原生二进制，部署摩擦）、匿名预览构建端点（deploy 的 requireAuth 与预览的匿名性冲突，不能复用）、构建结果缓存与失效、客户端回退。

**工作量估计：10 至 14 小时**（端点 3 小时、esbuild 集成与缓存 4 小时、客户端对接 3 小时、部署与验证 3 小时以上），另有持续性运维成本。

**风险清单**：

- 与 localStorage 优先架构冲突：预览从纯客户端能力变为强依赖服务端。游客刷新后从 localStorage 恢复项目时，服务端不在则预览瘫痪；现有能力里预览是离线可用的。
- 与 deploy 语义混淆：deploy 是永久托管且要求登录，预览是匿名即时反馈，强行复用文件落盘会把鉴权、目录清理、TTL 三件事搅在一起。
- 实时性：流式生成中每次代码更新都多一轮网络往返，预览刷新延迟可感。
- 新攻击面：匿名构建端点需自行限流与限额（文件数、体积已有 deploy 同款上限可抄，但仍需新增 DoS 考量）。

**演示效果差异**：唯一可见差异是支持白名单外任意 npm 包（dayjs、lodash 等），但对笔试 Demo 的演示脚本几乎必然用不到；代价是每次刷新多一个 loading。

## 4. 三路线对比

| 维度 | A：import map + blob | B：mini-bundler | C：服务端 esbuild |
|---|---|---|---|
| 可行性 | 可行（需修正 blob 创建位置） | 可行 | 可行但架构冲突 |
| 工作量 | 16 至 18h | 14 至 16h | 10 至 14h + 运维 |
| CSP 变化 | +blob:，保留 esm.sh，可去 unsafe-eval | **零放宽，且可同时去掉 unsafe-eval 与 esm.sh** | 沙箱侧不变，新增服务端面 |
| 新增外部依赖域 | esm.sh（保留）、blob: | 无（React 维持 jsdelivr UMD） | 无 |
| 循环依赖 | 原生 ESM，最佳 | CJS 语义，够用 | esbuild 处理，最佳 |
| 错误定位 | blob:UUID，差 | 模块路径前缀，中 | sourcemap，最佳 |
| 可测试性 | 时序语义依赖真实浏览器 e2e | 纯字符串变换，vitest 全覆盖 | 需要服务端集成测试 |
| 零基础设施 | 保持 | 保持 | 破坏 |
| 演示差异 | 无 | 无 | 支持任意 npm 包 |

## 5. 推荐路线与理由

**推荐路线 B（浏览器内 mini-bundler），并以路线 A 的路径解析器设计为共享地基；路线 A 作为 Demo 之后的演进方向（原生 ESM 语义 + sourcemap 潜力），路线 C 不推荐。**

理由：

1. **沙箱铁律最优**。B 是三路线中唯一能让 CSP 严格不宽于现状、且实际收回 `unsafe-eval` 与 esm.sh 两项既有放宽的方案（React 维持 jsdelivr UMD，产物走已放行的 unsafe-inline，无 new Function、无 blob:、无新域）。A 需要新增 `blob:` 到 script-src 并保留 esm.sh，安全面净增两项。
2. **零基础设施偏好**。B 完全在浏览器内完成，localStorage 优先、刷新恢复、游客模式全部不受影响；C 直接破坏这一原则。
3. **现有 Sucrase 链复用最大化**。B 复用 Sucrase 的 jsx 与 imports 两个 transform（后者是 Jest 的生产级用法），新增的只是约 300 行纯函数变换，与现有 vitest 基建无缝衔接；A 的 import map 注入时序与 blob 语义只能靠真实浏览器验证，验证成本更高。
4. **笔试 Demo 场景**。B 的产物是单一内联脚本，代码查看、分享、导出天然自包含；演示效果与现状无差异，而工作量与 A 相当甚至略少。

### 逃逸面自证（铁律 5 问）

生成代码可能的逃逸路径与本方案的封堵：网络外逃被 `connect-src 'none'` 与 script-src 域白名单封堵（`sandbox.ts:186-204`）；DOM/存储逃逸被无 `allow-same-origin` 的不透明 origin 封堵（`sandbox.ts:19-34` 代码层抛错兜底）；脚本注入主文档被 srcdoc 隔离封堵。路线 B 相比现状**减少了**两个逃逸助力：不再有 unsafe-eval（无 new Function），不再有 esm.sh 域（脚本来源收敛回 jsdelivr 与 unsafe-inline）。残余风险与现状一致：unsafe-inline 内联脚本与 img-src https: 的信标面，属于既有风险 R1（docs/tech-sandbox.md:966），非本次方案引入。
