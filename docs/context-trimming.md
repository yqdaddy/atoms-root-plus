# 智能上下文裁剪功能

## 功能说明

在修改模式（modify intent）下，智能裁剪上下文，只携带相关文件，减少 token 消耗。

## 实现方案

采用混合方案：
1. **关键词提取**：从用户请求中提取关键词（支持中英文）
2. **文件匹配**：
   - 文件名匹配（如 "style.css" 匹配 "样式"）
   - 内容关键词匹配
   - 综合评分，筛选候选文件
3. **依赖分析**：解析文件的 import/require 语句，构建依赖图
4. **依赖闭包**：只携带候选文件及其依赖闭包
5. **兜底策略**：如果筛选结果为空，携带所有文件

## 使用方法

功能已集成到 `runDirectModifyPipeline` 中，无需额外调用。

### 日志输出

修改模式执行时会输出裁剪日志：

```
[runDirectModifyPipeline] 上下文裁剪: 2/11 文件 关键词: [样式, 按钮] 匹配: 路径=2, 内容=0, 依赖=0
[runDirectModifyPipeline] Token 节省: 1574 (81.8%) 350/1924
```

## 测试效果

测试场景：11 个文件的项目

| 用户请求 | 裁剪前 | 裁剪后 | Token 节省 |
|---------|--------|--------|-----------|
| 修改按钮样式，让按钮变成圆角 | 11 文件 | 2 文件 | 81.8% |
| 优化任务列表的渲染逻辑 | 11 文件 | 1 文件 | 77.0% |
| 修复用户登录状态管理的问题 | 11 文件 | 1 文件 | 93.9% |
| 添加一个新的页面路由 | 11 文件 | 1 文件 | 95.0% |
| 优化全局样式，改变背景渐变颜色 | 11 文件 | 2 文件 | 81.8% |

## 配置参数

可通过 `trimContext` 的 options 参数调整：

- `pathMatchThreshold`：路径匹配阈值（默认 0.35）
- `contentMatchThreshold`：内容匹配阈值（默认 0.15）
- `minFileCount`：最小文件数（默认 1，防止过度裁剪）
- `includeEntry`：是否强制包含入口文件（默认 false）

## 关键词映射

### 中文术语 → 文件类型

```typescript
'样式': ['css'],
'按钮': ['html', 'javascript', 'css'],
'登录': ['html', 'javascript'],
'数据': ['javascript', 'json'],
// 更多映射见 contextTrimming.ts
```

### 中文术语 → 路径关键词

```typescript
'样式': ['style', 'css', 'theme'],
'主': ['main', 'index', 'app'],
'组件': ['component', 'comp'],
// 更多映射见 contextTrimming.ts
```

## 注意事项

1. **关键词提取**：目前采用简单分词 + 术语表匹配，后续可引入专业分词库提升精度
2. **依赖分析**：支持 ES6 import、CommonJS require、HTML script/link 标签
3. **安全性**：所有文件最终都会通过 `originalFiles` 合并，确保未变更文件不会丢失

## 后续优化方向

1. 引入专业中文分词库（如 jieba）
2. 支持动态加载的依赖（如 webpack 动态 import）
3. 添加语义匹配（基于 embedding 相似度）
4. 缓存依赖图，避免重复构建