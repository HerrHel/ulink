"""scripts/video-worker 纯函数 / 接口自测（不依赖 yt-dlp / playwright / ASR / OCR）。

用法（在本目录下）：
    python selftest.py

覆盖：
- 平台清单加载（与 src/config/videoPlatforms.json 真源比对）
- 平台判定 / 域名白名单 / 长短链
- DNS 预检（注入 fake resolver，不依赖真实网络）
- 字幕轨语言优先级（中文 > 英文 > 其它）
- 画面网址提取（完整链接 + 无协议裸域名 + TLD 白名单 + 去标点）
- 跨帧投票聚合（confidence / frames）
- include 缺省解析、job_id 格式
- /health、/api/video/extract 的 YouTube 快速失败、/api/video/jobs 提交与轮询

退出码 0 = 全部通过，1 = 有失败。
"""

import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import server  # noqa: E402  （必须在 sys.path 处理之后）

failures = []


def check(name, condition, detail=""):
    if condition:
        print("PASS  " + name)
    else:
        print("FAIL  " + name + (("  <<< " + str(detail)) if detail else ""))
        failures.append(name)


def check_eq(name, actual, expected):
    check(name, actual == expected, "actual=%r expected=%r" % (actual, expected))


def fake_resolver(ips):
    def resolver(_host, _port=None):
        return [(2, 1, 6, "", (ip, 0)) for ip in ips]

    return resolver


def raising_resolver(_host, _port=None):
    raise OSError("name resolution failed")


# ─────────────────────────── 1. 平台清单 ───────────────────────────


def test_platform_list():
    check_eq("platform_list_source", server.PLATFORM_LIST_SOURCE, "file")
    check("allowed_hosts 含 youtube", "youtube.com" in server.ALLOWED_VIDEO_HOSTS, server.ALLOWED_VIDEO_HOSTS)
    check("allowed_hosts 含 bilibili", "bilibili.com" in server.ALLOWED_VIDEO_HOSTS)
    check("browser_first 含 douyin", "douyin.com" in server.BROWSER_FIRST_HOSTS)
    check("short_link 含 b23.tv", "b23.tv" in server.SHORT_LINK_HOSTS)
    check("short_link 含 t.cn", "t.cn" in server.SHORT_LINK_HOSTS)

    # 与唯一真源逐项比对（容器里没有 src/ 时跳过，只保证不误报失败）
    truth_path = os.path.join(HERE, "..", "..", "src", "config", "videoPlatforms.json")
    if os.path.isfile(truth_path):
        with open(truth_path, "r", encoding="utf-8") as handle:
            truth = json.load(handle)
        check_eq("videoHosts 与真源一致", set(server.ALLOWED_VIDEO_HOSTS), set(truth["videoHosts"]))
        check_eq("browserFirstHosts 与真源一致", set(server.BROWSER_FIRST_HOSTS), set(truth["browserFirstHosts"]))
        check_eq(
            "resolverShortLinkHosts 与真源一致",
            set(server.SHORT_LINK_HOSTS),
            set(truth["resolverShortLinkHosts"]),
        )
    else:
        print("SKIP  src/config/videoPlatforms.json 不存在（容器环境），跳过真源比对")

    # 配置文件缺失时回落内置常量（不因配置缺失导致服务起不来）
    fallback, source = server._load_platform_config(os.path.join(HERE, "no-such-file.json"))
    check_eq("缺失配置 -> builtin 回落", (fallback, source), ({}, "builtin"))


# ─────────────────────────── 2. 平台判定 / 白名单 ───────────────────────────


def test_platform_detection():
    check_eq("host 去 www + 小写", server._host("https://www.YouTube.com/watch?v=1"), "youtube.com")
    check_eq("host 带端口", server._host("https://b23.tv:443/abc"), "b23.tv")
    check_eq("host 非法 URL", server._host("not a url"), "")

    cases = {
        "https://v.douyin.com/xxxx/": "douyin",
        "https://www.xiaohongshu.com/explore/123": "xiaohongshu",
        "https://xhslink.com/a/b": "xiaohongshu",
        "https://www.tiktok.com/@user/video/1": "tiktok",
        "https://www.bilibili.com/video/BV1xx": "bilibili",
        "https://b23.tv/abc": "bilibili",
        "https://www.youtube.com/watch?v=1": "youtube",
        "https://youtu.be/abc": "youtube",
        "https://x.com/user/status/1": "twitter",
        "https://vimeo.com/123": "generic",
    }
    for url, expected in cases.items():
        check_eq("detect_platform " + url, server.detect_platform(url), expected)

    check("白名单命中 youtube.com", server._host_allowed("youtube.com"))
    check("白名单命中子域名 www.bilibili.com", server._host_allowed("www.bilibili.com"))
    check("白名单拒绝 evil.com", not server._host_allowed("evil.com"))
    check("白名单拒绝 notyoutube.com（后缀伪装）", not server._host_allowed("notyoutube.com"))
    check(
        "browser_first 后缀匹配",
        server._host_matches("www.douyin.com", server.BROWSER_FIRST_HOSTS)
        and not server._host_matches("notdouyin.com", server.BROWSER_FIRST_HOSTS),
    )


# ─────────────────────────── 3. DNS 预检（YouTube 快速失败基础） ───────────────────────────


def test_dns_preflight():
    public = server.dns_preflight("youtube.com", resolver=fake_resolver(["93.184.216.34"]))
    check("DNS 公网地址 -> ok", public["ok"] is True and public["reason"] == "", public)
    check_eq("DNS 公网返回 IP", public["ips"], ["93.184.216.34"])

    polluted = server.dns_preflight("youtube.com", resolver=fake_resolver(["127.0.0.1", "10.0.0.5"]))
    check(
        "DNS 污染（回环/内网）-> private_address",
        polluted["ok"] is False and polluted["reason"] == "private_address",
        polluted,
    )

    failed = server.dns_preflight("youtube.com", resolver=raising_resolver)
    check("DNS 失败 -> dns_failed", failed["ok"] is False and failed["reason"] == "dns_failed", failed)

    empty = server.dns_preflight("youtube.com", resolver=lambda _h, _p=None: [])
    check("DNS 空结果 -> dns_failed", empty["ok"] is False and empty["reason"] == "dns_failed", empty)

    # YouTube 严格预检：污染公网段 / 非 Google 网络都应判定不可达
    poison = server._youtube_preflight("youtube.com", resolver=fake_resolver(["104.244.42.197"]))
    check(
        "已知污染公网段 -> poison_address",
        poison["ok"] is False and poison["reason"] == "poison_address",
        poison,
    )
    unexpected = server._youtube_preflight("youtube.com", resolver=fake_resolver(["1.1.1.1"]))
    check(
        "非 Google 网络 -> unexpected_network",
        unexpected["ok"] is False and unexpected["reason"] == "unexpected_network",
        unexpected,
    )
    google = server._youtube_preflight(
        "youtube.com", resolver=fake_resolver(["142.250.1.1", "172.217.0.1"])
    )
    check("Google 网络 -> ok", google["ok"] is True, google)

    original_strict = server.YOUTUBE_DNS_STRICT
    server.YOUTUBE_DNS_STRICT = False
    try:
        relaxed = server._youtube_preflight("youtube.com", resolver=fake_resolver(["1.1.1.1"]))
        check("严格模式关闭 -> 不校验网络归属", relaxed["ok"] is True, relaxed)
    finally:
        server.YOUTUBE_DNS_STRICT = original_strict


# ─────────────────────────── 4. 字幕轨优先中文再英文 ───────────────────────────


def test_subtitle_track():
    tracks = {
        "en": [{"ext": "vtt", "url": "https://example.com/en.vtt"}],
        "zh-Hans": [{"ext": "json3", "url": "https://example.com/zh.json3"}],
        "zh-Hant": [{"ext": "vtt", "url": "https://example.com/zh-hant.vtt"}],
    }
    picked = server.pick_subtitle_track(tracks)
    check_eq("字幕优先中文（zh-Hans）", (picked or {}).get("lang"), "zh-Hans")
    check_eq("字幕优先 json3 格式", (picked or {}).get("ext"), "json3")

    only_en = {"en-US": [{"ext": "vtt", "url": "https://example.com/en-us.vtt"}]}
    check_eq("无中文时回退英文", (server.pick_subtitle_track(only_en) or {}).get("lang"), "en-US")

    zh_hant_only = {
        "en": [{"ext": "vtt", "url": "u-en"}],
        "zh-Hant": [{"ext": "vtt", "url": "u-zh"}],
    }
    check_eq("繁体中文优先于英文", (server.pick_subtitle_track(zh_hant_only) or {}).get("lang"), "zh-Hant")

    check_eq("空字幕字典 -> None", server.pick_subtitle_track({}), None)
    check_eq("非字典 -> None", server.pick_subtitle_track(None), None)

    ranks = [server._lang_rank(lang) for lang in ("zh-Hans", "zh-CN", "zh-Hant", "en", "en-US", "fr")]
    check("语言秩：中文 < 英文 < 其它", ranks[0] < ranks[3] < ranks[5], ranks)
    check("语言秩：简体优先于繁体", ranks[0] < ranks[2], ranks)


# ─────────────────────────── 5. 画面网址提取 ───────────────────────────


def test_extract_urls():
    cases = [
        ("官网 https://ulink.ren/s/abc，扫码查看", ["https://ulink.ren/s/abc"]),
        ("访问 www.example.com/path。", ["https://www.example.com/path"]),
        ("关注 bilibili.com", ["https://bilibili.com"]),
        ("邮箱 hello@example.com", []),
        ("版本 1.2.3 更新", []),
        ("看这里 https://example.com/）", ["https://example.com"]),
        ("http://a.com/x?q=1#y", ["http://a.com/x?q=1#y"]),
        ("图片 image.png 无效", []),
        ("https://192.168.1.1/admin", []),
        ("站点 www.abc.com.cn/中文", ["https://www.abc.com.cn/中文"]),
    ]
    for text, expected in cases:
        check_eq("extract_urls " + text, server.extract_urls_from_text(text), expected)

    mixed = server.extract_urls_from_text("看 https://a.com 和 www.b.com")
    check_eq("混合完整链接 + 裸域名", mixed, ["https://a.com", "https://www.b.com"])

    check_eq("空文本 -> []", server.extract_urls_from_text(""), [])
    check_eq("重复链接去重", server.extract_urls_from_text("https://a.com https://a.com"), ["https://a.com"])


# ─────────────────────────── 6. 跨帧投票聚合 ───────────────────────────


def test_aggregate_votes():
    frames = [
        [("https://example.com", 0.9)],
        [("https://example.com", 0.8)],
        [("https://other.com", 0.5)],
        [],
    ]
    result = server.aggregate_url_votes(frames)
    check_eq("聚合数量", len(result), 2)
    check_eq("聚合排序（帧数优先）", result[0]["url"], "https://example.com")
    check_eq("出现帧数", result[0]["frames"], 2)
    check_eq("置信度 = 0.6*2/4 + 0.4*0.85", result[0]["confidence"], 0.64)
    check_eq("低票站点 frames", result[1]["frames"], 1)
    check_eq("低票站点 confidence", result[1]["confidence"], 0.35)

    merged = server.aggregate_url_votes(
        [[("https://www.a.com", 1.0)], [("http://a.com/", 1.0)]]
    )
    check_eq("www/协议写法合并为一条", len(merged), 1)
    check_eq("合并后保留首次出现的写法", merged[0]["url"], "https://www.a.com")
    check_eq("合并后帧数", merged[0]["frames"], 2)
    check_eq("合并后满置信度", merged[0]["confidence"], 1.0)

    check_eq("空帧列表 -> []", server.aggregate_url_votes([]), [])
    check("聚合结果可 JSON 序列化", isinstance(json.dumps(result), str))


# ─────────────────────────── 7. include 缺省 / job_id ───────────────────────────


def test_include_and_job_id():
    check_eq(
        "provider=none + ocr 关闭 -> 两者都 false",
        server.resolve_include_request(None, None, asr_provider="none", ocr_enabled=False),
        {"transcript": False, "ocr": False},
    )
    check_eq(
        "provider=http -> 缺省 transcript=true",
        server.resolve_include_request(None, None, asr_provider="http", ocr_enabled=False),
        {"transcript": True, "ocr": False},
    )
    check_eq(
        "OCR 启用 -> 缺省 ocr=true",
        server.resolve_include_request(None, None, asr_provider="none", ocr_enabled=True),
        {"transcript": False, "ocr": True},
    )
    check_eq(
        "显式 include 覆盖缺省",
        server.resolve_include_request(True, False, asr_provider="none", ocr_enabled=True),
        {"transcript": True, "ocr": False},
    )

    job_id = server._new_job_id()
    check_eq("job_id 长度 32（随机 hex）", len(job_id), 32)
    check("job_id 格式合法", server._is_valid_job_id(job_id))
    check("job_id 非 hex 被拒", not server._is_valid_job_id("abc"))
    check("job_id 路径穿越被拒", not server._is_valid_job_id("../etc/passwd"))

    request = server.VideoExtractRequest(url="https://www.bilibili.com/video/BV1xx")
    check_eq("include_comments 默认 false", request.include_comments, False)
    response = server.VideoExtractResponse(
        success=True, source="bilibili", url="https://x", title="t", description="d"
    )
    check_eq("响应 provider 默认 none", response.provider, "none")
    check_eq("响应 error_code 默认 None", response.error_code, None)


# ─────────────────────────── 8. 接口自测（TestClient） ───────────────────────────


def test_endpoints():
    try:
        from fastapi.testclient import TestClient
    except Exception as exc:  # pragma: no cover - 环境未装 httpx 时跳过
        print("SKIP  接口自测（缺少 fastapi.testclient/httpx：%s）" % exc)
        return

    # 保证不受宿主环境变量影响
    old_provider, old_ocr = server.ASR_PROVIDER, server.OCR_ENABLED
    old_token = server.WORKER_TOKEN
    server.ASR_PROVIDER, server.OCR_ENABLED, server.WORKER_TOKEN = "none", False, ""
    try:
        with TestClient(server.app) as client:
            # 8.1 /health：无 yt-dlp / playwright / ASR / OCR 依赖也能正常返回
            health = client.get("/health")
            check_eq("/health 200", health.status_code, 200)
            payload = health.json()
            for key in (
                "proxy_configured",
                "asr_provider",
                "asr_ready",
                "ocr_provider",
                "ocr_ready",
                "mimo_configured",
                "version",
                "youtube_dns_strict",
            ):
                check("/health 含字段 " + key, key in payload, payload)
            check_eq("/health version", payload.get("version"), server.WORKER_VERSION)
            check_eq("/health asr_provider", payload.get("asr_provider"), "none")
            check_eq("/health asr_ready", payload.get("asr_ready"), False)
            check_eq("/health ocr_ready", payload.get("ocr_ready"), False)
            check_eq("/health deep_ready", payload.get("deep_ready"), False)
            check_eq(
                "/health platform_list_source",
                payload.get("platform_list_source"),
                server.PLATFORM_LIST_SOURCE,
            )

            # 8.2 非白名单域名 -> 400
            bad = client.post("/api/video/extract", json={"url": "https://evil.example.net/x"})
            check_eq("非白名单 host -> 400", bad.status_code, 400)

            # 8.3 YouTube DNS 预检失败 -> success=false + error_code=youtube_unreachable（不白等）
            original_preflight = server.dns_preflight
            server.dns_preflight = lambda host, resolver=None, expected_networks=None: {
                "ok": False,
                "reason": "private_address",
                "detail": "127.0.0.1",
                "ips": ["127.0.0.1"],
            }
            try:
                resp = client.post(
                    "/api/video/extract",
                    json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
                )
                check_eq("YouTube 预检失败 HTTP 200", resp.status_code, 200)
                body = resp.json()
                check_eq("YouTube 预检失败 success", body.get("success"), False)
                check_eq("YouTube 预检失败 error_code", body.get("error_code"), "youtube_unreachable")
                check_eq("YouTube 预检失败 provider", body.get("provider"), "none")
            finally:
                server.dns_preflight = original_preflight

            # 8.4 深度任务：ASR/OCR 都不可用 -> 503 deep_unavailable；显式宣称不要能力 -> 400
            resp = client.post(
                "/api/video/jobs",
                json={"url": "https://www.bilibili.com/video/BV1xx411c7mD"},
            )
            check_eq("深度任务能力不可用 -> 503", resp.status_code, 503)
            check(
                "503 提示含 deep_unavailable",
                "deep_unavailable" in str(resp.json().get("detail", "")),
                resp.json(),
            )
            resp = client.post(
                "/api/video/jobs",
                json={
                    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                    "include": {"transcript": False, "ocr": False},
                },
            )
            check_eq("显式不要任何能力 -> 400", resp.status_code, 400)

            # 8.5 token 校验覆盖新接口
            server.WORKER_TOKEN = "selftest-token"
            resp = client.post(
                "/api/video/jobs",
                json={
                    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                    "include": {"transcript": True},
                },
            )
            check_eq("无 token 提交 -> 401", resp.status_code, 401)
            resp = client.get("/api/video/jobs/" + server._new_job_id())
            check_eq("无 token 查询 -> 401", resp.status_code, 401)
            server.WORKER_TOKEN = ""

            # 8.6 提交 + 轮询（monkeypatch 掉 DNS/白名单校验，避免依赖外网；
            # yt-dlp 未安装 -> 任务应立即 failed/download_failed，而不是挂死）
            original_validate = server.validate_target_url
            server.validate_target_url = lambda url: url
            try:
                submit = client.post(
                    "/api/video/jobs",
                    json={
                        "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                        "include": {"transcript": True},
                    },
                )
                check_eq("提交深度任务 -> 202", submit.status_code, 202)
                job = submit.json()
                check_eq("提交返回 status=queued", job.get("status"), "queued")
                check("提交返回合法 job_id", server._is_valid_job_id(job.get("job_id")), job)

                job_id = job["job_id"]
                deadline = time.time() + 10
                state = {}
                while time.time() < deadline:
                    state = client.get("/api/video/jobs/" + job_id).json()
                    if state.get("status") in ("done", "failed"):
                        break
                    time.sleep(0.05)
                check("轮询到终态", state.get("status") in ("done", "failed"), state)
                check_eq("未装 yt-dlp -> failed", state.get("status"), "failed")
                check_eq(
                    "失败错误码 download_failed",
                    (state.get("error") or {}).get("code"),
                    "download_failed",
                )
                check("失败任务含 progress/stage", "progress" in state and "stage" in state, state)
            finally:
                server.validate_target_url = original_validate

            # 8.7 job_id 格式 / 不存在
            check_eq("非法 job_id -> 400", client.get("/api/video/jobs/not-a-job").status_code, 400)
            check_eq(
                "未知 job_id -> 404",
                client.get("/api/video/jobs/" + server._new_job_id()).status_code,
                404,
            )
    finally:
        server.ASR_PROVIDER, server.OCR_ENABLED, server.WORKER_TOKEN = old_provider, old_ocr, old_token


# ─────────────────────────── 9. 深度任务内部件（不依赖真实 yt-dlp/ffmpeg/OCR） ───────────────────────────


def _make_job(url="https://www.bilibili.com/video/BV1xx", include=None):
    now = time.time()
    return {
        "job_id": server._new_job_id(),
        "status": "queued",
        "progress": 0.0,
        "stage": "queued",
        "url": url,
        "include": dict(include or {"transcript": True, "ocr": False}),
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }


def test_deep_job_table():
    original_pipeline = server._deep_pipeline
    job = _make_job()
    with server._jobs_lock:
        server._jobs[job["job_id"]] = job
    success_result = {
        "success": True,
        "source": "bilibili",
        "url": "https://www.bilibili.com/video/BV1xx",
        "title": "t",
        "duration": 1,
        "uploader": None,
        "transcript": None,
        "on_screen_urls": [],
        "degraded": False,
    }
    server._deep_pipeline = lambda *_a, **_kw: success_result
    try:
        server._run_deep_job(job["job_id"])
        with server._jobs_lock:
            done_job = server._jobs[job["job_id"]]
        check_eq("后台任务成功 -> done", done_job["status"], "done")
        check_eq("done 写回 result", (done_job.get("result") or {}).get("success"), True)
        check_eq("done progress=1", done_job["progress"], 1.0)
        public = server._job_public(done_job)
        check("job_public 含 result 且无 error", "result" in public and "error" not in public, public)

        fail_job = _make_job(include={"transcript": True, "ocr": False})
        with server._jobs_lock:
            server._jobs[fail_job["job_id"]] = fail_job
        server._deep_pipeline = lambda *_a, **_kw: (_ for _ in ()).throw(
            server.DeepTaskError("asr_failed", "boom")
        )
        server._run_deep_job(fail_job["job_id"])
        with server._jobs_lock:
            failed_job = server._jobs[fail_job["job_id"]]
        check_eq("后台任务失败 -> failed", failed_job["status"], "failed")
        check_eq("失败 error.code 透传", (failed_job.get("error") or {}).get("code"), "asr_failed")
        check("失败 job_public 无 result", "result" not in server._job_public(failed_job))

        # 过期清理：完成超过 TTL 的任务应被移除
        with server._jobs_lock:
            failed_job["updated_at"] = time.time() - server.DEEP_JOB_TTL_SECS - 5
            server._cleanup_jobs_locked()
            check("过期任务被清理", fail_job["job_id"] not in server._jobs)
            check("未过期任务保留", job["job_id"] in server._jobs)
            server._jobs.pop(job["job_id"], None)
    finally:
        server._deep_pipeline = original_pipeline
        with server._jobs_lock:
            server._jobs.pop(job["job_id"], None)


class _FakeOCR:
    def __call__(self, _image_path):
        return (
            [
                [[[0, 0, 1, 1]], "访问 https://ulink.ren/a，", 0.93],
                [[[0, 0, 1, 1]], "www.example.com", 0.8],
            ],
            0.01,
        )


class _FakeOCRPlain:
    def __call__(self, _image_path):
        return [[[[0, 0, 1, 1]], "bilibili.com", 0.9]]


class _FakeYoutubeDL:
    """最小 yt-dlp 替身：按 outtmpl 写一个假媒体文件，返回 info。"""

    instances = []

    def __init__(self, opts):
        self.opts = opts
        _FakeYoutubeDL.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def extract_info(self, _url, download=False):
        outtmpl = self.opts.get("outtmpl") or ""
        path = outtmpl.replace("%(id)s", "fake").replace("%(ext)s", "webm")
        size = int(self.opts.pop("_fake_size", 1024))
        if download and path:
            with open(path, "wb") as handle:
                handle.write(b"0" * size)
            return {"id": "fake", "ext": "webm", "filepath": path}
        return {"id": "fake", "duration": 10, "title": "fake video", "webpage_url": _url}


class _FakeYtDlpModule:
    YoutubeDL = _FakeYoutubeDL


def test_deep_helpers():
    # OCR 返回结构兼容（(blocks, elapse) 与纯 blocks 两种）
    blocks = server._ocr_frame(_FakeOCR(), "frame.jpg")
    check_eq("OCR 块解析（tuple 返回）", blocks, [("访问 https://ulink.ren/a，", 0.93), ("www.example.com", 0.8)])
    check_eq(
        "OCR 文本块 -> URL 提取",
        server.extract_urls_from_text(blocks[0][0]),
        ["https://ulink.ren/a"],
    )
    check_eq("OCR 纯 blocks 返回兼容", server._ocr_frame(_FakeOCRPlain(), "f.jpg"), [("bilibili.com", 0.9)])
    check_eq("OCR 引擎异常 -> []", server._ocr_frame(lambda _p: (_ for _ in ()).throw(RuntimeError("x")), "f.jpg"), [])

    # 无 ffmpeg 时报可归因错误（而不是崩溃 / 静默成功）
    original_ffmpeg_ready = server._ffmpeg_ready
    server._ffmpeg_ready = lambda: False
    try:
        try:
            server._to_wav("no.mp4", tempfile.gettempdir(), time.time() + 5)
            check("无 ffmpeg 转码 -> internal", False, "no exception")
        except server.DeepTaskError as exc:
            check("无 ffmpeg 转码 -> internal", exc.code == "internal" and "ffmpeg" in exc.message, (exc.code, exc.message))
        try:
            server._extract_frames("no.mp4", tempfile.gettempdir(), 10.0, time.time() + 5)
            check("无 ffmpeg 抽帧 -> internal", False, "no exception")
        except server.DeepTaskError as exc:
            check("无 ffmpeg 抽帧 -> internal", exc.code == "internal" and "ffmpeg" in exc.message)
    finally:
        server._ffmpeg_ready = original_ffmpeg_ready

    # yt-dlp 替身：下载文件识别 / 体积上限 / 元数据探测
    original_yt_dlp = server.yt_dlp
    server.yt_dlp = _FakeYtDlpModule
    tmpdir = tempfile.mkdtemp(prefix="ulink-selftest-")
    try:
        deadline = time.time() + 30
        info = server._deep_probe("https://www.bilibili.com/video/BV1xx", deadline)
        check_eq("yt-dlp 替身探测 duration", info.get("duration"), 10)

        path = server._deep_download(
            "https://www.bilibili.com/video/BV1xx",
            tmpdir,
            deadline,
            kind="audio",
            max_bytes=1024 * 1024,
            job_id="selftest",
            progress_base=0.1,
            progress_span=0.1,
        )
        check("yt-dlp 替身下载出本地文件", os.path.isfile(path) and os.path.basename(path).startswith("audio-fake"), path)
        check_eq("下载文件大小", os.path.getsize(path), 1024)

        oversize_dir = tempfile.mkdtemp(prefix="ulink-selftest-over-")
        try:
            try:
                server._deep_download(
                    "https://www.bilibili.com/video/BV1xx",
                    oversize_dir,
                    deadline,
                    kind="audio",
                    max_bytes=100,
                    job_id="selftest",
                    progress_base=0.1,
                    progress_span=0.1,
                )
                check("超体积上限 -> too_long", False, "no exception")
            except server.DeepTaskError as exc:
                check("超体积上限 -> too_long", exc.code == "too_long", (exc.code, exc.message))
        finally:
            shutil.rmtree(oversize_dir, ignore_errors=True)
    finally:
        server.yt_dlp = original_yt_dlp
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_mimo_channel():
    """MiMo 通道（ASR / 画面理解）的纯逻辑与就绪判定。"""
    check("ASR providers 含 mimo", "mimo" in server._ASR_PROVIDERS)
    check("OCR providers 含 mimo", "mimo" in server._OCR_PROVIDERS)

    check_eq(
        "parse_mimo_content(str)",
        server.parse_mimo_content({"choices": [{"message": {"content": "  你好 "}}]}),
        "你好",
    )
    check_eq(
        "parse_mimo_content(parts)",
        server.parse_mimo_content(
            {"choices": [{"message": {"content": [{"type": "text", "text": "a"}, {"text": "b"}]}}]}
        ),
        "ab",
    )
    check_eq("parse_mimo_content(None)", server.parse_mimo_content(None), "")
    check_eq("parse_mimo_content(空对象)", server.parse_mimo_content({}), "")

    check_eq(
        "provider=mimo -> transcript 缺省 true",
        server.resolve_include_request(None, None, asr_provider="mimo", ocr_enabled=False),
        {"transcript": True, "ocr": False},
    )

    old_key, old_asr, old_ocr = server.MIMO_API_KEY, server.ASR_PROVIDER, server.OCR_PROVIDER
    try:
        server.MIMO_API_KEY = ""
        server.ASR_PROVIDER = "mimo"
        server.OCR_PROVIDER = "mimo"
        check("mimo 无 key -> asr_ready false", server._asr_ready() is False)
        check("mimo 无 key -> ocr_ready false", server._ocr_ready() is False)
        server.MIMO_API_KEY = "test-key"
        check("mimo 有 key -> asr_ready true", server._asr_ready() is True)
        check("mimo 有 key -> ocr_ready true", server._ocr_ready() is True)

        server.MIMO_API_KEY = ""
        try:
            server._mimo_post({"model": "x"}, time.time() + 5)
            check("无 key _mimo_post -> asr_unavailable", False, "no exception")
        except server.DeepTaskError as exc:
            check(
                "无 key _mimo_post -> asr_unavailable",
                exc.code == "asr_unavailable",
                (exc.code, exc.message),
            )
    finally:
        server.MIMO_API_KEY, server.ASR_PROVIDER, server.OCR_PROVIDER = old_key, old_asr, old_ocr

    prompt = server._MIMO_VISION_PROMPT
    check("视觉提示词含 NONE", "NONE" in prompt)
    check("视觉提示词禁止补全", "不要补全" in prompt)

    urls = server.extract_urls_from_text("官网 https://ulink.ren 和 www.example.com")
    check("画面模型输出含 ulink.ren", any("ulink.ren" in u for u in urls), urls)


def test_bilibili_fingerprint():
    """B站免账号指纹 Cookie（对齐 yt-dlp PR #16889）。"""
    check("B站 URL 判定（bilibili.com）", server._is_bilibili_url("https://www.bilibili.com/video/BV1xx411c7mD"))
    check("B站 URL 判定（b23.tv）", server._is_bilibili_url("https://b23.tv/fuBzhYU"))
    check("非 B站 URL 不注入", not server._is_bilibili_url("https://example.com/a"))
    check(
        "412 错误识别",
        server._is_ytdlp_412(Exception("ERROR: [BiliBili] x: HTTP Error 412: Precondition Failed")),
    )
    check("412 提示含 412", "412" in server._bilibili_retry_hint(Exception("HTTP Error 412")))

    # Challenge（SHA-256 PoW）：构造 q/r，验证能解出 i
    q = "selftest-question"
    target_i = 7
    payload = {"q": q, "r": __import__("hashlib").sha256((q + str(target_i)).encode()).hexdigest()}
    check("PoW 求解正确", server._bilibili_challenge_result(payload) == target_i)
    check("PoW 无 q/r 返回 None", server._bilibili_challenge_result({}) is None)
    check_eq(
        "代理文本解析",
        server._parse_proxy_text("117.68.5.80:45881\n"),
        "http://117.68.5.80:45881",
    )
    check_eq("代理文本非法", server._parse_proxy_text("error"), "")

    # 扩展上报媒体地址：只接受平台 CDN + https + 白名单端口
    client_media = server._sanitize_client_media(
        {
            "platform": "bilibili",
            "audio_urls": [
                "https://xy.mcdn.bilivideo.cn:8082/v1/a.m4s",
                "http://evil.example/a.m4s",
                "https://evil.example/a.m4s",
            ],
            "video_urls": ["https://cn.bilivideo.com/v1/v.m4s"],
            "title": "t",
            "duration": 12,
        }
    )
    check("client 媒体白名单", bool(client_media) and len(client_media["audio_urls"]) == 1)
    check("client 视频白名单", bool(client_media) and len(client_media["video_urls"]) == 1)
    check(
        "client 非白名单平台拒绝",
        server._sanitize_client_media({"platform": "evil", "audio_urls": ["https://cn.bilivideo.com/a"]}) is None,
    )
    # JWT payload 解码
    import base64 as _b64
    import json as _json
    fake_payload = _b64.urlsafe_b64encode(_json.dumps({"q": "x", "r": "y"}).encode()).decode().rstrip("=")
    fake_token = "header." + fake_payload + ".signature"
    check("JWT payload 解码", server._jwt_payload(fake_token).get("q") == "x")

    # challenge token 会写入 cookiefile
    old_sec = dict(server._bili_sec_cache)
    try:
        server._bili_sec_cache.update({"token": "sec-token-value", "exp": time.time() + 3600})
        merged_sec = server._write_bilibili_cookiefile(None)
        if merged_sec:
            sec_text = open(merged_sec, "r", encoding="utf-8").read()
            check("cookiefile 含 challenge token", "X-BILI-SEC-TOKEN\tsec-token-value" in sec_text)
        else:
            check("cookiefile 含 challenge token", False, "no file")
    finally:
        server._bili_sec_cache.clear()
        server._bili_sec_cache.update(old_sec)

    old_fp = server._bilibili_fingerprint
    base_fd, base_path = tempfile.mkstemp(prefix="ulink-selftest-cookies-", suffix=".txt")
    try:
        with os.fdopen(base_fd, "w", encoding="utf-8") as handle:
            handle.write(".bilibili.com\tTRUE\t/\tFALSE\t1999999999\tSESSDATA\tkeep-me\n")
        server._bilibili_fingerprint = lambda force=False: {
            "buvid3": "b3-value",
            "buvid4": "b4-value",
            "buvid_fp": "fp-value",
        }
        merged = server._write_bilibili_cookiefile(base_path)
        check("合并 cookie 文件已生成", bool(merged and os.path.exists(merged)), merged)
        if merged:
            merged_text = open(merged, "r", encoding="utf-8").read()
            check("保留用户原有 Cookie", "SESSDATA\tkeep-me" in merged_text)
            check("包含 buvid_fp", "buvid_fp\tfp-value" in merged_text)
            check("包含 buvid3", "buvid3\tb3-value" in merged_text)
            opts = {"http_headers": {"User-Agent": "ua"}}
            server._apply_bilibili_fingerprint(opts, "https://www.bilibili.com/video/BV1")
            check("注入 Referer", opts["http_headers"].get("Referer") == "https://www.bilibili.com/")
            check("注入 cookiefile", "cookiefile" in opts)
        opts_other = {"http_headers": {"User-Agent": "ua"}}
        server._apply_bilibili_fingerprint(opts_other, "https://example.com/a")
        check("非 B站不注入", "cookiefile" not in opts_other)
    finally:
        server._bilibili_fingerprint = old_fp
        for path in (base_path,):
            try:
                os.unlink(path)
            except OSError:
                pass


def main():
    print("== ulink video-worker selftest ==")
    test_platform_list()
    test_platform_detection()
    test_dns_preflight()
    test_subtitle_track()
    test_extract_urls()
    test_aggregate_votes()
    test_include_and_job_id()
    test_endpoints()
    test_deep_job_table()
    test_deep_helpers()
    test_mimo_channel()
    test_bilibili_fingerprint()
    print("")
    if failures:
        print("FAILED %d check(s): %s" % (len(failures), ", ".join(failures)))
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
