# 多阶段构建：前端 build → server 编译 → 运行
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
RUN npm ci

# 复制源码
COPY . .

# 构建前端
RUN npm run build

# 构建服务端
RUN npm run build:server

# 运行阶段
FROM node:20-alpine AS runner

WORKDIR /app

# 复制必要文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3000

# 环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 启动服务
CMD ["node", "dist-server/index.js"]