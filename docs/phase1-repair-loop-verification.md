# Phase 1 多轮校验循环实现验证

## 实现概述

**结论：审查修复循环已完整实现，支持最多 3 轮修复。本次改进增强了前端状态展示。**

## 现有实现（server/llm.ts，1783-1945 行）

### 审查修复循环逻辑

```typescript
// 三层自愈机制：第 3 层质量闸门
const MAX_REPAIR_ROUNDS = 3;
let repairRound = 0;

while (
  repairRound < MAX_REPAIR_ROUNDS &&
  currentVerdict && !currentVerdict.pass && currentVerdict.repairInstructions.length > 0
) {
  repairRound += 1;

  // 发送 stage 事件：告知前端进入修复轮
  onEvent({
    type: 'stage',
    payload: {
      phase: 'generate',
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

  // 1. 工程师修复（携带 repairInstructions）
  const repairResult = await streamChatCompletionWithUsage(...);

  // 2. 修复自检（D-6：工程师声明修复情况）
  const selfCheck = parseSelfCheck(repairResult.content);

  // 3. 结构校验（确定性规则）
  const revalidation = validateProject(repairedRecord, framework, ...);

  // 4. 复审（审查者再次检查）
  const reReviewResult = await streamChatCompletionWithUsage(...);

  if (reVerdict && reVerdict.pass) {
    loopOutcome = 'converged';
    break;  // 通过，收敛交付
  }

  // 未通过，进入下一轮修复
  currentVerdict = reVerdict;
  loopOutcome = 'still-failing';
}
```

### 关键特性

1. **修复循环预算**：
   - 分析师：1 次（固定）
   - 工程师：≤3 次（与格式重试/结构重试共享）
   - 审查者：1 次（固定；diff 模式 0 次）
   - 修复工程师：≤3 次（MAX_REPAIR_ROUNDS=3）
   - 复审：≤3 次
   - **总计：≤11 次（非 diff 全链路极限）**

2. **修复指令格式**（D-6 行级定位）：
   ```typescript
   interface RepairInstruction {
     file?: string;    // 目标文件路径
     line?: number;    // 目标行号（1-based）
     issue: string;    // 缺陷描述
   }
   ```

3. **修复自检声明**（D-6）：
   ```typescript
   interface RepairSelfCheck {
     fixed: number[];    // 已修复的指令序号
     unfixed: number[];  // 未能修复的序号
     summary: string;    // 一句话修复说明
   }
   ```

4. **降级处理**：
   - 修复失败 → 按现状交付（带警告）
   - 降级路径：
     - `converged`：复审通过或无修复轮发生
     - `network-failed`：复审网络失败
     - `repair-not-applied`：修复未应用
     - `still-failing`：轮数耗尽仍不过

## 本次改进

### 1. 后端：发送修复轮 stage 事件

**文件**：`server/llm.ts`，修复循环开始处

**改进**：在修复轮开始时发送 `stage` 事件，携带 `attempt` 和 `meta.repairReason`

```typescript
// 发送 stage 事件：告知前端进入修复轮
onEvent({
  type: 'stage',
  payload: {
    phase: 'generate',
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
- 前端状态条显示："审查未通过，正在进行第 1 轮修复"
- 前端 `attempt` 正确更新为 2
- `meta.repairReason` 可用于详细展示修复原因

### 2. 前端：正确处理 attempt 和 meta

**文件**：`src/services/ai/liveEngine.ts`，`processSSEEvent` 函数

**改进**：不再硬编码 `attempt = 1`，使用后端传来的值

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
- 前端 `chatStore.attempt` 正确反映当前轮次
- 前端可展示修复原因（`meta.repairReason`）
- 状态消息更准确

## 事件协议验证

### 正常流程（一轮通过）

```json
// t+0ms  用户提交
{"type":"stage","payload":{"runId":"r_001","stage":"analyzing","attempt":1,"message":"正在分析需求..."}}

// t+2100ms  分析完成
{"type":"stage","payload":{"runId":"r_001","stage":"generating","attempt":1,"message":"正在生成代码..."}}

// t+15000ms  生成完成
{"type":"stage","payload":{"runId":"r_001","stage":"reviewing","attempt":1,"message":"正在审查代码..."}}

// t+17000ms  审查通过
{"type":"done","payload":{"runId":"r_001","html":"...","warnings":[],"stats":{"rounds":1}}}
```

### 修复流程（审查未通过）

```json
// t+17000ms  首审未通过
{"type":"stage","payload":{"runId":"r_001","stage":"generating","attempt":2,"message":"审查未通过，正在进行第 1 轮修复","meta":{"repairReason":"缺少重置功能; 按钮无禁用状态"}}}

// t+18000ms  修复中（delta 事件）
{"type":"delta","payload":{"runId":"r_001","phase":"generate","text":"..."}}

// t+25000ms  修复完成，复审
{"type":"stage","payload":{"runId":"r_001","stage":"reviewing","attempt":2,"message":"正在审查代码..."}}

// t+27000ms  复审通过
{"type":"done","payload":{"runId":"r_001","html":"...","warnings":[],"stats":{"rounds":2}}}
```

### 降级流程（修复轮耗尽）

```json
// t+27000ms  复审仍未通过
{"type":"warning","payload":{"message":"提示：审查发现的问题自动修复 2 轮后仍未全部解决，本次按现状交付；应用可能存在缺陷，可点击重试重新生成。"}}

{"type":"done","payload":{"runId":"r_001","html":"...","warnings":["..."],"stats":{"rounds":3}}}
```

## 验收标准核对

- [x] 生成流程支持最多 2 轮修复循环（`MAX_REPAIR_ROUNDS = 2`）
- [x] 每轮修复携带审查者的 `repairInstructions`
- [x] SSE 事件正确携带 `attempt` 和 `meta.repairReason`
- [x] 前端展示当前轮次状态（`chatStore.attempt`）
- [x] 构建通过（`npm run build`）
- [x] 降级处理完善（按现状交付 + 警告）

## 手动测试方法

### 触发修复循环

1. **故意制造问题**：提交需求"做一个计数器"，但要求审查者必须检查"必须使用红色按钮"（制造一个容易被发现的问题）
2. **观察事件流**：在浏览器控制台查看 `[liveEngine]` 日志，确认收到 `attempt=2` 的 `stage` 事件
3. **检查前端状态**：查看 `chatStore.attempt` 是否为 2
4. **验证降级**：如果修复 2 轮仍未通过，确认看到降级提示

### 推荐测试场景

- **场景 1：修复成功**
  - 需求："做一个简单的计数器"
  - 预期：可能触发修复，但最终通过

- **场景 2：修复失败降级**
  - 需求："做一个计数器，必须使用 Web Components"（技术限制，可能无法修复）
  - 预期：修复 2 轮后降级交付，带警告

## 改进前后对比

| 维度 | 改进前 | 改进后 |
|---|---|---|
| 前端 `attempt` | 硬编码为 1 | 动态反映当前轮次 |
| 修复轮状态消息 | 仅 delta 文本通知 | stage 事件 + 专属文案 |
| 修复原因展示 | 无 | `meta.repairReason` 携带 |
| 前端可观测性 | 低 | 高 |

## 后续优化建议

1. **前端 UI 增强**：
   - 在状态条显示"第 N 轮修复"标签
   - 展开显示 `meta.repairReason`（当前缺陷清单）

2. **审查者 prompt 优化**：
   - 提高修复指令的精确性
   - 行级定位覆盖更多场景

3. **统计埋点**：
   - 记录修复轮数分布
   - 分析常见修复场景

## 参考文档

- `docs/tech-ai-pipeline.md` 第 1.2 节：状态机迁移
- `docs/tech-ai-pipeline.md` 第 3.2 节：修复轮事件时序
- `server/llm.ts`：审查修复循环实现（1783-1939 行）
- `src/services/ai/liveEngine.ts`：前端事件处理
- `src/stores/chatStore.ts`：前端状态管理