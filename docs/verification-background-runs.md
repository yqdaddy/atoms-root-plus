# 验证报告：生成任务与页面生命周期解耦（background runs）

- 验证角色：dev-litpp-reality-checker（独立验证，未修改任何被测代码）
- 验证依据：docs/prd-background-runs.md AC-001 至 AC-007
- 验证方式：真实浏览器走查（mcp-chrome）+ 服务端 SQLite 只读查询（data/atoms.db）双通道取证
- 环境：前端 http://localhost:5173（Vite dev），后端 3000；测试账号 test_bgrun_x7k9（09:47 注册成功）
- 验证时间：第一轮 2026-09-29 09:43:59 至 10:35:18；复测（三项修复后）同日 10:57:41 至 11:59:00 (+0800)，全部结论均来自对应时间窗内的新鲜执行
- 证据约定：所有任务状态/时间线取自 generations 表实查；UI 状态有对应时间戳截图观察记录
- 复测结论速览见「一、AC 逐条结论」表（已更新为复测后判定）与「七、复测记录」

## 一、AC 逐条结论（复测后最终判定）

| 条目 | 用户故事 | 首轮 | 复测后 | 证据 | 备注 |
|---|---|---|---|---|---|
| AC-001 | US-001 断连续跑 | FAIL | **PASS** | 首轮 1.1 + 复测 7.1 | 服务端续跑与结果交付链路（finishedUnclaimed+ack）均实测走通 |
| AC-002 | US-001 刷新替代关闭 | FAIL | **PASS**（交付链路实测+首轮不终止任务实证） | 首轮 1.2 + 复测 7.1 | 交付链路与 AC-001 同一通道，已实测；完整"刷新后长时间不回"流程含推定成分 |
| AC-003 | US-002 进度恢复 | PASS | **PASS**（维持） | 首轮 1.3 | 刷新场景；SPA 内切换场景见 AC-006 新缺陷 |
| AC-004 | US-003 完成回来 | FAIL | **PASS** | 复测 7.1/7.2 | 「生成已完成」toast 已直接捕获；AI 消息、版本、状态全部到位 |
| AC-005 | US-004 显式停止 | PASS | **PASS**（维持） | 首轮 1.5 | 本轮未改动相关代码，未重测 |
| AC-006 | US-005 切换项目 | FAIL | **FAIL**（新缺陷） | 复测 7.3 | 完成后切回可交付，但生成中切回不恢复（MAJOR-005）、消息重复（MAJOR-004） |
| AC-007 | US-006 失败可见 | FAIL | **PASS**（带保留） | 复测 7.4 | 红色失败条+原因+重试按钮+错误消息全到位；受"每次仅弹最新一条未领取任务"排队限制（MINOR-007） |

复测后 P0 判定：F-004（结果感知）已达成；AC 通过率 5/7（AC-006 FAIL 为新增回归所致）。

## 二、详细证据

### 1.1 AC-001 断连续跑（核心）

实验 A（任务 2f20a228，项目 6bcb08bf，全新番茄钟生成）：

- 10:06:09 服务端任务创建（generations 表 created_at=02:06:09Z），stage=generate
- 10:06:33 以 chrome_close_tabs(tabIds=[1434883678]) 精确关闭工作台标签（该 tab 为发起生成的标签，此前所有交互均在其上执行）；关闭后立即查库：running / generate
- 断连后静置轮询（每 15s 查库）时间线：
  - 10:06:39 running generate（updated 02:06:09Z）
  - 10:07:25 running generate（updated 02:07:15Z，仍在推进）
  - 10:08:25 running generate（updated 02:08:23Z）
  - 10:09:40 running generate（updated 02:09:39Z）
  - **10:09:55 succeeded / done**（updated 02:09:46Z）
- 结论：断连后任务自驱运行 3 分 22 秒并成功完成，未因断连 failed/cancelled。**服务端解耦（F-001）成立**。
- 结果交付检查（10:10:17 重新打开该项目）：
  - UI：无任何提示（无「生成已完成」toast、无恢复条），预览区空白（占位文案"开始描述你的应用..."），对话区仅用户需求 1 条消息
  - 服务端对照：generations 表该任务 result_files 长度 18422 字节（完整番茄钟）；projects 表项目数据 files./index.html 仅 200 字节空壳、chat 会话 messages=0、status 仍为 "generating"
  - **判定：任务成功但结果永不交付到项目，用户回来拿不到任何成果。AC-001 验收标准"重新打开该项目，文件与消息为完整最终结果"不成立。**

佐证实验 B（任务 54298884，项目 6bcb08bf，10:01:58 创建）：10:02:22-25 精确断连（tabId 1434883671）后，事件流显示 retry 事件在断连后继续发生（02:02:28Z、02:02:45Z），10:02:52 因"输出格式不符合要求，已自动重试 4 次仍未成功"进入 failed。失败原因与断连无关（断连前后重试行为连续），进一步证明断连不终止、不干扰任务。

无效实验说明（存档）：任务 3b54a92c（09:56:55 关闭）后被证实关闭的是非生成标签（重进项目时 AI 消息与文件已由存活 SSE 应用，且服务端确认无任何消息写库逻辑，server/runs.ts 与 routes/llm.ts 均无 messages 写入），该次不作为断连证据，仅作在线完成对照。

### 1.2 AC-002 刷新替代关闭

- 刷新不终止任务：任务 9616f8ae 于 10:14:09 浏览器刷新（chrome_navigate refresh）后继续运行，10:16:29 succeeded（DB 时间线完整，见 1.3）。
- "重复 AC-001 流程结果一致"：AC-001 的结果交付本身 FAIL；刷新后长时间不回来的完整流程未单独实测，依据同一根因（BLOCKER-001，终态任务无回放入口）推定同样 FAIL。判定 **FAIL**（其中"刷新不终止"分项 PASS 有实证）。

### 1.3 AC-003 进度恢复

实验（任务 9616f8ae，项目 baa8a1fa，10:13:30 创建）：

- 10:14:09 刷新页面（脱离生成上下文，回到空白工作台，URL /workspace 不保留项目）
- 10:14:27 从"我的项目"列表重新进入该项目
- 10:14:30（进入后约 3 秒内）截图确认：
  - 恢复提示条出现："检测到进行中的生成，已恢复进度，正在接续服务端输出"（带 spinner）
  - 进度阶段展示："正在生成代码... 1分23秒"（时钟以服务端 startedAt 为准）
  - 回放内容已渲染（PM 分析 JSON 增量文本）
  - 红色"停止生成"按钮在位
- 10:15:04 再次截图：进度推进为"1分53秒"（30 秒间隔与时钟一致），恢复条持续
- 10:16:29 任务 succeeded，恢复会话经轮询通道接到 done：预览立即更新为完整番茄钟应用（5 文件），代码视图版本历史出现 V1「初始」"生成应用，共 5 个文件"
- **判定 PASS**。
- 备注：PRD 要求"阶段文案随推进更新（如生成中变为审查中）"未观察到——该任务在 generate 阶段直落 done（events 中无 review 阶段事件），属观察窗口限制而非缺陷实锤，列为 UNVERIFIED 分项。

### 1.4 AC-004 完成回来

原场景（离开至生成完成后回来）＝ BLOCKER-001 直接命中：

- 项目 6bcb08bf / 任务 2f20a228（1.1）：回来无「生成已完成」提示、无文件、无消息
- 项目 b2fc6836 / 任务 e40e547a（1.6）：同样结果丢失

恢复接续场景（用户在任务结束前回来，恢复会话接到 done，任务 9616f8ae）：

- 文件已应用：5 个文件（index.html 4033B、styles/main.css 5475B、src/utils.js 2357B、src/main.js 7391B、README.md 850B），预览非空且可交互
- 版本落库：版本历史 V1「初始」"生成应用，共 5 个文件"，localStorage `litpp:v1:versions:<pid>` count=1
- 「生成已完成」toast：**UNVERIFIED**（toast 为短时元素，完成时刻未捕获到截图；不判定成败）
- 消息完整性：**FAIL**——对话区停留在回放的 delta 文本，无 AI 完成消息条目；localStorage `litpp:v1:projects:<pid>` chat 会话 messages=[0,0]。对照在线完成路径（任务 3b54a92c、88a8316d）AI 消息正常出现，说明恢复通道的 done 未走完消息生成/入库链路

### 1.5 AC-005 显式停止

实验（任务 55e891bc，项目 b2fc6836）：

- 10:20:58 创建；10:21:41 经刷新重进，恢复条出现
- 10:21:57 点击"停止生成"
- 10:22:09 查库：**status=cancelled / stage=cancelled / error="用户取消"**（点击后约 12 秒内确认，含 3s 等待）
- UI：生成中元素（恢复条/进度条/停止按钮）全部消失，输入框恢复可用
- 10:22:43 重进项目：无恢复条（cancelled 为终态，/runs/active 不再返回）
- 对比组：关闭页面操作（1.1 实验 A/B）不产生 cancelled，任务继续至终态
- **判定 PASS**。

### 1.6 AC-006 切换项目

实验（任务 e40e547a，项目 b2fc6836）：

- 10:23:27 创建，10:24:16 stage=generate；10:24:29 切换至 B 项目（番茄钟 baa8a1fa，正常加载、无恢复条、操作正常）
- B 项目停留约 1.5 分钟后 10:25:54 切回 A 项目
- 任务在切换期间 10:25:57 前完成（succeeded，result_files 17109 字节完整记账本）
- 切回后 UI：欢迎页视图 + 仅一条审查折叠条（"6 项通过，2 项未过"），**预览空白、无完成提示、无恢复条**，无 AI 回复消息
- 服务端对照：项目 b2fc6836 files 仍为 200 字节空壳、status 卡在 "generating"（项目列表徽章永久显示"生成中"）
- 任务本身未被切换中断（服务端正常完成）→ F-001 佐证；但"切回 A，A 的阶段与输出连续无缺失"不成立
- **判定 FAIL**（结果交付缺失，BLOCKER-001 第三例复现）

### 1.7 AC-007 失败可见

采用自然失败场景（未注入，保证真实性）：任务 54298884（1.1 佐证实验 B）因生成格式问题重试 4 次后 failed，服务端 error 字段存有明确错误文案（"生成结果格式不符合要求，已自动重试 4 次仍未成功。请点击重试再次生成..."）。

- 10:04:16 用户重新打开该项目：**无错误信息、无重试入口、无任何失败提示**；最新会话仅用户需求 1 条消息
- 服务端 generations 表 error 与 error 事件均在（数据未丢，是回放入口缺失）
- 在线失败路径（失败时用户在场）未单独实测，不影响本条判定（AC-007 的关键场景即"离开后回来"）
- **判定 FAIL**（与 BLOCKER-001 同根因：终态任务无回放通道）

## 三、防重复与正常路径（任务附加要求）

- 防重复：恢复完成的任务 9616f8ae（baa8a1fa）在 10:17 / 10:25 / 10:32 至少三次进入该项目：
  - 无恢复条（终态任务不触发恢复会话）
  - localStorage `litpp:applied-run:baa8a1fa...` = 9616f8ae（已应用标记在位）
  - `litpp:v1:versions:baa8a1fa...` count=1，版本数稳定，无重复落库
  - 结论：**重复回放防护 PASS**（机制与实测一致）
- 正常路径：多次新建项目进入（10:05 / 10:13 / 10:21，均有截图）均为正常欢迎页，无恢复 UI、无异常报错；无任务项目（B 项目 10:25:21）进入同样无恢复条。**PASS**

## 四、缺陷清单（首轮；复测后清单见 7.5）

| 编号 | 严重度 | 描述 | 复现步骤 | 建议负责角色 |
|---|---|---|---|---|
| BLOCKER-001 | blocker | 断连/切换期间到达终态（成功或失败）的生成任务，结果永不交付：/runs/active 仅返回 running 任务（server/runs.ts getActiveRunView/findRunningRun 仅匹配 status='running'），前端 useRunRecovery 仅在有 running 任务时启动回放，导致终态任务的 result_files 与 error 信息成为"孤岛"。3 次独立复现（2f20a228 成功、e40e547a 成功、54298884 失败） | 1. 发起生成 2. 输出开始后关闭/切换页面 3. 等待任务完成（GET /runs/active 已查不到）4. 重进项目：无提示、无文件、无消息 | dev-litpp-backend-architect + dev-litpp-frontend-developer（需"刚结束未查看"任务的回放/领取机制，PRD 非目标节已预留该口径） |
| MAJOR-002 | major | 恢复会话接续完成时 AI 消息缺失：文件应用与版本落库正常，但对话区无 AI 回复、chat 会话 messages=0（对照在线完成路径消息正常） | 发起较长生成 → 刷新后重进项目（恢复条出现）→ 等任务完成：预览/版本更新但无 AI 消息 | dev-litpp-frontend-developer（恢复通道 done 的消息生成/入库链路） |
| MINOR-003 | minor | 结果丢失场景下项目 status 永久卡在 "generating"：项目列表徽章持续显示"生成中"，无超时/校正机制（与 BLOCKER-001 同源，修复时一并处理） | 同 BLOCKER-001，完成后看项目列表徽章 | dev-litpp-backend-architect |
| UNVERIFIED-004 | - | 「生成已完成」toast 与恢复场景阶段文案流转（generate→review）未能实测捕获（toast 短时；任务在 generate 直落终态），不作结论 | - | - |

## 五、总体结论（首轮；复测后结论见 7.5）

1. **核心机制成立**：服务端任务与连接解耦真实生效（断连/刷新/切换均不终止任务，F-001）；running 任务的恢复接续（F-002/F-003，恢复条 3 秒内出现、进度推进、轮询接到 done 应用文件与版本）真实生效；显式取消（F-005）真实生效且断连不触发取消。
2. **P0 通过率：3/5**（F-001、F-002、F-003、F-005 达标，F-004 结果感知不达标）。AC 通过率：2/7（AC-003、AC-005 PASS；AC-001/002/004/006/007 FAIL，其中 AC-002 含推定成分已注明）。
3. **不可宣称完成、不建议进入下一阶段**：BLOCKER-001 使"随时离开、随时回来接续"的产品承诺在结果层面落空（用户离开期间完成的生成 100% 丢失成果），必须先补齐"终态未查看任务的回放/领取"链路并回归 AC-001/004/006/007 后再议。
4. 本次验证证伪的"看似完成"宣称：实现说明称"断连不 abort、轮询接续"已完成闭环，实测服务端半边成立，但"回来拿到结果"的用户故事整体不成立——恢复机制只覆盖"回来时任务还在跑"一种时序，"回来时已经跑完"（最常见时序）完全缺失。

## 六、验证时间与环境记录

- 全部验证于 2026-09-29 09:43:59 至 10:35:18 (+0800) 现场执行
- 服务端状态查询方式：sqlite3 只读查询 /Users/zoe/Documents/zwork/atoms-root-plus/data/atoms.db generations/projects 表（每次查询均带本地时间戳记录）
- 浏览器操作：mcp-chrome（导航、截图、点击、精确 tabId 关闭、localStorage 注入读取）
- 关键任务清单：460262ed（在线完成对照）、3b54a92c（在线完成对照）、54298884（断连后失败）、2f20a228（断连后成功、结果丢失）、9616f8ae（刷新+恢复接续成功）、55e891bc（恢复态停止）、e40e547a（切换后完成、结果丢失）

## 七、复测记录（三项修复后，2026-09-29 10:57:41 至 11:59:00 +0800）

复测环境同首轮（前端 5173 / 后端 3000，账号 test_bgrun_x7k9）。复测前先做代码存在性核查：后端 server/runs.ts finishedUnclaimed 标记 + ackRun + stmtFindUnclaimedTerminal（`status IN ('succeeded','failed') AND applied_at IS NULL ORDER BY updated_at DESC LIMIT 1`）与 POST /runs/:runId/ack（routes/llm.ts）在位；前端 useRunRecovery.ts 终态领取回放、ensureRecoveredDoneMessage（:196）、settleProjectStatusAfterTerminal（:173）在位。后端已热重载，前端 Vite 热更。

### 7.1 AC-001/AC-002 复测：断连后完成回来（PASS）

任务 2cb729f0（项目 ff25eb43，个人读书管理应用，全新项目）：

- 11:00:54 任务创建（running/generate），页面确认分析完成、生成进度 2/3
- 11:01:40 chrome_close_tabs(tabIds=[1434883717]) 精确关闭发起标签
- 断连期间 DB 时间线（每 10s）：generate 持续推进（03:02:20Z→03:03:44Z），11:05:21 短暂 review 后回落 generate，**11:06:29 succeeded/done**——断连自驱 4 分 49 秒，期间 generate→review→generate→done
- result_files 26701 字节落库；applied_at 初始为空
- 11:14 左右从项目列表重进（约在完成后 8 分钟）：
  - **「生成已完成」toast 直接捕获**（进入后首屏截图右上角，AC-004 补测项达成）
  - 预览区渲染完整深色读书应用（首页/书架/番茄钟/我的底导航）
  - 代码视图：项目文件 4 个（index.html 5.1KB / main.css 7.4KB / main.js 11.1KB / README.md 0.8KB），真实生成代码
  - 版本历史面板：「历史(1)」，V1 初始「生成应用，共 4 个文件」当前
  - 对话区：assistant 消息存在（服务端 projects.data 实查：chat=2，assistant 消息 27240 字符、runId=2cb729f0，MAJOR-002 修复证实）
  - 服务端项目 status=ready（MINOR-003 修复证实）；generations.applied_at=1790651287717（ack 链路走通）
- 再次进入（11:19）：无恢复条、无 toast，消息数（1+1）与版本数（1）稳定，不重复弹恢复
- 未捕获项：「正在应用离线期间完成的结果...」恢复条文案未获视觉证据——回放在进入后约 2-3 秒内完成（26KB 事件回放快于截图链路），文案代码在位（useRunRecovery.ts:406），其下游效果（应用/版本/消息/ack）全部实测到位。标注 UNVERIFIED（仅文案本体，非功能）

### 7.2 AC-007 复测：失败可见（PASS，带 MINOR-007 保留）

复用首轮自然失败任务 54298884（failed，error 文案在库）：

- 第一次进入 14698477（11:30 左右）：仅回放了同项目更新的未领取任务 c174d957（succeeded，10:04，applied_at 置 11:30:54），失败条未出现——后端 stmtFindUnclaimedTerminal 每次只取 `ORDER BY updated_at DESC LIMIT 1`
- 第二次进入（11:32）：**红色失败条出现**（DOM 实证：`data-testid="run-recovery-failure"`、`border-red-500/20 bg-red-500/5`），含完整原因文案（"生成结果格式不符合要求，已自动重试 4 次仍未成功..."）+ **重试按钮**（红系样式）+ 关闭按钮；对话区新增 11:32 线程同文案错误消息
- generations 表：54298884.applied_at=1790652732396（11:32:12 ack），失败结果链路闭环
- MINOR-007（新）：失败条呈现为排队式——同项目多未领取任务时，最新 succeeded 会先顶掉 failed 的呈现，需多次进出逐个消费。可用性瑕疵，不算验收失败

### 7.3 AC-006 复测：切换项目（FAIL，两处新缺陷）

**7.3.1 生成中切走再切回：FAIL（MAJOR-005）**

任务 fdc50da3（项目 C=d2a44e56，11:35:23 创建，长生成约 8 分钟）：

- 11:35:50 左右从 C 切到项目列表 → 进入项目 B（11:36:07 DB 确认 C 仍 running/generate）
- 11:36:40 左右切回 C：**无恢复条、无生成中面板、无任何进行中指示**（DOM 查询 run-recovery-banner 无元素；交互元素查询无停止/暂停按钮）；等待至 11:37+ 仍无
- 任务 11:43:25 succeeded（DB 时间线：generate→review→generate→done）
- 根因定位（代码证据）：HomePage 卸载无任何清理（无 abort/无状态复位，src/pages/HomePage.tsx 无 unmount cleanup），chatStore.isGenerating 在离开后保持 true；重挂载后恢复入口被 `if (useChatStore.getState().isGenerating) return;`（useRunRecovery.ts:526）短路；而页面生成面板用的是组件本地 state（HomePage.tsx:479 useState(false)），重挂载后为 false，于是既不恢复也不显示——用户切回后对进行中任务零感知
- 对照：首轮 AC-003 PASS 的场景是浏览器刷新（store 重置），SPA 内项目切换（无刷新）才会触发本缺陷

**7.3.2 完成后切回：结果可交付，但消息重复（MAJOR-004，见 7.4）**

任务 b3db0f3f（项目 A，11:23:21 创建，21 秒完成）：完成时用户仍在 A 页面（live 写入 msg，runId=run-1790652201420）→ 切到 B 再切回 A：结果消息送达，但 chat 从 4 条涨到 5 条——新增一条与 live 消息逐字相同的重复 assistant 消息（runId=b3db0f3f，服务端 projects.data 实查）。fdc50da3 同模式（C 的 live 消息 runId=run-1790652923196 已在，重进后预计同样重复）。

另：积压任务交付验证通过——进入 B 时领取了一小时前的 e40e547a（applied_at=11:25:22），进入 14698477 时领取了 c174d957（applied_at=11:30:54），均无需用户做任何事。

### 7.4 防重复复测：FAIL（MAJOR-004）

- 复现 1（项目 A/b3db0f3f）：chat 4→5 条，重复消息内容逐字相同，仅 runId 不同
- 复现 2（项目 D=6d45938b，全新计数器项目，11:55:01 创建、16 秒完成）：live 完成（msg1，runId=run-1790654101542，11:55:28）→ 切走再重进 → 回放补写 msg2（runId=d6e81e07，11:56:32），UI 上呈现为两个内容高度重复的「创建」线程；applied_at=11:56:33
- 收敛性：第三次进入 D 后 chat 稳定 3 条（applied 标记 + ack 双保险生效），不再继续膨胀
- 根因（代码证据）：live 路径消息用客户端 runId（`run-<创建毫秒>`），且不写 applied 标记、不 ack；恢复通道去重 `hasAssistantMessage = chat.some(m => m.role==='assistant' && m.runId === runId)`（useRunRecovery.ts:196-202）按服务端 runId（uuid）匹配，永远匹配不上 live 消息 → 重放必补一条
- 结论：**"完成后反复进出项目，消息数/版本数稳定不重复"不成立**（消息翻一倍后收敛；版本数未复现重复——首轮 9616f8ae 与本轮 D 均为 1，因走 hook 内部终态回放分支不落版本）

### 7.5 复测新缺陷与总体结论

| 编号 | 严重度 | 描述 | 复现步骤 | 建议负责角色 |
|---|---|---|---|---|
| MAJOR-004 | major | live 完成后离开再回来，消息双写：live 消息（客户端 runId）与回放消息（服务端 runId）内容重复；live 路径不写 applied 标记、不 ack，恢复去重按 runId 永不匹配。2/2 复现（b3db0f3f、d6e81e07），ack 后收敛 | 发起短生成 → 页面上等完成 → 切到别的项目 → 切回：chat 多一条重复 AI 消息 | dev-litpp-frontend-developer（live 完成时写 applied 标记/ack，或恢复去重兼容客户端 runId） |
| MAJOR-005 | major | SPA 内切换项目离开生成中页面再切回，恢复机制被卡死的 chatStore.isGenerating 短路（useRunRecovery.ts:526），页面无任何进行中/恢复指示，直到任务完成才被动感知；刷新场景不受影响 | 发起长生成 → 切到别的项目 → 切回：无恢复条、无进度面板 | dev-litpp-frontend-developer（卸载时复位 isGenerating 或恢复入口改用非阻塞判断） |
| MAJOR-006 | major（blocker 候选） | 项目 C（d2a44e56）从列表打开必为空白欢迎页（7 项目全新标签页复现 2 次）；switchProject 走 loadProject(null)→deleteProject 孤儿清理路径，本地明细缺失/损坏；服务端数据完好（57KB，chat 2 条、status draft）。同批其他项目（A/B/D/14698477）均正常。测试期间 11:25 有 liveEngine.ts HMR，不能完全排除开发中热更干扰，需开发复核根因 | 复现序列：新建 C（11:35）→ 生成完成（11:43，期间曾切走再切回）→ 从项目列表点 C：欢迎空态 | dev-litpp-frontend-developer（localStorage 明细持久化/加载链路）+ dev-litpp-backend-architect（孤儿清理不应静默 deleteProject） |
| MINOR-007 | minor | 终态任务领取呈排队式：/runs/active 每次仅返回最新一条未领取任务，同项目多个未领取时需反复进出逐个消费，最新 succeeded 会先顶掉 failed 的呈现 | 同项目积压 succeeded+failed 各一条 → 进入只回放 succeeded → 再次进入才见失败条 | dev-litpp-backend-architect（可考虑一次返回全部未领取或优先 failed） |
| UNVERIFIED-008 | - | 「正在应用离线期间完成的结果...」恢复条文案未获视觉捕获（回放 2-3 秒内完成，快于截图链路）；代码在位、下游效果全部实测 | - | - |

**原三项修复验证结论**：BLOCKER-001 修复有效（finishedUnclaimed+ack 全链路走通，含一小时积压任务自动领取）；MAJOR-002 修复有效（恢复完成 AI 消息在库）；MINOR-003 修复有效（A=ready、B/C/14698477 收口为 draft/ready，项目列表徽章同步）。

**复测后总体结论**：

1. AC 通过率 5/7（AC-001/002/003/004/005/007 PASS，AC-006 FAIL）；P0 F-004 结果感知达成，首轮一票否决解除。
2. 但复测新增 MAJOR-004（消息双写，稳定复现）、MAJOR-005（切换后恢复失效）、MAJOR-006（项目 C 打不开，blocker 候选）。
3. **仍不可宣称完成**：MAJOR-004 直接违反"消息数/版本数稳定不重复"验收；MAJOR-005 使 AC-006 的核心场景（切走再切回继续看进度）失效；MAJOR-006 存在用户完全打不开自己项目的风险。三项修复（建议负责角色见上）并回归 AC-006 与防重复用例后，方可再议进入下一阶段。
4. 本轮证伪的宣称："三个缺陷已修复"仅对原三项成立；修复引入的 live/恢复双通道 runId 不一致使防重复从 PASS 退化为 FAIL，属修复附带的回归。

**复测验证时间与环境**：2026-09-29 10:57:41 至 11:59:00 (+0800) 现场执行；任务时间线 sqlite3 只读实查 data/atoms.db（generations.applied_at/projects.data.chat 逐次取证）；UI 证据为 mcp-chrome 实际操作与 DOM/截图捕获；测试任务清单：2cb729f0（断连成功+完整交付）、b3db0f3f（live 完成后切回、消息重复）、fdc50da3（生成中切回无恢复、项目 C 打不开）、d6e81e07（D，防重复复现+收敛）、54298884/c174d957/e40e547a/3b54a92c（积压领取与失败可见）。

## 八、第三轮定向复测（MAJOR-004/005/006 修复后，2026-09-29 12:16 至 12:50 +0800）

环境同前（前端 5173 / 后端 3000），新注册账号 rc3tester0929a，Chrome MCP 实测。本轮仅针对三项 MAJOR 修复 + 防回归，不重复全量验收。

### 8.1 用例结果

| 用例 | 判定 | 说明 |
|---|---|---|
| MAJOR-004 防重复 | **FAIL（机制 PASS，暴露 RC3-BUG-001）** | 无重复消息、无重复版本（PASS）；但切回后 AI 完成消息 2→1 丢失（见 8.2） |
| MAJOR-005 SPA 切换恢复 | **PASS** | 生成中切 /projects 45s 后切回，3 秒内 run-recovery-banner 出现，回放续接，done 应用完整（单位换算项目 bf7b162c，chat 2 条 / 版本 1 / applied 标记 / runs/active=null 全部到位） |
| MAJOR-006 项目打开不误删 | **PASS** | 删除项目 02028084 本地明细键（15972 字节，摘要保留）后刷新，从列表点开：列表项未删、项目正常打开（非欢迎页）、详情从服务端回填（backfilled=true，chatCount=1，fileCount=7） |
| 回归（在线迭代生成 + 停止） | **PASS** | 迭代生成完成预览生效、chat 6 条无重复、版本 2 个；暂停生成按钮有效且服务端任务同步 cancelled |

### 8.2 新缺陷清单

| 编号 | 严重度 | 描述 | 证据 | 建议负责 |
|---|---|---|---|---|
| RC3-BUG-001 | major | 在线完成生成后 AI 完成消息不持久化，切走再切回消息 2→1：HomePage done 链路 addMessage 后未触发项目持久化（本地与服务端 chat 均仅 user 消息，savedAt 早于完成时刻约 5 分钟）；applied-run 去重标记 + ack 使 useRunRecovery 跳过恢复、ensureRecoveredDoneMessage 兜底永不触发。恢复通道完成的项目 chat 完整（反证缺口仅在实时链路） | 倒数日项目 02028084 实测 2 复现；localStorage 注入读取 + GET /api/projects 双通道取证 | frontend-developer（done 链路补持久化）+ ai-engineer（去重跳过时补偿） |
| RC3-BUG-002 | major | 项目云端同步不完整：单位换算项目 bf7b162c（本地 ready、2 版本、chat 完整）完全不在 GET /api/projects 服务端列表，MAJOR-006 的服务端回填保障对其失效；该项目特殊路径为"生成中切走、经恢复通道完成" | GET /api/projects 实查 | frontend-developer 排查（必要时转 backend-architect） |
| RC3-BUG-004 | minor | 用户主动"暂停生成"终态消息误写为"生成结果格式不符合要求，已自动重试 4 次仍未成功。请点击重试再次生成..."，语义误导 | 回归用例实测 | ai-engineer |
| （附带） | minor | JsonStructureRenderer.tsx:536 ReviewReportCard 将 repairInstructions 元素（{file,line,issue}）直接当 React child 渲染抛错，完成消息显示"该消息渲染失败"占位卡（有 MessageErrorBoundary 降级，不白屏） | console 错误栈 | frontend-developer |

### 8.3 结论

1. MAJOR-005、MAJOR-006 修复验证有效；MAJOR-004 去重机制生效（标记+ack 双保险）。
2. **不可提交**：RC3-BUG-001 为 MAJOR 级数据丢失（违背"数据持久化"产品要求），且恰被刚加的去双保险掩盖（在线完成路径恢复链路从不介入，介入时兜底又被标记关掉）；RC3-BUG-002 使回填保障对部分项目失效。
3. 本轮证伪的宣称："生成完成 = 结果已保存"不成立。前两轮验证的恢复链路完整，但"在线等完成"这一最常见路径从不经过恢复链路，其消息从未落盘。
4. 修复后最小回归：在线完成 → 切换 → 消息不丢（重跑用例 1）+ 抽查 RC3-BUG-002 同步。

## 九、第四轮最小回归（RC3 修复后，2026-09-29 13:06 至 13:36 +0800）

环境同前，账号 rc3tester0929a。

### 9.1 用例结果

| 用例 | 判定 | 说明 |
|---|---|---|
| 1 在线完成双通道持久化 | **PASS** | 记账本项目 591a33c8 在线完成切回消息稳定 2 条；本地 envelopeSavedAt=05:14:36Z（晚于完成）、服务端 chat 含 assistant（runId run-1790658404707）+ 7 文件 |
| 2 服务端同步 | **PASS** | 列表 count=3 含 591a33c8；bf7b162c 已追平（41348 字节，PUT 补建生效）。注记：get_web_content 命中 HTTP 缓存返回旧列表为取证工具假象，fetch 通道证实正常 |
| 3 取消文案 | **FAIL** | 文案中性化 PASS（"生成已暂停"无格式/重试字样）；但服务端终态落库 failed 非 cancelled（RC4-BUG-002），重开项目出现"请求已取消"红色失败卡 |
| 4 repairInstructions 渲染 | **PASS** | 对象格式化为 "file:line issue" 文本列表，无失败占位卡，控制台 0 异常 |
| 5 抽查切走切回 | **FAIL** | 意外发现 RC4-BUG-001：run 在切走期间已结束故无 banner（正确行为，MAJOR-005 本轮 UNVERIFIED 无回退证据）；但重构迭代产物全部静默丢失 |

### 9.2 新缺陷清单

| 编号 | 严重度 | 描述 | 证据 | 建议负责 |
|---|---|---|---|---|
| RC4-BUG-001 | major | modify 意图升级场景 run 产物静默丢失：格式重试循环中意图升级（"建议生成完整文件"）发出空产物中间 done（outputTokens=46 无 files），前台当终局应用并 ack（run 4f48d86f succeeded/result_files=NULL/applied_at=13:32:21.670），最终真实产物再无落库机制；AI 回复与文件全丢、无任何报错，且与前台是否见证无关（服务端 done 即无产物） | DB 实查 events 4 条 + done payload | ai-engineer（生成管线终态判定） |
| RC4-BUG-002 | major | 主动取消落库 failed 而非 cancelled：/cancel 的 error 事件（"请求已取消"）先于 cancelRunTask 的 finish('cancelled') 到达录制器，终态竞争 cancelled 被忽略；重开项目回放 error → 红色失败卡 + 重试按钮，主动取消被失败呈现 | run f82f4a9d status=failed, error='请求已取消' | ai-engineer（runs.ts 终态竞争） |
| RC4-MINOR-001 | minor | 项目列表摘要把 failed 项目显示为"已完成" | /projects 列表实测 | frontend-developer |

### 9.3 结论

1. RC3 三项修复（BUG-001 双通道持久化 / BUG-002 同步追平 / 渲染）全部验证有效。
2. **不可提交**：两个新 MAJOR 均在服务端生成管线（中间 done 终态误判 / 取消终态竞争）。
3. 本轮证伪的宣称：BUG-001 修复"忠实持久化了不含产物的状态"——flushProjectDetail 正确执行，但上游终态本身是空产物中间 done；BUG-004 前端文案中性化有效但服务端终态未闭环。
4. UNVERIFIED：MAJOR-005 banner 恢复路径本轮未触发（run 在切走期间已结束），第三轮 PASS 结论无回退证据；RC4-BUG-001 前台见证场景未实测（服务端 done 即无产物，推断无关）。

## 十、第五轮定向回归（RC4 修复后，2026-09-29 14:19 至 14:51 +0800）

环境同前，后端 14:09 热重载确认。typecheck 干净、全量 39 文件/669 测试通过（验证者亲跑）。

### 10.1 用例结果

| 用例 | 判定 | 说明 |
|---|---|---|
| 1 取消终态 | **PASS** | run b36bda47 落 `running/engineer_paused`（非终局、无 error/failed、可继续）；重开项目中性"生成已暂停，等待你的反馈"+ 继续/放弃 + 恢复 banner；列表徽章"生成中"如实显示。RC4-BUG-002 修复生效（实测行为与修复意图精确一致，与最初断言"cancelled"字面差异系暂停/取消语义演进，以修复描述为准） |
| 2 意图升级产物 | **PARTIAL FAIL** | 2b 切走恢复领取完整 PASS（run 45d6b8f6：9388 字符产物落地、文件更新、chat 4 条、appliedRun 写入）；2a 在线完成被 RC5-BUG-001 旁路绕过（见下）；版本断言 FAIL 系 validateGeneratedHtml responsive 启发式判失败（validation.ok=false 按设计不存版本），属产物质量与校验交互，非恢复机制缺陷 |
| 3 防回退抽查 | **PASS** | 切走 10s 切回消息组不变无重复无丢失；暂停态重开 banner 约 3s 出现。"真·生成中切回"未捕获（两次长重构均在切走期间完成），UNVERIFIED 不算 FAIL |
| 4 全绿确认 | **PASS** | typecheck 干净 + vitest 669/669 |

### 10.2 缺陷清单

| 编号 | 严重度 | 描述 | 证据 | 建议负责 |
|---|---|---|---|---|
| RC5-BUG-001 | major | RC4-BUG-001 修复被"空变更 diff"旁路绕过：模型输出 changes:[] + 对话 summary 命中 llm.ts:1596-1612 空变更分支直接对话交付 done，handleConversationEscape 三防护点零命中，产物静默丢失 | run d40ff5e7 事件链 + 日志"diff 输出为空变更，转对话模式" | ai-engineer |
| RC5-MINOR-001 | minor | 暂停反馈文案重复："生成已暂停。生成已暂停，等待你的反馈" | 截图 rc5-case1-reopen-paused | frontend-developer |
| RC5-MINOR-002 | minor | diff 交付摘要统计失真：成功应用后仍显示"已应用 0 处修改，涉及 2 个文件" | run 45d6b8f6 chat 末条 | ai-engineer |
| RC5-OBS-001 | 观察 | diff 产物 index.html 引用未创建的 src/main.js，沙箱内逻辑可能失效；校验器不查引用存在性 | ca2f8f8f files 键集 vs 引用 | ai-engineer 评估 |

RC5-OBS-001 评估结论（ai-engineer，2026-09-29）：现状 E_IMPORT_MISSING 仅覆盖 react-cdn 框架的 import 扫描，html 框架 `<script src>`/`<link href>` 本地引用不在检查范围。建议方向 B 分两步独立实施（不搭车本次 bugfix）：第一步 html 分支新增本地路径存在性检查，以 warnings 上线（不阻塞交付、不烧重试预算）测误报率；第二步误报干净后对 create+diff 模式升格 error 走既有校验重试通道。另 prompt 侧的空变更纠偏 hint 已随 RC5-BUG-001 落地（覆盖"借口要内容"型规避，不覆盖"引用未建文件"型）。

### 10.3 结论

1. 取消语义、恢复领取、防回退、全量回归四项全部确认有效，卡点收敛至"空变更 diff 旁路"一处。
2. 本轮证伪的宣称："RC4-BUG-001 已修复"对实际触发面无效——复刻单测模拟的路径（parseOutput conversation）与真实事故路径（diff 空变更）不一致，测试全绿但缺陷仍在。教训：复刻测试必须以真实事故路径为模拟对象。

## 十一、第六轮窄验证（RC5 修复复测，2026-09-29 15:08 至 15:28 +0800）——最终判定：可提交

| 用例 | 判定 | 证据 |
|---|---|---|
| 1 空变更产物不丢 | **PASS** | 大重构迭代（run e8e4a441）：诚实交付 30 处编辑、文件/预览更新、非规避文本；空变更旁路未自然触发（如实标注），以 llm.rc5.test.ts 4/4（验证者亲跑）+ server/llm.ts:1606 代码在位为服务端证据 |
| 2 暂停文案 + 续跑 | **PASS** | 暂停卡单条连贯文案（DOM 取证）；继续生成反馈后新 run succeeded、4 处编辑落地、预览更新 |
| 3 摘要口径 | **PASS** | "已应用 30 处修改，涉及 /index.html…"与 applyChanges 实际数一致 |
| 4 全量终证 | **PASS** | typecheck exit 0；vitest 40 文件 / 673 用例全过（验证者亲跑） |
| 5 暂停重开防回退 | **PASS** | 恢复横幅 + 暂停卡完整恢复，续跑正常 |

残余观察项（不阻塞，转后续待办）：

| 编号 | 级别 | 描述 | 建议 |
|---|---|---|---|
| RC6-OBS-001 | minor | 交付摘要"涉及"文件列表未去重（同文件多 change 块重复列出） | ai-engineer（chatDelivery buildDeliverySummary 去重） |
| RC6-OBS-002 | minor | 跳过的编辑仍计入"涉及/查看变更 N 个文件"（徽章 3 文件实际落盘 2） | ai-engineer（涉及列表以实际落盘为准） |
| RC6-OBS-003 | 观察 | 重开后暂停卡正文与标题六字重叠，语义连贯 | 可不处理 |
| RC6-OBS-004 | 观察 | responsive 启发式对简约风格产物偏严（连续判 false 致成功交付不存版本） | ai-evaluator 评估阈值 |

最终结论：六轮验证缺陷链（BLOCKER-001 结果孤岛 → MAJOR-004/005/006 → RC3-BUG-001/002 → RC4-BUG-001/002 → RC5-BUG-001）全部修复并逐轮验证收敛，AC 覆盖：AC-001 至 AC-007 全部实测通过或按修复语义确认（AC-006 切换恢复经第三/五轮 banner 实证）。可提交。
