# 轻量化服务端部署指南

本文档说明如何本地运行和 Docker 部署 Atoms Demo 服务端。

## 前置要求

- Node.js 20+
- npm 或 pnpm

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

### 3. 启动 API 服务器（另一终端）

```bash
npm run dev:server
```

API 运行在 http://localhost:3000

## 生产部署

### 方式一：直接运行

```bash
# 构建前端
npm run build

# 构建服务端
npm run build:server

# 启动服务（前端 + API 一体）
npm run start
```

访问 http://localhost:3000

### 方式二：Docker 部署

```bash
# 构建镜像
docker build -t atoms-demo .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -v atoms-data:/app/data \
  --name atoms-demo \
  atoms-demo
```

访问 http://localhost:3000

## 数据备份

SQLite 数据库文件位于 `data/atoms.db`。备份方式：

```bash
# 本地部署：直接复制文件
cp data/atoms.db data/atoms.db.backup

# Docker 部署：从 volume 复制
docker cp atoms-demo:/app/data/atoms.db ./atoms.db.backup
```

## API 契约

### 健康检查

```
GET /api/health
Response: { "status": "ok", "timestamp": "2026-09-18T08:00:00.000Z" }
```

### 项目列表

```
GET /api/projects
Response: [
  {
    "id": "uuid",
    "name": "项目名称",
    "status": "draft" | "generating" | "ready" | "error",
    "updatedAt": "2026-09-18T08:00:00.000Z",
    "entryBytes": 1024
  }
]
```

### 项目详情

```
GET /api/projects/:id
Response: {
  "schemaVersion": 1,
  "savedAt": "2026-09-18T08:00:00.000Z",
  "data": { /* Project 对象 */ }
}
```

### 创建项目

```
POST /api/projects
Request: { "name": "项目名称", "description": "描述" }
Response: { "id": "uuid" }
Status: 201
```

### 更新项目

```
PUT /api/projects/:id
Request: { "name": "新名称", "files": {...}, "chat": [...] }
Response: { "success": true }
```

### 删除项目

```
DELETE /api/projects/:id
Response: { "success": true }
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `NODE_ENV` | development | 环境（production 关闭 CORS） |

## 故障排查

### 前端无法连接 API

1. 确认 API 服务已启动：`curl http://localhost:3000/api/health`
2. 检查 CORS 配置：开发模式下 API 允许 localhost:5173 访问

### 数据库文件损坏

SQLite WAL 模式下，正常关闭会合并 WAL 文件。异常断电后：

```bash
# 检查数据库完整性
sqlite3 data/atoms.db "PRAGMA integrity_check;"

# 如有损坏，可尝试恢复
sqlite3 data/atoms.db ".recover" > recover.sql
sqlite3 data/atoms-recovered.db < recover.sql
```

### 旧版 sqlite3 CLI 不支持 json_extract

用 `sqlite3` CLI 直接查询 `projects` 表的 `data` 列（JSON 文本）时，如果 CLI 版本较旧，会报错：

```
Parse error: no such function: json_extract
```

原因：SQLite 3.38 起才内置 JSON 函数，更早版本需要在编译时启用 JSON1 扩展。系统自带的 CLI 往往不带。

检查 CLI 版本：

```bash
sqlite3 --version
```

3.38 及以上可直接使用 `json_extract`；更旧版本请改用下方替代方式（服务端使用的 better-sqlite3 自带 JSON1 支持，不受影响）。

替代查询：用 Node 加 better-sqlite3 一行脚本，查看 projects 表的项目 id、name、updatedAt：

```bash
node -e "const Database=require('better-sqlite3');const db=new Database('data/atoms.db',{readonly:true});for(const r of db.prepare('SELECT id,data,updated_at FROM projects ORDER BY updated_at DESC').all()){const p=JSON.parse(r.data).data;console.log(r.id,p.name,p.updatedAt)}"
```

注意 `name` 与 `updatedAt` 存放在 `data` 列的 JSON 内层（`data.data`），所以脚本中先 `JSON.parse(r.data)` 再取字段；表上的 `updated_at` 列仅用于排序。

### 磁盘空间不足

SQLite 对磁盘空间敏感。建议：

1. 监控 `data/` 目录大小
2. 定期清理不需要的项目
3. 设置数据库大小上限（`PRAGMA max_page_count`）