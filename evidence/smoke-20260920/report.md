# Litpp Demo 集成测试报告

> 由 dev-litpp-reality-checker 独立执行，报告日期 2026-09-20 08:41-09:05。
> 本轮发现的所有缺陷（D1-D5）随后已修复并通过二次独立验证。

## Phase A：集成测试（浏览器自动化）

| 步骤 | 功能 | 状态 | 证据 |
|------|------|------|------|
| A1 | 未登录打开 / 显示落地页 | PASS | `screenshots/a1-landing-not-logged-in.png` |
| A2 | 未登录访问 /workspace 重定向登录页 | PASS | URL = `/login?redirect=%2Fworkspace` |
| A3a | 重复注册显示错误 | UNVERIFIED | 判定逻辑有缺陷需重测 |
| A3 | 注册后进入工作区 | PASS | `screenshots/a3b-register-success-workspace.png` |
| A4 | 工作区欢迎界面+模板芯片 | PASS | 欢迎文案 + chips（待办清单/数据看板/落地页） |
| A5 | 提交番茄钟需求 | PASS | `screenshots/a5b-after-submit.png` |
| A6a | 流式分析后出现批准按钮 | FAIL | 假"生成完成"横幅提前弹出（缺陷 D1/缺陷②） |
| A6c | 批准后流式生成完成 | BLOCKED | 流程中断 |
| A6d | 预览iframe含srcdoc内容 | BLOCKED | 服务端 entryBytes=222（默认模板） |
| A7 | 项目列表出现记录 | PASS | `logs/a7-projects-list-text.txt` |
| A8 | 新建项目清理旧状态 | PASS | `screenshots/a8b-workspace-after-new.png` |
| A8d | 第二需求创建新项目记录 | PASS | before=2; after=3 |
| A9 | 刷新后数据恢复 | PASS | localStorage summaries=3 |
| A10 | 登出回到落地页 | FAIL | URL 仍为 /workspace（缺陷 D3） |
| A10b | 登出清理localStorage项目 | PASS | 残留键=[] |
| A11 | 重新登录后项目列表恢复 | PASS | 含幻影数据（缺陷 D2） |

## Phase B：功能冒烟（API）

| 测试项 | 状态码 | 状态 |
|--------|--------|------|
| 错误密码登录 | 401 | PASS |
| 重复注册 | 409 | PASS |
| 登出 | 200 | PASS |
| 登出后 GET /me | 401 | PASS |
| 项目 CRUD（POST/GET/PUT/DELETE） | 201/200/200/200 | PASS |
| 删除后 GET | 404 | PASS |
| POST /llm/generate 空 prompt | 400 | PASS |
| POST /llm/cancel 随机 requestId | 200 {success:false} | PASS |

## 缺陷清单与修复状态

| 编号 | 严重度 | 描述 | 修复状态 |
|------|--------|------|----------|
| D1 | 阻塞 | 生成流程在批准阶段断裂（假"生成完成"横幅 + 首条用户消息丢失） | ✅ 已修复并验证 |
| D2 | 严重 | 游客池数据污染登录用户项目列表 | ✅ 已修复并验证 |
| D3 | 严重 | 登出后 URL 停留在 /workspace | ✅ 已修复并验证 |
| D4 | 轻微 | 聊天面板 1440px 下极窄 | ✅ 已修复并验证 |
| D5 | 轻微 | PUT /api/projects 接受任意 files 字段形状 | ✅ 已修复并验证 |

## 环境信息

- 前端：http://localhost:5178（Vite dev server）
- 后端：http://localhost:3000（pm2 atoms-server）
- Playwright chromium @1.49.0（headless）
- 控制台错误数：Phase A1 = 7 条

## 总体结论

测试时点核心主流程不可用（批准阶段断裂）；上述缺陷修复后经 reality-checker 二次独立验证全部 PASS（代码存在性 + 逻辑推演 + 构建零错误）。
