# 部署指南

## 架构

单入口部署：nginx 托管前端静态产物，并将 `/api` 反向代理到 Node 后端。

```
浏览器 ──http/https──▶ nginx（80/443，唯一对外端口）
                        ├── /            → dist/ 静态文件（含 SPA fallback）
                        └── /api/        → http://127.0.0.1:3000（Node 后端，仅监听本机）
```

- 前端构建产物：`npm run build` 输出 `dist/`
- 后端：Node.js + SQLite，只监听 `127.0.0.1:3000`，不直接对外

## 后端部署（Linux 服务器）

### 1. 服务器要求

- Node.js 18+
- nginx

### 2. 上传代码

```bash
# 本地打包（后端只需运行时文件）
tar -czvf atoms-backend.tar.gz dist-server/ package.json package-lock.json .env.example

# 上传到服务器
scp atoms-backend.tar.gz user@服务器IP:/home/user/
```

### 3. 服务器配置

```bash
ssh user@服务器IP

mkdir -p /home/user/atoms
cd /home/user/atoms
tar -xzvf ../atoms-backend.tar.gz

# 安装依赖
npm install --production

# 配置环境变量
cp .env.example .env
nano .env
# 填入：
# LLM_API_KEY=你的API密钥
# LLM_BASE_URL=https://api.agnes-ai.cn/v1
# LLM_MODEL=agnes-3.0-flash
# AUTH_SESSION_SECRET=随机密钥

# 使用 PM2 守护进程
npm install -g pm2
pm2 start dist-server/index.js --name atoms-api
pm2 save
pm2 startup
```

## 前端部署（nginx 静态托管）

### 1. 构建并上传

```bash
# 本地构建
npm run build

# 上传产物到服务器
scp -r dist/ user@服务器IP:/var/www/atoms/
```

### 2. nginx 配置

```nginx
server {
    listen 80;
    server_name 你的域名;

    root /var/www/atoms;
    index index.html;

    # API 反向代理（SSE 流式必须关闭缓冲）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';

        # SSE 关键：禁用缓冲，流式事件逐块透传
        proxy_buffering off;
        proxy_cache off;

        # LLM 生成耗时较长，放宽超时
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # 前端静态资源（带哈希，长缓存）
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback：其余路由返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

配置要点：

- `proxy_buffering off`：SSE 流式输出必须逐块转发，开启缓冲会导致生成过程卡住直到结束才一次性输出
- `proxy_read_timeout 300s`：LLM 生成可能持续数分钟，默认 60s 会中途断流
- `proxy_set_header Connection ''`：保持长连接以支持流式响应

### 3. 重载 nginx

```bash
sudo nginx -t && sudo nginx -s reload
```

## 验证部署

```bash
# 检查前端页面
curl http://你的域名/

# 检查 API
curl http://你的域名/api/health

# 检查 SSE 流式（应看到事件逐条输出而非一次性到达）
curl -N -X POST http://你的域名/api/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"做一个计数器"}'
```

## 常见问题

### 生成过程卡住，结束后一次性输出

nginx 反代未关闭缓冲。确认 `/api/` 的 location 中有 `proxy_buffering off;`。

### 生成到一半断开

`proxy_read_timeout` 太短。LLM 生成可能持续数分钟，建议 300s 以上。

### API 连接失败

检查后端进程：`pm2 status`。确认后端监听 `127.0.0.1:3000`：`curl http://127.0.0.1:3000/api/health`。

### 刷新页面 404

SPA fallback 未配置。确认 `location /` 中有 `try_files $uri $uri/ /index.html;`。
