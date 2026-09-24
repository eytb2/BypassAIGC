#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo "🚀 启动 BypassAIGC (本地 Python 模式)"
echo "=========================================="

if [ ! -d "$DIR/.venv" ]; then
    echo "创建 Python 3.11 虚拟环境..."
    /home/lemon/.local/bin/uv venv --python 3.11 "$DIR/.venv"
    echo "安装依赖..."
    /home/lemon/.local/bin/uv pip install --python "$DIR/.venv" -r "$DIR/package/requirements.txt"
fi

echo "正在启动 Web 服务..."
exec "$DIR/.venv/bin/python" "$DIR/package/main.py"
