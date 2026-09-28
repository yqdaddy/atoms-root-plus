# Phase 1 多轮校验循环 - 实施总结

## 核心成果

**审查修复循环已完整实现，支持最多 3 轮修复，本次改进增强了前端状态展示与事件协议。**

## 实施内容

### 1. 后端改进（server/llm.ts）

#### 改进 1：修复轮发送 stage 事件

**位置**：修复循环开始处（约 1812 行）

**代码**：
```typescript
// 发送 stage 事件：告知前端进入修复轮
onEvent({
  type: 'stage',
  payload: {
    phase: 'generate',
    ...(intent ? { intent } : {}),
    attempt: repairRound + 1,
    message: `审查未通过，正在进行第 ${repairRound} 轮修复`,
    meta: {
      repairReason: currentVerdict.repairInstructions
        .map(r => r.issue)
        .slice(0, 3)
        .join('; '),
    },
  },
});
```

**效果**：
- 前端状态条正确显示修复轮次
- `attempt` 字段正确传递
- `meta.repairReason` 提供修复原因详情

#### 改进 2：修复轮次上限调整

**从 2 轮调整为 3 轮**：
- `MAX_REPAIR_ROUNDS` 从 2 改为 3
- 符合验收标准要求
- 模型调用预算从 ≤9 次提升到 ≤11 次

### 2. 前端改进（src/services/ai/liveEngine.ts）

#### 改进：正确处理 attempt 和 meta 字段

**位置**：`processSSEEvent` 函数（约 184 行）

**代码**：
```typescript
case 'stage': {
  const backendStage = payload.phase as string;
  const frontendStage = STAGE_MAP[backendStage] || 'analyzing';
  // 优先使用后端传来的 message（修复轮有专属文案）
  const message = payload.message || STAGE_MESSAGES[backendStage] || `${backendStage} 阶段`;
  // 优先使用后端传来的 attempt（修复轮为 2+），否则默认为 1
  const attempt = payload.attempt ?? 1;

  event = {
    type: 'stage',
    payload: {
      runId,
      stage: frontendStage,
      attempt,
      message,
      ...(payload.intent ? { intent: payload.intent } : {}),
      ...(payload.meta ? { meta: payload.meta } : {}),
    },
  };
  break;
}
```

**效果**：
- 不再硬编码 `attempt = 1`
- 正确传递后端传来的 `message`、`attempt` 和 `meta`
- 前端 `chatStore.attempt` 正确反映当前轮次

## 验收标准核对

- [x] **生成流程支持最多 3 轮修复循环**
  - `MAX_REPAIR_ROUNDS = 3`
  - 循环条件：`repairRound < MAX_REPAIR_ROUNDS`

- [x] **每轮修复携带审查者的 repairInstructions**
  - 修复工程师 prompt 包含完整的修复指令清单
  - 支持结构化格式（file、line、issue）

- [x] **SSE 事件正确携带 attempt 和 repairReason**
  - `stage` 事件包含 `attempt` 字段
  - `meta.repairReason` 包含修复原因

- [x] **前端展示当前轮次状态**
  - `chatStore.attempt` 正确更新
  - 状态条显示专属文案："审查未通过，正在进行第 N 轮修复"

- [x] **构建通过（npm run build）**
  - TypeScript 编译成功
  - Vite 打包成功

- [x] **降级处理完善**
  - 修复失败时按现状交付
  - 附带 warning 提示用户

## 已实现的完整功能

### 审查修复循环（server/llm.ts）

1. **多层自愈机制**：
   - 第 1 层：工程师格式重试（MAX_PARSE_ATTEMPTS=3）
   - 第 2 层：结构校验重试
   - 第 3 层：审查修复循环（MAX_REPAIR_ROUNDS=3）

2. **修复自检机制**（D-6）：
   ```typescript
   interface RepairSelfCheck {
     fixed: number[];    // 已修复的指令序号
     unfixed: number[];  // 未能修复的序号
     summary: string;    // 修复说明
   }
   ```

3. **行级定位**（D-6）：
   ```typescript
   interface RepairInstruction {
     file?: string;    // 目标文件路径
     line?: number;    // 目标行号（1-based）
     issue: string;    // 缺陷描述
   }
   ```

4. **降级保护**：
   - 修复调用失败 → 保留原产物
   - 修复产物校验失败 → 保留原产物
   - 复审网络失败 → 保留修复产物
   - 轮数耗尽 → 按现状交付 + 警告

## 事件协议示例

### 正常流程（一轮通过）

```json
{"type":"stage","payload":{"stage":"analyzing","attempt":1,"message":"正在分析需求..."}}
{"type":"stage","payload":{"stage":"generating","attempt":1,"message":"正在生成代码..."}}
{"type":"stage","payload":{"stage":"reviewing","attempt":1,"message":"正在审查代码..."}}
{"type":"done","payload":{"html":"...","stats":{"rounds":1}}}
```

### 修复流程（触发修复轮）

```json
{"type":"stage","payload":{"stage":"reviewing","attempt":1,"message":"正在审查代码..."}}
{"type":"stage","payload":{"stage":"generating","attempt":2,"message":"审查未通过，正在进行第 1 轮修复","meta":{"repairReason":"缺少重置功能; 按钮无禁用状态"}}}
{"type":"delta","payload":{"phase":"generate","text":"..."}}
{"type":"stage","payload":{"stage":"reviewing","attempt":2,"message":"正在审查代码..."}}
{"type":"done","payload":{"html":"...","stats":{"rounds":2}}}
```

### 降级流程（修复轮耗尽）

```json
{"type":"warning","payload":{"message":"提示：审查发现的问题自动修复 3 轮后仍未全部解决，本次按现状交付；应用可能存在缺陷，可点击重试重新生成。"}}
{"type":"done","payload":{"html":"...","warnings":["..."],"stats":{"rounds":4}}}
```

## 测试方法

### 手动测试场景

1. **场景 1：正常修复成功**
   - 提交需求："做一个计数器，必须有重置按钮"
   - 预期：可能触发修复，但最终通过
   - 观察：状态条显示修复轮次

2. **场景 2：修复失败降级**
   - 提交需求："做一个计数器，必须使用 Web Components"（技术限制）
   - 预期：修复 3 轮后降级交付
   - 观察：warning 事件和降级提示

3. **场景 3：多轮修复**
   - 故意制造多个难以修复的问题
   - 预期：触发多轮修复
   - 观察：`attempt` 字段逐轮递增

### 前端状态检查

在浏览器控制台：
```javascript
// 查看当前轮次
window.__ZUSTAND_STORE__?.getState?.()?.streamBuffer?.attempt

// 查看状态消息
window.__ZUSTAND_STORE__?.getState?.()?.streamBuffer?.stageMessage
```

### 后端日志检查

在服务器控制台：
```bash
# 查看修复循环触发
grep "审查修复循环" server.log

# 查看修复轮次
grep "修复轮" server.log
```

## 改进前后对比

| 维度 | 改进前 | 改进后 |
|---|---|---|
| 修复轮次上限 | 2 轮 | 3 轮 |
| 前端 `attempt` | 硬编码为 1 | 动态反映当前轮次 |
| 修复轮状态消息 | 仅 delta 文本通知 | stage 事件 + 专属文案 |
| 修复原因展示 | 无 | `meta.repairReason` 携带 |
| 前端可观测性 | 低 | 高 |

## 后续优化建议

1. **前端 UI 增强**：
   - 在状态条显示"第 N 轮修复"标签
   - 展开显示 `meta.repairReason`（缺陷清单）

2. **审查者 prompt 优化**：
   - 提高修复指令的精确性
   - 行级定位覆盖更多场景

3. **统计埋点**：
   - 记录修复轮数分布
   - 分析常见修复场景

4. **成本监控**：
   - 监控修复轮次的 token 消耗
   - 优化 prompt 降低成本

## 相关文件

- **核心实现**：
  - `server/llm.ts`：审查修复循环（1783-1945 行）
  - `src/services/ai/liveEngine.ts`：前端事件处理
  - `src/stores/chatStore.ts`：前端状态管理

- **类型定义**：
  - `src/services/ai/types.ts`：事件协议与类型
  - `server/prompts-v2.ts`：审查者 prompt

- **文档**：
  - `docs/tech-ai-pipeline.md`：技术方案
  - `docs/phase1-repair-loop-verification.md`：验证文档

## 结论

Phase 1 多轮校验循环已完整实现，满足所有验收标准。审查修复循环支持最多 3 轮修复，每轮携带修复指令，前端正确展示修复轮次状态。降级处理完善，保证用户体验。

**建议**：可以进入 Phase 2 或其他功能开发。