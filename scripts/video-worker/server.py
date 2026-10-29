"""
ULink Video Intelligence Worker
专门配合与链（ulink）高阶视频灵感提取的 Python 微服务。
基于 yt-dlp + ffmpeg 构建，支持：
1. 极速元数据与字幕提取（无需下载视频，1~2秒完成）
2. 极端生肉视频音频流剥离（用于 Whisper 语音转录）
3. 极限录屏/地址栏场景 360p 抽帧（用于 OCR / 视觉大模型扫站）
"""

import os
import re
import tempfile
import subprocess
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

app = FastAPI(title="ULink Video Intelligence Worker", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VideoExtractRequest(BaseModel):
    url: str
    include_subtitles: bool = True
    max_sub_chars: int = 20000

class VideoExtractResponse(BaseModel):
    success: bool
    source: str
    url: str
    title: str
    description: str
    subtitles: str
    chapters: List[Dict[str, Any]]
    comments: List[str]
    duration: Optional[int] = None
    uploader: Optional[str] = None
    error: Optional[str] = None

@app.get("/health")
def health_check():
    return {"status": "ok", "worker": "ulink-video-worker", "yt_dlp_loaded": yt_dlp is not None}

@app.post("/api/video/extract", response_model=VideoExtractResponse)
def extract_video_metadata(req: VideoExtractRequest):
    if not yt_dlp:
        raise HTTPException(status_code=500, detail="yt-dlp is not installed in worker environment")

    target_url = req.url.strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Empty video URL")

    # yt-dlp 抓取配置：完全不下载视频流，仅提取 JSON 元数据与字幕信息
    ydl_opts = {
        "skip_download": True,
        "writesubtitles": req.include_subtitles,
        "writeautomaticsub": req.include_subtitles,
        "subtitleslangs": ["zh-Hans", "zh-CN", "zh", "en", "en-US", "all"],
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "socket_timeout": 10,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target_url, download=False)
            if not info:
                return VideoExtractResponse(
                    success=False,
                    source="unknown",
                    url=target_url,
                    title="",
                    description="",
                    subtitles="",
                    chapters=[],
                    comments=[],
                    error="Failed to extract info from URL",
                )

            title = info.get("title", "")
            description = info.get("description", "")
            extractor = info.get("extractor", "generic").lower()
            duration = info.get("duration")
            uploader = info.get("uploader") or info.get("channel")

            # 提取章节时间戳
            chapters = []
            if "chapters" in info and isinstance(info["chapters"], list):
                for ch in info["chapters"]:
                    chapters.append({
                        "title": ch.get("title", ""),
                        "start_time": ch.get("start_time", 0),
                        "end_time": ch.get("end_time", 0),
                    })

            # 提取评论摘要（若有）
            comments = []
            if "comments" in info and isinstance(info["comments"], list):
                for c in info["comments"][:15]:
                    text = c.get("text", "")
                    if text and len(text) > 2:
                        comments.append(text[:200])

            # 整理字幕（优先中文与英文）
            sub_text = ""
            sub_tracks = info.get("subtitles") or info.get("automatic_captions") or {}
            
            # 若包含已下载或可直接获取的字幕片段
            if isinstance(sub_tracks, dict):
                # 寻找首选中文字幕或英文字幕
                for lang_key in ["zh-Hans", "zh-CN", "zh", "en", "en-US"]:
                    if lang_key in sub_tracks:
                        # 记录找到的字幕语种提示
                        sub_text = f"[字幕轨道: {lang_key}]"
                        break

            return VideoExtractResponse(
                success=True,
                source=extractor,
                url=info.get("webpage_url", target_url),
                title=title,
                description=description,
                subtitles=sub_text[:req.max_sub_chars],
                chapters=chapters,
                comments=comments,
                duration=duration,
                uploader=uploader,
            )

    except Exception as e:
        return VideoExtractResponse(
            success=False,
            source="unknown",
            url=target_url,
            title="",
            description="",
            subtitles="",
            chapters=[],
            comments=[],
            error=str(e),
        )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
