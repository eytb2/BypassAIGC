#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo "🚀 启动 BypassAIGC (Docker 容器化模式)"
echo "=========================================="

mkdir -p "$DIR/data"
touch "$DIR/package/ai_polish.db"

# 如果镜像不存在则构建
if ! docker image inspect bypass-aigc:latest >/dev/null 2>&1; then
    echo "正在使用 Docker 构建镜像 bypass-aigc:latest ..."
    docker build -t bypass-aigc:latest -f Dockerfile .
fi

# 停止已存在的容器
docker rm -f bypass-aigc >/dev/null 2>&1 || true

# 启动容器
docker run -d \
    --name bypass-aigc \
    --restart unless-stopped \
    -p 9800:9800 \
    -v "$DIR/data:/app/data" \
    -v "$DIR/package/.env:/app/.env" \
    -v "$DIR/package/ai_polish.db:/app/ai_polish.db" \
    bypass-aigc:latest

echo ""
echo "✅ 容器已在后台运行！"
echo "📍 Web 页面: http://localhost:9800"
echo "📍 管理后台: http://localhost:9800/admin"
echo "📍 API 文档: http://localhost:9800/docs"
echo ""
echo "查看实时日志: docker logs -f bypass-aigc"
echo "停止服务命令: docker stop bypass-aigc"
