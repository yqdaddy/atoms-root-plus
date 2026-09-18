# 部署指南

## 架构

- **前端**：GitHub Pages（静态托管）
- **后端**：Linux 服务器（Node.js + SQLite）

## 前端部署（GitHub Pages）

### 1. 创建 GitHub 仓库

```bash
# 在 GitHub 网页创建仓库：https://github.com/new
# 仓库名：atoms-root-plus
```

### 2. 推送代码

```bash
git remote add origin https://github.com/你的用户名/atoms-root-plus.git
git branch -M main
git push -u origin main
```

### 3. 启用 GitHub Pages

1. 进入仓库 Settings → Pages
2. Source 选择 `GitHub Actions`

### 4. 创建部署 Workflow

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run build
      
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      
      - uses: actions/deploy-pages@v4
```

### 5. 配置前端 API 地址

创建 `.env.production`：

```env
VITE_API_BASE=https://你的服务器域名/api
```

## 后端部署（Linux 服务器）

### 1. 服务器要求

- Node.js 18+
- 端口 3000 开放

### 2. 上传代码

```bash
# 本地打包
tar -czvf atoms-backend.tar.gz dist-server/ package.json package-lock.json .env.example

# 上传到服务器
scp atoms-backend.tar.gz user@服务器IP:/home/user/
```

### 3. 服务器配置

```bash
# SSH 登录服务器
ssh user@服务器IP

# 解压
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

# 启动服务
node dist-server/index.js
```

### 4. 使用 PM2 守护进程

```bash
npm install -g pm2
pm2 start dist-server/index.js --name atoms-api
pm2 save
pm2 startup
```

### 5. Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name 你的域名;
    
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 验证部署

```bash
# 检查前端
curl https://你的用户名.github.io/atoms-root-plus/

# 检查后端
curl https://你的域名/api/health
```

## 常见问题

### CORS 错误

确保后端 CORS 配置正确（server/index.ts 已配置）。

### API 连接失败

检查防火墙是否开放 3000 端口。

### 前端空白

检查 VITE_API_BASE 是否正确配置。