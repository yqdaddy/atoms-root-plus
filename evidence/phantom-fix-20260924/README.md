# 幻影迭代修复 运行时验证证据

验证时间：2026-09-24 07:33 - 07:55（Asia/Shanghai）
验证人：dev-litpp-reality-checker（独立验证）
环境：localhost:5173（Vite dev）+ localhost:3000（tsx watch server，07:26 重启加载新代码）
浏览器：Chrome（mcp-chrome），登录态（云同步开启）

注：浏览器截图通道本次故障（image readback failed），运行时证据以文本存档代替。

## 证据 1：真实用户正常流程（生成 + 迭代）

- 07:33 新建项目（6ba6951c）发送"做一个简洁的个人主页，标题是验证测试站"→ 生成成功，右侧预览渲染"验证测试站"，files 3 个（/index.html、/styles/main.css、/src/main.js）
- 07:40 对该项目（chat 2 条 + files 3 个）发修改请求"把标题改大一点"→ diff 模式正常交付，聊天区显示"变更已应用（diff 模式跳过审查）"，模型输出 changes JSON 并被正确应用
- 结论：正常项目的修改请求走 diff 模式正常交付（验证清单第 3 项退路要求，通过）

## 证据 2：幻影请求体直连后端（决定性证据）

构造方式：在浏览器 MAIN world 直接调用后端 API，发送与修复后前端（requestAsIteration=false 时）完全一致的请求体：修改语义 prompt + 无 currentFiles/chatTurns/currentHtml。

STEP1: POST /api/llm/generate  body={"prompt":"把标题改大一点","options":{"framework":"html"}}
- status 200
- SSE 事件序列：stage...delta...approval_required
- sessionId: ceb632ae-0c40-4d16-9f39-ee15709c1a0a

STEP2: POST /api/llm/approve  body={"sessionId":"ceb632ae-..."}
- status 200
- SSE 事件序列：stage...delta...done
- done 事件：files=["/index.html"] hasChanges=false htmlLen=16172
- 无 error 事件，无"期望包含 files 数组的对象"报错

结论：修复后前端在幻影迭代场景发出的请求体会被服务端按全新生成处理，输出 files 格式并正常交付。原报错链路（currentFiles:{} + 修改语义 → changes → 容错条件不满足 → 裸错误）已被前端修复截断。链路闭合。

## 证据 3：localStorage 篡改受阻的原因（存储层 schema 防护）

尝试清空项目 files 保留 chat 历史构造幻影场景，两次被系统恢复：
1. 登录状态下云同步（apiSync.initializeSync + mergeProjects，src/services/storage/apiSync.ts:185）会从服务端拉回项目数据覆盖本地篡改
2. 存储层 isProject 校验（src/types/project.ts:211）强制要求 files[ENTRY_FILE_PATH] 存在，files 为空的项目数据 migrateProject 判定 validate-failed（src/services/storage/migration.ts:97），loadProject 失败 → 远程数据胜出

推论：幻影迭代（chat 有历史 + files 空）只能产生于内存中（新项目首条生成失败未落盘后继续对话），持久化层已排除该状态。因此尝试通过"生成中取消"构造（两次，间隔 2-6 秒点击停止），但简单页面生成 5 秒内完成，未能在落盘前中断。幻影场景的端到端 UI 实测受阻，以上述 API 直连证据 + 代码逻辑推演代替。

## 证据 4：测试套件

- npm test：9 文件 161 测试全部通过（与宣称基线一致），07:30:51 执行
- npx vitest run server/llm.changesTolerance.test.ts：4 场景全部通过，07:31:07 执行
  - 场景 3：第三轮策略切换（含最小 JSON 示例）后交付，断言"最后一次尝试""完整文件内容""第 2/2 次""完整重生成策略"
  - 场景 4：三次全失败时错误文案含"已自动重试 2 次""换一种描述方式"，且不含 '"edits"' 与 '期望包含 files 数组的对象'

## 证据 5：构建

- npm run build：通过（built in 2.41s）
- npm run build:server：通过（tsc 无错误输出）

## 云同步恢复的副作用验证（顺带）

对项目 6ba6951c 注入脏数据（files={}, savedAtNote）后，云同步自动恢复为 files 3 个文件 + chat 4 条（含修改对话），脏字段被清除。数据自愈行为正常。
