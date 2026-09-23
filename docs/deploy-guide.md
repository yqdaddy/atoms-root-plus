# 部署指南

通过 GitHub Actions 自动部署到你的服务器。

## 快速开始

1. **服务器准备**：按照 [`docs/server-setup.md`](./server-setup.md) 完成服务器配置
2. **配置 GitHub Secrets**：在仓库 Settings → Secrets 添加 5 个变量
3. **推送到 master 分支**：自动触发部署

## 架构

```
GitHub Actions
    │
    ├── 构建 frontend (dist/)
    │
    ├── 构建 backend (dist-server/)
    │
    └── SSH + rsync
            │
            ├── 前端 → /mnt/atoms/ (nginx 托管)
            │
            └── 后端 → /mnt/atoms-backend/ (pm2 守护)
```

## 需要的 GitHub Secrets

| Secret | 说明 | 示例 |
|---|---|---|
| `SERVER_HOST` | 服务器 IP 或域名 | `1.2.3.4` |
| `SERVER_USER` | SSH 用户名 | `root` |
| `SSH_PRIVATE_KEY` | 部署专用私钥 | `-----BEGIN...` |
| `FRONTEND_PATH` | 前端路径 | `/mnt/atoms` |
| `BACKEND_PATH` | 后端路径 | `/mnt/atoms-backend` |

## 本地测试部署（可选）

```bash
# 手动触发部署（无需推送）
gh workflow run deploy.yml

# 查看部署状态
gh run watch
```

## 详细文档

- [服务器准备步骤](./server-setup.md)
- [nginx 配置示例](./server-setup.md#3-配置-nginx)
- [SSH 密钥生成](./server-setup.md#4-创建部署专用-ssh-密钥)
- [常见问题](./server-setup.md#常见问题)

## 生成项目的静态托管（一键部署）

用户在平台内点击"部署"后，服务端把项目文件写入 `DEPLOY_DIR`（默认 `/var/www/atoms-projects/`），由 Nginx 以静态方式对外提供访问。

### 环境变量（后端 .env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEPLOY_DIR` | `/var/www/atoms-projects` | 部署根目录，Nginx alias 指向此处 |
| `DEPLOY_BASE_URL` | `/projects` | 部署 URL 前缀，需与 Nginx `location` 对应 |

### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Litpp 平台本身
    location / {
        proxy_pass http://localhost:3000;
    }

    # 部署的生成项目
    location /projects/ {
        alias /var/www/atoms-projects/;
        index index.html;
    }
}
```

注意：`alias` 末尾的 `/` 与 `location` 末尾的 `/` 必须成对出现，否则路径拼接会错位。

### 部署目录权限

```bash
sudo mkdir -p /var/www/atoms-projects
# pm2 运行用户需要对部署目录有写权限（按实际运行用户调整）
sudo chown -R $(whoami) /var/www/atoms-projects
```

### API 一览

| 端点 | 说明 |
|---|---|
| `POST /api/deploy` | 部署项目（幂等，重复部署覆盖旧文件），需登录 |
| `GET /api/deploy/:projectId` | 查询最近一次部署记录 |
| `DELETE /api/deploy/:projectId` | 下线并清理部署目录与记录 |

### 安全约束

- `projectId` 仅允许字母、数字和连字符（1-64 位），写入前再做 resolve 前缀校验，防路径穿越
- 文件路径拒绝 `..`、绝对路径、反斜杠、隐藏文件；扩展名白名单：html/htm/css/js/mjs/json/map/svg/txt/csv/md/xml/webmanifest
- 单文件上限 10MB，单项目总量上限 50MB，文件数上限 500
- 必须包含入口文件 `index.html`
- 平台内删除项目时，自动清理对应部署目录与部署记录