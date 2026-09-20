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
            ├── 前端 → /var/www/atoms/ (nginx 托管)
            │
            └── 后端 → /opt/atoms-backend/ (pm2 守护)
```

## 需要的 GitHub Secrets

| Secret | 说明 | 示例 |
|---|---|---|
| `SERVER_HOST` | 服务器 IP 或域名 | `1.2.3.4` |
| `SERVER_USER` | SSH 用户名 | `root` |
| `SSH_PRIVATE_KEY` | 部署专用私钥 | `-----BEGIN...` |
| `FRONTEND_PATH` | 前端路径 | `/var/www/atoms` |
| `BACKEND_PATH` | 后端路径 | `/opt/atoms-backend` |

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