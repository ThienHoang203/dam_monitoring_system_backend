# Stage 1: Build ứng dụng NestJS
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files và cài đặt tất cả dependencies để build
COPY package*.json ./
RUN npm ci

# Copy toàn bộ mã nguồn và build ra dist
COPY . .
RUN npm run build

# Stage 2: Chạy ứng dụng phiên bản Production
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Sao chép package.json và cài đặt duy nhất production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Sao chép thư mục dist đã biên dịch từ stage builder
COPY --from=builder /app/dist ./dist

# Port ứng dụng NestJS
EXPOSE 3001

CMD ["node", "dist/main"]
