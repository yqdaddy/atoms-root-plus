# 返工后发布前最小复验 · 最终裁定

复验人：dev-litpp-reality-checker（独立验证，未改任何源码）
时间窗：2026-09-24T15:46Z ～ 16:40Z（本地 09-24 23:46 ～ 09-25 00:40，全部当场新鲜执行）
环境：vite dev @5173 + backend @3000；mainline HEAD = c10d328（冻结，git status 无源码残留）
基线：上轮 final gate（evidence/combined-regression-20260924/final/）裁定的 3 项返工

## 总体裁定：可发布

三项返工全部 PASS（本轮当场复现），P0 链路（注册 → react-cdn 生成 → 预览 → 迭代 → 刷新持久化；html 生成 → 预览）真实可用。新发现的缺陷均不阻塞发布， listed 供下一迭代。

## 逐项结论（对照复验清单）

FINAL-1 | 同步链路收录 framework，非法回退 html（eb6214a）| PASS
- 证据：final1-api-probes.txt（16:37 重跑：POST 无 framework→ABSENT；PUT react-cdn→保留；PUT 非法→html；PUT 缺键→保持现值；POST 非法→html）
- 代码：server/routes/projects.ts:64-71（normalizeFramework）、:110（POST）、:235-238（PUT）
- 全链路（按交接口径验证 create→update 完整链，非孤立 POST）：新注册 rc_reverify_e2e → 待办清单 chip(react-cdn) → 直接生成 → 真实应用渲染 → 服务端库 framework=react-cdn → 经两次修改 PUT 后仍 react-cdn（db-verification.txt §1）→ 刷新+我的项目重开，卡片显示 React CDN 徽标（reverify-13/14/15/35）→ 迭代请求 SSE body 携带 options.framework="react-cdn"、currentFiles=16（sse-request-capture.txt §1）

FINAL-2 | 组装剥离冗余 React/ReactDOM/Babel 外链（不伤 chart.js）+ 沙箱就绪三线并发（c10d328）| PASS
- 证据：final2-fixture-evidence.txt；截图 reverify-21/22
- 注入 4 条 defer 外链的夹具项目，组装 srcdoc：unpkg react/react-dom=0、babel=0、剥离注释=3、chart.js=1（保留未误伤）
- 就绪计时：首ready +216.6ms（≪3s 强制上限），遮罩解除，CDP 点击确认沙箱内真实交互（tab 切换/状态变更）
- 代码：src/services/sandbox/assembler.ts（5 条剥离正则）、src/components/SandboxFrame.tsx（READY_FORCED_SIGNAL_MS=3000、三线就绪、sendReady 幂等）

FINAL-3（旁证）| 生成过程无“代码存在 N 个问题”噪音 toast | PASS
- 全程截图（reverify-08～12 react-cdn 生成、23/24 两次迭代、27～33 html 生成含审查未通过/修复轮）均未出现该噪音 toast；仅出现信息性提示（自动重试、外部域名白名单提示、长度截断提示）

回归 1 | html 模式新鲜生成 | PASS（部分子项 UNVERIFIED，见下）
- 预览渲染真实内容（FlowTask 落地页，reverify-30/36）；framework=html 落库且卡片显示“原生 HTML”徽标（reverify-35）；刷新后经我的项目重开数据仍在（reverify-34→35→36）
- UNVERIFIED：“交付摘要渲染正常”——本轮 html 生成未产出交付摘要（见 OBS-3），无对象可验证

回归 2 | 全量 vitest | PASS
- vitest-full-run.txt：29 files / 505 passed (505) / 14.02s / exit 0 @2026-09-24T16:17:48Z

清理 | PASS（cleanup-record.txt）
- 两测试账号全部项目经 DELETE API 清空（DB 复查=0）；探针项目即建即删；/tmp 夹具（含上轮明文口令文件）已删
- 账号行无法删除（无账号删除 API），users 表仍存 rc_final_gate、rc_reverify_e2e，记录在案

## 缺陷与观察清单（均不阻塞发布）

OBS-1 | major | react-cdn 创建回合最终 assistant 消息为 43,145 字符多阶段拼接，聊天面板渲染失败，以“该消息渲染失败”保护卡兜底（数据已落库，不崩溃）。内容中审查 JSON 反而建议补 React CDN 外链，反向印证 FINAL-2 的必要性。建议负责：dev-litpp-frontend-developer + dev-litpp-ai-engineer
OBS-2 | major | html 创建回合未正常收尾：审查 0 项通过/2 项未过 → 修复第 1/2 轮流式输出后回合结束，修复产物未应用（文件仍 2 个）、无交付摘要、assistant 消息未持久化（DB chat 仅 user 一条），项目可继续使用。与范围外“create pipeline 静默挂起”同族，记录不修。建议负责：dev-litpp-ai-engineer
OBS-3 | minor | 修改回合可能改错层：标题修改仅落 /index.html 的 <title> 与 /DESIGN.md，可见 H1（/src/App.jsx）未改（currentFiles=16 已随请求上送）。AI 修改有效性问题。建议负责：dev-litpp-ai-engineer
OBS-4 | minor | 代码页签语法渲染出现 `"<text-amber-400">class=...` 乱码（仅展示层，DB 内容复核正确）。建议负责：dev-litpp-frontend-developer
OBS-5 | minor | apiSync.ts:198-200 注释仍宣称服务端契约无 framework 字段（FINAL-1 修复后已过时）。建议负责：dev-litpp-backend-architect
OBS-6 | info | 首个修改回合回复“当前未提供这些文件内容”，但第二次迭代钩子证实 currentFiles=16 已上送，两回合上下文传递不一致，建议排查
OBS-7 | info | 任务口径称 rc_final_gate 有 2 个项目，DB 实查仅 1 个（561a22e5），差异原因不明（可能上轮已清理），如实记录

## UNVERIFIED 项（显式列出）
- html 模式“交付摘要渲染正常”：本轮未产出交付摘要（OBS-2），无验证对象
- vue-cdn / chart.js 实际 CDN 渲染：范围外（外部 CDN 黑洞），仅记录
- create pipeline 静默挂起、applied-modify 不落库、MINOR-D5：范围外，本轮未复验

## 被证伪的“看似完成”宣称
- 执行侧曾以“POST 已收录 framework”口径交接；复验证实前端创建链 POST 仅送 id/name/description，framework 实际依赖后续 PUT 整包序列化。按交接修正口径改验完整链后 FINAL-1 成立——孤立验证 POST 会误判
- 本轮无其他“已完成”宣称被证伪；三处新缺陷（OBS-1/2/4）均为宣称范围外的新发现

## 验证时间与环境汇总
- 2026-09-24T15:46Z～16:14Z：真实用户走查（注册/生成/预览/迭代/刷新），截图 reverify-01～24
- 2026-09-24T16:17Z：vitest 全量（vitest-full-run.txt）
- 2026-09-24T16:18Z～16:34Z：html 回归生成与重开，截图 reverify-25～36
- 2026-09-24T16:17Z/16:23Z/16:33Z/16:35Z：DB 只读查询（db-verification.txt）
- 2026-09-24T16:37Z：FINAL-1 API 探针重跑（final1-api-probes.txt）
- 方式：mcp-chrome 真实浏览器操作（CDP 点击穿透跨域沙箱）、MAIN-world 脚本探针、curl API 探针、python sqlite3 只读查询
