---
name: taste-skill
description: Litpp Demo 项目级反 AI 味设计规范。任何视觉设计或前端实现开始之前必须调用，作为反 AI 味评审基线；实现完成后用于逐条自检。提炼自全局 taste-skill，结合本项目 docs/design-system.md 定稿 token 与禁则。
---

# taste-skill：Litpp Demo 反 AI 味基线

> 本文件是项目定制版。全局规范见 `~/.claude/skills/taste-skill/skills/taste-skill/SKILL.md`。
> 本项目设计系统已在 `docs/design-system.md` 定稿，其 token 与禁则优先级高于本文，本文与其冲突时按 design-system.md 修改。

## 1. 反 AI 模式禁令

以下模式是 LLM 生成界面的高频签名，任何情况下不得作为默认选择出现。除非用户明确要求并给出理由，否则一律禁止。

### 1.1 颜色

- **禁 AI 紫**：全站无紫色系、无紫色霓虹渐变、无紫色按钮辉光（LILA 规则）。紫、青、蓝紫渐变光斑是 AI 生成物泛滥的重灾区。
- **禁装饰性渐变背景**：本项目首屏与全部界面背景为纯色，无光斑、无网格线、无 mesh gradient 装饰。
- **禁纯黑纯白**：深色底用 `#09090b`，浅色底用 `#fafafa`；主文字不用 `#000` 与 `#fff`。纯值消灭层次感。
- **禁第二种品牌色**：单一强调色锁定。全站只有 atom 绿一个强调色，success 复用它；warning / danger / info 只用于语义，不作装饰。
- **禁霓虹外发光**：默认无 neon glow、无 outer glow。层级靠 1px 边框（border-default）分隔，阴影只用于真正离开页面的层。

### 1.2 字体

- **禁无个性默认字体**：不用 Inter、Roboto、Open Sans 作为主字体（全局版 discouragement + 项目禁用清单）。
- **禁运行时字体外链**：不引入 Google Fonts `<link>`，一律通过 @fontsource 自托管。
- **禁细字重中文**：中文字重只用 400 / 500 / 600，系统黑体细重在深底上发虚。
- **禁 Fraunces / Instrument Serif 类 LLM 最爱衬线体**作为默认展示字体。

### 1.3 图标与素材

- **禁手撸 SVG 图标**（项目铁律）：全站图标统一来自 iconify 体系，主集 lucide（`lucide:` 前缀），补集 tabler；同一界面不混用两集。
- **禁手绘装饰性 SVG 插画**：iconify 找不到合适图形时换语义近似的 lucide 图标，而不是画。
- **禁 div 拼假截图**：不用 `<div>` 矩形拼装假任务列表、假仪表盘、假终端窗口充当产品预览。
- **禁 emoji 当图标**：可见文本与标记中不放 emoji，用图标库字形替代。

### 1.4 排版与布局

- **禁 Em-dash**：U+2014 全角破折号与作为分隔符的 U+2013 en-dash 全站禁用，含标题、标签、按钮文案、提示文案、注释、文档。改用句号、逗号、括号、冒号或半角连字符。这是全局版认定为最严重的单条 AI 签名，零容忍。
- **禁三等分同款卡片**：三张一模一样的 feature 卡片横排是 AI 套版签名。工具 UI 按信息层级组织，不按营销页卡片模板填充。
- **禁千篇一律卡片布局**：卡片只在表达真实层级时使用，否则用 `border-t`、`divide-y` 或留白分组。长列表不用每行都画底线的默认 `<ul>`。
- **禁 Eyebrow 泛滥**：每个标题上方都加小型大写宽字距标签（`text-[11px] uppercase tracking-[0.18em]`）是最常违反的 AI 味。本项目工具 UI 原则上不加 eyebrow。
- **禁装饰性状态点**：彩色圆点只允许表达真实语义（生成中、连接断开），禁止出现在每个导航项、列表行、徽章前。
- **禁假精确数字**：不用编造的 `99.99%`、`4.1×`、`v1.4.2` 构建号、假版本脚注。数据要么真实，要么标注为示例。
- **禁 AI 味文案**：不用"提升""无缝""释放""下一代"等夸饰动词；空态与错误文案写平实的功能陈述句（design-system.md 第 3 节文案为一字不改的定稿）。

### 1.5 动效

- **禁无动机动画**：每个动画必须能说出一句话的理由（反馈 / 状态转换 / 层级引导），说不出就不做（MOTION MUST BE MOTIVATED）。
- **禁装饰性循环动画**：无漂浮、无 shimmer 满天飞。本项目仅 5 个有明确动机的循环动画（spinner、skeleton-shimmer、generating-pulse、caret-blink、typing-dots），见 design-system.md 1.5 节。
- **禁 window scroll 监听驱动动画**：用 IntersectionObserver 或 scrollIntoView。
- **只动 transform 与 opacity**：不动 width / height / top / left。
- **必须尊重 prefers-reduced-motion**：循环动画全量降级（design-system.md 1.5 节规则 2）。

### 1.6 状态完备

- **禁只有成功态**：任何视图必须四态齐备（loading / 生成中 / 错误 / 空），且错误态必须包含"发生了什么 + 用户能做什么 + 恢复动作按钮"三段式。
- **禁裸转圈**：超过 2 秒的等待必须有进度反馈；骨架屏优先于转圈（形状匹配的 shimmer 骨架，spinner 仅用于按钮内联）。

## 2. 本项目 taste 基线（定稿，不重新发挥）

以下决策已在 `docs/design-system.md` 定稿。**实现时直接引用，禁止重新选型、禁止"我觉得更好"式的临场发挥**。若确有必要变更，走设计评审改 design-system.md，不在代码里悄悄偏移。

| 维度 | 定稿 | 出处 |
|---|---|---|
| 唯一强调色 | atom 绿 `#16bf80`（atom-500），success 复用；色阶 atom-50 到 atom-950 | design-system.md 1.1 |
| 字体 | Space Grotesk（display + sans）+ JetBrains Mono（mono），@fontsource 自托管，中文回退系统黑体 | design-system.md 1.2 |
| 深色优先 | 深色为默认：`#09090b` 基底；浅色 `#fafafa` 经覆盖表切换；同屏不混主题 | design-system.md 1.1 |
| 图标集 | iconify 体系，主集 lucide，补集 tabler，25 个动作映射表照抄不得自创 | design-system.md 第 2 节 |
| 圆角锁定 | 仅 {0, 6, 10, 14, 9999}px 五值，控件 md、容器 lg、胶囊 full | design-system.md 1.4 |
| 间距锁定 | 4px 基准，Tailwind 刻度，禁半格值 | design-system.md 1.3 |
| 动效 | 80ms 到 280ms 区间，ease-standard 单曲线，仅 5 个有动机的循环动画 | design-system.md 1.5 |
| 层级 | 边框优先，1px border-default 分隔面板；shadow 只用于浮层 | design-system.md 1.4 |
| 基调参数 | DESIGN_VARIANCE 4 / MOTION_INTENSITY 4 / VISUAL_DENSITY 6 | design-system.md 0.2 |

选型理由（摘自 design-system.md，理解后不推翻）：

1. 绿是"生成、成长、可用"的颜色，本产品核心时刻是"应用活了"，情绪与功能一致
2. 绿色在深色工具 UI 中辨识度高，避开 AI 套版紫色与竞品（v0 黑白、bolt 黑底高亮）
3. Space Grotesk 几何骨架带工程感，契合"代码生成"气质；刻意避开 v0 同款 Geist，防止"套壳"观感
4. 主色与语义 success 同族，色板少、对比度天然达标（深底 8:1 起）

## 3. taste 自检清单（实现完成后逐条过）

实现或评审任何界面后，逐条回答。任何一条答不上来或答"是 AI 默认"，返工。

1. **换个 AI 会不会生成一模一样的界面？** 把需求原样丢给另一个模型，若产出与本界面高度雷同，说明落入了默认审美，重审颜色、字体、布局三个维度。
2. **主色是否有品牌理由？** 全站强调色必须且只能是 atom 绿 `#16bf80`。出现第二种品牌色、紫色系、青色系、装饰渐变，直接不合格。
3. **字体是否有性格？** DevTools 查 computed font-family：标题正文必须命中 Space Grotesk（拉丁）+ 系统中文黑体栈，代码与计数命中 JetBrains Mono。出现 Inter / Roboto / 禁用清单字体即不合格。
4. **图标是否全部来自 iconify？** grep 全站 SVG path：图标 DOM 必须是 iconify 渲染（`lucide:` / `tabler:` 前缀），零手写 path；同一界面不混用两集；strokeWidth 统一 2，颜色一律 currentColor。
5. **圆角是否只在锁定集合内？** 遍历 border-radius：只允许 {0, 6, 10, 14, 9999}px。
6. **四态是否齐备？** 每个视图对照 design-system.md 第 3 节矩阵：loading / 生成中 / 错误 / 空各有实现，文案与定稿一字不差。
7. **每个动画能否说出一句话的理由？** 说不出的删掉。时长是否在 80 到 280ms 区间，曲线是否为 ease-standard。
8. **有没有 Em-dash？** 全文 grep U+2014 与作为分隔符的 U+2013，出现即不合格（本文档自身亦零容忍）。
9. **文案有没有 AI 味？** 复读每一条上屏文案：无夸饰动词、无假精确数字、无装饰性标签；空态与错误文案是平实陈述句。
10. **有没有装饰性元素混入？** 无装饰状态点、无 eyebrow、无假版本号、无 hero 底部装饰条、无 locale 条。
11. **对比度是否达标？** 正文与 UI 文字 4.5:1 以上（含占位符）；text-tertiary 只用于禁用态。
12. **reduced-motion 是否降级？** 开启 prefers-reduced-motion 后循环动画全停，位移入场退化为仅 opacity。

## 4. 常见 AI 味案例对照

| 反面模式（AI 默认） | 正确做法（本项目定稿） |
|---|---|
| 深色底上紫蓝渐变 hero、按钮紫色辉光 | 纯色 `#09090b` 底 + atom 绿 `#16bf80` 单强调色，层级靠 1px border-default |
| Inter + 通用 sans 全站一把梭 | Space Grotesk 主字体 + JetBrains Mono，@fontsource 自托管，无外链 |
| 手绘一坨 SVG path 当图标，或 lucide / phosphor 混着用 | 全站 iconify，主集 lucide，动作映射表照 design-system.md 第 2 节执行 |
| 三张同款渐变卡片横排讲特性 | 按工具信息层级组织：面板双栏 + 边框分隔，卡片仅在真实层级需要时出现 |
| 等待只有无限转圈，出错只有一行红字 | 骨架屏 + 阶段指示器 + 计时器 + 三段式错误卡片（what / what-can-you-do / 恢复按钮） |
| 每个标题上方加 `UPPERCASE TRACKED` eyebrow，每行前加彩色圆点 | 标题裸排；状态点仅在真实语义（生成中）出现，全站仅 generating-pulse 一处 |
| 文案写"无缝释放下一代 AI 生产力"，数据编 `99.99%` | 写"生成结果自动保存在本地"式功能陈述句；数字要么真实要么标示例 |
| 每个元素加弹簧循环动画显得"高级" | 动效只服务反馈与状态转换，5 个有动机的循环动画之外全部静止，尊重 reduced-motion |

## 5. 与全局版的关系

- 本项目是工具型产品，属于全局 taste-skill 第 13 节声明的范围之外（落地页/作品集专属规则如 hero 规格测试、marquee、bento 节奏不适用）。
- 全局版的反 AI 味基线（LILA、字体个性、单强调色、圆角锁定、单主题、动效动机、文案自查、四态闭环、纯黑纯白禁令）全部适用于本项目，已收敛进本文第 1 节。
- 需要全局版完整细节（色彩校准、layout discipline、pre-flight 全表）时读 `~/.claude/skills/taste-skill/skills/taste-skill/SKILL.md`；本项目日常实现以本文与 `docs/design-system.md` 为准。
