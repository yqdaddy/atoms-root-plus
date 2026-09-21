# 服务器部署指南

本文档详细说明如何将 Atoms Demo 部署到生产服务器。

## 目录

1. [服务器要求](#1-服务器要求)
2. [安装依赖](#2-安装依赖)
3. [配置 Nginx](#3-配置-nginx)
4. [部署应用](#4-部署应用)
5. [配置 HTTPS（推荐）](#5-配置-https推荐)
6. [监控与运维](#6-监控与运维)
7. [常见问题](#常见问题)

---

## 1. 服务器要求

### 硬件要求

| 配置项 | 最低要求 | 推荐配置 |
|--------|----------|----------|
| CPU | 1 核 | 2 核+ |
| 内存 | 1 GB | 2 GB+ |
| 磁盘 | 10 GB | 20 GB+ |

### 软件要求

- 操作系统：Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- Node.js：18.x LTS
- Nginx：1.18+
- PM2：全局安装

---

## 2. 安装依赖

### 2.1 安装 Node.js

```bash
# 使用 nvm 安装（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
nvm alias default 18

# 验证
node -v  # v18.x.x
npm -v
```

### 2.2 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx -y

# CentOS
sudo yum install nginx -y

# 验证
nginx -v
```

### 2.3 安装 PM2

```bash
sudo npm install -g pm2

# 验证
pm2 -v
```

### 2.4 安装构建工具

```bash
# Ubuntu/Debian
sudo apt install build-essential -y

# 项目依赖（better-sqlite3 需要）
sudo apt install python3 -y
```

---

## 3. 配置 Nginx

### 3.1 创建目录结构

```bash
# 前端静态文件目录
sudo mkdir -p /var/www/atoms

# 用户部署的项目目录（独立子域）
sudo mkdir -p /var/www/atoms-projects

# 后端目录
sudo mkdir -p /var/www/atoms-backend

# 设置权限（假设用当前用户运行）
sudo chown -R $USER:$USER /var/www/atoms
sudo chown -R $USER:$USER /var/www/atoms-projects
sudo chown -R $USER:$USER /var/www/atoms-backend
```

### 3.2 创建 Nginx 配置文件

```bash
sudo nano /etc/nginx/sites-available/atoms.conf
```

配置内容：

```nginx
# Atoms Demo Nginx 配置
# 路径：/etc/nginx/sites-available/atoms.conf

# ========================================
# 主应用站点
# ========================================
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com;  # 替换为你的域名或 IP

    # 访问日志
    access_log /var/log/nginx/atoms.access.log;
    error_log /var/log/nginx/atoms.error.log;

    # 1. 前端静态文件
    location / {
        root /var/www/atoms;
        try_files $uri $uri/ /index.html;

        # CSP 安全头（主应用允许内联脚本用于预览）
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; frame-src 'self' https://projects.your-domain.com;" always;

        # 静态资源缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # 2. 后端 API（SSE 需要特殊配置）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # SSE 支持
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        # 通用代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（LLM 生成可能较慢）
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # 3. 禁止访问隐藏文件
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}

# ========================================
# 用户项目托管子域（跨源安全配置）
# 重要：此子域必须与主应用不同源，隔离用户生成内容
# ========================================
server {
    listen 80;
    listen [::]:80;
    server_name projects.your-domain.com;  # 用户项目子域

    # 访问日志（独立日志便于排查）
    access_log /var/log/nginx/atoms-projects.access.log;
    error_log /var/log/nginx/atoms-projects.error.log;

    root /var/www/atoms-projects;
    index index.html;

    # CSP 安全头（严格限制脚本来源）
    # 注意：如需支持内联脚本，需添加 'unsafe-inline'（不推荐）
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self';" always;

    # X-Content-Type-Options 防止 MIME 类型嗅探
    add_header X-Content-Type-Options "nosniff" always;

    # X-Frame-Options 防止被其他站点嵌入
    add_header X-Frame-Options "SAMEORIGIN" always;

    # SPA 路由支持
    location / {
        try_files $uri $uri/ $uri.html /index.html;
    }

    # 禁止执行服务器端脚本（安全）
    location ~* \.(php|pl|py|cgi|sh|bash|exe)$ {
        deny all;
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # 禁止访问备份文件和临时文件
    location ~* (\.bak|\.tmp|\.swp|\.orig|~)$ {
        deny all;
    }
}
```

### 3.3 启用站点配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/atoms.conf /etc/nginx/sites-enabled/

# 删除默认站点（可选）
sudo rm -f /etc/nginx/sites-enabled/default

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## 4. 部署应用

### 4.1 构建应用

在本地开发机器上：

```bash
# 克隆代码
git clone https://github.com/your-repo/atoms-root-plus.git
cd atoms-root-plus

# 安装依赖
npm install

# 构建
npm run build

# 构建产物：
# - dist/        → 前端（上传到 /var/www/atoms/）
# - dist-server/ → 后端（上传到 /var/www/atoms-backend/）
```

### 4.2 上传到服务器

方式一：使用 rsync（推荐）

```bash
# 上传前端
rsync -avz --delete dist/ user@your-server:/var/www/atoms/

# 上传后端
rsync -avz --delete dist-server/ user@your-server:/var/www/atoms-backend/
rsync -avz package*.json user@your-server:/var/www/atoms-backend/
```

方式二：使用 SCP

```bash
scp -r dist/* user@your-server:/var/www/atoms/
scp -r dist-server/* user@your-server:/var/www/atoms-backend/
```

### 4.3 配置后端环境变量

#### 4.3.1 环境变量清单

| 变量名 | 必需 | 说明 | 示例值 |
|--------|------|------|--------|
| `PORT` | 是 | 后端服务端口 | `3000` |
| `LLM_API_KEY` | 是 | LLM API 密钥 | `sk-xxx` |
| `LLM_API_BASE` | 是 | LLM API 端点 | `https://api.agnes-ai.cn/v1` |
| `LLM_MODEL` | 是 | 模型名称 | `agnes-3.0-flash` |
| `JWT_SECRET` | 是 | JWT 签名密钥（必须更换为强随机值） | `openssl rand -hex 32` |
| `DEPLOY_DIR` | 是 | 用户项目部署目录 | `/var/www/atoms-projects` |
| `DEPLOY_BASE_URL` | 是 | 用户项目访问 URL（**必须跨源**） | `https://projects.your-domain.com` |
| `FRONTEND_URL` | 是 | 前端 URL（CORS 白名单） | `https://your-domain.com` |

#### 4.3.2 DEPLOY_BASE_URL 安全配置（重要）

> **安全警告**：`DEPLOY_BASE_URL` 必须配置为**独立域名或子域**，不能与主应用同源。

**为什么必须跨源？**

用户通过 Atoms 生成的应用代码会部署到 `DEPLOY_BASE_URL` 指向的路径。如果该路径与主应用同源：
- 部署的用户生成代码可以在主应用 origin 下执行 JavaScript
- 可能窃取用户 Cookie、localStorage 数据
- 可能发起 CSRF 攻击

**错误配置（危险）**：
```bash
DEPLOY_BASE_URL=/projects           # 同源，不安全！
DEPLOY_BASE_URL=https://your-domain.com/projects  # 同源，不安全！
```

**正确配置（安全）**：
```bash
DEPLOY_BASE_URL=https://projects.your-domain.com    # 独立子域，安全
DEPLOY_BASE_URL=https://your-projects-domain.com    # 独立域名，安全
```

#### 4.3.3 创建环境变量文件

在服务器上：

```bash
# 创建 .env 文件
cat > /var/www/atoms-backend/.env << 'EOF'
# 服务端口
PORT=3000

# LLM API 配置
LLM_API_KEY=your-api-key-here
LLM_API_BASE=https://api.agnes-ai.cn/v1
LLM_MODEL=agnes-3.0-flash

# JWT 密钥（重要：生产环境必须更换为强随机值）
JWT_SECRET=$(openssl rand -hex 32)

# 部署配置（重要：必须使用独立子域，见上文安全说明）
DEPLOY_DIR=/var/www/atoms-projects
DEPLOY_BASE_URL=https://projects.your-domain.com

# 前端 URL（用于 CORS 白名单）
FRONTEND_URL=https://your-domain.com
EOF
```

### 4.4 安装后端依赖并启动

```bash
cd /var/www/atoms-backend
npm install --production

# 使用 PM2 启动
pm2 start dist/index.js --name atoms-backend

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup
# 按提示执行输出的命令
```

### 4.5 验证部署

```bash
# 检查后端状态
pm2 status
pm2 logs atoms-backend

# 检查 API
curl http://localhost:3000/api/health

# 检查前端
curl http://localhost/
```

---

## 5. 配置 HTTPS（推荐）

### 5.1 安装 Certbot

```bash
# Ubuntu/Debian
sudo apt install certbot python3-certbot-nginx -y

# CentOS
sudo yum install certbot python3-certbot-nginx -y
```

### 5.2 获取证书

```bash
# 自动配置 HTTPS
sudo certbot --nginx -d your-domain.com

# 或者手动获取证书
sudo certbot certonly --nginx -d your-domain.com
```

### 5.3 自动续期

```bash
# 测试续期
sudo certbot renew --dry-run

# Certbot 会自动添加定时任务续期
```

### 5.4 HTTPS 配置示例

Certbot 会自动修改 Nginx 配置，最终效果：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # ... 其他配置同上
}
```

---

## 6. 监控与运维

### 6.1 日志管理

```bash
# 查看 Nginx 日志
sudo tail -f /var/log/nginx/atoms.access.log
sudo tail -f /var/log/nginx/atoms.error.log

# 查看后端日志
pm2 logs atoms-backend

# 日志轮转（Nginx 默认已配置）
# /etc/logrotate.d/nginx
```

### 6.2 监控命令

```bash
# 系统状态
htop

# 磁盘使用
df -h

# 项目部署目录大小
du -sh /var/www/atoms-projects/*

# 后端进程状态
pm2 status
pm2 monit
```

### 6.3 常用运维命令

```bash
# 重启后端
pm2 restart atoms-backend

# 重载 Nginx
sudo systemctl reload nginx

# 清理旧部署项目
cd /var/www/atoms-projects
ls -la  # 查看项目
rm -rf project-id  # 删除特定项目

# 数据库备份
cp /var/www/atoms-backend/data.db /var/www/atoms-backend/data.db.bak
```

---

## 常见问题

### Q1: SSE 连接中断

**现象**：生成过程中断，前端报错

**解决**：
1. 检查 Nginx 的 `proxy_buffering off;` 配置
2. 增加超时时间 `proxy_read_timeout`
3. 检查后端日志 `pm2 logs`

### Q2: 部署项目 404

**现象**：访问 `/projects/xxx/` 返回 404

**解决**：
1. 检查 `DEPLOY_DIR` 路径是否正确
2. 检查 Nginx `alias` 末尾的 `/`
3. 检查目录权限 `ls -la /var/www/atoms-projects/`

### Q3: 后端启动失败

**现象**：`pm2 start` 后状态为 `errored`

**解决**：
```bash
# 查看错误日志
pm2 logs atoms-backend --err

# 常见原因：
# 1. 端口被占用 → lsof -i :3000
# 2. 环境变量缺失 → 检查 .env 文件
# 3. better-sqlite3 编译问题 → npm rebuild better-sqlite3
```

### Q4: LLM API 调用失败

**现象**：生成时报错 `ECONNREFUSED` 或超时

**解决**：
1. 检查 `LLM_API_BASE` 是否正确
2. 检查 `LLM_API_KEY` 是否有效
3. 检查服务器网络：`curl https://api.agnes-ai.cn/v1/models`

### Q5: 文件上传大小限制

**现象**：大文件上传失败

**解决**：
```nginx
# 在 Nginx 配置中添加
client_max_body_size 50M;
```

---

## 附录

### 目录结构

```
/var/www/
├── atoms/                  # 前端静态文件
│   ├── index.html
│   ├── assets/
│   └── ...
├── atoms-backend/          # 后端应用
│   ├── dist/
│   ├── node_modules/
│   ├── .env
│   └── data.db             # SQLite 数据库
└── atoms-projects/         # 用户部署的项目（独立子域托管）
    ├── project-abc123/
    │   ├── index.html
    │   └── ...
    └── project-xyz789/
        └── ...
```

### 部署前安全检查清单

在将应用部署到生产环境前，请逐项核对以下安全配置：

#### 认证与授权

- [ ] **LLM API 端点已加认证**：`/api/llm/*` 路由需要 JWT 认证
- [ ] **Share 端点已加认证**：`/api/share/*` 路由需要 JWT 认证
- [ ] **JWT_SECRET 已更换为生产密钥**：使用 `openssl rand -hex 32` 生成，禁止使用默认值

#### 跨源与隔离

- [ ] **DEPLOY_BASE_URL 跨源配置**：配置为独立域名或子域（如 `https://projects.your-domain.com`），禁止使用同源路径
- [ ] **CORS origin 白名单已配置**：`FRONTEND_URL` 已正确设置，禁止使用 `*`
- [ ] **用户项目子域已配置 CSP**：Nginx 配置中已添加 `Content-Security-Policy` 头

#### HTTPS 与加密

- [ ] **HTTPS 已启用**：主应用和用户项目子域均已配置 HTTPS
- [ ] **SSL 证书有效**：证书未过期，域名匹配
- [ ] **HTTP 自动跳转 HTTPS**：Nginx 配置中已添加 80 到 443 的跳转

#### 访问控制

- [ ] **Nginx 已禁止执行服务器端脚本**：`\.(php|pl|py|cgi|sh|bash|exe)$` 已 deny
- [ ] **隐藏文件禁止访问**：`location ~ /\.` 已 deny
- [ ] **备份文件禁止访问**：`location ~* (\.bak|\.tmp|\.swp|\.orig|~)$` 已 deny

#### 日志与监控

- [ ] **访问日志已启用**：Nginx 和后端日志正常记录
- [ ] **错误日志可访问**：`/var/log/nginx/` 和 `pm2 logs` 可查看
- [ ] **日志轮转已配置**：Nginx 和 PM2 日志自动轮转

#### 敏感信息

- [ ] **.env 文件权限正确**：`chmod 600 /var/www/atoms-backend/.env`
- [ ] **.env 文件未提交到版本控制**：确认 `.gitignore` 中包含 `.env`
- [ ] **API 密钥已更换为生产密钥**：禁止使用测试或示例密钥

### 安全配置快速验证命令

```bash
# 验证 DEPLOY_BASE_URL 是否跨源
echo "主应用域名: your-domain.com"
echo "项目子域: projects.your-domain.com"
# 两者应该不同源（协议+域名+端口）

# 验证 JWT_SECRET 是否为强随机值
grep JWT_SECRET /var/www/atoms-backend/.env
# 应该是 64 字符的十六进制字符串

# 验证 HTTPS 是否生效
curl -I https://your-domain.com
curl -I https://projects.your-domain.com
# 应该返回 HTTP/2 200

# 验证 CORS 配置
curl -I -H "Origin: https://your-domain.com" https://your-domain.com/api/health
# 应该包含 Access-Control-Allow-Origin 头

# 验证 CSP 头是否生效
curl -I https://projects.your-domain.com
# 应该包含 Content-Security-Policy 头

# 验证敏感文件访问权限
ls -la /var/www/atoms-backend/.env
# 应该显示 -rw-------（仅所有者可读写）

# 验证服务器端脚本是否被禁止
curl -I https://projects.your-domain.com/test.php
# 应该返回 403 Forbidden
```

### 相关文档

- [部署架构](./deploy-guide.md) - GitHub Actions 自动部署
- [环境变量说明](./env-reference.md) - 所有环境变量配置
- [API 文档](./api-reference.md) - 后端 API 接口说明