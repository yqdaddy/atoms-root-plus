# UX 规范：广场页与项目资料面板

token 唯一来源 docs/design-system.md：深色优先（bg-base #09090b、bg-surface #18181b、border-default #27272a）、唯一强调色 atom 绿 #16bf80、圆角 {6,10,14,full}、Space Grotesk + JetBrains Mono、间距 4px 基准、动效 80 到 280ms。本文只定布局、组件、文案与图标，不另立 token。时间戳与计数一律 text-secondary（12px），不用 text-tertiary（对比度不足 4.5:1）。

## 一、广场页 /gallery（公开页）

### 布局线框

```
┌──────────────────────────────────────────────────────────┐
│ 码孖造   功能 定价 文档 [广场]        登录 / 工作台       │ 复用 landing Header（h-14，border-b），nav 增「广场」，当前项 text-primary
├──────────────────────────────────────────────────────────┤
│ 广场  N 个项目                        [最新][最多复刻]    │ max-w-6xl px-6 py-8；segmented：active bg-elevated，h-8，无图标
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                      │ grid-cols-1 sm:2 lg:3 gap-4
│ │ 缩略图   │ │         │ │         │                     │ aspect-[4/3] bg-base，居中 lucide:eye 32px tertiary（装饰位）
│ ├─────────┤ ├─────────┤ ├─────────┤                      │ 卡片：bg-surface、border-default、rounded-lg(10px)
│ │ 项目名   │ │         │ │         │                     │ 14px/500 text-primary truncate；hover:border-strong 140ms
│ │ 简介两行 │ │         │ │         │                     │ 13px text-secondary line-clamp-2
│ │ 作者 时间│ ○6 [复刻]│ │         │                     │ 12px：copy 图标+mono 复刻数；已登录见主色小按钮「复刻」
│ └─────────┘ └─────────┘ └─────────┘                      │ 未登录该位置为 ghost「登录后复刻」
└──────────────────────────────────────────────────────────┘
```

### 组件清单（复用优先）

| 组件 | 来源与用法 |
|---|---|
| 顶部导航 | landing/Header.tsx 原样复用，nav 加「广场」项（/gallery），当前页高亮 |
| 项目卡片 | 复用 ProjectsPage ProjectCard 的容器语言（border、hover、圆角），去掉 more 菜单与状态徽章 |
| 相对时间 | 抽取 ProjectsPage formatTime 复用（刚刚、N 分钟前、N 小时前、N 天前、短日期） |
| 只读预览 | Modal.tsx 全屏容器 + SandboxFrame（sandbox+srcdoc，postMessage 校验），顶条「只读预览 · 项目名」+ x 关闭 |
| 排序切换 | 自建 segmented control：两枚按钮「最新」「最多复刻」，默认最新 |
| 结果反馈 | Toast.tsx：复刻成功、复刻失败 |
| 发布入口 | /projects 卡片 more 菜单新增「发布到广场」（share-2 图标行），成功后 toast「已发布到广场」；工作台顶区可选同款 ghost 按钮，P2 可延后 |

### 四态与文案

| 态 | 表现与文案 |
|---|---|
| 加载 | 骨架屏 6 张卡片（缩略图块加两条文字条），shimmer 1.6s，reduced-motion 停 shimmer；不用裸转圈 |
| 空 | compass 24px + 标题「广场还没有项目」+「在项目卡片上选择发布到广场，作品就会出现在这里」+ 主按钮「去工作台」 |
| 错误 | 三段式卡片：「广场加载失败」+「检查网络后重试，已加载内容不会丢失」+ 主按钮「重试」（refresh-cw） |
| 排序请求中 | 保持现有列表不清空，segmented 禁用，完成后原位刷新 |
| 复刻中 | 按钮内联 loader-circle 旋转（0.9s），按钮禁用防重复提交 |
| 复刻成功 | toast success「已复刻到我的项目」，随后跳 /workspace |
| 复刻失败 | toast error「复刻失败，请重试」，按钮恢复可用 |

### 交互流

1. 点卡片任意处打开只读预览，未登录同样可看；预览内不可编辑。
2. 已登录：卡片 footer 显示主色小按钮「复刻」；未登录：ghost「登录后复刻」跳 /login?redirect=%2Fgallery。
3. 预览 Modal 内 Esc 或点遮罩关闭，焦点归还触发卡片。

## 二、项目资料面板（工作台）

### 入口与形态

工作台顶部工具区新增 ghost 图标按钮「资料」（book-open 16px + 文字，aria-label 同文字）。点击右侧展开抽屉：宽 360px（min 320，max 400），全高，bg-surface，左 1px border-default，200ms translate-x 入场，遮罩 bg-black/50；Esc、遮罩点击、x 均可关闭。

### 布局线框

```
┌────────────────────────────┐
│ 项目资料                [x] │ 标题 20px/600
│ 已用 12.4 KB / 32 KB        │ mono-metric 12px text-secondary
│ ▓▓▓▓▓▓▓░░░░░░               │ h-1 rounded-full；达 90% 转语义 amber，满格 danger
│ [粘贴文本] [上传文件]        │ 两枚 tab：active bg-elevated；图标 clipboard-list / file-up
│ 名称 [________________]     │ placeholder「资料名称，如：产品介绍」
│ 内容 [________________]     │ textarea 最高 160px 后内部滚动；右下 mono 计数「0.8 KB」
│                  [添加]     │ primary sm；名称或内容为空时禁用
│ ──────────────────────────  │ 以下 divide-y 列表，不画卡片
│ ▤ 产品介绍 3.2KB 2天前 [删] │ file-text 16px + 名称 13px truncate + mono 大小 + 时间 + trash-2（32px 命中区）
│ ▤ FAQ     1.1KB 5分钟前[删] │
└────────────────────────────┘
```

### 组件清单

| 组件 | 来源与用法 |
|---|---|
| 抽屉 | 新建 Drawer，复用 Modal 的遮罩、Esc 与 focus-ring 逻辑；列表行 divide-y 分隔 |
| 上传区 | 虚线 border-default rounded-md 块，点击或拖入，accept=".md,.txt,.json"，单文件先比剩余配额 |
| 反馈 | Toast.tsx（添加成功、保存失败）+ 行内红字 role="alert"（超限、类型错） |
| 删除确认 | 复用 ProjectsPage confirm 文案样式：「确定删除资料「X」吗？此操作不可恢复。」 |
| 注入徽标 | 生成输入区上方 pill：rounded-full px-2 py-0.5 text-[12px] text-accent bg-accent/10，book-open 12px +「将注入 N 份资料」，点击打开抽屉；以点击生成那一刻的资料快照为准，生成中编辑只影响下一轮 |

### 四态与文案

| 态 | 表现与文案 |
|---|---|
| 加载 | 列表骨架 3 行 shimmer |
| 空 | folder 图标 +「还没有资料」+「粘贴文本或上传 .md、.txt、.json，生成时会作为参考注入」；添加区常驻即行动入口 |
| 超限 | 行内红字「配额已用完（32 KB）。删除部分资料或精简内容后再添加。」添加按钮禁用 |
| 类型错误 | 「仅支持 .md、.txt、.json 文件」 |
| 文件过大 | 「文件 8.2 KB，剩余配额 3.1 KB，放不下。」数字取真实值 |
| 保存失败 | toast error「资料保存失败，请重试」，输入内容保留不清空 |

### 键盘与可用性

Tab 顺序：资料按钮 → 抽屉内（tab → 名称 → 内容 → 添加 → 列表删除）；图标按钮命中区 ≥32px 且带 aria-label；焦点环 2px atom-400 offset 2px；错误文案 role="alert"。

## 三、图标清单（主集 lucide，经 iconify-local 下载后引用）

需新下载（.claude/skills/iconify-local/scripts/fetch-icons.sh，均 lucide: 前缀，共 13 个）：
compass、copy、eye、refresh-cw、log-in、book-open、file-text、file-up、trash-2、x、loader-circle、plus、share-2

已下载可复用（assets/icons/index.json）：alert-triangle（超限与错误）、clipboard-list（粘贴文本 tab）、folder（资料空态）、chevron-up（抽屉收起备选）

统一 strokeWidth 2、currentColor，尺寸 14/16/20/24 四档；同一界面不混 tabler。

## 四、taste 自查结论

无紫色系与第二种品牌色，无渐变背景；无 Inter；全文零 Em-dash；文案为平实陈述句，无夸饰动词与假数字；循环动画仅 spinner 与骨架 shimmer 两类，尊重 reduced-motion；两界面四态齐备；图标全部 lucide 且先下载后引用。
