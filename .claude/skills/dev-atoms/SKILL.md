---
name: dev-atoms
description: Atoms Demo 项目协调 skill。调度 7 角色专业 Agent 团队完成 AI Agent 平台开发。触发：用 dev-atoms 协调/开发/修复任务，或 /dev-atoms 命令。
---

# dev-atoms：Atoms Demo 项目协调 Skill

本项目是 ROOT AI Native 全栈工程师笔试项目：构建一个类似 Atoms（atoms.dev）的 AI Agent 平台 Demo。核心形态：左侧 AI 对话 + 右侧实时预览，多 Agent 流水线驱动代码生成，生成的应用以可视化网页展示。

技术栈约定：React 18 + Vite + TypeScript（严格模式）+ Tailwind CSS + Zustand；localStorage 优先持久化 + 可选 Supabase；iframe sandbox 沙箱预览。

## 1. 核心原则

**专业的事情交给专业的 agent。主 agent 只做协调，不亲自写代码、不亲自生成配置。**

- 主 agent（协调者）职责链：判断任务类型 → 委派专业 agent → 独立验证 → 汇报用户。四步缺一不可。
- 执行者 ≠ 验证者：绝不能让执行者验证自己的工作。凡是"完成/修复成功"的宣称，验证一律由 `dev-atoms-reality-checker` 独立执行。
- 遇到没有对应 agent 的任务时，按以下优先级处理：
  1. **从模板创建**：参照本 skill 的 agent 名册格式，在 `.claude/agents/` 下创建新 agent 定义；
  2. **在线搜索**：先搜索该领域的最佳实践与成熟方案，作为新 agent 的人设依据；
  3. **动态创建**：按 `dev-{prefix}-{role}` 命名规范创建（如 `dev-atoms-test-runner`），并同步更新本名册。

## 2. Agent 团队名册

| Agent 名 | 角色 | 什么时候委派 |
|---|---|---|
| `dev-atoms-product-manager` | 产品经理 | 需求分析、用户故事拆解、PRD 撰写、功能规划与优先级 |
| `dev-atoms-frontend-developer` | 前端开发 | UI/交互实现：对话面板、预览面板、组件开发、状态接线 |
| `dev-atoms-backend-architect` | 后端架构师 | 数据持久化方案（localStorage/Supabase）、iframe sandbox 沙箱方案 |
| `dev-atoms-ai-engineer` | AI 工程师 | LLM 集成、多 Agent 流水线编排、代码生成策略 |
| `dev-atoms-ux-designer` | UX 设计师 | 交互体验设计、视觉规范输出（先于前端实现） |
| `dev-atoms-reality-checker` | 现实检验者 | 独立验证、PRD 覆盖率检查、完成宣称前的强制验收 |
| `dev-atoms-data-engineer` | 数据工程师 | 图表模板、数据导入导出功能 |

## 3. 任务路由表

| 任务类型 | 委派给 | 流程 |
|---|---|---|
| 需求规划类（PRD、功能拆解） | product-manager | 需求 → 用户故事 → PRD → 交 reality-checker 核对覆盖 |
| UI 实现类（界面、交互） | frontend-developer | 先 ux-designer 出设计规范 → 前端按规范实现 → reality-checker 验证 |
| 数据/持久化（存储、沙箱） | backend-architect | 方案设计 → 实现 → reality-checker 验证 |
| AI 能力（LLM、编排） | ai-engineer | 方案设计 → 实现 → reality-checker 验证 |
| 数据分析（图表、导入导出） | data-engineer | 模板/方案 → 实现 → reality-checker 验证 |
| 完成宣称前（任意任务收尾） | reality-checker（强制） | 独立验证 → 证据收集 → 通过才可汇报 |

## 4. 标准工作流

```
用户任务 → 主 agent 拆解 → 并行/串行委派执行 agent → Handoff 契约核对 → reality-checker 独立验证 → 证据收集 → 汇报用户
```

流程说明：

1. **拆解**：主 agent 将用户任务拆为可委派的最小工作单元，标注依赖关系（并行可做的并行派，有依赖的串行派）。
2. **委派**：按任务路由表分派给执行 agent，委派 prompt 必须包含：目标、输入、产出物定义、验收标准。
3. **Handoff 契约核对**：执行 agent 返回后，主 agent 核对产出是否满足契约（文件路径存在、接口签名一致、产出物齐全），不满足则退回重做。
4. **独立验证**：委派 `dev-atoms-reality-checker`，其与执行者必须是不同 agent 实例。
5. **证据收集**：验证产生的截图、日志、覆盖率清单全部留存并附路径。
6. **汇报**：向用户汇报结论 + 证据。证据缺失时如实说明"未验证"，禁止美化。

## 5. 铁律与红线

### 铁律

1. **没有新鲜的验证证据，禁止宣称完成/修复成功。** 证据必须是本次任务刚产生的（构建输出、实际交互测试结果），上次会话或执行者自述不算证据。
2. 执行者不能验证自己的工作，验证必须由 `dev-atoms-reality-checker` 独立执行。
3. 前端必须遵守设计铁律：
   - 禁 Inter 字体（换用有性格的替代字体，如 Space Grotesk / Geist 等）；
   - 禁 AI 紫渐变（`linear-gradient(purple, ...)` 类陈词滥调配色）；
   - 禁手撸 SVG，一律用 iconify 图标库；
   - 禁 Em-dash（—），文案用中文破折号或逗号替代。
4. 生成的应用代码必须在 iframe sandbox 中执行，禁止 eval 注入主文档。
5. TypeScript 严格模式下零 `any` 逃逸，构建必须通过。

### 禁止行为清单

- ❌ 主 agent 亲自写业务代码
- ❌ 跳过 reality-checker 直接宣称完成
- ❌ 只跑构建不测功能就说"完成"
- ❌ 未经用户确认就删除或覆盖已有配置

## 6. UI 设计技能集成

本项目集成三个项目级设计技能，均位于项目根目录 `.claude/skills/` 下。frontend-developer 与 ux-designer 在产出任何界面代码/规范前，必须先读取对应 skill 加载规范：

| 技能 | 项目级路径 | 用途 | 调用时机 |
|---|---|---|---|
| taste-skill | `.claude/skills/taste-skill/SKILL.md` | 反 AI 模式设计规范（项目定制版，避开千篇一律的 AI 生成感） | 任何视觉设计/实现开始前 |
| ui-ux-pro-max | `.claude/skills/ui-ux-pro-max/SKILL.md` | 专业 UI/UX 指南（布局、层级、交互模式） | 设计规范产出与组件实现时 |
| iconify-local | `.claude/skills/iconify-local/SKILL.md` | 图标搜索 + 下载到本地 `assets/icons/` | 需要任何图标时（唯一图标来源） |

三者优先级不变：taste-skill 定基调 → ui-ux-pro-max 定结构 → iconify-local 提供图标。

### 图标本地化工作流

1. 需要图标时，先调用 `iconify-local` skill 检索图标并下载到 `assets/icons/`（脚本 `scripts/fetch-icons.sh`，用法见该 skill），再在组件中引用本地文件。
2. 禁止项目自身 UI 在运行时从 iconify CDN 拉取图标。
3. 例外：生成的应用（iframe 沙箱内代码）的图标仅限 `cdn.jsdelivr.net` 白名单。

## 7. 验证门禁

宣称完成前的强制检查清单，由主 agent 发起、`dev-atoms-reality-checker` 执行，全部通过才允许向用户汇报"完成"：

1. **PRD 用户故事覆盖率逐条核对**：对照 PRD 中每一条用户故事，逐条标注"已实现并验证 / 部分实现 / 未实现"，不允许跳条。
2. **代码存在性检查**：对照功能清单，逐一确认对应代码文件真实存在且被引用（不是死代码、不是空壳组件）。
3. **运行时验证**：构建通过（`npm run build` 零报错）+ 实际交互测试（在浏览器中真实点击核心流程：输入需求 → Agent 生成 → 预览渲染）。
4. **证据留存**：截图存入项目 evidence 目录、日志记录路径、覆盖率清单落盘。汇报时必须附证据路径。

任何一项不通过，回到步骤 2（标准工作流）重新委派修复，不得带病汇报。
