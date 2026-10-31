# ULink 视频智能灵感提取微服务 (Video Intelligence Worker)

> **2026-10-31 校正（先读）**：线上方案是 **MiMo ASR/OCR**（`WORKER_ASR_PROVIDER=mimo` + `MIMO_API_KEY`），不是 `faster_whisper`/`rapidocr`（后者仅为离线备选）。因此：
> - `include.transcript` 缺省 = ASR **真正就绪**（provider≠none 且依赖/密钥齐全）；`include.ocr` 缺省 = OCR 就绪（mimo 只看 provider+key，rapidocr 才要 `WORKER_OCR_ENABLED`）。
> - `transcript.provider` 枚举为 `mimo | faster_whisper | http`；mimo 无时间戳 → `segments=[]` 且 `degraded=true`。
> - §6.2 只写了 rapidocr 的开启方式，MiMo 路径见 §3（只需 provider=mimo + key，无需 `INSTALL_DEEP`）。
> - 经云函数 `deep_status` 轮询时，worker 侧「job 不存在」会被映射为 **503 `deep_unavailable`**（直连 worker 才是 404）。
> - 部署命令请用 `bash <tcb> ...`（Windows 用同目录 `tcb.cmd`），不要写成 `node <tcb> ...`。
> - `/health` 示例里的 `deep_ready=false` 只是示例；实际 `deep_ready = asr_ready || ocr_ready`。

基于 **yt-dlp + Playwright + ffmpeg + FastAPI** 的视频元数据 / 字幕 / 口播转写 / 画面网址提取微服务，配套与链（ulink）的「视频内容解析」会员权益。

接口契约唯一真源：[`docs/VIDEO_DEEP_EXTRACT.md`](../../docs/VIDEO_DEEP_EXTRACT.md)。本 README 只写 worker 侧实现与运维细节，**字段结构以契约为准**。

三条链路：

1. **yt-dlp 元数据链路（同步）**：B站、YouTube、Twitter/X 等 1000+ 平台，`--skip-download` 只取 JSON 元数据 + 章节 + 评论 + 字幕；
2. **Playwright 无头浏览器兜底（同步）**：抖音、小红书、TikTok 这类「强风控 / 需 JS 渲染」的页面，直接读取渲染后的标题与简介文本——纯 HTTP 抓取（r.jina.ai 等）在这些站点上会直接 502，浏览器是唯一稳定路径；
3. **深度解析（异步任务，P1/P2）**：平台没有字幕轨时下载音频做 ASR 口播转写；只出现在画面里的网址用 ffmpeg 抽帧 + OCR 提取并按帧投票聚合。

> 平台域名清单唯一真源是 `src/config/videoPlatforms.json`，由 `node scripts/build-fn-assets.mjs`
> 复制为本目录的 `video-platforms.json`，`server.py` 启动时读取（文件缺失/损坏时回落内置常量）。
> **不要手改本目录的副本**，改真源后重新跑构建脚本。

---

## 一、 文件说明

| 文件 | 说明 |
| --- | --- |
| `server.py` | 服务全部实现（同步接口 + 深度任务 + 纯函数） |
| `selftest.py` | 纯函数 / 接口自测，**不依赖** yt-dlp / playwright / ASR / OCR，本地与容器内都能跑 |
| `requirements.txt` | 轻量运行依赖（serving + yt-dlp + playwright） |
| `requirements-deep.txt` | 深度解析可选依赖（faster-whisper / rapidocr-onnxruntime / opencv / numpy） |
| `video-platforms.json` | 平台域名清单（构建脚本从真源复制，勿手改） |
| `Dockerfile` | 镜像构建，`ARG INSTALL_DEEP=0` 默认不装深度依赖 |

---

## 二、 一键本地启动（开发测试）

```bash
cd scripts/video-worker

# 1. 安装轻量依赖（深度解析可选：pip install -r requirements-deep.txt）
pip install -r requirements.txt
playwright install chromium

# 2. 自检（纯函数 + 接口，不联网、不需要 yt-dlp/浏览器）
python selftest.py

# 3. 启动服务（默认监听 8080 端口）
python server.py
```

访问 `http://localhost:8080/docs` 可看到 OpenAPI 调试文档；`GET /health` 会回报每条链路与深度能力的就绪状态。

> 本机未安装 yt-dlp / playwright / faster-whisper / rapidocr 时**服务仍可正常启动**，
> `/health` 如实返回 `yt_dlp_loaded=false` / `playwright_loaded=false` / `asr_ready=false` / `ocr_ready=false`，
> 对应接口返回结构化错误而非崩溃。

---

## 三、 Docker 容器化部署（生产推荐）

### 方式 A：CloudBase 云托管（当前线上方案，国内节点）

```bash
node <tcb> cloudrun deploy -e ulink-d1g5srvjo54b1886a \
  --service-name ulink-video-worker \
  --source scripts/video-worker \
  --port 8080 --min-num 0 --max-num 1 \
  --open-access-types PUBLIC --force --wait --yes
```

- 服务地址：`tcb cloudrun detail -s ulink-video-worker --json` 里的 `DefaultDomainName`
- 环境变量（如 `WORKER_TOKEN`）CLI 目前不支持传参，需在控制台「服务设置 → 环境变量」里配置；
  未配置 Token 时服务依赖「仅视频平台域名白名单 + 60 次/分/IP 限流」防滥用（**公网暴露强烈建议配 Token**）。
- 冷启动：`min-num 0` 空闲缩容到 0，首次请求约 10~25 秒（含浏览器预热）。**个人版 CloudBase 不建议常驻
  `min-num 1`**（2GB 常驻约 57.6 万资源点/月，是个人版套餐的 14 倍）；冷启动可接受或临时调大云函数超时。
- **推荐启用方式（MiMo，无需重依赖、镜像不变）**：
  1. 控制台「服务设置 → 环境变量」加 `MIMO_API_KEY`、`WORKER_ASR_PROVIDER=mimo`、`WORKER_OCR_PROVIDER=mimo`；
  2. 可选调 `WORKER_OCR_MIMO_MAX_FRAMES`（默认 12）、`WORKER_ASR_LANGUAGE=zh`；
  3. `GET /health` 应看到 `asr_ready=true`、`ocr_ready=true`、`mimo_configured=true`。
  成本：ASR ¥0.5/小时音频、画面理解按 token（实测约 ¥0.0004/帧），2 次/天约 ¥6~9/月；CloudBase 只承担
  yt-dlp 下载 + ffmpeg（约 10~20 资源点/次，占个人版额度 1~3%）。
- **离线方案（可选）**：默认镜像不含 `whisper`/`rapidocr` 依赖（`INSTALL_DEEP=0`）。若要在镜像内跑，
  用 `docker build --build-arg INSTALL_DEEP=1`（或把 Dockerfile 的 `ARG INSTALL_DEEP=0` 改为 `1`）后
  `--source`/`--image-url` 部署，再配 `WORKER_OCR_PROVIDER=rapidocr`、`WORKER_ASR_PROVIDER=faster_whisper`
  （模型需可用）。注意 1C2G 上 10 分钟音频 ASR 约 133 资源点/次，且容易撞 300s 任务超时。

### 方式 B：自有 VPS + Docker

```bash
cd scripts/video-worker

# 默认：与旧版行为一致（仅元数据/字幕 + 浏览器兜底）
docker build -t ulink-video-worker:latest .

# 开启深度解析依赖（镜像会大数百 MB）
docker build --build-arg INSTALL_DEEP=1 -t ulink-video-worker:deep .

docker run -d --name ulink-video-worker -p 8080:8080 --restart=always \
  -e WORKER_TOKEN=<强随机口令> \
  -e WORKER_ASR_PROVIDER=faster_whisper \
  -e WORKER_OCR_ENABLED=true \
  ulink-video-worker:deep
```

节点选择建议：

- **国内/香港节点**：抖音、小红书更稳（这些站点对海外机房 IP 风控更严）；
- **海外节点**：YouTube、Twitter/X 更稳（YouTube 在无代理的国内网络基本不可用，见第六节）；
- 两者都要覆盖时，可部署两台，函数侧按域名分流（或国内节点 + `YTDLP_PROXY` 出海外）。

构建/运行自检：

```bash
docker run --rm ulink-video-worker:latest python selftest.py
curl -s http://127.0.0.1:8080/health | python -m json.tool
```

---

## 四、 环境变量

### 4.1 抓取与同步接口

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 监听端口，默认 8080 |
| `WORKER_TOKEN` | 否* | 调用口令；配置后**所有** `/api/video/*` 请求必须带 `X-Worker-Token`。*公网暴露时必须配置 |
| `YTDLP_COOKIES` | 否 | Netscape 格式 cookies 全文（抖音/YouTube 风控时必需） |
| `YTDLP_COOKIES_FILE` | 否 | 挂载的 cookies.txt 路径（优先于 `YTDLP_COOKIES`） |
| `YTDLP_PROXY` | 否 | yt-dlp 出站代理（国内节点抓 YouTube 必需，`/health` 的 `proxy_configured` 反映该项） |
| `BILI_PROXY_API` | 否 | B站专用动态代理「提取链接」（含 trade_no/sign，放环境变量）。worker 每次任务前调用它取 `ip:port`，**只给 B站请求用**；`auto_white=1` 会白名单当前 worker 出口 IP |
| `BILI_PROXY_TTL_SECS` | 否 | 代理缓存时长，默认 120 秒（过期/失败自动重取） |
| `WORKER_BROWSER_TIMEOUT_MS` | 否 | 浏览器单页加载超时，默认 20000 |
| `WORKER_BROWSER_SETTLE_MS` | 否 | 页面渲染后等待时长，默认 3000 |
| `WORKER_BROWSER_PROFILE_DIR` | 否 | 浏览器持久化 profile 目录（保留 Cookie，默认系统临时目录） |
| `WORKER_BROWSER_ENABLED` | 否 | 设为 `false` 可关闭浏览器兜底（仅用 yt-dlp） |
| `WORKER_MAX_TEXT_CHARS` | 否 | 文本上限，默认 20000 |
| `WORKER_UPSTREAM_TIMEOUT_MS` | 否 | 上游请求/yt-dlp socket 超时，默认 12000 |
| `WORKER_YOUTUBE_DNS_STRICT` | 否 | YouTube DNS 严格预检，默认 `true`：除私网/保留地址外，还拒绝已知污染段与非 Google 网络（见第七节）；`false` 只查私网 |
| `WORKER_COMMENT_LIMIT` | 否 | `include_comments=true` 时最多回传的评论条数，默认 15（0 关闭） |
| `WORKER_ALLOW_ANY_HOST` | 否 | 默认 `false`：只允许视频平台域名，避免服务被当成任意网站代理 |
| `WORKER_RATE_LIMIT_PER_MIN` | 否 | 单 IP 每分钟请求上限，默认 60（0 关闭） |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | 否 | 指向宿主机 Chrome/Edge（本地调试用；容器默认用镜像内 chromium） |

### 4.2 深度解析（异步任务）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `WORKER_DEEP_CONCURRENCY` | 否 | `1` | 同时执行的深度任务数，其余排队 |
| `WORKER_DEEP_MAX_SECONDS` | 否 | `900` | 视频时长上限（秒），超限任务返回 `too_long` |
| `WORKER_DEEP_MAX_MB` | 否 | `200` | 单任务下载体积上限（MB），超限返回 `too_long` |
| `WORKER_DEEP_TIMEOUT_SECS` | 否 | `300` | 单任务总超时（秒），超时返回 `internal` |
| `WORKER_DEEP_JOB_TTL_SECS` | 否 | `1800` | 任务状态内存保留时长（30 分钟），过期清理 |
| `WORKER_DEEP_MAX_QUEUE` | 否 | `16` | 排队 + 运行中任务数上限，超出返回 503 |
| `WORKER_DEEP_TRANSCRIPT_MAX_CHARS` | 否 | `60000` | 转写文本截断长度 |
| `WORKER_ASR_PROVIDER` | 否 | `none` | `mimo`（推荐，小米 MiMo 语音识别，无需重依赖）/ `none` / `faster_whisper` / `http` |
| `MIMO_API_KEY` | 建议 | — | `WORKER_ASR_PROVIDER=mimo` 或 `WORKER_OCR_PROVIDER=mimo` 时必填；只放服务端环境变量 |
| `MIMO_BASE_URL` | 否 | `https://api.xiaomimimo.com/v1` | MiMo OpenAI 兼容接口根地址 |
| `WORKER_ASR_MIMO_MODEL` | 否 | `mimo-v2.5-asr` | MiMo 语音识别模型 ID |
| `WORKER_ASR_MIMO_CHUNK_SECS` | 否 | `90` | 音频分片长度（秒）；服务端 base64 上限 10MB，90s mp3 约 0.4MB |
| `WORKER_ASR_MIMO_MIN_INTERVAL_SECS` | 否 | `1.5` | 分片请求最小间隔，避免撞 ASR 的 RPM/TPM |
| `WORKER_OCR_MIMO_MODEL` | 否 | `mimo-v2.6-flash` | 画面理解模型 ID |
| `WORKER_OCR_MIMO_MAX_FRAMES` | 否 | `12` | MiMo 画面理解最多送帧数（每帧一次请求，建议 8~12 控制时延/成本） |
| `WORKER_MIMO_TIMEOUT_SECS` | 否 | `120` | 单次 MiMo 请求超时 |
| `WORKER_MIMO_MAX_RETRIES` | 否 | `2` | 429/5xx 重试次数 |
| `WORKER_ASR_MODEL` | 否 | `base` | faster-whisper 模型名（tiny/base/small/medium/large-v3…） |
| `WORKER_ASR_DEVICE` | 否 | `cpu` | faster-whisper 设备（cpu/cuda） |
| `WORKER_ASR_COMPUTE_TYPE` | 否 | `int8` | faster-whisper 计算精度（int8/float16…） |
| `WORKER_ASR_LANGUAGE` | 否 | 自动 | 指定语言（如 `zh`）可减少误判、加快收敛 |
| `WORKER_ASR_HTTP_URL` | 否 | — | `WORKER_ASR_PROVIDER=http` 时的 OpenAI 兼容接口，如 `http://asr:9000/v1/audio/transcriptions` |
| `WORKER_ASR_HTTP_TOKEN` | 否 | — | 上述接口的 Bearer Token |
| `WORKER_ASR_HTTP_MODEL` | 否 | `whisper-1` | 上述接口的 model 字段 |
| `WORKER_ASR_HTTP_TIMEOUT_SECS` | 否 | `240` | 上述接口超时（秒） |
| `WORKER_OCR_PROVIDER` | 否 | `none` | `mimo`（推荐，多模态理解，无需重依赖）/ `rapidocr`（本地离线，需 `INSTALL_DEEP=1`）/ `none` |
| `WORKER_OCR_ENABLED` | 否 | `false` | 旧开关：仅设它时等价 `WORKER_OCR_PROVIDER=rapidocr`（兼容旧配置） |
| `WORKER_OCR_SCENE_THRESHOLD` | 否 | `0.3` | ffmpeg 场景切换阈值（scene>阈值 视为换帧点） |
| `WORKER_OCR_MAX_FRAMES` | 否 | `24` | 单任务最多 OCR 的帧数（场景帧优先，其余均匀采样） |
| `WORKER_OCR_SAMPLE_SECS` | 否 | `5` | 兜底采样的最小间隔（秒） |
| `WORKER_FFMPEG_PATH` | 否 | `ffmpeg` | ffmpeg 可执行文件路径（PATH 中已有则无需配置） |

---

## 五、 API

所有 `/api/video/*` 接口在配置 `WORKER_TOKEN` 后都要求请求头 `X-Worker-Token: <token>`；同时按 IP 限流（默认 60 次/分）。

### 5.1 `GET /health`

```json
{
  "status": "ok",
  "worker": "ulink-video-worker",
  "version": "1.2.0",
  "yt_dlp_loaded": true,
  "yt_dlp_version": "2025.1.15",
  "playwright_loaded": true,
  "cookies_configured": false,
  "proxy_configured": false,
  "asr_provider": "mimo",
  "asr_ready": true,
  "ocr_provider": "mimo",
  "ocr_ready": true,
  "ocr_enabled": false,
  "mimo_configured": true,
  "asr_mimo_model": "mimo-v2.5-asr",
  "ocr_mimo_model": "mimo-v2.6-flash",
  "deep_ready": false,
  "ffmpeg_ready": true,
  "youtube_dns_strict": true,
  "platform_list_source": "file",
  "allowed_hosts_count": 24,
  "deep_concurrency": 1,
  "deep_jobs_active": 0,
  "deep_jobs_queued": 0,
  "deep_limits": { "max_seconds": 900, "max_mb": 200, "timeout_secs": 300, "job_ttl_secs": 1800 }
}
```

`platform_list_source` 为 `file`（读到 video-platforms.json）或 `builtin`（回落内置常量）。
`asr_ready` / `ocr_ready` 只表示**依赖与配置就绪**，faster-whisper 的模型仍需首次调用时下载/加载。

### 5.2 `POST /api/video/extract`（同步元数据 / 字幕）

```json
{ "url": "https://v.douyin.com/xxxx/", "include_subtitles": true, "include_comments": false }
```

`include_comments`（默认 `false`）：为 `true` 时 yt-dlp 开 `getcomments`，最多回传 `WORKER_COMMENT_LIMIT` 条评论（抓评论会明显变慢，同步接口默认关闭）。

响应（与 `extract-video` 云函数对外结构一致，新增 `provider` / `error_code`）：

```json
{
  "success": true,
  "source": "douyin",
  "url": "https://www.douyin.com/video/7701700795477003571",
  "title": "视频文案 / 标题",
  "description": "视频简介（抖音为完整分享文案，含话题标签）",
  "subtitles": "[字幕全文，未取到则为空；轨道优先中文再英文]",
  "chapters": [{ "title": "引言", "start_time": 0, "end_time": 60 }],
  "comments": ["置顶评论..."],
  "duration": 213,
  "uploader": "博主名称",
  "provider": "yt-dlp",
  "error_code": null,
  "error": null
}
```

- `provider`：`yt-dlp`（元数据链路）或 `browser`（浏览器兜底）；都没成功时为 `none`。
- YouTube 快速失败：命中 `youtube.com` / `youtu.be` 时先做 **DNS 预检**，域名解析失败或解析到
  私网/回环/保留地址（典型的 DNS 污染）、已知污染地址段、或非 Google/YouTube 网络时立即返回
  （不会白等 45s；配了 `YTDLP_PROXY` 时跳过预检，因为 DNS 由代理侧解析）：

```json
{
  "success": false,
  "source": "youtube",
  "provider": "none",
  "error_code": "youtube_unreachable",
  "error": "YouTube DNS 预检失败：域名解析到内网/保留地址（疑似 DNS 污染）（127.0.0.1）。本服务所在网络无法直连 YouTube，请配置 YTDLP_PROXY 或改用其它解析链路。"
}
```

短链（`v.douyin.com` / `b23.tv` / `xhslink.com` 等，见 video-platforms.json 的 `resolverShortLinkHosts`）由 worker 先解析跳转再抓取；非白名单域名一律 400。

### 5.3 `POST /api/video/jobs`（提交深度任务）

```json
{
  "url": "https://www.bilibili.com/video/BV1xx411c7mD",
  "include": { "transcript": true, "ocr": true }
}
```

- `include.transcript` 缺省 = 是否配置了 ASR（`WORKER_ASR_PROVIDER != none`）；
- `include.ocr` 缺省 = `WORKER_OCR_ENABLED`；
- 两者都 false：显式指定 → 400；未显式指定且 worker 未配置任何深度能力 → 503（`deep_unavailable`）；
- YouTube 且未配 `YTDLP_PROXY`：提交时即做严格 DNS 预检，不可达直接 503（`deep_unavailable`），
  避免云函数扣了额度才在任务里失败；配了代理则跳过本地预检。

成功返回 **202**：

```json
{ "job_id": "9f2c1b7d5a4e4c3b8a1f0e2d6c9b7a5e", "status": "queued" }
```

`job_id` 为 32 位随机 hex；非法格式 400，不存在 404，队列满 503，Token 错误 401，超限流 429。

### 5.4 `GET /api/video/jobs/{job_id}`（轮询）

```json
{
  "job_id": "9f2c1b7d5a4e4c3b8a1f0e2d6c9b7a5e",
  "status": "running",
  "progress": 0.42,
  "stage": "asr"
}
```

`status`：`queued` → `running` → `done` | `failed`；`stage`：`queued` / `download` / `asr` / `ocr` / `aggregate` / `done`。

完成（`done`）：

```json
{
  "job_id": "9f2c...",
  "status": "done",
  "progress": 1.0,
  "stage": "done",
  "result": {
    "success": true,
    "source": "bilibili",
    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
    "title": "视频标题",
    "duration": 123,
    "uploader": "UP 主",
    "transcript": {
      "text": "转写全文",
      "segments": [{ "start": 0.0, "end": 3.2, "text": "..." }],
      "provider": "faster_whisper",
      "language": "zh"
    },
    "on_screen_urls": [{ "url": "https://example.com", "confidence": 0.92, "frames": 3 }],
    "degraded": false
  }
}
```

- `transcript`：未请求/未执行时为 `null`；`provider` 为 `faster_whisper` 或 `http`；
  `http` 服务若只返回纯文本（无 `segments`），`degraded=true`（如实标记时间轴缺失）。
- `on_screen_urls`：跨帧投票聚合结果，`confidence = 0.6 × 出现帧占比 + 0.4 × 平均 OCR 置信度`，
  按 `frames` 降序；同一站点的 `www.`/协议写法会合并。

失败（`failed`）：

```json
{
  "job_id": "9f2c...",
  "status": "failed",
  "progress": 0.3,
  "stage": "asr",
  "error": { "code": "asr_unavailable", "message": "未配置 ASR（WORKER_ASR_PROVIDER=none）..." }
}
```

`error.code` 枚举：`download_failed` / `too_long` / `no_audio` / `asr_unavailable` / `asr_failed` /
`ocr_unavailable` / `internal`。**绝不伪造**：拿不到转写/网址就如实失败或返回空列表。

### 5.5 深度任务流程与限制

```
短链解析 → YouTube DNS 预检 → yt-dlp 元数据探测（时长上限）
        → yt-dlp bestaudio → ffmpeg 16kHz 单声道 wav → ASR
        → [可选] yt-dlp ≤720p 视频 → ffmpeg 场景检测抽帧 + 兜底采样 → rapidocr → URL 提取投票
        → 汇总
```

- 并发：`WORKER_DEEP_CONCURRENCY`（默认 1）个任务并行，其余在内存队列排队；
- 上限：时长 `WORKER_DEEP_MAX_SECONDS`、体积 `WORKER_DEEP_MAX_MB`、单任务超时 `WORKER_DEEP_TIMEOUT_SECS`；
- 状态存内存（30 分钟过期，进程重启即丢失）——**已知限制**，后续可落库；
- 抽帧策略：`scene > 0.3` 的场景切换帧优先（最多一半配额），其余按时间均匀采样兜底，
  总帧数受 `WORKER_OCR_MAX_FRAMES` 限制（默认 24 帧）。

---

## 六、 开启深度解析

### 6.1 ASR（二选一）

**A. 本地 faster-whisper**：`--build-arg INSTALL_DEEP=1` 构建镜像后配置

```bash
WORKER_ASR_PROVIDER=faster_whisper
WORKER_ASR_MODEL=base          # 中文建议 small/medium 以上；base 更快但准确率有限
WORKER_ASR_LANGUAGE=zh         # 可选，指定后更快更稳
```

注意：首次任务会下载模型（HuggingFace，国内需配 `HF_ENDPOINT` 镜像或预置模型缓存），
`small` 以上模型 CPU 推理较慢，建议给容器 ≥2GB 内存并适当调大 `WORKER_DEEP_TIMEOUT_SECS`。

**B. OpenAI 兼容 HTTP**：worker 只做下载 + 转码，音频发往该服务

```bash
WORKER_ASR_PROVIDER=http
WORKER_ASR_HTTP_URL=http://asr-service:9000/v1/audio/transcriptions
WORKER_ASR_HTTP_TOKEN=<token>
WORKER_ASR_HTTP_MODEL=whisper-1
```

### 6.2 画面 OCR

```bash
# 镜像内需装 requirements-deep.txt（INSTALL_DEEP=1）
WORKER_OCR_ENABLED=true
```

`/health` 的 `ocr_ready` 变为 `true` 后，带 `include.ocr=true` 的任务才会真正抽帧 OCR；
未安装 `rapidocr_onnxruntime` 时返回 `ocr_unavailable`，不影响纯 ASR 任务。

### 6.3 不开启深度解析时

默认配置（`WORKER_ASR_PROVIDER=none` + `WORKER_OCR_ENABLED=false`）下镜像行为与旧版一致：
同步接口正常，深度任务提交返回 503 `deep_unavailable`，`/health.deep_ready=false`。

---

## 七、 YouTube 无代理的真实限制（必须知情）

- YouTube 在中国大陆网络通常**无法直连**：DNS 被污染（解析到回环/内网地址，或返回
  Twitter/Facebook 等无关公网 IP——本项目已内置常见污染段识别）、或 TCP 被阻断。
- 本服务不会假装成功：命中 YouTube 域名先做 DNS 预检，失败立即返回
  `success=false` + `error_code=youtube_unreachable`（同步接口），深度任务返回 `download_failed`。
  默认严格模式（`WORKER_YOUTUBE_DNS_STRICT=true`）还会校验解析结果必须落在 YouTube 所属的
  Google 网络；若所在网络返回正常可用但不在预置网段内的地址，可设
  `WORKER_YOUTUBE_DNS_STRICT=false` 只保留私网检查。
- 配了 `YTDLP_PROXY` 时**跳过**本地 DNS 预检（DNS 由代理侧解析），`/health.proxy_configured=true`
  可自检；未配代理则本机几乎必然拿到 `youtube_unreachable`。
- 要在国内节点解析 YouTube，**必须**给 worker 配 `YTDLP_PROXY`，或把 worker 部署在海外节点。
  这也意味着 YouTube 的可用性取决于代理质量，不是代码问题。
- B站 / 抖音 / 小红书等国内平台不受影响。

---

## 七点五、 B站 412 与「免账号指纹 Cookie」

B站对缺少设备指纹 Cookie 的请求会返回 **HTTP 412**（即使不登录）。本服务已内置社区修复
（对齐 yt-dlp PR [#16889](https://github.com/yt-dlp/yt-dlp/pull/16889)，该 PR 目前 open、未合并）：

- 从 `https://api.bilibili.com/x/frontend/finger/spi` 取 `buvid3` / `buvid4`；
- 本地生成 `buvid_fp`（md5 随机）；
- 合并进 yt-dlp 的 cookiefile，并补 `Referer` / `Origin` / `Sec-CH-UA` 等浏览器特征头；
- 命中 412 时先尝试**解 B站 challenge**（见下），再换新指纹重试（最多 3 次），仍失败则如实返回
  「B站触发 412 风控（已尝试指纹与 challenge 验证）：可能是当前出口 IP 被限流」。
- **不需要任何账号**；只有出现 `v_voucher`（B站要求 cookie 校验）或需要评论/CC 字幕时，
  才建议再配 `YTDLP_COOKIES`（浏览器 Cookie，低风险小号）。
- 指纹 Cookie 缓存在进程内 30 分钟，不落盘、不发往第三方。

### B站专用动态代理（可选，解决机房 IP 被硬限流）

如果 B站 412 是当前出口 IP 被限流（指纹/challenge/Cookie 都无法解决），可配 `BILI_PROXY_API`：

- 把代理商「提取链接」整条（含 `trade_no`/`sign`）放环境变量；worker 在 B站任务前调用它拿 `ip:port`；
- `auto_white=1` 会把**当前 worker 出口 IP** 加入白名单（所以必须由 worker 自己调 API，不能只在本机测试）；
- 代理只用于 B站请求（`yt-dlp` 的 B站链路 + challenge 探测），其它平台仍直连；
- 代理缓存默认 120 秒，过期/失败自动重取；日志会打印 `bili proxy refreshed: ip:port`；
- `/health` 可见 `bili_proxy_configured` / `bili_proxy_active`。
- ⚠️ 2026-10-31 实测：动态提取链接在本地可用（B站 API/页面 200），但从 CloudRun 容器访问
  `v2.api.juliangip.com` 会 `Max retries exceeded`（疑似代理商限制云机房 IP 或需白名单）。
  这种情况改用代理商的**隧道代理/账密认证固定入口**（`http://user:pass@host:port`），直接配
  `YTDLP_PROXY` 即可，不需要 worker 再调提取 API。

### 412 Challenge（PoW，免账号）

B站 412 响应会下发 `X-BILI-SEC-TOKEN`（JWT）。worker 会：

1. 解 JWT 拿到 `q` / `r`，暴力搜索 `i` 使 `sha256(q + i) == r`（上限 500 万次）；
2. POST `https://security.bilibili.com/th/captcha/cc/check`（`token` + `result`）换取新 token；
3. 把新 token 写入 `X-BILI-SEC-TOKEN` Cookie 并缓存到 JWT 过期，成功后 yt-dlp 重试即可正常取流。

实现对齐社区分支 `0xvd/yt-dlp-exp@fix_bilibili`，纯标准库（hashlib/base64/json），无外部依赖。

---

## 八、 安全（公网暴露必读）

1. **必须配 `WORKER_TOKEN`**：公网暴露时不配 Token，等于把「视频下载 + 转码 + OCR」算力免费开放。
   云函数侧用同值注入（`VIDEO_WORKER_TOKEN`），Token 校验覆盖 `/api/video/extract`、`/api/video/jobs`（含轮询）。
2. **域名白名单**：只允许 video-platforms.json 里的平台域名（含子域后缀匹配），且每跳短链跳转都重新校验，
   非白名单一律 400；`WORKER_ALLOW_ANY_HOST` 仅本地调试时打开。
3. **SSRF 防护**：入口与每次短链跳转都做 DNS 解析检查，解析到私网/回环/保留地址直接拒绝（fail-closed）。
4. **限流**：进程内单 IP 每分钟计数（默认 60），深度任务另有队列上限与并发上限。
5. **隐私**：深度解析会把**音视频内容**在服务端处理；若 `WORKER_ASR_PROVIDER=http`，音频会发送到
   配置的外部 ASR 服务。前端首次使用需明确告知，隐私政策需披露（见契约 §5）。
6. 建议在安全组限制来源为 CloudBase 出口 IP，或在反代层再加一层鉴权。

---

## 九、 与 ulink 生产对接（必须做，否则前端不会调用本服务）

1. 在 `.env.local` 增加：

   ```bash
   VIDEO_WORKER_URL=http://<节点IP或域名>:8080/api/video/extract
   # 可选：worker 侧配置了 WORKER_TOKEN 时，函数侧必须给同一个值
   VIDEO_WORKER_TOKEN=<与 worker 相同的口令>
   # 可选：函数侧等待 worker 的上限（毫秒），默认 45000
   EXTRACT_VIDEO_WORKER_TIMEOUT_MS=45000
   ```

2. 重新部署云函数（会把上表变量注入 `extract-video`）：

   ```bash
   node scripts/deploy-cloudbase-fn.mjs extract-video
   ```

3. 生效链路：
   - 聊天里粘贴视频链接 → `read_webpage` 命中视频平台域名 → 优先走 `extract-video`（内含 worker）；
   - 「分析此视频的内容」→ `videoHarvest` → `extract-video` → worker；
   - worker 不可用/未配置 → 自动回落到旧链路（平台专用适配器 → r.jina.ai），行为与升级前一致；
   - 深度解析（`action=deep` / `deep_status`）由云函数调用本服务同源的 `/api/video/jobs` 系列接口，
     路径与鉴权方式见契约 §2/§3。

---

## 十、 已知限制

- 任务状态仅存内存：进程重启/缩容到 0 会丢任务（客户端轮询会拿到 404，需重新提交）；
- 单 worker 默认并发 1，长视频（接近 900s）深度任务可能排队较久，云函数侧轮询上限需与之匹配；
- OCR 依赖画面清晰度与字号，字幕贴纸/台标文字也会被提取（由云函数/LLM 侧再过滤）；
- faster-whisper 长时间推理无法被硬中断，`WORKER_DEEP_TIMEOUT_SECS` 只能保证阶段间与下载/转码超时；
- 评论区抓取（`include_comments`）对 YouTube/B站有效，部分平台无评论数据返回空列表。
