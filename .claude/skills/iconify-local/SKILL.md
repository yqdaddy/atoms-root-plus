---
name: iconify-local
description: >
  Iconify 图标搜索与本地化技能。搜索图标并下载 SVG 到项目 assets/icons/，
  实现离线可用。触发词：图标、找图标、icon、lucide、下载图标、图标下载。
---

# Iconify Local v1.0

> 项目图标唯一来源：搜索 + 下载到本地，零运行时网络依赖。

## 1. 图标工作流

```
搜索图标 -> 确认图标名 -> 下载到本地 -> 引用本地 SVG
```

### 1.1 搜索

```bash
# 按关键词搜索（lucide 集优先）
curl "https://api.iconify.design/search?query=rocket&limit=20&prefix=lucide"

# 查看集合信息
curl "https://api.iconify.design/collections" | jq '.lucide'
```

返回示例：`{"icons":["lucide:search-code","lucide:hammer",...]}`

### 1.2 下载

```bash
# 使用脚本批量下载
./scripts/fetch-icons.sh lucide:search-code lucide:hammer lucide:shield-check
```

### 1.3 引用

```tsx
// 方式 A：本地 SVG 文件（推荐，离线可用）
import searchCode from './assets/icons/lucide/search-code.svg?react'
<searchCode className="w-6 h-6" />

// 方式 B：@iconify/react（需构建时打包集合）
import { Icon } from '@iconify/react'
<Icon icon="lucide:search-code" className="w-6 h-6" />
```

## 2. 本项目图标规范

| 规则 | 说明 |
|------|------|
| 图标集 | 主集 lucide，补集 tabler（仅 lucide 缺格时） |
| 命名映射表 | docs/design-system.md 第 2 节（25 个动作映射） |
| 新增图标 | 必须先下载再引用，禁止手撸 SVG |
| 尺寸刻度 | 14/16/20/24px 四档 |
| 描边 | strokeWidth 2，颜色 currentColor |

### 核心图标清单（stepper 三节点 + 常用动作）

```
lucide:search-code  lucide:hammer  lucide:shield-check
lucide:search  lucide:refresh-cw  lucide:maximize-2
lucide:monitor  lucide:tablet  lucide:smartphone
lucide:send  lucide:settings  lucide:history
lucide:layout-template  lucide:copy  lucide:check
lucide:x  lucide:plus  lucide:trash-2
lucide:download  lucide:upload
```

## 3. fetch-icons.sh 用法

```bash
# 进入脚本目录
cd .claude/skills/iconify-local/scripts

# 下载单个图标
./fetch-icons.sh lucide:search

# 批量下载
./fetch-icons.sh lucide:search-code lucide:hammer lucide:shield-check

# 输出示例
# OK  assets/icons/lucide/search-code.svg
# OK  assets/icons/lucide/hammer.svg
# FAIL lucide:not-exist (404)
# Done: 2 success, 1 failed
```

### 参数

| 参数 | 格式 | 说明 |
|------|------|------|
| 图标名 | collection:name | 如 lucide:search、tabler:brand-github |

### 输出

- SVG 文件：`assets/icons/{collection}/{name}.svg`
- 索引文件：`assets/icons/index.json`

## 4. CDN 白名单约束

生成的应用代码中引用外部资源仅限：

- `cdn.jsdelivr.net`
- `fonts.googleapis.com`
- `fonts.gstatic.com`

图标引用优先本地 SVG，如需 CDN 回退：
```html
<img src="https://cdn.jsdelivr.net/npm/@mdi/svg@7/svg/home.svg" />
```