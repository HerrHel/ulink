"""
ULink Video Intelligence Worker
专门配合与链（ulink）高阶视频灵感提取的 Python 微服务。

抓取策略（按顺序命中即返回）：
1. yt-dlp 元数据抽取（简介 / 章节 / 评论 / 字幕文本）——覆盖 B站、YouTube、Twitter 等 1000+ 平台；
2. Playwright 无头浏览器兜底——抖音 / 小红书 / TikTok 等「必须登录态或需要 JS 渲染」的页面，
   直接读取渲染后的标题与简介文本，保证不会像 r.jina.ai 那样直接 502。

设计约束：
- 只取公开信息，绝不伪造：抓不到就如实返回 success=false 与 error；
- 任何兜底失败都不影响另一条链路（yt-dlp 失败 → 浏览器兜底，反之亦然）；
- 不下载视频流（skip_download），耗时控制在秒级。
"""

import asyncio
import hmac
import html
import ipaddress
import json
import os
import re
import socket
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

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


DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

UPSTREAM_TIMEOUT_MS = int(os.environ.get("WORKER_UPSTREAM_TIMEOUT_MS", "12000"))
BROWSER_TIMEOUT_MS = int(os.environ.get("WORKER_BROWSER_TIMEOUT_MS", "20000"))
BROWSER_SETTLE_MS = int(os.environ.get("WORKER_BROWSER_SETTLE_MS", "3000"))
MAX_TEXT_CHARS = int(os.environ.get("WORKER_MAX_TEXT_CHARS", "20000"))
# 可选调用口令：若配置，则要求请求头 X-Worker-Token 一致（云托管公网暴露时建议开启）
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "").strip()

SHORT_LINK_HOSTS = {
    "b23.tv",
    "bili2233.cn",
    "v.douyin.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
    "xhslink.com",
    "t.cn",
}

# 页面型平台：这些站点 yt-dlp 通常拿不到（风控/需登录），优先走浏览器兜底
BROWSER_FIRST_HOSTS = ("douyin.com", "iesdouyin.com", "xiaohongshu.com", "xhslink.com", "tiktok.com")

# 只允许视频/图文平台域名：服务若被公网直连，也不能退化成任意网站代理（防 SSRF/滥用）
ALLOWED_VIDEO_HOSTS = (
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
ALLOW_ANY_HOST = os.environ.get("WORKER_ALLOW_ANY_HOST", "false").strip().lower() == "true"
RATE_LIMIT_PER_MIN = int(os.environ.get("WORKER_RATE_LIMIT_PER_MIN", "60"))
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
BROWSER_ENABLED = os.environ.get("WORKER_BROWSER_ENABLED", "true").strip().lower() != "false"

# 各平台首页：先访问一次再进详情页，抖音/小红书会下发风控 Cookie（纯冷启动详情页常被降级为空壳）
PLATFORM_HOME = {
    "douyin": "https://www.douyin.com/",
    "xiaohongshu": "https://www.xiaohongshu.com/explore",
    "tiktok": "https://www.tiktok.com/",
}


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


app = FastAPI(title="ULink Video Intelligence Worker", version="1.1.0", lifespan=lifespan)

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


class VideoExtractResponse(BaseModel):
    success: bool
    source: str
    url: str
    title: str
    description: str
    subtitles: str
    chapters: List[Dict[str, Any]] = []
    comments: List[str] = []
    duration: Optional[int] = None
    uploader: Optional[str] = None
    error: Optional[str] = None


# ─────────────────────────── 通用工具 ───────────────────────────


def _host(url: str) -> str:
    m = re.match(r"^https?://([^/:?#]+)", url, re.I)
    return (m.group(1) if m else "").lower().removeprefix("www.")


def _host_allowed(host: str) -> bool:
    if ALLOW_ANY_HOST:
        return True
    return any(host == h or host.endswith("." + h) for h in ALLOWED_VIDEO_HOSTS)


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast


def validate_target_url(url: str) -> str:
    """入口校验：仅 http(s) + 仅视频平台域名 + DNS 解析结果不得落在内网（fail-closed）"""
    if not re.match(r"^https?://", url or "", re.I):
        raise HTTPException(status_code=400, detail="Only http(s) URLs are supported")
    host = _host(url)
    if not host:
        raise HTTPException(status_code=400, detail="Invalid URL host")
    if not _host_allowed(host):
        raise HTTPException(status_code=400, detail="Unsupported host")
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        raise HTTPException(status_code=400, detail="DNS resolution failed")
    for info in infos:
        ip = info[4][0]
        if _is_private_ip(ip):
            raise HTTPException(status_code=400, detail="Blocked private address")
    return url


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for") or ""
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


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
    for line in raw.splitlines():
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
    order = ["zh-Hans", "zh-CN", "zh", "zh-Hant", "zh-TW", "en", "en-US", "en-GB"]
    for i, key in enumerate(order):
        if lang == key:
            return i
    return 100 if lang.startswith(("zh", "en")) else 200


def pick_subtitle_track(tracks: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """按语言优先级 + 解析格式优先级挑一条字幕轨道"""
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


# ─────────────────────────── yt-dlp 链路 ───────────────────────────

_cookiefile_cache: Optional[str] = None


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


def _build_ydl_opts(proxy: Optional[str]) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": UPSTREAM_TIMEOUT_MS / 1000,
        "retries": 1,
        "http_headers": {"User-Agent": DESKTOP_UA},
    }
    cookie = _prepare_cookiefile()
    if cookie:
        opts["cookiefile"] = cookie
    if proxy:
        opts["proxy"] = proxy
    return opts


def extract_with_ytdlp(target_url: str, include_subtitles: bool, max_chars: int) -> Optional[VideoExtractResponse]:
    if not yt_dlp:
        return None
    proxy = os.environ.get("YTDLP_PROXY", "").strip() or None
    try:
        with yt_dlp.YoutubeDL(_build_ydl_opts(proxy)) as ydl:
            info = ydl.extract_info(target_url, download=False)
    except Exception as exc:  # token 失效 / 风控 / 网络异常：交给浏览器兜底
        return VideoExtractResponse(
            success=False,
            source=detect_platform(target_url),
            url=target_url,
            title="",
            description="",
            subtitles="",
            error=str(exc)[:300],
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
    for c in (info.get("comments") or [])[:15]:
        if isinstance(c, dict):
            text = c.get("text") or ""
            if text and len(text) > 2:
                comments.append(text[:200])

    subtitles = ""
    if include_subtitles:
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


# ─────────────────────────── HTTP 接口 ───────────────────────────


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "worker": "ulink-video-worker",
        "yt_dlp_loaded": yt_dlp is not None,
        "yt_dlp_version": getattr(getattr(yt_dlp, "version", None), "__version__", None),
        "playwright_loaded": async_playwright is not None,
        "cookies_configured": _prepare_cookiefile() is not None,
    }


@app.post("/api/video/extract", response_model=VideoExtractResponse)
async def extract_video_metadata(req: VideoExtractRequest, request: Request):
    if WORKER_TOKEN:
        token = request.headers.get("x-worker-token") or ""
        if not hmac.compare_digest(token, WORKER_TOKEN):
            raise HTTPException(status_code=401, detail="invalid worker token")
    check_rate_limit(request)
    target_url = (req.url or "").strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="Empty video URL")
    validate_target_url(target_url)
    if not yt_dlp and not async_playwright:
        raise HTTPException(status_code=500, detail="worker has neither yt-dlp nor playwright installed")

    resolved = await asyncio.to_thread(resolve_short_link, target_url)
    platform = detect_platform(resolved)
    max_chars = min(req.max_sub_chars, MAX_TEXT_CHARS)

    # 页面型平台优先浏览器（yt-dlp 对抖音/小红书基本必失败，先跑再兜底会白等）
    browser_first = any(h in _host(resolved) for h in BROWSER_FIRST_HOSTS)
    browser_result: Optional[VideoExtractResponse] = None
    ytdlp_result: Optional[VideoExtractResponse] = None

    if browser_first:
        browser_result = await extract_with_browser(resolved)
        if browser_result:
            return browser_result

    ytdlp_result = await asyncio.to_thread(
        extract_with_ytdlp, resolved, req.include_subtitles, max_chars
    )
    if ytdlp_result and ytdlp_result.success and (
        ytdlp_result.description.strip() or ytdlp_result.subtitles.strip() or ytdlp_result.title.strip()
    ):
        return ytdlp_result

    if not browser_first:
        browser_result = await extract_with_browser(resolved)
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
        error=(
            "抓取失败：yt-dlp 与浏览器兜底均未拿到可用内容（可能需要配置 Cookie 或该页面限制访问）"
            + (" | browser: " + _last_browser_diag if _last_browser_diag else "")
        )[:800],
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
