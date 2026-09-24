#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo "🔨 使用 Docker 构建 Linux 独立单文件可执行文件"
echo "=========================================="

# 确保 static 目录存在（从 prebuilt 提取的前端资源）
if [ ! -d "$DIR/package/static" ]; then
    echo "未找到 package/static，请先准备前端产物！"
    exit 1
fi

echo "1. 构建打包镜像..."
docker build -t bypass-aigc-builder:latest -f Dockerfile.build .

echo "2. 运行 PyInstaller 打包并导出二进制文件..."
mkdir -p "$DIR/dist"
docker run --rm \
    -v "$DIR/package:/build/package" \
    -v "$DIR/dist:/build/package/dist" \
    bypass-aigc-builder:latest

echo ""
echo "✅ 构建完成！二进制文件已输出到: $DIR/dist/AI学术写作助手"
ls -lh "$DIR/dist/AI学术写作助手"
