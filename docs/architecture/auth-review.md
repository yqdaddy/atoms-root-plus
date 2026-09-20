# 认证架构审查报告

**审查日期**：2026-09-20
**审查范围**：登录守卫、应用归属账号、登出清理缓存

---

## 一、当前架构总结

### 1.1 会话管理

| 层面 | 实现 | 说明 |
|------|------|------|
| 会话载体 | HttpOnly Cookie | Cookie 名称 `atoms_session`，由后端 `server/auth.ts` 管理 |
| 会话存储 | SQLite `sessions` 表 | 存储 `token_hash`（SHA-256）、`user_id`、过期时间 |
| 会话 TTL | 7 天 | `SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000` |
| 前端状态 | Zustand `authStore` | 仅内存态，不持久化到 localStorage |

**前端 authStore 状态**：
```typescript
interface AuthState {
  user: AuthUser | null;  // null 表示未登录
  isLoading: boolean;     // 会话恢复进行中
}
```

**会话恢复流程**：
1. 应用启动时调用 `authStore.checkAuth()`
2. 请求 `GET /api/auth/me`（携带 HttpOnly cookie）
3. 成功则设置 `user`，失败则 `user = null`

### 1.2 API 认证机制

**中间件**：
- `optionalAuth`：可选认证，有会话则设置 `c.set('user', user)`，无则 `null`
- `requireAuth`：强制认证，无会话返回 401

**项目路由认证**（`server/routes/projects.ts`）：
```typescript
// 全路由可选认证
projectsRouter.use('*', optionalAuth);

// 每个端点从 context 获取 userId
const user = c.get('user');
const userId = user?.id ?? null;  // null = 游客模式
```

**用户隔离实现**（`server/db.ts`）：
```typescript
function ownerCondition(userId: string | null): { sql: string; params: string[] } {
  if (userId === null) {
    return { sql: 'user_id IS NULL', params: [] };  // 游客数据
  }
  return { sql: 'user_id = ?', params: [userId] };  // 用户数据
}
```

**数据隔离验证**：
- `GET /api/projects`：返回 `userId` 对应的项目列表
- `GET /api/projects/:id`：按 `userId` 过滤，只能访问自己的项目
- `PUT /api/projects/:id`：按 `userId` 过滤，只能更新自己的项目
- `DELETE /api/projects/:id`：按 `userId` 过滤，只能删除自己的项目

### 1.3 localStorage 使用清单

| Key Pattern | 用途 | 持久化方式 |
|-------------|------|------------|
| `atoms:v1:projects` | 项目摘要列表 + currentId | Zustand persist |
| `atoms:v1:projects:{id}` | 单个项目详情（信封格式） | 手动写入 |
| `atoms:v1:settings` | 用户偏好（providerId, theme, deviceMode） | Zustand persist |
| `atoms:v1:backup:*` | 隔离备份数据（迁移失败时写入） | quarantine.ts |

**注意**：`chatStore` 不持久化，仅在内存中。

---

## 二、需求验证

### 2.1 登录守卫

**需求**：前端需要知道用户是否登录

**现状**：✅ 满足

```typescript
// 任意组件中
const { user, isLoading } = useAuthStore();

if (isLoading) return <Loading />;
if (!user) return <Navigate to="/login" />;
// 已登录，显示正常内容
```

**实现位置**：
- `src/stores/authStore.ts`：提供 `user` 状态
- `src/components/AuthControls.tsx`：根据 `user` 显示不同 UI

### 2.2 应用归属账号

**需求**：API 需要能识别用户

**现状**：✅ 满足

后端 `optionalAuth` 中间件从 HttpOnly cookie 中解析会话，获取 `userId`，所有 CRUD 操作都按 `userId` 隔离。

**验证代码路径**：
- `server/auth.ts`：`getSessionUser()` 从 cookie 解析用户
- `server/db.ts`：`ownerCondition()` 构建用户隔离条件
- `server/routes/projects.ts`：每个端点使用 `userId` 过滤

### 2.3 登出清理缓存

**需求**：登出时需要清除相关数据

**现状**：⚠️ 部分满足

**当前登出实现**：
```typescript
// src/stores/authStore.ts
logout: async () => {
  await logoutUser();  // POST /api/auth/logout（清除 cookie + 数据库会话）
  set({ user: null }); // 清除内存状态
}
```

**问题**：未清理 localStorage 中的项目数据

---

## 三、登出清理策略

### 3.1 需要清理的 localStorage 键

| Key Pattern | 清理原因 |
|-------------|----------|
| `atoms:v1:projects` | 项目摘要列表，属于用户隐私数据 |
| `atoms:v1:projects:*` | 所有项目详情，属于用户隐私数据 |
| `atoms:v1:settings` | 用户偏好，可保留（非敏感） |

**建议**：
- 登出时清理所有项目数据
- 设置数据可保留（主题、设备模式等是设备级偏好）

### 3.2 清理实现建议

```typescript
// src/stores/authStore.ts 修改 logout 函数
logout: async () => {
  await logoutUser();
  set({ user: null });

  // 清理 localStorage 中的项目数据
  clearProjectData();
}

// 新增清理函数（可放在 src/services/storage/ 中）
function clearProjectData(): void {
  try {
    // 清除项目列表
    localStorage.removeItem('atoms:v1:projects');

    // 清除所有项目详情
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('atoms:v1:projects:')) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // 忽略清理错误
  }
}
```

### 3.3 登录场景考虑

**场景**：游客创建项目 → 登录

**当前行为**：
- 游客项目 `user_id IS NULL`
- 登录后用户看到的是空项目列表（因为查询 `user_id = ?`）
- 游客项目"丢失"

**建议**：登录时检测是否有游客项目，提示用户是否保留。如需保留，可在登录成功后将这些项目的 `user_id` 更新为当前用户。

---

## 四、架构评估

### 4.1 安全性评估

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 会话令牌存储 | ✅ | HttpOnly cookie，前端 JS 无法访问 |
| 密码存储 | ✅ | scrypt + HMAC-SHA256 pepper |
| 时序攻击防护 | ✅ | 常量时间比较 + dummy 验证 |
| API 认证 | ✅ | 所有写操作需认证，读操作可选认证 |
| 用户数据隔离 | ✅ | 按 `userId` 严格隔离 |

### 4.2 需要调整的点

| 问题 | 优先级 | 建议 |
|------|--------|------|
| 登出未清理 localStorage | 中 | 登出时清理项目数据 |
| 游客项目登录后"丢失" | 低 | 登录时提示或自动迁移 |

---

## 五、结论

当前认证架构设计合理，满足以下核心需求：

1. ✅ 登录守卫：`authStore.user` 可判断登录状态
2. ✅ 应用归属账号：API 按 `userId` 严格隔离
3. ⚠️ 登出清理：需补充 localStorage 清理逻辑

**下一步行动**：
1. 在 `authStore.logout()` 中添加 localStorage 清理
2. 考虑游客项目迁移方案（可选优化）

---

## 附录：localStorage 键清单

```
atoms:v1:projects              # 项目列表（currentId, summaries[]）
atoms:v1:projects:{uuid}       # 单个项目详情（StorageEnvelope<Project>）
atoms:v1:settings              # 用户偏好（providerId, theme, deviceMode）
atoms:v1:backup:{backupId}     # 隔离备份数据
```

**清除命令示例**（浏览器控制台）：
```javascript
// 清除所有项目数据
Object.keys(localStorage)
  .filter(k => k.startsWith('atoms:v1:projects'))
  .forEach(k => localStorage.removeItem(k));
```