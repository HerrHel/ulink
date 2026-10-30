FROM python:3.12-slim

WORKDIR /app

# ffmpeg：yt-dlp 的音频/视频转码与抽帧兜底
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 无头浏览器（抖音/小红书/TikTok 页面渲染兜底）：--with-deps 会装齐系统依赖
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps chromium

COPY server.py .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "server.py"]
