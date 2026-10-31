# 视频深度解析（口播 ASR + 画面网址 OCR）设计与接口契约

> 状态：实现中（P0/P1/P2）。本文件是**接口契约的唯一真源**，前端 / 云函数 / worker 三端按此实现。
> 关联：[`scripts/video-worker/README.md`](../scripts/video-worker/README.md)、[`AGENTS.md`](../AGENTS.md) 安全段。

## 0. 背景与边界

现有链路（P0 之前）只做「元数据 + 平台自带字幕」：

```
客户端 → extract-video 云函数 → B站适配器 / YouTube Data API / yt-dlp worker → r.jina.ai 兜底
```

yt-dlp 本身**不做 ASR、不做 OCR**。本设计新增「深度解析」异步任务，补齐：

1. **仅口播**（平台无字幕轨）→ 下载音频 + ASR 转写；
2. **只出现在画面里的网址** → 下载低码率视频 + ffmpeg 抽帧 + OCR 提取 URL。

深度解析是**分钟级、百 MB 级**任务，因此**必须异步**（提交 → 轮询），不复用现有同步接口。

## 1. 单一真源

- 平台域名清单：`src/config/videoPlatforms.json`（唯一真源）
  - 客户端：`src/lib/ai/videoPlatforms.ts` 直接 import；
  - 云函数：`supabase/functions/extract-video/video-adapters.ts` 与 `cloudbase/functions/extract-video/index.js` 经 `node scripts/build-fn-assets.mjs` 内联/复制；
  - worker：`scripts/build-fn-assets.mjs` 复制为 `scripts/video-worker/video-platforms.json`，镜像里 `COPY` 进容器，`server.py` 启动时读取；
  - 漂移守卫：`src/__tests__/lib/videoPlatforms.test.ts` 断言三份一致。

## 2. 云函数接口（extract-video，POST JSON）

沿用现有 `/extract-video` 路由，用 `action` 区分：

| action | 入参 | 行为 | 配额 metric |
|---|---|---|---|
| 缺省 / `extract` | `{ url }` | 现有同步解析（保持向后兼容） | `video.extract.daily` |
| `deep` | `{ url, include?: { transcript?: boolean, ocr?: boolean } }` | 提交深度任务，立即返回 job | `video.deep.daily` |
| `deep_status` | `{ job_id }` | 查询任务状态/结果 | 不扣 |

### 2.1 `deep` 响应

```json
{ "job_id": "9f2c...", "status": "queued", "eta_seconds": 60 }
```

错误（HTTP 4xx/5xx，body 带机器码）：

```json
{ "error": "登录后可使用深度解析", "code": "login_required" }
{ "error": "今日深度解析额度已用完（每日 N 次）", "code": "deep_quota_exceeded", "quota": { "limit": N } }
{ "error": "深度解析服务暂不可用", "code": "deep_unavailable" }
```

### 2.2 `deep_status` 响应

```json
{
  "job_id": "9f2c...",
  "status": "queued | running | done | failed",
  "progress": 0.0,
  "stage": "queued | download | asr | ocr | aggregate | done",
  "result": {
    "success": true,
    "source": "bilibili",
    "url": "https://...",
    "title": "",
    "duration": 123,
    "uploader": "",
    "transcript": {
      "text": "转写全文",
      "segments": [{ "start": 0.0, "end": 3.2, "text": "..." }],
      "provider": "mimo | faster_whisper | http",  // mimo 无时间戳 → segments=[] 且 degraded=true
      "language": "zh"
    },
    "on_screen_urls": [
      { "url": "https://example.com", "confidence": 0.92, "frames": 3 }
    ],
    "degraded": false,
    "quota_refunded": false  // 仅 failed 后可能为 true（20261031000001 退额度）
  },
  "error": { "code": "asr_unavailable", "message": "..." }
}
```

`error.code` 枚举（worker 任务）：`download_failed` / `too_long` / `no_audio` / `asr_unavailable` / `asr_failed` / `ocr_unavailable` / `internal`；云函数代理层另会返回：`invalid_token`(401) / `quota_unavailable`(503) / `invalid_url`(400) / `invalid_job_id`(400)。

## 3. worker 接口（scripts/video-worker）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/video/jobs` | `{ url, include? }` → 202 `{ job_id, status: "queued" }` |
| GET | `/api/video/jobs/{job_id}` | 状态/结果，见 2.2 |
| GET | `/health` | 追加 `asr_provider`、`asr_ready`、`ocr_ready`、`proxy_configured` |

约束：

- 同步 HTTP 接口 `/api/video/extract` **保持原行为**（P0 只做增强，不破坏现有调用）。
- 深度任务：单 worker 最多并发 1 个（`WORKER_DEEP_CONCURRENCY`，默认 1），其余排队；
  任务状态存内存（30 分钟过期），进程重启即丢失——已知限制，后续可落库。
- 深度任务上限：时长 `WORKER_DEEP_MAX_SECONDS`（默认 900）、下载体积 `WORKER_DEEP_MAX_MB`（默认 200）、
  单任务超时 `WORKER_DEEP_TIMEOUT_SECS`（默认 300）。
- ASR provider（`WORKER_ASR_PROVIDER`）：
  - `mimo`（**推荐，线上方案**）：调用小米 MiMo 语音识别模型，音频转 90s mp3 分片 → base64 →
    `chat/completions` + `input_audio`；只返回文本（**无时间戳**，`segments` 为空 → 标 `degraded`）；
    需要 worker 环境变量 `MIMO_API_KEY`，可选 `MIMO_BASE_URL` / `WORKER_ASR_MIMO_MODEL` /
    `WORKER_ASR_MIMO_CHUNK_SECS` / `WORKER_ASR_LANGUAGE`；
  - `none`（默认）、`faster_whisper`（本地，需镜像重依赖/模型）、`http`（OpenAI 兼容
    `/v1/audio/transcriptions`，`WORKER_ASR_HTTP_URL` + `WORKER_ASR_HTTP_TOKEN`）。
- 画面 OCR provider（`WORKER_OCR_PROVIDER`）：
  - `mimo`（**推荐，线上方案**）：复用 ffmpeg 抽帧（默认最多 12 帧，`WORKER_OCR_MIMO_MAX_FRAMES`），
    逐帧送 MiMo 多模态理解，提示词要求「逐字、不补全、不猜测、无则 NONE」，再经
    `extract_urls_from_text` + 跨帧投票聚合；同样只需 `MIMO_API_KEY`；
  - `rapidocr`（本地离线，需 `INSTALL_DEEP=1` + `rapidocr_onnxruntime`，`WORKER_OCR_ENABLED=true`）；
  - `none`（默认）。
- 模型通道的通用参数：`WORKER_MIMO_TIMEOUT_SECS`（单请求，默认 120）、
  `WORKER_MIMO_MAX_RETRIES`（429/5xx 重试，默认 2）。
- 成本（国内按量，2026-10 官方价）：ASR ¥0.5/小时音频（10 分钟 ≈ ¥0.08）；多模态理解按 token
  （实测一帧约 260 prompt tokens、82 输出 tokens ≈ ¥0.0004/帧），12 帧 ≈ ¥0.005/次。
  深度任务 2 次/日 的 MiMo 账单约 ¥6~9/月；CloudBase 只承担 yt-dlp 下载 + ffmpeg（约 10~20 资源点/次）。
- 公网暴露时必须配 `WORKER_TOKEN`（请求头 `X-Worker-Token`）；云函数侧同值注入（`VIDEO_WORKER_TOKEN`）。

## 4. 客户端

- `src/lib/ai/deepVideoExtract.ts`：`submitDeepVideo(url)` / `pollDeepVideo(jobId, { signal, onProgress })`，
  轮询间隔 2s、上限 240s（worker 单任务上限 300s，留余量），429/403 映射为结构化错误，不静默降级（避免绕过配额）。
- AI 工具 `deep_read_video`（仅视频平台域名可用）：提交 → 轮询并在聊天 steps 展示阶段 →
  结果拼成文本（转写 + 画面网址）→ 走现有 LLM 提炼/候选卡片。
- 现有同步解析的 `degraded` 必须被前端消费：降级时明确告知「已降级为 r.jina.ai 网页正文」，
  不再显示内部枚举 `来源：generic`。

## 5. 配额与隐私

- 额度真源 `plans.features`：`video.deep.daily`，PRO 各档 2 次/日，free 0（需登录）。
  迁移 `20261030000001_video_deep_quota.sql` **已于 2026-10-31 应用**；缺省仍保留云函数
  `EXTRACT_VIDEO_DEEP_DAILY` 回落（登录且 `video.extract.daily>=10` 视为 PRO → 2，否则 0）。
- 深度解析会把**音视频内容**发往模型服务商（语音识别 / 多模态理解）与自建 worker；
  用户首次使用需明确告知。隐私政策**不写具体模型名称**，只写「境内已完成备案的大模型 / 语音识别服务商」，
  实际生效名单维护在 `src/config/aiProviders.ts`；原「设置 → 关于 → AI 服务商」入口已于 2026-10-29 移除，当前通过 herr@ulink.ren 索取（恢复入口是待办）。
- 10 次/日 的轻量解析与 2 次/日 的深度解析分开计数，避免成本失控。

## 6. 部署清单

1. `node scripts/build-fn-assets.mjs`（重新生成派生 JS + worker 平台清单）
2. `node scripts/deploy-cloudbase-fn.mjs extract-video`（函数；需 `.env.local` 配 `VIDEO_WORKER_URL`）
3. worker：`tcb cloudrun deploy ... --source scripts/video-worker`（默认 ASR/OCR 关闭，行为与旧版一致；
   开启 ASR/OCR 需在控制台配环境变量并按需装依赖）
4. 前端：`npm run build` → 由 CI 发布（勿手动与 CI 冲突）

## 7. 当前部署状态（2026-10-30 实测）

- `extract-video` 云函数已部署并验证：同步响应带 `provider`（实测 B站走 `worker`）、
  `deep` 匿名返回 `401 login_required`、`deep_status` 非法 job_id 返回 400、未知 job 返回 503。
- worker `ulink-video-worker-007`（镜像 006）已发布并验证：`/health` 返回 `version=1.2.0`、
  `asr_provider=mimo` / `asr_ready=true`、`ocr_provider=mimo` / `ocr_ready=true`、`mimo_configured=true`、
  `deep_ready=true`；镜像仍是 `INSTALL_DEEP=0`（MiMo 通道不需要重依赖）。
- MiMo 真实联调（2026-10-30，本机直连 API）：
  - 视觉：单帧 4.6s，`image_tokens=224`，逐字输出测试帧里的两个网址（无补全/无幻觉）；
  - ASR：7 秒中文语音 1.38s 返回文本，计费 `seconds=7`（¥0.5/小时 ≈ ¥0.001/次），无时间戳；
  - 成本：12 帧/次 ≈ ¥0.005 + ASR ≈ ¥0.08/10 分钟 → 2 次/日约 ¥6~9/月。
- **B站 412 已加免账号修复（两层）**：
  1. 指纹 Cookie（对齐 yt-dlp PR [#16889](https://github.com/yt-dlp/yt-dlp/pull/16889)）：
     `finger/spi` 取 `buvid3/buvid4` + 自生成 `buvid_fp` + 浏览器特征头；
  2. **412 Challenge 求解**（对齐社区分支 `0xvd/yt-dlp-exp@fix_bilibili`）：解 `X-BILI-SEC-TOKEN`
     JWT 的 `q/r`，暴力搜索 `i` 使 `sha256(q+i)==r`，POST
     `security.bilibili.com/th/captcha/cc/check` 换新 token 写入 Cookie 后重试。
  **不需要账号**；token 按 JWT 过期缓存。仍失败会如实提示「IP 被限流」。
  - 2026-10-30 实测：指纹 + challenge + 匿名/登录态浏览器 Cookie 均试过，当前 CloudRun IP 仍 412。
  - 2026-10-31 代理实测：巨量IP 动态提取链接在本机可用（B站 API 200、页面 200），但 CloudRun
    容器访问提取接口失败（`Max retries exceeded`），代理未能生效；需改用隧道/账密固定入口
    （`YTDLP_PROXY=http://user:pass@host:port`）或让代理商白名单 CloudBase 出口 IP。
  - 测试用的登录 Cookie 已在验证后从 worker 环境变量移除，未入库。
  - 评论/CC 字幕仍依赖云函数原生适配器（它同样被 412 挡，需要 `SESSDATA` Cookie 才能恢复）。
- **深度任务线上实测仍受「来源访问」阻塞**：bilibili 元数据接口在 worker 云机房 IP 上间歇性返回
  `HTTP 412`（yt-dlp 与浏览器兜底都会被风控），`deep` 任务会如实返回 `download_failed`；
  指纹修复后可先无账号重试，仍失败再考虑 `YTDLP_COOKIES`（专用小号 Cookie）或换出口 IP。
  YouTube 则必须 `YTDLP_PROXY`。MiMo 解决的是「模型能力与成本」，**不能**解决平台反爬。
- 迁移 `20261030000001_video_deep_quota.sql` **已于 2026-10-31 应用**：`plans.features` 现为 free `video.deep.daily=0`、PRO 各档 `2`；失败退额度迁移 `20261031000001` 此前已应用。
- 前端已发布（线上 `version.json` commit `8882cea9`，2026-10-31 构建；`deep_read_video` 工具已在线），`degraded` / `provider` 均已消费。
- `WORKER_TOKEN` 尚未配置（worker 仍是公网可直调）；上线前建议按 `scripts/video-worker/README.md` 4.1 配置。
- 部署细节（无需重建镜像）：环境变量通过 CloudBase tcbr API `UpdateCloudRunServer` 注入到新版本
  （`DeployInfo.ReleaseType=FULL` + `Items` 含 `EnvParams`）；控制台「服务设置 → 环境变量」等价。

## 8. 安全备注：X-Forwarded-For 与配额

2026-10-30 线上实测：CloudBase 网关**不会回填**可信客户端 IP，`X-Forwarded-For` 由调用方完全控制，
因此任何「按 IP」的配额/限流键都可被伪造绕过（`extract-video`、worker 及各函数同此口径）。

- 已做的缓解：`extract-video` 增加**与 IP 无关**的全局限流（`EXTRACT_VIDEO_RATE_LIMIT_GLOBAL_PER_MIN`，默认 1200/分）
  与匿名全局单日额度（`EXTRACT_VIDEO_ANON_GLOBAL_DAILY`，默认 2000/日），并把客户端 IP 取法改为
  「优先 `x-real-ip`，否则 XFF 最后一跳」（比第一跳更难被伪造，但网关不回填时仍不可信）。
- 登录用户的日额度按 **uid** 计量，不依赖 IP，不受影响。
- 后续如能拿到网关可信 IP 头（或接入 WAF），应替换 `clientIp()`；在此之前不要假设 IP 即真实用户。

## 9. 未完成项 / 决策记录（2026-10-31，重要）

> **当前决定：B站来源访问问题暂不投入成本，不买代理、不买号；优先做浏览器扩展（用户 IP）方案。**
> **2026-10-31 收尾决定：B站扩展通道作为「实验性实验室功能」保留并收尾；抖音/小红书/代理/自建中继全部冻结，不再继续投入。**
> 以后看到 B站深度解析失败时，先回来看本节，不要重复试指纹/Challenge/Cookie 这三条已证伪的路。

### 已排除（都实测过，不要再试）

- 服务端指纹（buvid3/buvid4 + 随机 buvid_fp）→ CloudRun 出口 IP 仍 412；
- 412 Challenge（`X-BILI-SEC-TOKEN` PoW + `security.bilibili.com/th/captcha/cc/check`）→ 拿不到 token；
- 真实浏览器匿名 Cookie（14 个）与登录态 Cookie（28 个，含 SESSDATA）→ 仍 412；
- 换 CloudRun 实例/换 revision → 仍 412；
- **结论**：当前 CloudBase 上海机房出口 IP 被 B站硬限流，算法/Cookie 层无解。

### 代理试验（2026-10-31，仅验证可行性，未采用）

- 用巨量IP 动态提取链接在本机测试：B站 API 200、视频页 200，**代理本身可用**；
- 但 CloudRun 容器访问该提取接口 `Max retries exceeded`，worker 拿不到代理（疑似代理商限制云机房 IP / 需白名单 / 需隧道账密模式）；
- 代码已支持 `BILI_PROXY_API`（仅 B站走代理）与 `/health` 诊断字段，保留但不启用；测试用登录 Cookie 已从环境变量移除；
- **未购买/未续费任何代理**，测试消耗的提取额度未计入长期成本。

### 未来可选的解决方向（按优先级）

1. **浏览器扩展 playinfo（当前优先）**：用户在 B站页面上点扩展 → 读取 `window.__playinfo__` 的签名播放地址 → 服务器带 Referer 下 CDN 音频 → MiMo ASR/OCR。0 月费、不跨境、不用账号；已实测 CDN 带 Referer 可从 CloudBase 下载。待做：扩展按钮 + `playinfo` 入参与校验 + worker 下载路径。
2. **自建中继/出口**：家里公网 IPv4 / 家宽 + gost/sing-box，或 Tailscale exit node，或按小时租一台干净 VPS 跑 worker；属于"自建中站"路线，需要运维与实测。
3. **购买静态 ISP / 隧道代理**：固定 IP、账密认证（不要用"提取链接"模式，CloudRun 可能调不通）；拿到 `host:port+user:pass` 后配 `YTDLP_PROXY` 即可。成本是唯一门槛，暂缓。

### 其他待收尾（与本功能相关）

- [x] 深度解析失败退额度（2026-10-31）：迁移 `20261031000001_deep_quota_refund.sql`
  （按 job_id 幂等退款），提交失败与异步任务 `failed` 都会退回 1 次体验额度；
- `WORKER_TOKEN` 未配（worker 仍是公网可直调，建议按 worker README 4.1 配置）；迁移方面
  `20261030000001_video_deep_quota` 已于 2026-10-31 应用，其余历史迁移以 `cloudbase/migrations/` 与实际库为准；
- 前端改动已发布（扩展 MVP 为实验性；抖音/小红书/代理冻结）。

## 10. 浏览器扩展 MVP（实验性，2026-10-31 收尾）

### 交互

1. 用户在 B站/抖音/小红书视频页右键 →「与链：深度解析此视频」；
2. 扩展 background 用 `chrome.scripting.executeScript({world:'MAIN'})` 读取页面已有数据：
   - B站：`window.__playinfo__.data.dash.audio/video` 的 `baseUrl` + `backupUrl`（页面 JS 已签名，**不逆向、不额外请求**）；
   - 抖音：`#RENDER_DATA` / `_ROUTER_DATA` / `<video>` / Resource Timing 中的 CDN 地址；
   - 小红书：`__INITIAL_STATE__` 中的 `xhscdn` 地址；
3. 数据写入 `chrome.storage.local`，打开 `video-extract.html` 新标签页；
4. 新标签页取 CloudBase 登录态 → `POST /extract-video {action:'deep', include:{transcript,ocr}, client:{...}}`；
5. 云函数校验 `client` 后透传 worker；worker 用 `Referer` 从 CDN 直链下载（不再走 yt-dlp）→ MiMo ASR/OCR；
6. 页面轮询 `deep_status`，展示口播转写、时间轴、画面网址、降级说明。

### 安全 / 诚实边界

- `client` 只接受平台 CDN 后缀 + https + 白名单端口（B站 `bilivideo.com/.cn`，抖音 `douyinvod.com` 等，小红书 `xhscdn.com`），拒绝任意 URL 下载代理；
- 数组最多 6 条、URL ≤2048 字符、标题/上传者截断；worker 侧再校验一次；
- 扩展只读当前主动打开页面，不上传无关页面数据；「深度解析」消耗的是实验性体验额度（PRO 2 次/日），不构成主套餐固定承诺；
- UI 文案明确：B站=正式支持；抖音/小红书=实验性，未登录/验证码/页面改版时如实失败，不伪造结果。

### 实测状态（2026-10-31）

- **B站**：用 Playwright 在真实页面验证读取逻辑，`__playinfo__` 返回 6 条音频 + 6 条视频地址；扩展链路可用；
- **B站 client 后端链路已端到端跑通**：用 `BV1GJ411x7h7` 的 `__playinfo__` 音频地址直调 worker
  `/api/video/jobs`（`client.audio_urls`，include transcript），worker 从 CDN 带 Referer 下载 1.1MB 音频，
  MiMo ASR 返回完整歌词转写（`provider=mimo`，`degraded=true` 因无时间轴）；另用同一视频的
  `video_urls` 跑 `include.ocr=true`，worker 下载视频→抽帧→MiMo 视觉识别成功完成（该 MV 无画面网址，
  `on_screen_urls=[]`，30 秒内 done）；云函数 `extract-video`
  已部署 client 透传（无登录请求返回 401 login_required，符合预期）；
- **抖音**：用用户提供的分享链接 `7627402647821208883` 实测，页面 `#RENDER_DATA` 未暴露 `play_addr`（0 条 CDN 地址）；已加 `douyin-hook.js`（MAIN world，document_start hook fetch/XHR 捕获 `aweme/detail` 响应），但该页面在未登录/无验证态下仍未触发详情接口（hook 捕获 0 条）。扩展会诚实提示「页面没有暴露可下载地址」；抖音适配仍是实验性，后续需在已登录真实浏览器验证 hook 是否生效，必要时补 `aweme/detail` 请求参数或登录态判定；
- 后端 `client` 透传、worker CDN 下载/ASR 复用已经写完并通过 Python selftest / `node --check`；
  `extract-video` 云函数与 worker 019 镜像已部署；前端已发布（`8882cea9`，2026-10-31）。

### 待办

- [x] 部署 `cloudbase/functions/extract-video` 与 worker 镜像（含 `client` 支持）；
- [x] 用 B站 `__playinfo__` 音频地址直调 worker 做端到端：转写成功（扩展 UI 的登录态联调待真实账号）；
- [ ] 抖音加网络响应 hook / 登录态判定；小红书同；
- [x] `/extension-guide.html` 上线（页面自述「准备商店上架，当前为开发版」）；
- [ ] 扩展商店上架（或提供下载 zip 的正式渠道）；
- [x] 前端发布（Pro 权益「需扩展」文案、深度失败引导已改，线上 `8882cea9`）。
