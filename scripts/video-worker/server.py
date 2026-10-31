"""
ULink Video Intelligence Worker
专门配合与链（ulink）高阶视频灵感提取的 Python 微服务。

同步抓取策略（按顺序命中即返回）：
1. yt-dlp 元数据抽取（简介 / 章节 / 评论 / 字幕文本）——覆盖 B站、YouTube、Twitter 等 1000+ 平台；
2. Playwright 无头浏览器兜底——抖音 / 小红书 / TikTok 等「必须登录态或需要 JS 渲染」的页面，
   直接读取渲染后的标题与简介文本，保证不会像 r.jina.ai 那样直接 502。

深度解析（异步，P1/P2）：
3. POST /api/video/jobs 提交任务 → 后台线程（并发上限 WORKER_DEEP_CONCURRENCY，默认 1，其余排队）；
4. 流程：短链解析 → yt-dlp bestaudio → ffmpeg 转 16k 单声道 wav → ASR（faster_whisper / OpenAI 兼容 http）；
   可选 OCR：yt-dlp ≤720p 视频 → ffmpeg 场景检测 + 兜底采样抽帧 → rapidocr 识别 → URL 提取投票聚合；
5. GET /api/video/jobs/{job_id} 轮询进度与结果；任务状态存内存（默认 30 分钟过期）。

设计约束：
- 只取公开信息，绝不伪造：抓不到就如实返回 success=false 与 error / error_code；
- 重依赖（yt-dlp / playwright / faster_whisper / rapidocr_onnxruntime）一律懒加载：
  未安装时服务照常启动，/health 如实报告 *_ready=false，深度任务返回 asr_unavailable / ocr_unavailable；
- 任何兜底失败都不影响另一条链路（yt-dlp 失败 → 浏览器兜底，反之亦然）；
- 平台域名清单唯一真源 src/config/videoPlatforms.json，构建脚本复制成本目录 video-platforms.json。

接口契约唯一真源：docs/VIDEO_DEEP_EXTRACT.md
"""

import asyncio
import base64
import hashlib
import hmac
import html
import importlib.util
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlsplit

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import yt_dlp
except ImportError:  # 允许未安装 yt-dlp 时仍启动服务（浏览器兜底可用）
    yt_dlp = None

try:
    from playwright.async_api import async_playwright
except ImportError:  # 允许未安装 playwright（仅 yt-dlp 链路）
    async_playwright = None


# ─────────────────────────── 基础配置 ───────────────────────────

WORKER_VERSION = "1.2.0"

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


UPSTREAM_TIMEOUT_MS = _env_int("WORKER_UPSTREAM_TIMEOUT_MS", 12000)
BROWSER_TIMEOUT_MS = _env_int("WORKER_BROWSER_TIMEOUT_MS", 20000)
BROWSER_SETTLE_MS = _env_int("WORKER_BROWSER_SETTLE_MS", 3000)
MAX_TEXT_CHARS = _env_int("WORKER_MAX_TEXT_CHARS", 20000)
# 可选调用口令：若配置，则要求请求头 X-Worker-Token 一致（云托管公网暴露时必须开启）
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "").strip()
YTDLP_PROXY = os.environ.get("YTDLP_PROXY", "").strip()

# ─── 深度解析（P1/P2）配置 ───
DEEP_CONCURRENCY = max(1, _env_int("WORKER_DEEP_CONCURRENCY", 1))
DEEP_MAX_SECONDS = max(1, _env_int("WORKER_DEEP_MAX_SECONDS", 900))
DEEP_MAX_MB = max(1, _env_int("WORKER_DEEP_MAX_MB", 200))
DEEP_TIMEOUT_SECS = max(10, _env_int("WORKER_DEEP_TIMEOUT_SECS", 300))
DEEP_JOB_TTL_SECS = max(60, _env_int("WORKER_DEEP_JOB_TTL_SECS", 1800))
DEEP_MAX_QUEUE = max(1, _env_int("WORKER_DEEP_MAX_QUEUE", 16))
DEEP_TRANSCRIPT_MAX_CHARS = max(2000, _env_int("WORKER_DEEP_TRANSCRIPT_MAX_CHARS", 60000))
COMMENT_LIMIT = max(0, _env_int("WORKER_COMMENT_LIMIT", 15))

# ASR provider：none（默认）/ faster_whisper（本地）/ http（OpenAI 兼容接口）/ mimo（小米 MiMo 语音识别模型）
_ASR_PROVIDERS = ("none", "faster_whisper", "http", "mimo")
ASR_PROVIDER = os.environ.get("WORKER_ASR_PROVIDER", "none").strip().lower()
if ASR_PROVIDER not in _ASR_PROVIDERS:
    ASR_PROVIDER = "none"
ASR_MODEL = os.environ.get("WORKER_ASR_MODEL", "base").strip() or "base"
ASR_DEVICE = os.environ.get("WORKER_ASR_DEVICE", "cpu").strip() or "cpu"
ASR_COMPUTE_TYPE = os.environ.get("WORKER_ASR_COMPUTE_TYPE", "int8").strip() or "int8"
ASR_LANGUAGE = os.environ.get("WORKER_ASR_LANGUAGE", "").strip()
ASR_HTTP_URL = os.environ.get("WORKER_ASR_HTTP_URL", "").strip()
ASR_HTTP_TOKEN = os.environ.get("WORKER_ASR_HTTP_TOKEN", "").strip()
ASR_HTTP_MODEL = os.environ.get("WORKER_ASR_HTTP_MODEL", "whisper-1").strip() or "whisper-1"
ASR_HTTP_TIMEOUT_SECS = max(10, _env_int("WORKER_ASR_HTTP_TIMEOUT_SECS", 240))

# ─── MiMo 多模态通道（ASR 与画面理解共用；密钥只放服务端环境变量，前端零感知）───
# 为什么用外部模型而不是镜像内跑 whisper/rapidocr：CloudBase 个人版资源点 = 内存×时长，
# 1C2G 跑 10 分钟 ASR 约 133 点/次；只做 yt-dlp 下载 + ffmpeg 抽帧/转码约 10~20 点/次。
# 费用模型见 docs/VIDEO_DEEP_EXTRACT.md。
MIMO_API_KEY = os.environ.get("MIMO_API_KEY", "").strip()
MIMO_BASE_URL = (os.environ.get("MIMO_BASE_URL", "https://api.xiaomimimo.com/v1").strip() or "").rstrip("/")
MIMO_ASR_MODEL = os.environ.get("WORKER_ASR_MIMO_MODEL", "mimo-v2.5-asr").strip() or "mimo-v2.5-asr"
MIMO_VISION_MODEL = os.environ.get("WORKER_OCR_MIMO_MODEL", "mimo-v2.6-flash").strip() or "mimo-v2.6-flash"
# 单段音频上限：ASR 模型 TPM 只有 10k，长音频必须分片，单片默认 90 秒
MIMO_ASR_CHUNK_SECS = max(15, _env_int("WORKER_ASR_MIMO_CHUNK_SECS", 90))
# 分片请求间隔（秒）：控制每分钟请求数，避免撞 RPM/TPM；默认 1.5 秒
MIMO_ASR_MIN_INTERVAL_SECS = max(0.0, _env_float("WORKER_ASR_MIMO_MIN_INTERVAL_SECS", 1.5))
MIMO_TIMEOUT_SECS = max(10, _env_int("WORKER_MIMO_TIMEOUT_SECS", 120))
MIMO_MAX_RETRIES = max(0, _env_int("WORKER_MIMO_MAX_RETRIES", 2))
# 画面理解默认最多送 12 帧（成本/时延平衡）；每帧单独调用一次，便于复用跨帧投票的 confidence/frames
MIMO_VISION_MAX_FRAMES = max(1, _env_int("WORKER_OCR_MIMO_MAX_FRAMES", 12))
_LAST_MIMO_ASR_AT = 0.0
_MIMO_ASR_PACE_LOCK = threading.Lock()

# ─── B站专用动态代理（仅 B站走代理；API 返回 ip:port，auto_white=1 会白名单调用方出口）───
# 用法：把代理商「提取链接」整条（含 trade_no/sign）放 BILI_PROXY_API；worker 每次任务前调用它，
# 拿到的代理只用于 B站请求；其它平台仍直连。链接含密钥，只放云托管环境变量。
# TODO(2026-10-31): 当前 CloudRun 出口 IP 被 B站硬限流；指纹/Challenge/Cookie 均已证伪。
#   代理试验（巨量IP 提取链接）本机可用但 CloudRun 调不通提取接口，已暂停、未购买。
#   后续方向见 docs/VIDEO_DEEP_EXTRACT.md §9：优先浏览器扩展 playinfo（用户 IP）；
#   或自建出口（家宽/VPS/Tailscale）；或改买静态 ISP/隧道账密代理（BILI_PROXY_API 保留备用）。
BILI_PROXY_API = os.environ.get("BILI_PROXY_API", "").strip()
BILI_PROXY_TTL_SECS = max(30, _env_int("BILI_PROXY_TTL_SECS", 120))
_bili_proxy_lock = threading.Lock()
_bili_proxy_cache: Dict[str, Any] = {"at": 0.0, "url": ""}

# 画面 OCR provider：none / rapidocr（本地，需重依赖）/ mimo（多模态理解，无需重依赖）
_OCR_PROVIDERS = ("none", "rapidocr", "mimo")
OCR_PROVIDER = os.environ.get("WORKER_OCR_PROVIDER", "").strip().lower()
if OCR_PROVIDER not in _OCR_PROVIDERS:
    # 兼容旧配置：只开 WORKER_OCR_ENABLED 时视为 rapidocr
    OCR_PROVIDER = "rapidocr" if _env_bool("WORKER_OCR_ENABLED", False) else "none"

# 画面 OCR：本地 rapidocr 需要镜像内装依赖；mimo 走外部多模态模型（见上）
OCR_ENABLED = OCR_PROVIDER == "rapidocr" or _env_bool("WORKER_OCR_ENABLED", False)
OCR_SCENE_THRESHOLD = min(0.95, max(0.05, _env_float("WORKER_OCR_SCENE_THRESHOLD", 0.3)))
OCR_MAX_FRAMES = max(2, _env_int("WORKER_OCR_MAX_FRAMES", 24))
OCR_SAMPLE_SECS = max(1.0, _env_float("WORKER_OCR_SAMPLE_SECS", 5.0))

FFMPEG_BIN = os.environ.get("WORKER_FFMPEG_PATH", "").strip() or "ffmpeg"

# 页面型平台：这些站点 yt-dlp 通常拿不到（风控/需登录），优先走浏览器兜底
# （内置值仅用于 video-platforms.json 缺失时的回落，真源是 src/config/videoPlatforms.json）
_BUILTIN_VIDEO_HOSTS = (
    "douyin.com",
    "iesdouyin.com",
    "tiktok.com",
    "xiaohongshu.com",
    "xhslink.com",
    "bilibili.com",
    "b23.tv",
    "bili2233.cn",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "vimeo.com",
    "dailymotion.com",
    "kuaishou.com",
    "weibo.com",
    "ixigua.com",
    "acfun.cn",
    "twitch.tv",
    "youku.com",
    "iqiyi.com",
    "mgtv.com",
    "douyu.com",
    "huya.com",
)
_BUILTIN_BROWSER_FIRST_HOSTS = (
    "douyin.com",
    "iesdouyin.com",
    "xiaohongshu.com",
    "xhslink.com",
    "tiktok.com",
)
_BUILTIN_SHORT_LINK_HOSTS = (
    "v.douyin.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
    "b23.tv",
    "bili2233.cn",
    "xhslink.com",
    "t.cn",
)


def _load_platform_config(path: Optional[str] = None) -> Tuple[Dict[str, Any], str]:
    """读取平台域名清单（唯一真源 src/config/videoPlatforms.json 的副本）。

    返回 (config, source)：source 为 "file" 或 "builtin"。文件缺失/损坏时回落内置常量，
    保证极端情况下服务仍可启动（不因配置缺失直接 502）。
    """
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "video-platforms.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data, "file"
    except Exception:
        pass
    return {}, "builtin"


_PLATFORM_CONFIG, PLATFORM_LIST_SOURCE = _load_platform_config()


def _hosts_from_config(key: str, fallback: Tuple[str, ...]) -> Tuple[str, ...]:
    values = _PLATFORM_CONFIG.get(key)
    if isinstance(values, list):
        cleaned = tuple(
            sorted({str(v).strip().lower().lstrip(".") for v in values if str(v).strip()})
        )
        if cleaned:
            return cleaned
    return tuple(fallback)


# 只允许视频/图文平台域名：服务若被公网直连，也不能退化成任意网站代理（防 SSRF/滥用）
ALLOWED_VIDEO_HOSTS = _hosts_from_config("videoHosts", _BUILTIN_VIDEO_HOSTS)
BROWSER_FIRST_HOSTS = _hosts_from_config("browserFirstHosts", _BUILTIN_BROWSER_FIRST_HOSTS)
SHORT_LINK_HOSTS = set(_hosts_from_config("resolverShortLinkHosts", _BUILTIN_SHORT_LINK_HOSTS))

ALLOW_ANY_HOST = _env_bool("WORKER_ALLOW_ANY_HOST", False)
RATE_LIMIT_PER_MIN = _env_int("WORKER_RATE_LIMIT_PER_MIN", 60)
# YouTube DNS 严格预检：除私网/保留地址外，还校验解析结果是否落在 YouTube 所属网络，
# 以识别「解析到 Twitter/Facebook 等无关公网 IP」这类典型 DNS 污染。可关（见 README）。
YOUTUBE_DNS_STRICT = _env_bool("WORKER_YOUTUBE_DNS_STRICT", True)
# 已知的 DNS 污染 / 黑洞地址段（GFW 常见返回：境外社交 IP、ISP 拦截页 IP 等）
_DNS_POISON_NETWORKS = tuple(
    ipaddress.ip_network(net)
    for net in (
        "104.244.42.0/24",  # Twitter：国内污染 youtube.com 的常见结果
        "31.13.64.0/18",  # Facebook
        "31.13.24.0/21",
        "66.220.144.0/20",
        "69.171.224.0/19",
        "173.252.64.0/18",
        "157.240.0.0/16",
        "204.15.20.0/22",
        "59.24.3.0/24",
        "203.98.7.0/24",
        "8.7.198.0/24",
        "37.61.54.0/24",
        "46.82.174.0/24",
        "78.16.49.0/24",
        "93.46.8.0/24",
        "159.106.121.0/24",
        "64.33.88.0/24",
        "243.185.187.0/24",
        "253.157.14.0/24",
        "54.76.135.0/24",
        "66.206.12.0/24",
        "4.36.66.0/24",
        "23.89.5.0/24",
        "216.234.179.0/24",
    )
)
# youtube.com / youtu.be 的前端只可能落在 Google 自有网络；不在其中基本可判定 DNS 被污染
_YOUTUBE_EXPECTED_NETWORKS = tuple(
    ipaddress.ip_network(net)
    for net in (
        "142.250.0.0/15",
        "172.217.0.0/16",
        "172.253.0.0/16",
        "173.194.0.0/16",
        "209.85.128.0/17",
        "216.58.192.0/19",
        "216.239.32.0/19",
        "64.233.160.0/19",
        "74.125.0.0/16",
        "108.177.0.0/17",
        "192.178.0.0/15",
        "2607:f8b0::/32",
        "2a00:1450::/32",
        "2404:6800::/32",
        "2001:4860::/32",
    )
)
_ip_hits: Dict[str, List[float]] = {}
# 最近一次浏览器兜底的诊断信息（失败原因回传调用方，便于定位风控/环境问题）
_last_browser_diag = ""

# 浏览器实例与引擎：常驻复用（抖音首页预热后会话稳定，页面渲染成功率远高于每次冷启动）
_pw = None
_browser_ctx = None
_browser_lock = asyncio.Lock()
_warmed_platforms: set = set()
# 持久化 profile：保留 Cookie/本地存储，跨请求复用登录态与风控信任分
PROFILE_DIR = os.environ.get("WORKER_BROWSER_PROFILE_DIR", "").strip() or os.path.join(
    tempfile.gettempdir(), "ulink-worker-profile"
)
BROWSER_ENABLED = _env_bool("WORKER_BROWSER_ENABLED", True)

# 各平台首页：先访问一次再进详情页，抖音/小红书会下发风控 Cookie（纯冷启动详情页常被降级为空壳）
PLATFORM_HOME = {
    "douyin": "https://www.douyin.com/",
    "xiaohongshu": "https://www.xiaohongshu.com/explore",
    "tiktok": "https://www.tiktok.com/",
}

# ─── 运行期能力探测（懒加载：只探测模块是否存在，不导入重依赖） ───


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _ffmpeg_ready() -> bool:
    return bool(FFMPEG_BIN) and (shutil.which(FFMPEG_BIN) is not None or os.path.isfile(FFMPEG_BIN))


def _asr_ready() -> bool:
    if ASR_PROVIDER == "faster_whisper":
        return _module_available("faster_whisper")
    if ASR_PROVIDER == "http":
        return bool(ASR_HTTP_URL)
    if ASR_PROVIDER == "mimo":
        return bool(MIMO_API_KEY)
    return False


def _ocr_ready() -> bool:
    if OCR_PROVIDER == "mimo":
        return bool(MIMO_API_KEY)
    if OCR_PROVIDER == "rapidocr":
        return bool(OCR_ENABLED and _module_available("rapidocr_onnxruntime"))
    return False


def _cookies_configured() -> bool:
    try:
        return _prepare_cookiefile() is not None
    except Exception:
        return False


_whisper_model = None
_whisper_lock = threading.Lock()
_ocr_engine = None
_ocr_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _browser_ctx, _pw
    if async_playwright and BROWSER_ENABLED:
        try:
            ctx = await _ensure_browser()
            # 提前预热抖音：首次线上请求无需再等会话建立（失败不影响服务可用）
            if ctx is not None:
                await _warmup(ctx, "douyin")
        except Exception:
            pass
    yield
    if _browser_ctx is not None:
        try:
            await _browser_ctx.close()
        except Exception:
            pass
        _browser_ctx = None
    if _pw is not None:
        try:
            await _pw.stop()
        except Exception:
            pass
        _pw = None
    _shutdown_executor()


app = FastAPI(title="ULink Video Intelligence Worker", version=WORKER_VERSION, lifespan=lifespan)

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
    max_sub_chars: int = MAX_TEXT_CHARS
    # 可选：为 true 时 yt-dlp 开 getcomments（默认关闭，避免评论抓取拖慢同步接口）
    include_comments: bool = False


class VideoExtractResponse(BaseModel):
    success: bool
    source: str
    url: str
    title: str
    description: str
    subtitles: str = ""
    chapters: List[Dict[str, Any]] = []
    comments: List[str] = []
    duration: Optional[int] = None
    uploader: Optional[str] = None
    # P0：本结果由哪条链路产出（yt-dlp / browser / none）
    provider: str = "none"
    # P0：YouTube DNS 预检失败等机器可读错误码（云函数据此给出可行动提示）
    error_code: Optional[str] = None
    error: Optional[str] = None


class DeepJobInclude(BaseModel):
    transcript: Optional[bool] = None
    ocr: Optional[bool] = None


class DeepClientMedia(BaseModel):
    """浏览器扩展上报的页面态媒体地址（只允许平台 CDN 直链，防止被当任意下载器）。"""

    platform: str
    referer: str
    audio_urls: List[str] = []
    video_urls: List[str] = []
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration: Optional[float] = None


class DeepJobRequest(BaseModel):
    url: str
    include: Optional[DeepJobInclude] = None
    client: Optional[DeepClientMedia] = None


# ─────────────────────────── 通用工具 ───────────────────────────


def _host(url: str) -> str:
    m = re.match(r"^https?://([^/:?#]+)", url or "", re.I)
    return (m.group(1) if m else "").lower().removeprefix("www.")


def _host_matches(host: str, hosts: Tuple[str, ...]) -> bool:
    if not host:
        return False
    return any(host == h or host.endswith("." + h) for h in hosts)


def _host_allowed(host: str) -> bool:
    if ALLOW_ANY_HOST:
        return True
    return _host_matches(host, ALLOWED_VIDEO_HOSTS)


def _client_media_url_ok(url: str, platform: str) -> bool:
    """扩展上报的媒体地址只允许平台 CDN 的 https 直链（无账密/只允许白名单端口）。"""
    match = re.match(r"^https://([^/:?#]+)(?::(\d{1,5}))?(?:[/?#].*)?$", url or "", re.I)
    if not match:
        return False
    host = match.group(1).lower()
    port = match.group(2) or ""
    if "@" in host or port not in ("", "443", "8082", "8443"):
        return False
    return _host_matches(host, CLIENT_MEDIA_HOSTS.get(platform, ()))


def _sanitize_client_media(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """校验云端透传的 client 媒体数据；不合法返回 None（调用方回落到 yt-dlp 链路）。"""
    if not isinstance(raw, dict):
        return None
    platform = str(raw.get("platform") or "").strip().lower()
    if platform not in CLIENT_MEDIA_HOSTS:
        return None

    def clean_urls(values: Any) -> List[str]:
        out: List[str] = []
        if not isinstance(values, list):
            return out
        for value in values:
            if not isinstance(value, str):
                continue
            text = value.strip()
            if not text or not _client_media_url_ok(text, platform):
                continue
            if text not in out:
                out.append(text)
            if len(out) >= 6:
                break
        return out

    audio = clean_urls(raw.get("audio_urls"))
    video = clean_urls(raw.get("video_urls"))
    if not audio and not video:
        return None
    title = str(raw.get("title") or "").strip()[:200]
    uploader = str(raw.get("uploader") or "").strip()[:120]
    duration = raw.get("duration")
    duration_value: Optional[float] = None
    if isinstance(duration, (int, float)) and 0 < float(duration) <= 36000:
        duration_value = float(duration)
    return {
        "platform": platform,
        "referer": CLIENT_MEDIA_REFERERS[platform],
        "audio_urls": audio,
        "video_urls": video,
        "title": title,
        "uploader": uploader,
        "duration": duration_value,
    }


def _download_client_media(
    urls: List[str],
    referer: str,
    tmpdir: str,
    kind: str,
    max_bytes: int,
    job_id: str,
    progress_base: float,
    progress_span: float,
) -> str:
    """下载扩展上报的 CDN 媒体直链（带平台 Referer），返回本地文件路径。"""
    if not urls:
        raise DeepTaskError("download_failed", "扩展未提供可下载的%s地址" % ("音频" if kind == "audio" else "视频"))
    label = "音频" if kind == "audio" else "视频"
    headers = {"User-Agent": DESKTOP_UA, "Referer": referer, "Accept": "*/*"}
    errors: List[str] = []
    for index, url in enumerate(urls):
        path = os.path.join(tmpdir, "%s-client-%d.bin" % (kind, index))
        try:
            with requests.get(url, headers=headers, stream=True, timeout=30) as response:
                if response.status_code not in (200, 206):
                    errors.append("HTTP %s" % response.status_code)
                    continue
                total = int(response.headers.get("Content-Length") or 0)
                if total > max_bytes:
                    raise DeepTaskError("too_long", "媒体体积超过上限 %dMB" % DEEP_MAX_MB)
                written = 0
                with open(path, "wb") as handle:
                    for chunk in response.iter_content(chunk_size=256 * 1024):
                        if not chunk:
                            continue
                        written += len(chunk)
                        if written > max_bytes:
                            raise DeepTaskError("too_long", "媒体体积超过上限 %dMB" % DEEP_MAX_MB)
                        handle.write(chunk)
                        if total:
                            _set_progress(
                                job_id,
                                min(0.98, progress_base + progress_span * (written / total)),
                                "download",
                            )
            if written > 0 and os.path.getsize(path) > 0:
                return path
            errors.append("empty body")
        except DeepTaskError:
            raise
        except Exception as exc:
            errors.append(str(exc)[:120])
            continue
    raise DeepTaskError(
        "download_failed",
        "%s下载失败：扩展提供的地址可能已过期（%s）" % (label, "；".join(errors[:2]) or "无可用地址"),
    )


def _is_private_ip(ip: str) -> bool:
    """IP 是否落在私网/保留范围（DNS 污染最常见的表现就是解析到 0.0.0.0/127.x/内网）。"""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast


def _looks_like_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def _ip_in_networks(value: str, networks: Tuple[Any, ...]) -> bool:
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return False
    return any(addr.version == network.version and addr in network for network in networks)


def dns_preflight(
    host: str,
    resolver: Any = None,
    expected_networks: Optional[Tuple[Any, ...]] = None,
) -> Dict[str, Any]:
    """DNS 预检（纯函数形式便于自测）：返回 {ok, reason, detail, ips}。

    reason: "" | "dns_failed" | "private_address" | "poison_address" | "unexpected_network"
    - private_address：解析到私网/回环/保留地址（最常见）；
    - poison_address：解析到已知 DNS 污染/黑洞地址段（如污染后返回 Twitter/Facebook IP）；
    - unexpected_network：给了 expected_networks 且结果不在其中（YouTube 专用严格校验）。
    """
    resolver = resolver or socket.getaddrinfo
    try:
        infos = resolver(host, None) or []
    except Exception as exc:
        return {"ok": False, "reason": "dns_failed", "detail": str(exc)[:160], "ips": []}
    ips: List[str] = []
    for info in infos:
        try:
            ip = info[4][0]
        except (IndexError, TypeError):
            continue
        if ip and ip not in ips:
            ips.append(ip)
    if not ips:
        return {"ok": False, "reason": "dns_failed", "detail": "no address returned", "ips": []}
    blocked = [ip for ip in ips if _is_private_ip(ip)]
    if blocked:
        return {
            "ok": False,
            "reason": "private_address",
            "detail": ",".join(blocked[:3]),
            "ips": ips,
        }
    poisoned = [ip for ip in ips if _ip_in_networks(ip, _DNS_POISON_NETWORKS)]
    if poisoned:
        return {
            "ok": False,
            "reason": "poison_address",
            "detail": ",".join(poisoned[:3]),
            "ips": ips,
        }
    if expected_networks:
        unexpected = [ip for ip in ips if not _ip_in_networks(ip, expected_networks)]
        if unexpected:
            return {
                "ok": False,
                "reason": "unexpected_network",
                "detail": ",".join(unexpected[:3]),
                "ips": ips,
            }
    return {"ok": True, "reason": "", "detail": "", "ips": ips}


def _youtube_preflight(host: str, resolver: Any = None) -> Dict[str, Any]:
    """YouTube 专用 DNS 预检：先做基础私网/污染检查，严格模式下再校验必须落在 Google 网络。"""
    basic = dns_preflight(host, resolver=resolver)
    if not basic["ok"]:
        return basic
    if not YOUTUBE_DNS_STRICT:
        return basic
    return dns_preflight(host, resolver=resolver, expected_networks=_YOUTUBE_EXPECTED_NETWORKS)


def _youtube_unreachable_reason(reason: str) -> str:
    return {
        "private_address": "域名解析到内网/保留地址（疑似 DNS 污染）",
        "poison_address": "域名解析到已知的 DNS 污染/黑洞地址",
        "unexpected_network": "域名解析结果不在 YouTube 所属网络（疑似 DNS 污染）",
        "dns_failed": "域名无法解析",
    }.get(reason, "DNS 预检失败")


def validate_url_shape(url: str) -> str:
    """入口形状校验：仅 http(s) + 仅视频平台域名（不做 DNS）。"""
    if not re.match(r"^https?://", url or "", re.I):
        raise HTTPException(status_code=400, detail="Only http(s) URLs are supported")
    host = _host(url)
    if not host:
        raise HTTPException(status_code=400, detail="Invalid URL host")
    if not _host_allowed(host):
        raise HTTPException(status_code=400, detail="Unsupported host")
    return url


def validate_target_url(url: str) -> str:
    """入口校验：仅 http(s) + 仅视频平台域名 + DNS 解析结果不得落在内网（fail-closed）"""
    validate_url_shape(url)
    preflight = dns_preflight(_host(url))
    if not preflight["ok"]:
        if preflight["reason"] == "private_address":
            raise HTTPException(status_code=400, detail="Blocked private address")
        if preflight["reason"] == "poison_address":
            raise HTTPException(status_code=400, detail="Blocked suspicious DNS address")
        raise HTTPException(status_code=400, detail="DNS resolution failed")
    return url


def _client_ip(request: Request) -> str:
    """调用方真实 IP（限流键）。

    安全：X-Forwarded-For 可被客户端伪造；网关把真实来源追加在链尾，
    因此取**最后一跳**而不是第一跳（否则可伪造 IP 绕过 60 次/分限流）。
    优先 x-real-ip（网关通常覆盖该头）。
    """
    real = request.headers.get("x-real-ip")
    if real and real.strip():
        return real.strip()
    forwarded = request.headers.get("x-forwarded-for") or ""
    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    if hops:
        return hops[-1]
    return request.client.host if request.client else "unknown"


def check_rate_limit(request: Request) -> None:
    """进程内计数限流（单实例部署；公网暴露时防止被打成免费代理）"""
    if RATE_LIMIT_PER_MIN <= 0:
        return
    now = time.time()
    ip = _client_ip(request)
    hits = [t for t in _ip_hits.get(ip, []) if now - t < 60]
    if len(hits) >= RATE_LIMIT_PER_MIN:
        _ip_hits[ip] = hits
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    hits.append(now)
    _ip_hits[ip] = hits
    if len(_ip_hits) > 2000:
        for k in [k for k, v in _ip_hits.items() if not v or now - v[-1] > 120]:
            _ip_hits.pop(k, None)


def require_worker_token(request: Request) -> None:
    """WORKER_TOKEN 校验（同步 / 深度接口共用）：配置后必须带 X-Worker-Token。"""
    if not WORKER_TOKEN:
        return
    token = request.headers.get("x-worker-token") or ""
    if not hmac.compare_digest(token, WORKER_TOKEN):
        raise HTTPException(status_code=401, detail="invalid worker token")


def detect_platform(url: str) -> str:
    host = _host(url)
    if "douyin" in host:
        return "douyin"
    if "xiaohongshu" in host or "xhslink" in host:
        return "xiaohongshu"
    if "tiktok" in host:
        return "tiktok"
    if "bilibili" in host or "b23.tv" in host:
        return "bilibili"
    if "youtube" in host or "youtu.be" in host:
        return "youtube"
    if host in ("x.com", "twitter.com"):
        return "twitter"
    return "generic"


def resolve_short_link(url: str) -> str:
    """短链逐跳跟随到 canonical 页面（每跳重新校验域名与 DNS，防跳转绕过白名单）"""
    if _host(url) not in SHORT_LINK_HOSTS:
        return url
    current = url
    for _hop in range(5):
        try:
            res = requests.get(
                current,
                headers={"User-Agent": DESKTOP_UA},
                timeout=UPSTREAM_TIMEOUT_MS / 1000,
                allow_redirects=False,
            )
        except Exception:
            return current
        location = res.headers.get("Location")
        if res.status_code not in (301, 302, 303, 307, 308) or not location:
            break
        try:
            current = validate_target_url(urljoin(current, location))
        except HTTPException:
            return url

    # 抖音短链会落到 iesdouyin.com/share/video/<id>，改写成可稳定渲染的详情页
    m = re.search(r"/share/video/(\d+)", current)
    if m:
        return "https://www.douyin.com/video/" + m.group(1)
    return current


def _strip_html(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or ""))


def _normalize_text(s: str) -> str:
    """压缩空白并去掉连续重复行（字幕解析后常见）"""
    lines: List[str] = []
    for raw in (s or "").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        if lines and line == lines[-1]:
            continue
        lines.append(line)
    return "\n".join(lines)


# ─────────────────────────── 字幕解析 ───────────────────────────


def parse_json3(raw: str) -> str:
    try:
        data = json.loads(raw)
    except Exception:
        return ""
    parts: List[str] = []
    for event in data.get("events", []) or []:
        for seg in event.get("segs", []) or []:
            t = seg.get("utf8")
            if t:
                parts.append(t)
    return _normalize_text("".join(parts).replace("\n", " "))


def parse_vtt(raw: str) -> str:
    out: List[str] = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s or s.startswith("WEBVTT") or s.startswith("NOTE") or s.startswith("Kind:"):
            continue
        if "-->" in s or re.match(r"^\d+$", s):
            continue
        out.append(_strip_html(s))
    return _normalize_text("\n".join(out))


def parse_srt(raw: str) -> str:
    return parse_vtt(raw)


def _lang_rank(lang: str) -> int:
    """字幕轨语言优先级：中文（简/繁）优先，其次英文，最后其它语言。

    数值越小越优先，便于 sorted() 直接使用。
    """
    key = str(lang or "").strip().lower().replace("_", "-")
    if not key:
        return 300
    if key == "zh-hans":
        return 0
    if key in ("zh-cn", "zh"):
        return 1
    if key == "zh-hant":
        return 2
    if key in ("zh-tw", "zh-hk", "zh-sg", "zh-mo"):
        return 3
    if key.startswith("zh"):
        return 4
    if key == "en":
        return 10
    if key.startswith("en-"):
        return 11
    return 100


def pick_subtitle_track(tracks: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """按语言优先级（中文 > 英文 > 其它）+ 解析格式优先级挑一条字幕轨道"""
    if not isinstance(tracks, dict) or not tracks:
        return None
    for lang in sorted(tracks.keys(), key=_lang_rank):
        entries = tracks.get(lang) or []
        if not isinstance(entries, list):
            continue
        for ext in ("json3", "vtt", "srv3", "srt", "ttml"):
            for entry in entries:
                if isinstance(entry, dict) and entry.get("ext") == ext and entry.get("url"):
                    return {"lang": lang, "ext": ext, "url": entry["url"]}
        for entry in entries:
            if isinstance(entry, dict) and entry.get("url"):
                return {"lang": lang, "ext": entry.get("ext") or "vtt", "url": entry["url"]}
    return None


def fetch_subtitle_text(track: Optional[Dict[str, Any]], max_chars: int) -> str:
    if not track:
        return ""
    try:
        res = requests.get(track["url"], headers={"User-Agent": DESKTOP_UA}, timeout=UPSTREAM_TIMEOUT_MS / 1000)
        if res.status_code != 200:
            return ""
        raw = res.text
    except Exception:
        return ""
    ext = track.get("ext")
    if ext == "json3":
        text = parse_json3(raw)
    else:
        text = parse_vtt(raw) if ext != "srt" else parse_srt(raw)
    return text[:max_chars]


# ─────────────────────────── 画面网址（OCR）提取与聚合（纯函数） ───────────────────────────

# TLD 白名单：只认这些后缀，避免把「1.2.3」「image.png」之类误当网址
_URL_TLDS = (
    "com", "cn", "net", "org", "io", "ai", "co", "me", "tv", "cc", "app", "dev",
    "xyz", "top", "info", "biz", "vip", "site", "online", "shop", "store", "tech",
    "cloud", "link", "live", "fun", "pro", "gov", "edu", "mil", "int", "la", "ly",
    "gl", "to", "so", "us", "uk", "jp", "hk", "tw", "sg", "de", "fr", "ru", "kr",
    "au", "ca", "nl", "se", "no", "fi", "dk", "it", "es", "ch", "at", "be", "pl",
    "cz", "pt", "gr", "ie", "nz", "in", "id", "my", "th", "vn", "ph", "br", "mx",
    "ar", "cl", "tr", "za", "ae", "sa", "il", "ir",
    # 品牌/项目常用 gTLD（ulink.ren 本身就是 .ren）
    "ren", "ink", "art", "blog", "wiki", "moe", "one", "world", "life", "space",
    "group", "team", "work", "design", "studio", "media", "news", "email", "video",
)
# 二级后缀（com.cn / co.uk ...）：必须先于单级后缀匹配
_URL_MULTI_TLDS = (
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
    "co.uk", "org.uk", "ac.uk", "co.jp", "ne.jp",
    "com.hk", "com.tw", "co.kr", "com.sg", "com.au", "co.nz",
    "com.br", "co.in", "com.my",
)
_ALL_URL_TLDS = tuple(sorted(set(_URL_TLDS) | set(_URL_MULTI_TLDS), key=len, reverse=True))
_TLD_ALTERNATION = "|".join(re.escape(t) for t in _ALL_URL_TLDS)

# http(s) 完整网址（宽松匹配，清洗阶段再裁剪标点）
_URL_SCHEME_RE = re.compile(r"(?i)\bhttps?://[^\s<>\"'`。，；、）】》」』]+")
# 无协议裸域名（含 www./m./wap. 前缀、可选端口与路径）
_URL_BARE_RE = re.compile(
    r"(?<![A-Za-z0-9@._-])"
    r"(?:(?:www|m|wap)\.)?"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"(?:" + _TLD_ALTERNATION + r")"
    r"(?![A-Za-z0-9-])"
    r"(?::\d{1,5})?"
    r"(?:/[^\s<>\"'`。，；、）】》」』]*)?",
    re.I,
)
_TRAILING_PUNCT = ".,;:!?、。，；：！？)]}>}」』】》\"'`~*…"
_LEADING_PUNCT = "([<{\"'`（【《「『"


def _host_has_known_tld(host: str) -> bool:
    h = (host or "").lower().rstrip(".")
    if "." not in h:
        return False
    return any(h.endswith("." + suffix) for suffix in _ALL_URL_TLDS)


def _clean_url_candidate(raw: str, bare: bool = False) -> str:
    """把 OCR 文本里的一段候选清洗成规范 URL；不是网址则返回空串。"""
    s = (raw or "").strip()
    if not s:
        return ""
    # 去首部标点 / 尾部标点（OCR 常把中文标点粘在网址后面）
    while s and s[0] in _LEADING_PUNCT:
        s = s[1:]
    while s and s[-1] in _TRAILING_PUNCT:
        s = s[:-1]
    if not s:
        return ""
    if bare and not re.match(r"(?i)^https?://", s):
        s = "https://" + s
    if not re.match(r"(?i)^https?://", s):
        return ""
    while s and s[-1] in _TRAILING_PUNCT:
        s = s[:-1]
    try:
        parts = urlsplit(s)
    except Exception:
        return ""
    host = (parts.hostname or "").lower().rstrip(".")
    if not host or "." not in host:
        return ""
    if host == "localhost" or _looks_like_ip(host):
        return ""
    if not _host_has_known_tld(host):
        return ""
    try:
        port = parts.port
    except ValueError:
        return ""
    if port is not None and not (0 < port < 65536):
        return ""
    netloc = host
    if port is not None and port not in (80, 443):
        netloc += ":" + str(port)
    path = parts.path or ""
    if path == "/" and not parts.query and not parts.fragment:
        path = ""
    out = parts.scheme.lower() + "://" + netloc + path
    if parts.query:
        out += "?" + parts.query
    if parts.fragment:
        out += "#" + parts.fragment
    return out


def _url_key(url: str) -> str:
    """聚合去重键：忽略协议与 www. 前缀，路径去尾斜杠（同一站点多个写法合并）。"""
    try:
        parts = urlsplit(url)
    except Exception:
        return (url or "").lower()
    host = (parts.hostname or "").lower().removeprefix("www.")
    key = host + (parts.path or "").rstrip("/")
    if parts.query:
        key += "?" + parts.query
    return key


def extract_urls_from_text(text: str) -> List[str]:
    """从一段 OCR 文本中提取网址（支持 http(s) 完整链接与无协议裸域名）。"""
    if not text:
        return []
    found: List[str] = []
    for match in _URL_SCHEME_RE.finditer(str(text)):
        url = _clean_url_candidate(match.group(0))
        if url:
            found.append(url)
    # 先抹掉已识别的完整链接，避免裸域名对同一位置重复命中
    remaining = _URL_SCHEME_RE.sub(" ", str(text))
    for match in _URL_BARE_RE.finditer(remaining):
        url = _clean_url_candidate(match.group(0), bare=True)
        if url:
            found.append(url)
    seen: set = set()
    result: List[str] = []
    for url in found:
        key = _url_key(url)
        if key in seen:
            continue
        seen.add(key)
        result.append(url)
    return result


def aggregate_url_votes(frames: List[List[Tuple[str, float]]]) -> List[Dict[str, Any]]:
    """跨帧投票聚合画面网址。

    frames: 每帧一组 (url, ocr_score)；返回 [{url, confidence, frames}]。
    confidence = 0.6 * (出现帧数/总帧数) + 0.4 * 平均 OCR 置信度，clamp [0,1]，保留两位。
    总帧数包含「没有识别到网址」的帧，因此偶发误识别不会拿到高置信度。
    """
    total_frames = max(1, len(frames))
    stats: Dict[str, Dict[str, Any]] = {}
    for frame in frames or []:
        hit_keys: set = set()
        for item in frame or []:
            try:
                url, score = item[0], item[1]
            except (TypeError, IndexError):
                continue
            url = str(url or "").strip()
            if not url:
                continue
            try:
                score = float(score)
            except (TypeError, ValueError):
                score = 0.0
            score = min(1.0, max(0.0, score))
            key = _url_key(url)
            entry = stats.setdefault(
                key,
                {"url": url, "frames": 0, "score_sum": 0.0, "score_n": 0},
            )
            entry["score_sum"] += score
            entry["score_n"] += 1
            hit_keys.add(key)
        for key in hit_keys:
            stats[key]["frames"] += 1
    out: List[Dict[str, Any]] = []
    for entry in stats.values():
        frame_ratio = entry["frames"] / total_frames
        avg_score = (entry["score_sum"] / entry["score_n"]) if entry["score_n"] else 0.0
        confidence = min(1.0, max(0.0, 0.6 * frame_ratio + 0.4 * avg_score))
        out.append(
            {
                "url": entry["url"],
                "confidence": round(confidence, 2),
                "frames": entry["frames"],
            }
        )
    out.sort(key=lambda item: (-item["frames"], -item["confidence"], item["url"]))
    return out


# ─────────────────────────── yt-dlp 链路 ───────────────────────────

_cookiefile_cache: Optional[str] = None

# ── B站免账号指纹 Cookie（对齐 yt-dlp PR #16889 / issue #14830）──
# B站对缺少 buvid3/buvid4/buvid_fp 指纹 Cookie 的请求返回 412（即使不登录）。
# 这里从 finger/spi 取 buvid3/4，自生成 buvid_fp，注入 yt-dlp 的 Cookie/Headers；
# 412 时换新指纹重试。账号 Cookie（YTDLP_COOKIES）仍可选，但不是必需。
_BILIBILI_HOST_SUFFIXES = ("bilibili.com", "b23.tv", "bili2233.cn", "bili22.cn", "bili33.cn")
_BILIBILI_HEADERS = {
    "Referer": "https://www.bilibili.com/",
    "Origin": "https://www.bilibili.com",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Sec-CH-UA": '"Google Chrome";v="148", "Chromium";v="148", "Not)A;Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Site": "same-site",
}
_BILI_FP_TTL_SECS = 1800
_bili_fp_lock = threading.Lock()
_bili_fp_cache: Dict[str, Any] = {"at": 0.0, "cookies": {}}

# ─── 浏览器扩展上报的媒体 CDN 白名单（与 cloudbase/functions/extract-video/index.js 同步）───
CLIENT_MEDIA_HOSTS: Dict[str, Tuple[str, ...]] = {
    "bilibili": ("bilivideo.com", "bilivideo.cn", "bilibili.com"),
    "douyin": ("douyinvod.com", "bytecdn.cn", "byteimg.com", "snssdk.com", "amemv.com", "zjcdn.com"),
    "xiaohongshu": ("xhscdn.com", "xhsimg.com"),
}
CLIENT_MEDIA_REFERERS: Dict[str, str] = {
    "bilibili": "https://www.bilibili.com/",
    "douyin": "https://www.douyin.com/",
    "xiaohongshu": "https://www.xiaohongshu.com/",
}


def _is_bilibili_url(url: str) -> bool:
    host = _host(url)
    return any(host == suffix or host.endswith("." + suffix) for suffix in _BILIBILI_HOST_SUFFIXES)


def _parse_proxy_text(text: str) -> str:
    """代理商提取接口返回 `ip:port`（可能带换行/空白）；返回 http://ip:port，非法返回空串。"""
    match = re.search(r"(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})", str(text or ""))
    if not match:
        return ""
    return "http://" + match.group(1) + ":" + match.group(2)


def _bilibili_proxy_url(force: bool = False) -> str:
    """调用 BILI_PROXY_API 取一个 B站专用动态代理（缓存 TTL 内复用），失败返回空串。"""
    if not BILI_PROXY_API:
        return ""
    with _bili_proxy_lock:
        now = time.time()
        if not force and _bili_proxy_cache["url"] and now - _bili_proxy_cache["at"] < BILI_PROXY_TTL_SECS:
            return str(_bili_proxy_cache["url"])
        try:
            response = requests.get(BILI_PROXY_API, timeout=10)
            proxy = _parse_proxy_text(response.text)
            if not proxy:
                _bili_proxy_cache["last_error"] = "invalid response: " + str(response.text or "")[:120]
        except Exception as exc:
            print("[worker] bili proxy api failed:", str(exc)[:160])
            _bili_proxy_cache["last_error"] = "request failed: " + str(exc)[:160]
            proxy = ""
        if proxy:
            _bili_proxy_cache.update({"at": now, "url": proxy, "last_error": ""})
            print("[worker] bili proxy refreshed:", proxy.rsplit("@", 1)[-1].split("//")[-1])
        return proxy


def _bilibili_fingerprint(force: bool = False) -> Dict[str, str]:
    """取/缓存 B站设备指纹 Cookie（buvid3/buvid4/buvid_fp）；finger API 失败时只给随机 buvid_fp。"""
    with _bili_fp_lock:
        now = time.time()
        if not force and _bili_fp_cache["cookies"] and now - _bili_fp_cache["at"] < _BILI_FP_TTL_SECS:
            return dict(_bili_fp_cache["cookies"])
        cookies: Dict[str, str] = {"buvid_fp": hashlib.md5(uuid.uuid4().bytes).hexdigest()}
        try:
            response = requests.get(
                "https://api.bilibili.com/x/frontend/finger/spi",
                headers={"User-Agent": DESKTOP_UA, **_BILIBILI_HEADERS},
                timeout=8,
            )
            if response.status_code == 200:
                data = (response.json() or {}).get("data") or {}
                if isinstance(data.get("b_3"), str) and data["b_3"]:
                    cookies["buvid3"] = data["b_3"]
                if isinstance(data.get("b_4"), str) and data["b_4"]:
                    cookies["buvid4"] = data["b_4"]
        except Exception as exc:
            print("[worker] bilibili finger api failed:", str(exc)[:200])
        _bili_fp_cache.update({"at": now, "cookies": cookies})
        return dict(cookies)


# ── B站 412 Challenge（对齐社区实现 0xvd/yt-dlp-exp@fix_bilibili）──
# 412 响应会下发 X-BILI-SEC-TOKEN（JWT）；解出 q/r 后暴力搜索 i 使 sha256(q+i)==r，
# 再 POST security.bilibili.com/th/captcha/cc/check 换新 token 写入 Cookie 即可通过。
# 纯标准库实现，不需要账号 / 代理 / 浏览器 JS 运行时。
_BILI_SEC_COOKIE = "X-BILI-SEC-TOKEN"
_bili_sec_lock = threading.Lock()
_bili_sec_cache: Dict[str, Any] = {"token": "", "exp": 0.0}


def _jwt_payload(token: str) -> Dict[str, Any]:
    try:
        part = str(token or "").split(".")[1]
        part += "=" * (-len(part) % 4)
        data = json.loads(base64.urlsafe_b64decode(part.encode("utf-8")).decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _bilibili_challenge_result(payload: Dict[str, Any], limit: int = 5_000_000) -> Optional[int]:
    """B站 412 的 SHA-256 工作量证明：找 i 使 sha256(q + i) == r。"""
    final_hash = payload.get("r") if isinstance(payload, dict) else None
    q = payload.get("q") if isinstance(payload, dict) else None
    if not isinstance(q, str) or not isinstance(final_hash, str):
        return None
    prefix = q
    for i in range(limit):
        if hashlib.sha256((prefix + str(i)).encode("utf-8")).hexdigest() == final_hash:
            return i
    return None


def _bilibili_cached_sec_token() -> str:
    with _bili_sec_lock:
        token = _bili_sec_cache.get("token") or ""
        exp = float(_bili_sec_cache.get("exp") or 0)
        if token and exp > time.time() + 300:
            return token
    return ""


def _bilibili_sec_token(url: str, force: bool = False) -> Optional[str]:
    """获取/刷新 B站 challenge 验证 Cookie 值（X-BILI-SEC-TOKEN），失败返回 None。"""
    cached = _bilibili_cached_sec_token()
    if cached and not force:
        return cached
    try:
        session = requests.Session()
        # 用与 yt-dlp 相同的指纹 Cookie 触发风控响应，才能拿到 412 下发的 challenge token；
        # 不带这些 Cookie 时 B站可能直接 200（但 yt-dlp 的请求仍会被 412）。
        for name, value in _bilibili_fingerprint().items():
            session.cookies.set(name, value, domain=".bilibili.com")
        headers = {"User-Agent": DESKTOP_UA, **_BILIBILI_HEADERS}
        bili_proxy = _bilibili_proxy_url()
        proxies = {"http": bili_proxy, "https": bili_proxy} if bili_proxy else None
        response = session.get(url, headers=headers, timeout=12, allow_redirects=True, proxies=proxies)
        token = session.cookies.get(_BILI_SEC_COOKIE) or response.cookies.get(_BILI_SEC_COOKIE)
        print(
            "[worker] bilibili challenge probe: status=%s token=%s"
            % (response.status_code, bool(token))
        )
        if not token:
            return None
        payload = _jwt_payload(token)
        result = _bilibili_challenge_result(payload)
        if result is None:
            print("[worker] bilibili challenge: no PoW result")
            return None
        check = requests.post(
            "https://security.bilibili.com/th/captcha/cc/check",
            data={"token": token, "result": result},
            headers={
                "User-Agent": DESKTOP_UA,
                "Referer": "https://www.bilibili.com/",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=12,
            proxies=proxies,
        )
        data = check.json() if check.status_code == 200 else {}
        if not isinstance(data, dict) or int(data.get("code", -1)) != 0:
            print("[worker] bilibili challenge rejected:", str(data)[:200])
            return None
        new_token = data.get("message")
        if not isinstance(new_token, str) or not new_token:
            return None
        exp = _jwt_payload(new_token).get("exp")
        exp = float(exp) if isinstance(exp, (int, float)) else time.time() + 1800
        with _bili_sec_lock:
            _bili_sec_cache.update({"token": new_token, "exp": exp})
        print("[worker] bilibili challenge solved, token cached")
        return new_token
    except Exception as exc:
        print("[worker] bilibili challenge failed:", str(exc)[:200])
        return None


def _write_bilibili_cookiefile(base_path: Optional[str], force: bool = False) -> Optional[str]:
    """生成合并 cookie 文件：用户 YTDLP_COOKIES（可选）+ B站指纹 Cookie。"""
    cookies = _bilibili_fingerprint(force)
    lines: List[str] = []
    if base_path and os.path.exists(base_path):
        try:
            with open(base_path, "r", encoding="utf-8") as handle:
                lines.extend(
                    line.rstrip("\n")
                    for line in handle
                    if line.strip() and not line.startswith("#")
                )
        except Exception:
            lines = []
    expiry = int(time.time()) + 7 * 24 * 3600
    existing = {line.split("\t")[5] for line in lines if line.count("\t") >= 6}
    for name, value in cookies.items():
        if name in existing:
            continue
        lines.append("\t".join([".bilibili.com", "TRUE", "/", "FALSE", str(expiry), name, value]))
    # challenge 验证 Cookie（若有缓存）：412 求解后写入，后续请求带上即可不再被拦
    sec_token = _bilibili_cached_sec_token()
    if sec_token and _BILI_SEC_COOKIE not in existing:
        lines.append(
            "\t".join([".bilibili.com", "TRUE", "/", "FALSE", str(expiry), _BILI_SEC_COOKIE, sec_token])
        )
    if not lines:
        return None
    fd, tmp = tempfile.mkstemp(prefix="ulink-bili-cookies-", suffix=".txt")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return tmp


def _apply_bilibili_fingerprint(opts: Dict[str, Any], target_url: str, force: bool = False) -> None:
    """给 yt-dlp 的 opts 注入 B站指纹 Cookie 与浏览器特征头（仅 B站链接生效）。"""
    if not _is_bilibili_url(target_url):
        return
    opts["http_headers"] = {**(opts.get("http_headers") or {}), **_BILIBILI_HEADERS}
    cookie_file = _write_bilibili_cookiefile(_prepare_cookiefile(), force=force)
    if cookie_file:
        opts["cookiefile"] = cookie_file


def _is_ytdlp_412(exc: BaseException) -> bool:
    text = str(exc)
    return "412" in text or "Precondition Failed" in text


def _bilibili_retry_hint(exc: BaseException) -> str:
    text = str(exc)
    if "v_voucher" in text or "验证" in text:
        return "B站要求 cookie 校验（v_voucher）：请配置 YTDLP_COOKIES（浏览器 Cookie）或稍后重试"
    return "B站触发 412 风控（已尝试指纹、challenge 与代理）：请检查 BILI_PROXY_API 是否配置/额度是否用尽"


def _prepare_cookiefile() -> Optional[str]:
    """支持两种 Cookie 注入方式（抖音/YouTube 风控时必需）：
    1. YTDLP_COOKIES_FILE：挂载的 Netscape 格式 cookies.txt 路径；
    2. YTDLP_COOKIES：直接给整段 Netscape cookies 文本（自动落临时文件）。"""
    global _cookiefile_cache
    if _cookiefile_cache:
        return _cookiefile_cache
    path = os.environ.get("YTDLP_COOKIES_FILE", "").strip()
    if path and os.path.exists(path):
        _cookiefile_cache = path
        return path
    text = os.environ.get("YTDLP_COOKIES", "").strip()
    if text:
        fd, tmp = tempfile.mkstemp(prefix="ulink-cookies-", suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        _cookiefile_cache = tmp
        return tmp
    return None


def _build_ydl_opts(
    proxy: Optional[str],
    include_comments: bool = False,
    target_url: str = "",
    force_fresh_fp: bool = False,
) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": UPSTREAM_TIMEOUT_MS / 1000,
        "retries": 1,
        "http_headers": {"User-Agent": DESKTOP_UA},
    }
    if include_comments:
        # 评论抓取显著拖慢速度，仅在调用方显式 include_comments=true 时开启
        opts["getcomments"] = True
    cookie = _prepare_cookiefile()
    if cookie:
        opts["cookiefile"] = cookie
    if target_url:
        _apply_bilibili_fingerprint(opts, target_url, force=force_fresh_fp)
    if proxy:
        opts["proxy"] = proxy
    if target_url and _is_bilibili_url(target_url):
        # B站专用动态代理优先（仅 B站走代理；其它平台保持直连）
        bili_proxy = _bilibili_proxy_url()
        if bili_proxy:
            opts["proxy"] = bili_proxy
    return opts


def extract_with_ytdlp(
    target_url: str,
    include_subtitles: bool,
    max_chars: int,
    include_comments: bool = False,
) -> Optional[VideoExtractResponse]:
    if not yt_dlp:
        return None
    proxy = YTDLP_PROXY or None
    info = None
    last_exc: Optional[BaseException] = None
    # B站 412：换新指纹重试（最多 3 次）；其它平台/错误直接失败交给浏览器兜底
    for attempt in range(3):
        try:
            with yt_dlp.YoutubeDL(
                _build_ydl_opts(proxy, include_comments, target_url, force_fresh_fp=attempt > 0)
            ) as ydl:
                info = ydl.extract_info(target_url, download=False)
            last_exc = None
            break
        except Exception as exc:  # token 失效 / 风控 / 网络异常：交给浏览器兜底
            last_exc = exc
            if _is_bilibili_url(target_url) and _is_ytdlp_412(exc) and attempt < 2:
                # 先解 challenge（PoW）拿 X-BILI-SEC-TOKEN，再换新指纹重试
                _bilibili_sec_token(target_url, force=True)
                time.sleep(1.2 * (attempt + 1))
                continue
            break
    if last_exc is not None:
        error_text = str(last_exc)[:300]
        if _is_bilibili_url(target_url) and _is_ytdlp_412(last_exc):
            error_text = _bilibili_retry_hint(last_exc)
        return VideoExtractResponse(
            success=False,
            source=detect_platform(target_url),
            url=target_url,
            title="",
            description="",
            subtitles="",
            provider="yt-dlp",
            error=error_text,
        )
    if not info:
        return None

    # yt-dlp 可能返回 playlist，取第一条视频
    if info.get("entries"):
        entries = [e for e in info["entries"] if e]
        info = entries[0] if entries else info

    chapters: List[Dict[str, Any]] = []
    for ch in info.get("chapters") or []:
        if isinstance(ch, dict):
            chapters.append(
                {
                    "title": ch.get("title", ""),
                    "start_time": ch.get("start_time", 0),
                    "end_time": ch.get("end_time", 0),
                }
            )

    comments: List[str] = []
    if include_comments and COMMENT_LIMIT > 0:
        for c in (info.get("comments") or [])[:COMMENT_LIMIT]:
            if isinstance(c, dict):
                text = c.get("text") or ""
                if text and len(text) > 2:
                    comments.append(text[:200])

    subtitles = ""
    if include_subtitles:
        # 优先平台自带字幕（人工校对），没有再退回自动字幕；轨道按「中文 > 英文」挑
        tracks = info.get("subtitles") or {}
        track = pick_subtitle_track(tracks)
        if not track:
            track = pick_subtitle_track(info.get("automatic_captions") or {})
        subtitles = fetch_subtitle_text(track, max_chars)

    extractor = str(info.get("extractor") or "").lower() or detect_platform(target_url)
    return VideoExtractResponse(
        success=True,
        source=extractor,
        url=info.get("webpage_url") or target_url,
        title=(info.get("title") or "").strip(),
        description=(info.get("description") or "").strip(),
        subtitles=subtitles,
        chapters=chapters,
        comments=comments,
        duration=info.get("duration"),
        uploader=info.get("uploader") or info.get("channel"),
        provider="yt-dlp",
    )


# ─────────────────────────── 浏览器兜底链路 ───────────────────────────


def _clean_browser_title(title: str) -> str:
    cleaned = title or ""
    cleaned = re.sub(r"\s*[-–—|]\s*(抖音|小红书|TikTok|哔哩哔哩|bilibili|YouTube)\s*$", "", cleaned, flags=re.I)
    return _normalize_text(cleaned)


# 平台风控/空壳页的通用标题：出现这些说明页面没渲染出真实视频信息，不能当成功结果
MEANINGLESS_TITLES = (
    "记录美好生活",
    "在抖音记录美好生活",
    "抖音-记录美好生活",
    "你的生活指南",
    "小红书-你的生活指南",
    "Make Your Day",
    "抖音",
    "小红书",
    "TikTok",
)


def _is_meaningless_text(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    if len(t) <= 2:
        return True
    return any(t == p or p in t for p in MEANINGLESS_TITLES)


async def _ensure_browser():
    """懒加载常驻浏览器上下文（首次调用启动 Chromium 并复用 profile）"""
    global _pw, _browser_ctx
    if not async_playwright or not BROWSER_ENABLED:
        return None
    if _browser_ctx is not None:
        return _browser_ctx
    if _pw is None:
        _pw = await async_playwright().start()
    launch_kwargs: Dict[str, Any] = {
        "headless": True,
        "user_agent": DESKTOP_UA,
        "locale": "zh-CN",
        "viewport": {"width": 1280, "height": 800},
        "args": [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--mute-audio",
            # 去掉 navigator.webdriver 特征，抖音/小红书对自动化标记的降级很敏感
            "--disable-blink-features=AutomationControlled",
        ],
    }
    # 生产容器用镜像内自带的 chromium；宿主机调试时可指向本机 Chrome/Edge
    chrome_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", "").strip()
    if chrome_path:
        launch_kwargs["executable_path"] = chrome_path
    os.makedirs(PROFILE_DIR, exist_ok=True)
    _browser_ctx = await _pw.chromium.launch_persistent_context(PROFILE_DIR, **launch_kwargs)
    # 持久化上下文自带一个空白页，关掉避免资源浪费
    for extra in list(_browser_ctx.pages):
        try:
            await extra.close()
        except Exception:
            pass
    return _browser_ctx


async def _warmup(ctx, platform: str) -> None:
    """进入详情页前先访问平台首页：拿到风控 Cookie，避免详情页只渲染出空壳"""
    home = PLATFORM_HOME.get(platform)
    if not home or platform in _warmed_platforms:
        return
    page = None
    try:
        page = await ctx.new_page()
        # 首页只做会话预热，超时宁短勿长（失败也不影响后续详情页）
        await page.goto(home, wait_until="domcontentloaded", timeout=min(BROWSER_TIMEOUT_MS, 12000))
        await page.wait_for_timeout(2500)
    except Exception:
        pass
    finally:
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
    _warmed_platforms.add(platform)


MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)


async def _mobile_page_snapshot(url: str) -> Optional[Dict[str, Any]]:
    """移动端 UA 再试一次：部分平台对桌面无头浏览器的降级更激进"""
    if _pw is None:
        return None
    launch_kwargs: Dict[str, Any] = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--disable-blink-features=AutomationControlled"],
    }
    chrome_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", "").strip()
    if chrome_path:
        launch_kwargs["executable_path"] = chrome_path
    browser = None
    try:
        browser = await _pw.chromium.launch(**launch_kwargs)
        ctx = await browser.new_context(
            user_agent=MOBILE_UA,
            locale="zh-CN",
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
        )
        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=BROWSER_TIMEOUT_MS)
        await page.wait_for_timeout(BROWSER_SETTLE_MS)
        return await page.evaluate(
            """() => {
              const meta = (name) => {
                const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                return el ? el.getAttribute('content') || '' : '';
              };
              return {
                title: document.title || '',
                desc: meta('og:description') || meta('description') || '',
                bodyLen: document.body ? document.body.innerText.length : 0,
                body: document.body ? document.body.innerText.slice(0, 120) : '',
              };
            }"""
        )
    except Exception:
        return None
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass


async def extract_with_browser(target_url: str) -> Optional[VideoExtractResponse]:
    """无头浏览器抓取渲染后的标题/简介（抖音、小红书、TikTok 等页面型平台）"""
    global _last_browser_diag
    if not async_playwright or not BROWSER_ENABLED:
        return None

    platform = detect_platform(target_url)
    # 浏览器上下文非线程安全，串行使用
    async with _browser_lock:
        _last_browser_diag = ""
        diag: List[str] = []
        try:
            ctx = await _ensure_browser()
            if ctx is None:
                _last_browser_diag = "browser context unavailable"
                return None
            await _warmup(ctx, platform)

            for attempt in range(2):
                page = None
                snapshot: Dict[str, Any] = {}
                status = None
                try:
                    page = await ctx.new_page()
                    res = await page.goto(target_url, wait_until="domcontentloaded", timeout=BROWSER_TIMEOUT_MS)
                    status = res.status if res else None
                    # 等标题渲染出来（抖音详情页是客户端渲染，冷启动时 title 可能长时间为空）
                    try:
                        await page.wait_for_function(
                            "document.title && document.title.trim().length > 5",
                            timeout=min(BROWSER_TIMEOUT_MS, 8000),
                        )
                    except Exception:
                        pass
                    await page.wait_for_timeout(BROWSER_SETTLE_MS)
                    snapshot = await page.evaluate(
                        """() => {
                          const meta = (name) => {
                            const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                            return el ? el.getAttribute('content') || '' : '';
                          };
                          return {
                            title: document.title || '',
                            desc: meta('og:description') || meta('description') || '',
                            finalUrl: location.href,
                            bodyLen: document.body ? document.body.innerText.length : 0,
                            body: document.body ? document.body.innerText.slice(0, 120) : '',
                          };
                        }"""
                    )
                except Exception as exc:
                    diag.append(f"desktop#{attempt}: goto/read error {str(exc)[:80]}")
                    snapshot = {}
                finally:
                    if page is not None:
                        try:
                            await page.close()
                        except Exception:
                            pass
                title = _clean_browser_title(snapshot.get("title") or "")
                meta_desc = _clean_browser_title(snapshot.get("desc") or "")
                if _is_meaningless_text(title) and _is_meaningless_text(meta_desc):
                    diag.append(
                        "desktop#%d: status=%s title='%s' body=%s '%s'"
                        % (
                            attempt,
                            status,
                            title[:40],
                            snapshot.get("bodyLen"),
                            str(snapshot.get("body") or "").replace("\n", " ")[:60],
                        )
                    )
                    continue
                # 抖音分享标题本身就是完整文案（含话题标签）；og:description 会混入
                # 「XX 于 2026xx 发布…已收获 N 个喜欢」等平台装饰语，故以标题为准
                description = title if platform == "douyin" else (meta_desc or title)
                if not description:
                    description = title
                if len(title) > 160:
                    title = title[:160]
                return VideoExtractResponse(
                    success=True,
                    source=platform,
                    url=target_url,
                    title=title,
                    description=description[:MAX_TEXT_CHARS],
                    subtitles="",
                    provider="browser",
                )

            # 桌面无头被风控时，用移动端 UA 再试一次
            mobile = await _mobile_page_snapshot(target_url)
            if mobile:
                m_title = _clean_browser_title(mobile.get("title") or "")
                m_desc = _clean_browser_title(mobile.get("desc") or "")
                if not _is_meaningless_text(m_title) or not _is_meaningless_text(m_desc):
                    return VideoExtractResponse(
                        success=True,
                        source=platform,
                        url=target_url,
                        title=(m_title if not _is_meaningless_text(m_title) else m_desc)[:160],
                        description=(m_title if platform == "douyin" else (m_desc or m_title))[:MAX_TEXT_CHARS],
                        subtitles="",
                        provider="browser",
                    )
                diag.append(
                    "mobile: title='%s' body=%s '%s'"
                    % (m_title[:40], mobile.get("bodyLen"), str(mobile.get("body") or "").replace("\n", " ")[:60])
                )

            _last_browser_diag = " | ".join(diag)[:400]
            return None
        except Exception:
            # 浏览器崩溃：丢弃上下文，下次请求重建
            global _browser_ctx
            try:
                if _browser_ctx is not None:
                    await _browser_ctx.close()
            except Exception:
                pass
            _browser_ctx = None
            _last_browser_diag = "browser crashed"
            return None


# ─────────────────────────── 深度任务：任务表 / 线程池 ───────────────────────────

_jobs_lock = threading.Lock()
_jobs: Dict[str, Dict[str, Any]] = {}
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
MAX_KEPT_JOBS = 200


class DeepTaskError(Exception):
    """深度任务的可归因失败（error.code 取契约枚举）。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _new_job_id() -> str:
    return secrets.token_hex(16)


def _is_valid_job_id(job_id: str) -> bool:
    return bool(re.match(r"^[0-9a-f]{32}$", job_id or ""))


def resolve_include_request(
    transcript: Optional[bool],
    ocr: Optional[bool],
    asr_provider: Optional[str] = None,
    ocr_enabled: Optional[bool] = None,
) -> Dict[str, bool]:
    """解析 include 缺省值（纯函数，便于自测）。

    缺省语义（契约 §3）：
    - transcript 缺省 = ASR provider 已配置；
    - ocr 缺省 = WORKER_OCR_ENABLED；
    - 两者都 false 时调用方应拒绝该任务（否则任务无事可做）。
    """
    provider = ASR_PROVIDER if asr_provider is None else asr_provider
    if transcript is None:
        # 未显式指定时按「当前 provider 真的可用」判定（mimo 缺 key 时不要假装能做转写）
        want_transcript = _asr_ready() if asr_provider is None else (provider != "none")
    else:
        want_transcript = bool(transcript)
    if ocr is None:
        want_ocr = _ocr_ready() if ocr_enabled is None else bool(ocr_enabled)
    else:
        want_ocr = bool(ocr)
    return {"transcript": want_transcript, "ocr": want_ocr}


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=DEEP_CONCURRENCY, thread_name_prefix="deep-job")
        return _executor


def _shutdown_executor() -> None:
    global _executor
    with _executor_lock:
        executor, _executor = _executor, None
    if executor is not None:
        try:
            executor.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass


def _update_job(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = time.time()


def _set_progress(job_id: str, progress: float, stage: Optional[str] = None) -> None:
    updates: Dict[str, Any] = {"progress": round(min(1.0, max(0.0, progress)), 3)}
    if stage:
        updates["stage"] = stage
    _update_job(job_id, **updates)


def _cleanup_jobs_locked(now: Optional[float] = None) -> None:
    now = now or time.time()
    expired = [
        job_id
        for job_id, job in _jobs.items()
        if job.get("status") in ("done", "failed")
        and now - float(job.get("updated_at") or job.get("created_at") or now) > DEEP_JOB_TTL_SECS
    ]
    for job_id in expired:
        _jobs.pop(job_id, None)
    if len(_jobs) > MAX_KEPT_JOBS:
        finished = sorted(
            ((job_id, job) for job_id, job in _jobs.items() if job.get("status") in ("done", "failed")),
            key=lambda kv: float(kv[1].get("updated_at") or kv[1].get("created_at") or 0.0),
        )
        for job_id, _job in finished[: max(0, len(_jobs) - MAX_KEPT_JOBS)]:
            _jobs.pop(job_id, None)


def _job_public(job: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "job_id": job.get("job_id"),
        "status": job.get("status"),
        "progress": round(float(job.get("progress") or 0.0), 3),
        "stage": job.get("stage"),
    }
    if job.get("error"):
        payload["error"] = job["error"]
    if job.get("result") is not None:
        payload["result"] = job["result"]
    return payload


# ─────────────────────────── 深度任务：媒体下载 / 转码 / ASR / OCR ───────────────────────────


def _remaining(deadline: float) -> float:
    return max(0.0, float(deadline) - time.time())


def _check_deadline(deadline: float, message: str = "深度任务超过 WORKER_DEEP_TIMEOUT_SECS 限制") -> None:
    if time.time() > deadline:
        raise DeepTaskError("internal", message)


def _as_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _deep_ydl_opts(deadline: float, target_url: str = "", force_fresh_fp: bool = False) -> Dict[str, Any]:
    timeout = max(5.0, min(30.0, _remaining(deadline) or 5.0))
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "retries": 1,
        "socket_timeout": timeout,
        "http_headers": {"User-Agent": DESKTOP_UA},
    }
    cookie = _prepare_cookiefile()
    if cookie:
        opts["cookiefile"] = cookie
    if target_url:
        _apply_bilibili_fingerprint(opts, target_url, force=force_fresh_fp)
    if YTDLP_PROXY:
        opts["proxy"] = YTDLP_PROXY
    if target_url and _is_bilibili_url(target_url):
        bili_proxy = _bilibili_proxy_url()
        if bili_proxy:
            opts["proxy"] = bili_proxy
    return opts


def _deep_probe(url: str, deadline: float) -> Dict[str, Any]:
    """yt-dlp 元数据探测（不下载）：拿到标题/时长/上传者，并用于时长上限判定。"""
    _check_deadline(deadline)
    if not yt_dlp:
        raise DeepTaskError("download_failed", "yt-dlp 未安装，无法执行深度解析")
    info = None
    last_exc: Optional[BaseException] = None
    for attempt in range(3):
        opts = _deep_ydl_opts(deadline, url, force_fresh_fp=attempt > 0)
        opts["skip_download"] = True
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
            if _is_bilibili_url(url) and _is_ytdlp_412(exc) and attempt < 2:
                _bilibili_sec_token(url, force=True)
                time.sleep(1.2 * (attempt + 1))
                continue
            break
    if last_exc is not None:
        hint = _bilibili_retry_hint(last_exc) if _is_bilibili_url(url) else str(last_exc)[:240]
        raise DeepTaskError("download_failed", f"yt-dlp 元数据抽取失败：{hint}")
    if not info:
        raise DeepTaskError("download_failed", "yt-dlp 未返回视频信息")
    if info.get("entries"):
        entries = [entry for entry in info["entries"] if entry]
        if entries:
            info = entries[0]
    return info


def _list_files(directory: str) -> set:
    if not os.path.isdir(directory):
        return set()
    return {
        os.path.join(directory, name)
        for name in os.listdir(directory)
        if os.path.isfile(os.path.join(directory, name))
    }


def _progress_hook(job_id: str, deadline: float, max_bytes: int, base: float, span: float):
    def hook(payload: Any) -> None:
        _check_deadline(deadline)
        if not isinstance(payload, dict) or payload.get("status") != "downloading":
            return
        total = payload.get("total_bytes") or payload.get("total_bytes_estimate") or 0
        done = payload.get("downloaded_bytes") or 0
        if total and int(total) > max_bytes:
            raise DeepTaskError("too_long", f"媒体体积超过上限 {DEEP_MAX_MB}MB")
        if done and int(done) > max_bytes:
            raise DeepTaskError("too_long", f"媒体体积超过上限 {DEEP_MAX_MB}MB")
        if total:
            _set_progress(job_id, base + span * min(1.0, float(done) / float(total)))

    return hook


def _deep_download(
    url: str,
    tmpdir: str,
    deadline: float,
    kind: str,
    max_bytes: int,
    job_id: str,
    progress_base: float,
    progress_span: float,
) -> str:
    """用 yt-dlp 下载媒体（kind=audio -> bestaudio；kind=video -> ≤720p 视频），返回本地文件路径。"""
    _check_deadline(deadline)
    if not yt_dlp:
        raise DeepTaskError("download_failed", "yt-dlp 未安装，无法下载音视频")
    before = _list_files(tmpdir)
    label = "音频" if kind == "audio" else "视频"
    last_exc: Optional[BaseException] = None
    for attempt in range(3):
        opts = _deep_ydl_opts(deadline, url, force_fresh_fp=attempt > 0)
        opts["outtmpl"] = os.path.join(tmpdir, kind + "-%(id)s.%(ext)s")
        opts["max_filesize"] = int(max_bytes)
        if kind == "audio":
            opts["format"] = "bestaudio/best"
        else:
            opts["format"] = "bestvideo[height<=720]+bestaudio/best[height<=720]/worst"
            opts["merge_output_format"] = "mp4"
        opts["progress_hooks"] = [_progress_hook(job_id, deadline, max_bytes, progress_base, progress_span)]
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.extract_info(url, download=True)
            last_exc = None
            break
        except DeepTaskError:
            raise
        except Exception as exc:
            last_exc = exc
            if _is_bilibili_url(url) and _is_ytdlp_412(exc) and attempt < 2:
                _bilibili_sec_token(url, force=True)
                time.sleep(1.2 * (attempt + 1))
                continue
            break
    if last_exc is not None:
        message = str(last_exc)
        if "超过上限" in message or "too large" in message.lower() or "filesize" in message.lower():
            raise DeepTaskError("too_long", f"媒体体积超过上限 {DEEP_MAX_MB}MB")
        if "WORKER_DEEP_TIMEOUT_SECS" in message or "超时" in message or "timeout" in message.lower():
            raise DeepTaskError("internal", "深度任务下载超时")
        if _is_bilibili_url(url) and _is_ytdlp_412(last_exc):
            raise DeepTaskError("download_failed", f"{label}下载失败：{_bilibili_retry_hint(last_exc)}")
        raise DeepTaskError("download_failed", f"{label}下载失败：{message[:240]}")

    new_files = _list_files(tmpdir) - before
    candidates = [path for path in new_files if os.path.getsize(path) > 0]
    if not candidates:
        if kind == "audio":
            raise DeepTaskError("no_audio", "未下载到音频文件（该视频可能无音频流）")
        raise DeepTaskError("download_failed", "未下载到视频文件")
    candidates.sort(key=os.path.getsize, reverse=True)
    path = candidates[0]
    if os.path.getsize(path) > max_bytes:
        raise DeepTaskError("too_long", f"媒体体积超过上限 {DEEP_MAX_MB}MB")
    return path


def _run_ffmpeg(
    args: List[str],
    timeout: float,
    allow_failure: bool = False,
    error_code: str = "internal",
    err_prefix: str = "ffmpeg 执行失败",
) -> bool:
    if not _ffmpeg_ready():
        if allow_failure:
            return False
        raise DeepTaskError("internal", "ffmpeg 未安装（深度解析需要 ffmpeg）")
    command = [FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y"] + list(args)
    try:
        proc = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=max(1.0, float(timeout)),
        )
    except subprocess.TimeoutExpired:
        if allow_failure:
            return False
        raise DeepTaskError(error_code, err_prefix + "：执行超时")
    except Exception as exc:
        if allow_failure:
            return False
        raise DeepTaskError(error_code, err_prefix + "：" + str(exc)[:200])
    if proc.returncode != 0:
        if allow_failure:
            return False
        tail = (proc.stderr or "")[-300:].strip()
        raise DeepTaskError(error_code, err_prefix + "：" + (tail or "returncode=" + str(proc.returncode)))
    return True


def _to_wav(src_path: str, tmpdir: str, deadline: float) -> str:
    """ffmpeg 转 16kHz 单声道 wav（ASR 标准输入格式）。"""
    _check_deadline(deadline)
    out_path = os.path.join(tmpdir, "audio-16k-mono.wav")
    ok = _run_ffmpeg(
        ["-i", src_path, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", out_path],
        timeout=min(_remaining(deadline), 180),
        error_code="no_audio",
        err_prefix="ffmpeg 音频转码失败",
    )
    if not ok or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise DeepTaskError("no_audio", "音频转码结果为空（可能没有音轨）")
    return out_path


def _get_whisper_model():
    """懒加载 faster-whisper 模型（首次调用可能耗时数十秒，仅在 worker 内复用）。"""
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise DeepTaskError(
                "asr_unavailable",
                "faster-whisper 未安装（需 requirements-deep.txt + Dockerfile INSTALL_DEEP=1）",
            )
        try:
            _whisper_model = WhisperModel(
                ASR_MODEL,
                device=ASR_DEVICE,
                compute_type=ASR_COMPUTE_TYPE,
            )
        except Exception as exc:
            raise DeepTaskError("asr_failed", f"faster-whisper 模型加载失败：{str(exc)[:200]}")
        return _whisper_model


def _asr_faster_whisper(wav_path: str, deadline: float) -> Dict[str, Any]:
    model = _get_whisper_model()
    kwargs: Dict[str, Any] = {"vad_filter": True}
    if ASR_LANGUAGE:
        kwargs["language"] = ASR_LANGUAGE
    try:
        segments_iter, info = model.transcribe(wav_path, **kwargs)
        texts: List[str] = []
        segments: List[Dict[str, Any]] = []
        for seg in segments_iter:
            _check_deadline(deadline)
            text = str(getattr(seg, "text", "") or "").strip()
            if not text:
                continue
            segments.append(
                {
                    "start": round(float(getattr(seg, "start", 0.0) or 0.0), 2),
                    "end": round(float(getattr(seg, "end", 0.0) or 0.0), 2),
                    "text": text,
                }
            )
            texts.append(text)
    except DeepTaskError:
        raise
    except Exception as exc:
        raise DeepTaskError("asr_failed", f"faster-whisper 转写失败：{str(exc)[:240]}")
    if not segments:
        raise DeepTaskError("asr_failed", "faster-whisper 未产出任何转写文本")
    language = getattr(info, "language", None) or ASR_LANGUAGE or None
    return {
        "text": _normalize_text(" ".join(texts))[:DEEP_TRANSCRIPT_MAX_CHARS],
        "segments": segments,
        "provider": "faster_whisper",
        "language": language,
    }


def _asr_http(wav_path: str, deadline: float) -> Dict[str, Any]:
    """OpenAI 兼容 /v1/audio/transcriptions（音频会离开本服务，隐私政策需披露）。"""
    if not ASR_HTTP_URL:
        raise DeepTaskError("asr_unavailable", "WORKER_ASR_PROVIDER=http 但 WORKER_ASR_HTTP_URL 未配置")
    timeout = max(10.0, min(_remaining(deadline) or ASR_HTTP_TIMEOUT_SECS, ASR_HTTP_TIMEOUT_SECS))
    data: Dict[str, Any] = {"model": ASR_HTTP_MODEL, "response_format": "verbose_json"}
    if ASR_LANGUAGE:
        data["language"] = ASR_LANGUAGE
    headers: Dict[str, str] = {}
    if ASR_HTTP_TOKEN:
        headers["Authorization"] = "Bearer " + ASR_HTTP_TOKEN
    try:
        with open(wav_path, "rb") as handle:
            response = requests.post(
                ASR_HTTP_URL,
                headers=headers,
                data=data,
                files={"file": ("audio.wav", handle, "audio/wav")},
                timeout=timeout,
            )
    except Exception as exc:
        raise DeepTaskError("asr_failed", f"ASR HTTP 请求失败：{str(exc)[:240]}")
    if response.status_code != 200:
        raise DeepTaskError(
            "asr_failed",
            f"ASR HTTP 返回 {response.status_code}：{response.text[:200]}",
        )
    try:
        payload = response.json()
    except Exception:
        text = (response.text or "").strip()
        if not text:
            raise DeepTaskError("asr_failed", "ASR HTTP 返回为空")
        return {
            "text": text[:DEEP_TRANSCRIPT_MAX_CHARS],
            "segments": [],
            "provider": "http",
            "language": ASR_LANGUAGE or None,
        }
    if not isinstance(payload, dict):
        raise DeepTaskError("asr_failed", "ASR HTTP 返回结构异常")
    text = str(payload.get("text") or "").strip()
    segments: List[Dict[str, Any]] = []
    for seg in payload.get("segments") or []:
        if not isinstance(seg, dict):
            continue
        seg_text = str(seg.get("text") or "").strip()
        if not seg_text:
            continue
        segments.append(
            {
                "start": round(float(seg.get("start") or 0.0), 2),
                "end": round(float(seg.get("end") or 0.0), 2),
                "text": seg_text,
            }
        )
    if not text and segments:
        text = " ".join(item["text"] for item in segments)
    if not text:
        raise DeepTaskError("asr_failed", "ASR HTTP 未返回转写文本")
    return {
        "text": text[:DEEP_TRANSCRIPT_MAX_CHARS],
        "segments": segments,
        "provider": "http",
        "language": payload.get("language") or ASR_LANGUAGE or None,
    }


# ── MiMo 多模态通道（ASR / 画面理解）──
# 设计取舍：模型调用放在 worker（而不是云函数转发层），原因是 mimo-chat 的单条消息 4000 字符
# 与 128MB/90s 限制装不下 base64 音频/图片；worker 直连可以只受本文件的任务上限约束。
_MIMO_VISION_PROMPT = (
    "你是严格的 OCR 与网址提取器。只提取图片中**逐字出现**的网址或域名"
    "（包括屏幕角标、水印、简介、评论区、字幕条里的网址）；"
    "不要补全协议、不要猜测、不要纠正拼写、不要输出图片里没有的内容。"
    "每行输出一个网址；没有任何网址时只输出 NONE。"
)


def parse_mimo_content(payload: Any) -> str:
    """从 chat/completions 响应里取文本（content 可能是 str，也可能是分段数组）。"""
    try:
        choices = payload.get("choices") or []
        message = (choices[0] or {}).get("message") or {}
        content = message.get("content")
    except Exception:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "".join(parts).strip()
    return ""


def _mimo_post(payload: Dict[str, Any], deadline: float, error_code: str = "asr_failed") -> Dict[str, Any]:
    """调用 MiMo OpenAI 兼容接口：429/5xx 退避重试，超时/网络错误结构化上报。"""
    if not MIMO_API_KEY:
        raise DeepTaskError(error_code.replace("_failed", "_unavailable"), "未配置 MIMO_API_KEY")
    if not MIMO_BASE_URL:
        raise DeepTaskError(error_code.replace("_failed", "_unavailable"), "未配置 MIMO_BASE_URL")
    url = MIMO_BASE_URL + "/chat/completions"
    headers = {"Authorization": "Bearer " + MIMO_API_KEY, "Content-Type": "application/json"}
    last_error = ""
    for attempt in range(MIMO_MAX_RETRIES + 1):
        _check_deadline(deadline)
        timeout = max(5.0, min(_remaining(deadline) or MIMO_TIMEOUT_SECS, MIMO_TIMEOUT_SECS))
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=timeout)
        except Exception as exc:
            last_error = "MiMo 请求失败：%s" % str(exc)[:200]
            if attempt >= MIMO_MAX_RETRIES:
                break
            time.sleep(min(2.0 * (attempt + 1), max(0.5, (_remaining(deadline) or 5.0) - 1)))
            continue
        if response.status_code == 200:
            try:
                data = response.json()
            except Exception:
                raise DeepTaskError(error_code, "MiMo 返回非 JSON")
            if not isinstance(data, dict):
                raise DeepTaskError(error_code, "MiMo 返回结构异常")
            return data
        last_error = "MiMo HTTP %d：%s" % (response.status_code, (response.text or "")[:200])
        if response.status_code in (429, 500, 502, 503, 504) and attempt < MIMO_MAX_RETRIES:
            time.sleep(min(3.0 * (attempt + 1), max(0.5, (_remaining(deadline) or 5.0) - 1)))
            continue
        break
    raise DeepTaskError(error_code, last_error[:300])


def _to_mp3_chunks(wav_path: str, tmpdir: str, deadline: float) -> List[str]:
    """把 16k 单声道 wav 按 MIMO_ASR_CHUNK_SECS 切成 mp3 分片（体积小、便于 base64）。"""
    out_dir = os.path.join(tmpdir, "asr-chunks")
    os.makedirs(out_dir, exist_ok=True)
    pattern = os.path.join(out_dir, "chunk_%03d.mp3")
    _run_ffmpeg(
        [
            "-i", wav_path,
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
            "-f", "segment", "-segment_time", str(MIMO_ASR_CHUNK_SECS),
            pattern,
        ],
        timeout=min(_remaining(deadline) or 180, 180),
        error_code="asr_failed",
        err_prefix="ASR 音频分片失败",
    )
    chunks = sorted(
        os.path.join(out_dir, name) for name in os.listdir(out_dir) if name.lower().endswith(".mp3")
    )
    if not chunks:
        raise DeepTaskError("asr_failed", "ASR 音频分片结果为空")
    return chunks


def _audio_data_url(path: str) -> Tuple[str, str]:
    """音频文件 → (data URL MIME, format)。MiMo ASR 仅支持 wav / mp3，且 base64 上限 10MB。"""
    if path.lower().endswith(".wav"):
        return "audio/wav", "wav"
    return "audio/mpeg", "mp3"


def _asr_mimo(wav_path: str, deadline: float) -> Dict[str, Any]:
    """MiMo 语音识别：mp3 分片 + data URL + chat/completions(input_audio)。

    注意：MiMo ASR 只返回文本、不返回时间戳，segments 恒为空；调用方据此标 degraded。
    """
    global _LAST_MIMO_ASR_AT
    chunks = _to_mp3_chunks(wav_path, os.path.dirname(wav_path), deadline)
    texts: List[str] = []
    language = ASR_LANGUAGE or "auto"
    for chunk_path in chunks:
        _check_deadline(deadline)
        # 控速：分片串行 + 最小间隔，避免撞 ASR 模型的 RPM/TPM（文档：TPM 10k）
        with _MIMO_ASR_PACE_LOCK:
            wait = MIMO_ASR_MIN_INTERVAL_SECS - (time.time() - _LAST_MIMO_ASR_AT)
            if wait > 0:
                time.sleep(min(wait, max(0.0, (_remaining(deadline) or 0.0) - 1)))
            _LAST_MIMO_ASR_AT = time.time()
        with open(chunk_path, "rb") as handle:
            audio_b64 = base64.b64encode(handle.read()).decode("ascii")
        mime, audio_format = _audio_data_url(chunk_path)
        payload = {
            "model": MIMO_ASR_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": "data:%s;base64,%s" % (mime, audio_b64),
                                "format": audio_format,
                            },
                        }
                    ],
                }
            ],
            "asr_options": {"language": language},
            "stream": False,
        }
        data = _mimo_post(payload, deadline, error_code="asr_failed")
        text = parse_mimo_content(data)
        if text:
            texts.append(text)
    joined = _normalize_text("\n".join(texts)).strip()
    if not joined:
        raise DeepTaskError("asr_failed", "MiMo ASR 未返回任何转写文本")
    return {
        "text": joined[:DEEP_TRANSCRIPT_MAX_CHARS],
        "segments": [],
        "provider": "mimo",
        "language": language,
    }


def _mimo_vision_urls(image_path: str, deadline: float) -> List[Tuple[str, float]]:
    """MiMo 画面理解：单帧 → 逐字提取网址（禁止补全/猜测）；返回 [(url, score)]。"""
    with open(image_path, "rb") as handle:
        raw = handle.read()
    mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
    data_url = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
    payload = {
        "model": MIMO_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": _MIMO_VISION_PROMPT},
                ],
            }
        ],
        "temperature": 0.0,
        "max_completion_tokens": 300,
        "stream": False,
    }
    data = _mimo_post(payload, deadline, error_code="ocr_failed")
    text = parse_mimo_content(data)
    if not text or text.strip().upper() == "NONE":
        return []
    # 模型只给文本：给固定 0.8 分（跨帧投票仍能按出现比例区分强弱），最终还要过 check-link 校验
    return [(url, 0.8) for url in extract_urls_from_text(text)]


def _transcribe(wav_path: str, deadline: float) -> Dict[str, Any]:
    _check_deadline(deadline)
    if ASR_PROVIDER == "faster_whisper":
        return _asr_faster_whisper(wav_path, deadline)
    if ASR_PROVIDER == "http":
        return _asr_http(wav_path, deadline)
    if ASR_PROVIDER == "mimo":
        return _asr_mimo(wav_path, deadline)
    raise DeepTaskError(
        "asr_unavailable",
        "未配置 ASR（WORKER_ASR_PROVIDER=none）；如需口播转写请配置 mimo / faster_whisper / http",
    )


def _get_ocr_engine():
    """懒加载 rapidocr-onnxruntime 引擎（首次初始化会加载 onnx 模型）。"""
    global _ocr_engine
    with _ocr_lock:
        if _ocr_engine is not None:
            return _ocr_engine
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            raise DeepTaskError(
                "ocr_unavailable",
                "rapidocr_onnxruntime 未安装（需 requirements-deep.txt + Dockerfile INSTALL_DEEP=1）",
            )
        try:
            _ocr_engine = RapidOCR()
        except Exception as exc:
            raise DeepTaskError("ocr_unavailable", f"OCR 引擎初始化失败：{str(exc)[:200]}")
        return _ocr_engine


def _collect_images(directory: str) -> List[str]:
    if not os.path.isdir(directory):
        return []
    names = sorted(
        name for name in os.listdir(directory) if name.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    return [os.path.join(directory, name) for name in names]


def _extract_frames(video_path: str, tmpdir: str, duration: Optional[float], deadline: float) -> List[str]:
    """ffmpeg 抽帧：优先场景切换帧（scene>阈值），再按时间均匀采样兜底，总数受 OCR_MAX_FRAMES 限制。"""
    if not _ffmpeg_ready():
        raise DeepTaskError("internal", "ffmpeg 未安装，无法抽帧")
    frames_root = os.path.join(tmpdir, "frames")
    scene_dir = os.path.join(frames_root, "scene")
    sample_dir = os.path.join(frames_root, "sample")
    os.makedirs(scene_dir, exist_ok=True)
    os.makedirs(sample_dir, exist_ok=True)
    max_frames = max(2, OCR_MAX_FRAMES)
    if OCR_PROVIDER == "mimo":
        max_frames = max(1, min(max_frames, MIMO_VISION_MAX_FRAMES))
    scene_limit = max(1, max_frames // 2)

    # 1) 场景切换帧：文字/画面突变处最容易出现网址
    _run_ffmpeg(
        [
            "-i", video_path,
            "-vf", "select='gt(scene,%.2f)',scale='min(1280,iw)':-2" % OCR_SCENE_THRESHOLD,
            "-vsync", "vfr",
            "-frames:v", str(scene_limit),
            "-q:v", "3",
            os.path.join(scene_dir, "scene_%04d.jpg"),
        ],
        timeout=min(_remaining(deadline) or 60, 180),
        allow_failure=True,
    )
    frames = _collect_images(scene_dir)
    remaining_slots = max_frames - len(frames)
    # 2) 兜底均匀采样：整段视频都可能出现网址，不能只看场景切换
    if remaining_slots > 0:
        if duration and duration > 0:
            interval = max(float(OCR_SAMPLE_SECS), float(duration) / float(max_frames))
        else:
            interval = float(OCR_SAMPLE_SECS)
        _run_ffmpeg(
            [
                "-i", video_path,
                "-vf", "fps=1/%.3f,scale='min(1280,iw)':-2" % interval,
                "-frames:v", str(remaining_slots),
                "-q:v", "3",
                os.path.join(sample_dir, "sample_%04d.jpg"),
            ],
            timeout=min(_remaining(deadline) or 60, 180),
            allow_failure=True,
        )
        frames += _collect_images(sample_dir)[:remaining_slots]
    return frames[:max_frames]


def _ocr_frame(engine: Any, image_path: str) -> List[Tuple[str, float]]:
    """对单帧 OCR，返回 [(文本块, 置信度)]；兼容 rapidocr 不同版本的返回结构。"""
    try:
        raw = engine(image_path)
    except Exception:
        return []
    blocks = raw[0] if isinstance(raw, tuple) and len(raw) == 2 else raw
    out: List[Tuple[str, float]] = []
    for item in blocks or []:
        try:
            text = str(item[1] or "").strip()
            score = float(item[2])
        except (TypeError, IndexError, ValueError):
            continue
        if text:
            out.append((text, score))
    return out


def _ocr_collect_on_screen_urls(
    video_path: str,
    tmpdir: str,
    duration: Optional[float],
    deadline: float,
    job_id: str,
    progress_base: float,
    progress_span: float,
) -> Tuple[List[Dict[str, Any]], bool]:
    """抽帧 + OCR + URL 投票聚合；返回 (on_screen_urls, degraded)。"""
    frames = _extract_frames(video_path, tmpdir, duration, deadline)
    if not frames:
        return [], True
    if OCR_PROVIDER == "mimo":
        # 多模态理解：逐帧调用（便于复用跨帧投票），不再走本地 OCR 引擎
        votes: List[List[Tuple[str, float]]] = []
        for index, frame_path in enumerate(frames):
            _check_deadline(deadline)
            votes.append(_mimo_vision_urls(frame_path, deadline))
            _set_progress(job_id, progress_base + progress_span * ((index + 1) / len(frames)), "ocr")
        return aggregate_url_votes(votes), False
    engine = _get_ocr_engine()
    votes: List[List[Tuple[str, float]]] = []
    for index, frame_path in enumerate(frames):
        _check_deadline(deadline)
        blocks = _ocr_frame(engine, frame_path)
        frame_urls: List[Tuple[str, float]] = []
        for block_text, block_score in blocks:
            for url in extract_urls_from_text(block_text):
                frame_urls.append((url, block_score))
        votes.append(frame_urls)
        _set_progress(job_id, progress_base + progress_span * ((index + 1) / len(frames)), "ocr")
    return aggregate_url_votes(votes), False


def _deep_pipeline(
    job_id: str,
    url: str,
    include: Dict[str, bool],
    tmpdir: str,
    deadline: float,
    client: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """深度任务主体：短链解析 → 音频/ASR → 可选画面 OCR → 汇总。失败抛 DeepTaskError。

    client 非空时表示音频/视频地址由浏览器扩展从页面态提供：跳过 yt-dlp 探测与下载，
    直接用平台 CDN 直链（带 Referer）下载；这是 B站/抖音等机房 IP 被风控时的主路径。
    """
    resolved = resolve_short_link(url)
    platform = detect_platform(resolved)
    client = client if isinstance(client, dict) else {}

    if client:
        # 扩展已给出页面态媒体地址：不需要 yt-dlp 探活，也不做 YouTube 预检
        platform = str(client.get("platform") or platform)
    elif platform == "youtube" and not YTDLP_PROXY:
        # YouTube 先做 DNS 预检：本机无法直连时快速失败，不白等下载超时
        # （配了 YTDLP_PROXY 时由代理侧解析 DNS，跳过本地预检）
        preflight = _youtube_preflight(_host(resolved))
        if not preflight["ok"]:
            raise DeepTaskError(
                "download_failed",
                "YouTube DNS 预检失败（%s：%s），本机无法直连 YouTube，需配置 YTDLP_PROXY"
                % (_youtube_unreachable_reason(preflight["reason"]), preflight["detail"]),
            )
    if not client and not yt_dlp:
        raise DeepTaskError("download_failed", "yt-dlp 未安装，无法执行深度解析")

    _set_progress(job_id, 0.05, "download")
    if client:
        duration = _as_float(client.get("duration"))
        info: Dict[str, Any] = {
            "title": client.get("title") or "",
            "uploader": client.get("uploader") or "",
            "duration": duration,
            "webpage_url": resolved,
        }
    else:
        info = _deep_probe(resolved, deadline)
        duration = _as_float(info.get("duration"))
    if duration is not None and duration > DEEP_MAX_SECONDS:
        raise DeepTaskError(
            "too_long",
            "视频时长 %ds 超过上限 %ds（WORKER_DEEP_MAX_SECONDS）" % (int(duration), DEEP_MAX_SECONDS),
        )
    max_bytes = DEEP_MAX_MB * 1024 * 1024
    client_video_path: Optional[str] = None

    def ensure_client_video() -> str:
        """扩展只给了视频地址时，下载一次并复用给 ASR/OCR（抖音音频通常混在视频里）。"""
        nonlocal client_video_path
        if client_video_path:
            return client_video_path
        client_video_path = _download_client_media(
            client.get("video_urls") or [],
            str(client.get("referer") or ""),
            tmpdir,
            kind="video",
            max_bytes=max_bytes,
            job_id=job_id,
            progress_base=0.10,
            progress_span=0.15,
        )
        return client_video_path

    transcript: Optional[Dict[str, Any]] = None
    degraded = False
    if include.get("transcript"):
        _set_progress(job_id, 0.10, "download")
        if client and client.get("audio_urls"):
            audio_path = _download_client_media(
                client.get("audio_urls") or [],
                str(client.get("referer") or ""),
                tmpdir,
                kind="audio",
                max_bytes=max_bytes,
                job_id=job_id,
                progress_base=0.10,
                progress_span=0.15,
            )
        elif client and client.get("video_urls"):
            # 抖音等平台音频混在视频里：下载视频后直接抽音轨
            audio_path = ensure_client_video()
        else:
            audio_path = _deep_download(
                resolved,
                tmpdir,
                deadline,
                kind="audio",
                max_bytes=max_bytes,
                job_id=job_id,
                progress_base=0.10,
                progress_span=0.15,
            )
        _set_progress(job_id, 0.30, "asr")
        wav_path = _to_wav(audio_path, tmpdir, deadline)
        transcript = _transcribe(wav_path, deadline)
        if not transcript.get("segments"):
            # 部分 OpenAI 兼容服务只回纯文本：如实标记降级（时间轴缺失）
            degraded = True
        _set_progress(job_id, 0.58, "asr")

    on_screen_urls: List[Dict[str, Any]] = []
    if include.get("ocr"):
        if OCR_PROVIDER == "none":
            raise DeepTaskError(
                "ocr_unavailable",
                "画面 OCR 未启用（WORKER_OCR_PROVIDER=none；可选 mimo / rapidocr）",
            )
        if OCR_PROVIDER == "rapidocr" and not _module_available("rapidocr_onnxruntime"):
            raise DeepTaskError(
                "ocr_unavailable",
                "rapidocr_onnxruntime 未安装（需 requirements-deep.txt + Dockerfile INSTALL_DEEP=1）",
            )
        if not _ffmpeg_ready():
            raise DeepTaskError("internal", "ffmpeg 未安装，无法抽帧做画面 OCR")
        if client and not client.get("video_urls"):
            # 扩展只拿到音频：无法抽帧做 OCR，如实标记降级
            degraded = True
        else:
            _set_progress(job_id, 0.62, "ocr")
            if client:
                video_path = ensure_client_video()
            else:
                video_path = _deep_download(
                    resolved,
                    tmpdir,
                    deadline,
                    kind="video",
                    max_bytes=max_bytes,
                    job_id=job_id,
                    progress_base=0.62,
                    progress_span=0.10,
                )
            on_screen_urls, frames_degraded = _ocr_collect_on_screen_urls(
                video_path,
                tmpdir,
                duration,
                deadline,
                job_id,
                progress_base=0.72,
                progress_span=0.23,
            )
            degraded = degraded or frames_degraded

    _set_progress(job_id, 0.98, "aggregate")
    result: Dict[str, Any] = {
        "success": True,
        "source": platform,
        "url": info.get("webpage_url") or resolved,
        "title": (info.get("title") or "").strip(),
        "duration": int(duration) if duration is not None else None,
        "uploader": info.get("uploader") or info.get("channel"),
        "transcript": transcript,
        "on_screen_urls": on_screen_urls,
        "degraded": degraded,
    }
    return result


def _run_deep_job(job_id: str) -> None:
    """后台线程入口：跑完整深度任务并写回任务表（不向外抛异常）。"""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("status") != "queued":
            return
        url = job["url"]
        include = dict(job["include"])
        client = dict(job.get("client") or {})
        job["status"] = "running"
        job["stage"] = "download"
        job["updated_at"] = time.time()

    deadline = time.time() + DEEP_TIMEOUT_SECS
    tmpdir = tempfile.mkdtemp(prefix="ulink-deep-")
    try:
        result = _deep_pipeline(job_id, url, include, tmpdir, deadline, client)
        _update_job(
            job_id,
            status="done",
            progress=1.0,
            stage="done",
            result=result,
            error=None,
        )
    except DeepTaskError as exc:
        _update_job(job_id, status="failed", error={"code": exc.code, "message": exc.message})
    except Exception as exc:  # 兜底：绝不把 traceback 泄漏给调用方
        _update_job(job_id, status="failed", error={"code": "internal", "message": str(exc)[:300]})
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ─────────────────────────── HTTP 接口 ───────────────────────────


@app.get("/health")
def health_check():
    with _jobs_lock:
        active = sum(1 for job in _jobs.values() if job.get("status") == "running")
        queued = sum(1 for job in _jobs.values() if job.get("status") == "queued")
    return {
        "status": "ok",
        "worker": "ulink-video-worker",
        "version": WORKER_VERSION,
        "yt_dlp_loaded": yt_dlp is not None,
        "yt_dlp_version": getattr(getattr(yt_dlp, "version", None), "__version__", None),
        "playwright_loaded": async_playwright is not None,
        "cookies_configured": _cookies_configured(),
        # P0：代理配置 / ASR / OCR 就绪状态（深度解析前置条件，便于运维一眼定位）
        "proxy_configured": bool(YTDLP_PROXY),
        "asr_provider": ASR_PROVIDER,
        "asr_ready": _asr_ready(),
        "ocr_provider": OCR_PROVIDER,
        "ocr_ready": _ocr_ready(),
        "ocr_enabled": OCR_PROVIDER == "rapidocr",
        "mimo_configured": bool(MIMO_API_KEY),
        "bili_sec_token_cached": bool(_bilibili_cached_sec_token()),
        "bili_proxy_configured": bool(BILI_PROXY_API),
        "bili_proxy_active": bool(_bili_proxy_cache.get("url")),
        "bili_proxy_last_error": str(_bili_proxy_cache.get("last_error") or ""),
        "asr_mimo_model": MIMO_ASR_MODEL if ASR_PROVIDER == "mimo" else "",
        "ocr_mimo_model": MIMO_VISION_MODEL if OCR_PROVIDER == "mimo" else "",
        "deep_ready": bool(_asr_ready() or _ocr_ready()),
        "ffmpeg_ready": _ffmpeg_ready(),
        "youtube_dns_strict": YOUTUBE_DNS_STRICT,
        "platform_list_source": PLATFORM_LIST_SOURCE,
        "allowed_hosts_count": len(ALLOWED_VIDEO_HOSTS),
        "deep_concurrency": DEEP_CONCURRENCY,
        "deep_jobs_active": active,
        "deep_jobs_queued": queued,
        "deep_limits": {
            "max_seconds": DEEP_MAX_SECONDS,
            "max_mb": DEEP_MAX_MB,
            "timeout_secs": DEEP_TIMEOUT_SECS,
            "job_ttl_secs": DEEP_JOB_TTL_SECS,
        },
    }


@app.post("/api/video/extract", response_model=VideoExtractResponse)
async def extract_video_metadata(req: VideoExtractRequest, request: Request):
    require_worker_token(request)
    check_rate_limit(request)
    target_url = (req.url or "").strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Empty video URL")

    validate_url_shape(target_url)
    platform = detect_platform(target_url)
    if platform == "youtube" and not YTDLP_PROXY:
        # P0：YouTube 在本机常被 DNS 污染/无法直连；先预检，失败直接结构化返回，
        # 避免 yt-dlp 白等到 45s 超时（云函数侧据 error_code 给出「需代理」提示）。
        # 配了 YTDLP_PROXY 时 DNS 由代理侧解析，本地解析结果无参考价值，故跳过预检。
        preflight = _youtube_preflight(_host(target_url))
        if not preflight["ok"]:
            reason = _youtube_unreachable_reason(preflight["reason"])
            return VideoExtractResponse(
                success=False,
                source="youtube",
                url=target_url,
                title="",
                description="",
                subtitles="",
                provider="none",
                error_code="youtube_unreachable",
                error=(
                    "YouTube DNS 预检失败：%s（%s）。本服务所在网络无法直连 YouTube，"
                    "请配置 YTDLP_PROXY 或改用其它解析链路。" % (reason, preflight["detail"])
                )[:600],
            )
    elif platform != "youtube":
        # 非 YouTube 保持旧行为：DNS 私网/解析失败 → 400（fail-closed 防 SSRF）
        validate_target_url(target_url)

    if not yt_dlp and not async_playwright:
        raise HTTPException(status_code=500, detail="worker has neither yt-dlp nor playwright installed")

    resolved = await asyncio.to_thread(resolve_short_link, target_url)
    platform = detect_platform(resolved)
    max_chars = min(req.max_sub_chars, MAX_TEXT_CHARS)

    # 页面型平台优先浏览器（yt-dlp 对抖音/小红书基本必失败，先跑再兜底会白等）
    browser_first = _host_matches(_host(resolved), BROWSER_FIRST_HOSTS)
    browser_result: Optional[VideoExtractResponse] = None
    ytdlp_result: Optional[VideoExtractResponse] = None

    if browser_first:
        try:
            browser_result = await extract_with_browser(resolved)
        except Exception as exc:  # 浏览器异常绝不能变成 500：如实回落 yt-dlp / 返回结构化失败
            print("[worker] browser fallback failed:", str(exc)[:300])
            browser_result = None
        if browser_result:
            return browser_result

    ytdlp_result = await asyncio.to_thread(
        extract_with_ytdlp,
        resolved,
        req.include_subtitles,
        max_chars,
        req.include_comments,
    )
    if ytdlp_result and ytdlp_result.success and (
        ytdlp_result.description.strip() or ytdlp_result.subtitles.strip() or ytdlp_result.title.strip()
    ):
        return ytdlp_result

    if not browser_first:
        try:
            browser_result = await extract_with_browser(resolved)
        except Exception as exc:  # 同上：浏览器异常不得冒泡成 500
            print("[worker] browser fallback failed:", str(exc)[:300])
            browser_result = None
        if browser_result:
            return browser_result

    if ytdlp_result and not ytdlp_result.success:
        if _last_browser_diag:
            ytdlp_result.error = ((ytdlp_result.error or "") + " | browser: " + _last_browser_diag)[:800]
        return ytdlp_result

    return VideoExtractResponse(
        success=False,
        source=platform,
        url=resolved,
        title="",
        description="",
        subtitles="",
        provider="none",
        error=(
            "抓取失败：yt-dlp 与浏览器兜底均未拿到可用内容（可能需要配置 Cookie 或该页面限制访问）"
            + (" | browser: " + _last_browser_diag if _last_browser_diag else "")
        )[:800],
    )


@app.post("/api/video/jobs", status_code=202)
def create_deep_job(req: DeepJobRequest, request: Request):
    """提交深度解析任务（异步）：立即返回 202 + job_id，后台线程排队执行。"""
    require_worker_token(request)
    check_rate_limit(request)
    target_url = (req.url or "").strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Empty video URL")
    # 提交时即做域名白名单 + DNS 校验（fail-closed），避免把任务排进去才发现不合法。
    # YouTube 单独走严格预检：网络不可达时尽早 503，别让云函数扣了额度才失败。
    validate_url_shape(target_url)
    if detect_platform(target_url) == "youtube":
        # 未配代理时严格预检（网络不可达尽早 503，别让云函数扣了额度才失败）；
        # 配了 YTDLP_PROXY 时 DNS 由代理侧解析，跳过本地预检。
        if not YTDLP_PROXY:
            preflight = _youtube_preflight(_host(target_url))
            if not preflight["ok"]:
                raise HTTPException(
                    status_code=503,
                    detail="deep_unavailable：YouTube DNS 预检失败（%s：%s），本机无法直连 YouTube，需配置 YTDLP_PROXY"
                    % (_youtube_unreachable_reason(preflight["reason"]), preflight["detail"]),
                )
    else:
        validate_target_url(target_url)

    include = resolve_include_request(
        req.include.transcript if req.include else None,
        req.include.ocr if req.include else None,
    )
    if not include["transcript"] and not include["ocr"]:
        explicitly_requested = bool(
            req.include and (req.include.transcript is not None or req.include.ocr is not None)
        )
        if explicitly_requested:
            raise HTTPException(
                status_code=400,
                detail="include 需至少请求 transcript 或 ocr 之一",
            )
        # 调用方未显式指定能力，而 worker 侧 ASR/OCR 都没配置：按「深度解析不可用」上报，
        # 云函数侧映射为 deep_unavailable，而不是让用户拿到一个永远空的任务。
        raise HTTPException(
            status_code=503,
            detail=(
                "deep_unavailable：深度解析能力均未配置或未就绪"
                "（asr_provider=%s / ocr_provider=%s），请检查 worker 环境变量"
                % (ASR_PROVIDER, OCR_PROVIDER)
            ),
        )

    job_id = _new_job_id()
    client = _sanitize_client_media(req.client.model_dump() if req.client else None)
    with _jobs_lock:
        _cleanup_jobs_locked()
        pending = sum(1 for job in _jobs.values() if job.get("status") in ("queued", "running"))
        if pending >= DEEP_MAX_QUEUE:
            raise HTTPException(
                status_code=503,
                detail="深度解析队列已满（WORKER_DEEP_MAX_QUEUE=%d），请稍后重试" % DEEP_MAX_QUEUE,
            )
        now = time.time()
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0.0,
            "stage": "queued",
            "url": target_url,
            "include": include,
            "client": client,
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
    try:
        _get_executor().submit(_run_deep_job, job_id)
    except Exception as exc:
        with _jobs_lock:
            _jobs.pop(job_id, None)
        raise HTTPException(status_code=503, detail="深度解析线程池不可用：%s" % str(exc)[:120])
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/video/jobs/{job_id}")
def get_deep_job(job_id: str, request: Request):
    """查询深度解析任务状态/结果。"""
    require_worker_token(request)
    check_rate_limit(request)
    if not _is_valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="invalid job id")
    with _jobs_lock:
        _cleanup_jobs_locked()
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        payload = _job_public(dict(job))
    return payload


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
