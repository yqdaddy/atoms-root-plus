# 服务器部署准备

## 1. 服务器要求

- Ubuntu 20.04+ / Debian / CentOS
- Node.js 22 LTS（当前 Active LTS，Node 20 已于 2026-04 EOL）
- nginx（已安装）
- 开放 80/443 端口

## 2. 创建目录结构

```bash
# SSH 登录服务器
ssh root@你的服务器IP

# 创建前端部署目录（nginx root）
mkdir -p /mnt/atoms

# 创建后端部署目录
mkdir -p /mnt/atoms-backend/data

# 设置数据目录权限
chmod 700 /mnt/atoms-backend/data
```

## 3. 配置 nginx

创建配置文件 `/etc/nginx/sites-available/atoms`：

```nginx
server {
    listen 80;
    server_name 你的域名或IP;

    root /mnt/atoms;
    index index.html;

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';

        # SSE 流式必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # 静态资源长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用配置：

```bash
ln -s /etc/nginx/sites-available/atoms /etc/nginx/sites-enabled/
nginx -t && nginx -s reload
```

## 4. 创建部署专用 SSH 密钥

**在你的本地电脑执行**：

```bash
# 生成专用密钥对（不要设置密码，否则 GitHub Actions 无法使用）
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/github-deploy -N ""

# 查看私钥（等下要填入 GitHub Secrets）
cat ~/.ssh/github-deploy

# 查看公钥（等下要添加到服务器）
cat ~/.ssh/github-deploy.pub
```

## 5. 将公钥添加到服务器

**在服务器执行**：

```bash
# 将公钥内容添加到 authorized_keys
echo "你的公钥内容" >> ~/.ssh/authorized_keys

# 如果用了其他用户（如 ubuntu），换成那个用户
# su - ubuntu
# echo "公钥内容" >> ~/.ssh/authorized_keys
```

## 6. 配置 GitHub Secrets

在你的 GitHub 仓库中（Settings → Secrets and variables → Actions）添加：

| Secret 名称 | 值 | 示例 |
|---|---|---|
| `SERVER_HOST` | 服务器 IP 或域名 | `192.168.1.100` 或 `your-domain.com` |
| `SERVER_USER` | SSH 用户名 | `root` 或 `ubuntu` |
| `SSH_PRIVATE_KEY` | 私钥内容（完整） | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `FRONTEND_PATH` | 前端部署路径 | `/mnt/atoms` |
| `BACKEND_PATH` | 后端部署路径 | `/mnt/atoms-backend` |

## 7. 首次部署后配置后端环境变量

首次部署后，SSH 到服务器编辑 `.env`：

```bash
ssh root@你的服务器IP
nano /mnt/atoms-backend/.env

# 填入真实配置：
# LLM_API_KEY=你的真实API密钥
# LLM_BASE_URL=https://api.agnes-ai.cn/v1
# LLM_MODEL=agnes-3.0-flash
# AUTH_SESSION_SECRET=随机生成的长字符串
# COOKIE_SECURE=false  # HTTPS 时改为 true
# NODE_ENV=production

# 重启后端
pm2 restart atoms-backend
```

## 8. 验证部署

```bash
# 检查前端
curl http://你的服务器IP/

# 检查后端
curl http://你的服务器IP/api/health

# 查看后端日志
ssh root@你的服务器IP "pm2 logs atoms-backend"
```

## 常见问题

### SSH 连接失败
- 检查服务器 22 端口是否开放
- 检查公钥是否正确添加到 `~/.ssh/authorized_keys`
- 检查 GitHub Secret `SSH_PRIVATE_KEY` 是否包含完整私钥（包括开头结尾）

### 前端页面空白
- 检查 nginx 是否正确配置 SPA fallback
- `nginx -t` 检查配置语法

### 后端启动失败
- 检查 `.env` 是否正确配置
- 查看 pm2 日志：`pm2 logs atoms-backend`
- 检查 3000 端口是否被占用：`lsof -i :3000`

### SSE 流式输出卡住
- 确保 nginx 配置了 `proxy_buffering off`