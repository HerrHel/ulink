FROM python:3.12-slim

# 深度解析（ASR/OCR）可选依赖开关：默认 0 = 不装，镜像行为与旧版完全一致。
# 需要口播转写 / 画面 OCR 时用：docker build --build-arg INSTALL_DEEP=1 ...
ARG INSTALL_DEEP=0

WORKDIR /app

# ffmpeg：yt-dlp 的音频/视频转码与抽帧兜底（深度解析必需）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# requirements-deep.txt 必须在上下文里（本目录已有），默认跳过安装以保持镜像轻量
COPY requirements-deep.txt .
RUN if [ "$INSTALL_DEEP" = "1" ]; then \
        pip install --no-cache-dir -r requirements-deep.txt; \
    else \
        echo "INSTALL_DEEP=0：跳过 ASR/OCR 依赖（/health 会如实返回 asr_ready/ocr_ready=false）"; \
    fi

# 无头浏览器（抖音/小红书/TikTok 页面渲染兜底）：--with-deps 会装齐系统依赖
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps chromium

# 平台域名清单：唯一真源 src/config/videoPlatforms.json，由 scripts/build-fn-assets.mjs
# 复制为 scripts/video-worker/video-platforms.json；server.py 启动时读取（缺失时回落内置常量）
COPY video-platforms.json .

COPY server.py .
# 纯函数/接口自测脚本（不会自动执行，可 docker run --rm <image> python selftest.py 验证）
COPY selftest.py .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "server.py"]
