FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖
RUN sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖配置
COPY package/requirements.txt /app/requirements.txt

# 安装 Python 依赖 (使用阿里云源加速)
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com \
    -r /app/requirements.txt

# 复制应用代码与静态资源
COPY package/backend /app/backend
COPY package/static /app/static
COPY package/main.py /app/main.py

# 环境变量设置
ENV SERVER_HOST=0.0.0.0 \
    SERVER_PORT=9800 \
    PYTHONUNBUFFERED=1

EXPOSE 9800

# 启动服务
CMD ["python", "main.py"]
