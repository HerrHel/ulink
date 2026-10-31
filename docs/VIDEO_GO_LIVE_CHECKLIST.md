# 视频解析（P0/P1/P2）上线决策与操作指南

> 配套：接口契约见 [`VIDEO_DEEP_EXTRACT.md`](./VIDEO_DEEP_EXTRACT.md)，worker 运维细节见
> [`scripts/video-worker/README.md`](../scripts/video-worker/README.md)。
> 当前状态（2026-10-30）：**P0 已上线并验证；P1/P2 代码已上线但依赖未启用；前端未发布；数据库迁移未执行。**

先定义本文反复用到的命令变量（PowerShell，仓库根执行）：

```powershell
$TCBJS = "$env:USERPROFILE\.workbuddy\binaries\node\cli-connector-packages\node_modules\@cloudbase\cli\bin\tcb"
$ENV   = "ulink-d1g5srvjo54b1886a"
$WORKER = "https://ulink-video-worker-333621-8-1436146693.sh.run.tcloudbase.com"
```

---

## 0. 决策总览

| # | 决策项 | 是否阻塞「口播/画面网址」 | 推荐 | 成本/风险 |
|---|---|---|---|---|
| D1 | 深度解析启用到哪一层（只口播 / 只 OCR / 都要 / 都不启用） | 是 | 先做 D2 的 `http` ASR（只口播，**无需重建镜像**），再按需做 D3 | 中 |
| D2 | ASR provider 选型（自建 http / 镜像内 faster-whisper / 云 ASR） | 是 | 自建 OpenAI 兼容 ASR 服务，worker 配 `WORKER_ASR_PROVIDER=http` | 低（无需重建镜像） |
| D3 | 画面 OCR 启用（重建 worker 镜像装依赖 + 开开关） | 是（画面网址） | 需要时才做；参数收紧（时长/帧数） | 中高（镜像+冷启动） |
| D4 | worker 访问控制 + 冷启动 | 否（影响体验与安全） | 配 `WORKER_TOKEN`；如付费功能建议 `min-num=1` | 低/中 |
| D5 | YouTube 真正解析（配海外代理） | 否（当前降级 jina） | 有海外节点再做 `YTDLP_PROXY` | 中 |
| D6 | B站评论/字幕（修复 412 风控） | 否（当前只有标题/简介） | 配专用账号 Cookie 或换出口 IP | 中（凭据维护） |
| D7 | 应用 3 个 pending 数据库迁移 | 否（深度额度有代码回落） | 先备份再 `migration up` | 中 |
| D8 | 前端发布（静态托管） | 是（用户看不到新 UI/工具） | `git push main` 走 CI | 低 |
| D9 | 其它函数 XFF 加固 / worker 死页误判 / deep 工具开关 | 否 | 后续单独排期 | 低 |

---

## D1. 深度解析启用到哪一层

深度解析 = 「口播转写（ASR）」+「画面网址（OCR）」两个可选子能力，可分别启用：

| 方案 | 要做什么 | 你能得到 | 镜像是否重建 |
|---|---|---|---|
| 1A 只口播 | D2（配 MiMo 语音识别） | 转写文本 → AI 提炼/回答 | **否** |
| 1B 只画面网址 | D3（配 MiMo 多模态理解） | `on_screen_urls` | **否** |
| 1C 两者都要（推荐） | D2 + D3（共用 `MIMO_API_KEY`） | 转写 + 画面网址 | **否** |
| 1D 暂不启用 | 什么都不做 | `deep` 任务如实返回 `deep_unavailable` | 否 |

> 2026-10-30 已完成真实联调：MiMo 视觉对测试帧逐字输出两个网址（含 `ulink.ren`，无补全）；
> MiMo ASR 对 7 秒中文语音 1.38s 返回文本。MiMo 方案 **不需要** `INSTALL_DEEP`、不需要自建 ASR 服务。

> 注意：当前前端工具 `deep_read_video` 已随 P1 代码写好，若选择 1D 且前端先行发布，
> 用户触发时只会看到「深度解析服务暂不可用」。要么先启用 1A，要么先不发布前端（或让 Lead 加开关隐藏工具）。

---

## D2. ASR：推荐 MiMo 语音识别（免自建、免重建镜像）

worker 已实现 `WORKER_ASR_PROVIDER=mimo`：ffmpeg 把音频转 90s mp3 分片 → base64 →
`chat/completions` + `input_audio`（注意：**不是** OpenAI `/v1/audio/transcriptions`）。

实测（2026-10-30）：7 秒中文语音，HTTP 200 / 1.38s，计费 `seconds=7`；按 ¥0.5/小时 ≈ **¥0.001/次**。
限制：只返回文本、**没有时间戳**（`segments` 为空，任务标 `degraded`）；base64 上限 10MB（90s mp3 ≈ 0.4MB，安全）。

### 步骤

1. 控制台「云托管 → ulink-video-worker → 服务设置 → 环境变量」新增：

```
MIMO_API_KEY=<你的 MiMo API Key，与 mimo-chat 同一个可复用>
WORKER_ASR_PROVIDER=mimo
WORKER_ASR_LANGUAGE=zh          # 可选；不填则自动检测
```

2. 验证：

```powershell
curl.exe -s "$WORKER/health"
# 期望："asr_provider":"mimo", "asr_ready":true, "mimo_configured":true, "deep_ready":true
```

3. 直接测一次深度任务（不消耗 PRO 额度，走 worker 直连）：

```powershell
curl.exe -s -X POST "$WORKER/api/video/jobs" -H "Content-Type: application/json" -d '{"url":"https://www.bilibili.com/video/BV1GJ411x7h7"}'
# → 202 {"job_id":"...","status":"queued"}
curl.exe -s "$WORKER/api/video/jobs/<job_id>"
# → 轮询到 status=done，result.transcript.text 非空
```

### 备选方案

| 方案 | 做法 | 适用 | 注意 |
|---|---|---|---|
| 自建 OpenAI 兼容 ASR（VPS） | `WORKER_ASR_PROVIDER=http` + `WORKER_ASR_HTTP_URL/TOKEN` | 已有 VPS/GPU、想要时间戳 | 需维护服务；CloudBase 仍只做下载+转码 |
| 镜像内 faster-whisper | 改 Dockerfile `ARG INSTALL_DEEP=1` 并预下载模型，配 `WORKER_ASR_PROVIDER=faster_whisper` | 完全离线 | 1C2G 上 10 分钟音频 ≈ 133 资源点/次，易超 300s 上限 |
| 云厂商 ASR 原生接口 | 需要新增 provider 适配 | 免运维、按量计费 | 当前 `http` provider 只兼容 OpenAI 协议 |

> 成本说明：用户已为固定 AI 额度付费，ASR/视觉的成本在额度内消化；深度解析仍受
> `video.deep.daily`（PRO 2 次/日）约束，避免单用户无限刷。

## D3. 画面网址：推荐 MiMo 多模态理解（免重建镜像）

worker 已实现 `WORKER_OCR_PROVIDER=mimo`：复用现有 ffmpeg 抽帧（场景帧 + 均匀采样），逐帧送多模态理解，
提示词强制「逐字、不补全、不猜测、无则 NONE」，再经 URL 正则 + 跨帧投票 + check-link 校验。

实测（2026-10-30）：单帧 4.6s，`image_tokens=224`、总 tokens≈343，正确输出 `https://ulink.ren/app` 与
`www.example.com`；单帧有漏检概率（另一轮只回 1 个），所以**必须靠多帧投票**。

### 步骤

1. 控制台给 `ulink-video-worker` 加（`MIMO_API_KEY` 若已在 D2 配好则复用）：

```
WORKER_OCR_PROVIDER=mimo
WORKER_OCR_MIMO_MAX_FRAMES=8    # 8~12，控制时延/成本（实测约 ¥0.0004/帧）
```

2. 验证：`/health` → `"ocr_provider":"mimo"`, `"ocr_ready":true`。

### 离线备选（rapidocr，需重建镜像）

1. 把 `scripts/video-worker/Dockerfile` 的 `ARG INSTALL_DEEP=0` 改为 `1`；
2. 重新部署（首次构建约 5~10 分钟）；
3. 控制台配 `WORKER_OCR_PROVIDER=rapidocr`、`WORKER_OCR_MAX_FRAMES=16`；
4. 验证 `/health` → `"ocr_provider":"rapidocr"`, `"ocr_ready":true`。
   注意 1C2G 上 24 帧约 10~20 秒，资源点消耗与时延都高于 MiMo 方案。

> 回滚：`node $TCBJS cloudrun version rollback -e $ENV -s ulink-video-worker --rollback-version-name <上一个版本名> --force`
> （版本名以 `cloudrun detail` 的 `OnlineVersionInfos` 为准。）

### 成本账（用 MiMo 时 CloudBase 压力很小）

- 资源点公式：`资源点 = 0.11108 点/GBs`，`1 GBs = 1GB 内存 × 1 秒`；个人版 **40,000 点/月**。
- MiMo 方案下 worker 只做 yt-dlp 下载 + ffmpeg 转码/抽帧：2GB × 30~60s ≈ **7~13 点/次**；
  2 次/日 ≈ 400~800 点/月，占个人版额度 **1~2%**。
- MiMo 账单（国内按量）：ASR ¥0.5/小时（10 分钟 ≈ ¥0.08）；画面理解约 ¥0.0004/帧（8~12 帧 ≈ ¥0.005/次）。
  2 次/日 ≈ **¥6~9/月**。这部分由用户已购买的 AI 额度消化，另受 `video.deep.daily`（PRO 2 次/日）约束。
- **不要在 CloudBase 上跑模型**：镜像内 faster-whisper 跑 10 分钟音频 ≈ 133 点/次（2 次/日 ≈ 8,000 点/月，20%），
  且 1C2G 很慢；`min-num=1` 常驻 ≈ 57.6 万点/月，是个人版套餐的 14 倍，**不可行**。
- 冷启动建议：把 `extract-video` 云函数超时从 60s 调到 120s（函数侧约 2~3 点/次），不要靠常驻实例。

---

## D4. worker 访问控制与冷启动

### 4.1 配 `WORKER_TOKEN`（防止公网被当免费代理）

1. 生成口令：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. 控制台 → 云托管 `ulink-video-worker` → 服务设置 → 环境变量，新增：

```
WORKER_TOKEN=<上一步生成的随机串>
```

3. 本地 `.env.local` 增加（该文件已被 gitignore，**不要提交**）：

```
VIDEO_WORKER_TOKEN=<同一个随机串>
```

4. 重新部署云函数，让函数带上 `X-Worker-Token`：

```powershell
node scripts/deploy-cloudbase-fn.mjs extract-video
```

5. 验证：不带头的 worker 请求应 401；带函数链路（`https://ulink.ren/extract-video`）仍正常。

### 4.2 冷启动（可选，建议付费功能开启）

今天实测 worker 缩容到 0 后首次请求出现 **503（等待 30s 仍未起）**、浏览器兜底路径冷启动可达 **50s+**，
而 `extract-video` 只等 worker 45s，因此冷启动会直接降级到 jina。

- 方案 A（不重建，推荐）：控制台 → 云托管服务 → 实例管理，把最小实例数改为 **1**。
- 方案 B（CLI 重建）：

```powershell
node $TCBJS cloudrun deploy -e $ENV --service-name ulink-video-worker `
  --source scripts/video-worker --port 8080 --min-num 1 --max-num 1 `
  --open-access-types PUBLIC --force --wait --yes
```

成本：等于长期挂一个 1C2G 小实例（以控制台账单为准）。若视频解析是付费权益，建议开启。

---

## D5. YouTube 真正解析（需要海外出网代理）

现状：worker 在 ap-shanghai，`youtube.com` DNS 被污染，DNS 预检直接返回 `youtube_unreachable`；
云函数在无 `YOUTUBE_API_KEY` 且 `proxy_configured=false` 时直接走 jina（`fallback_reason=worker_no_proxy`）。

要真正解析 YouTube（标题/字幕）：

1. 准备海外代理（HTTP/SOCKS，最好固定出口）。
2. 控制台给 worker 加：

```
YTDLP_PROXY=http://user:pass@<host>:<port>
```

3. 验证：`curl $WORKER/health` 的 `proxy_configured` 应为 `true`；等 5 分钟（云函数 health 缓存 TTL）后，
   调 `https://ulink.ren/extract-video` 解析 YouTube，期望 `provider:"worker"`。
4. 回退：删除该环境变量即可恢复「jina 降级」。
5. 更彻底方案：给云函数配 `YOUTUBE_API_KEY`（Data API v3）——但**拿不到字幕**，只补标题/简介/评论。

---

## D6. B站评论/CC 字幕（修复 412 风控）

今天已从函数日志确认根因：

```
[extract-video] bilibili view adapter empty: {"httpStatus":412,"biliCode":null,...}
```

即 CloudBase 上海机房 IP 访问 `api.bilibili.com` 被 **412 风控**，所以 B站一直回落到 worker（只有标题/简介）。

修复选项（按推荐排序）：

1. **worker 内置 B站 412 Challenge 求解（免账号，已实现）**：412 响应下发 `X-BILI-SEC-TOKEN`
   （JWT），worker 解出 `q/r` 后暴力搜索 `i` 使 `sha256(q+i)==r`，再 POST
   `security.bilibili.com/th/captcha/cc/check` 换新 token，写入 Cookie 重试（对齐社区分支
   `0xvd/yt-dlp-exp@fix_bilibili`）。**不需要账号、代理或浏览器 JS**；token 按 JWT 过期缓存。
   另外仍保留 `buvid3/buvid4/buvid_fp` 指纹（PR
   [#16889](https://github.com/yt-dlp/yt-dlp/pull/16889)）作为第一层。
   若 challenge 也被拒（IP 被彻底限流），才需要代理或 Cookie。
   **实测（2026-10-30 晚）**：指纹 + challenge 两层都已上线，并且又用**真实浏览器 Cookie**（匿名 14 个、
   登录态含 SESSDATA 28 个）验证过，当前 CloudRun 出口 IP 仍然 412（`cookies_configured=true` 也一样）。
   说明这台节点被 B站硬限流，算法/Cookie 层无解，下一步必须换出口 IP（住宅/ISP/VPS）或换部署位置。
   测试用的登录 Cookie 已在验证后从 worker 环境变量移除。
2. **B站账号 Cookie**（需要评论/CC 字幕时）：challenge 只解决 yt-dlp 的 412；若还要 B站热评、
   CC 字幕、官方 AI 小结，原生适配器（云函数内）仍需要 `SESSDATA` Cookie（低风险小号），
   再给 `extract-video` 加 `BILIBILI_COOKIE` 支持。
3. **换出口 IP**（固定公网 IP 走代理/专线）——成本更高，但无凭据维护。
4. **接受现状**：B站只有标题/简介；评论/字幕缺失，购买文案里不要承诺这两项。

> 另：worker 的 `include_comments=true`（yt-dlp 取评论）实测在 bilibili 上会失败并退回浏览器兜底，
> **不要**在函数侧打开它；B站评论走上面的原生适配器才有质量。

---

## D7. 应用数据库迁移（3 个 pending）

`2026-10-30` 实测 `migration up --dry-run` 显示 3 个待应用：

```
+ 20261025000007_linkcheck_scan_limit.sql   （plans 额度字段，安全）
+ 20261028000010_payment_flow.sql           （orders 字段 + 支付函数，DDL 增量）
+ 20261030000001_video_deep_quota.sql       （plans 加 video.deep.daily，本次新增）
```

**不应用也能用**：深度额度有代码回落（登录且 `video.extract.daily>=10` → 2 次/日），只是不显式写进 `plans.features`。
但迁移历史会一直落后，且 `payment_flow` 可能影响支付链路，建议尽快补齐。

### 操作步骤

1. **先备份**：CloudBase 控制台 → 数据库（PostgreSQL）→ 备份，手动做一次全量备份（或确认已有自动备份可回滚）。
2. 预演：

```powershell
node $TCBJS db pg migration up -e $ENV --dry-run
```

3. 正式应用：

```powershell
node $TCBJS db pg migration up -e $ENV
```

4. 验证：

```powershell
$sql = "SELECT id, features->>'video.deep.daily' AS deep FROM plans ORDER BY id"
node $TCBJS db execute -e $ENV --json --sql $sql
# 期望：free=0，plus_monthly/plus_yearly/pro_quarterly=2
```

5. 回滚：用第 1 步的备份恢复；本次迁移只做 `UPDATE plans` 与增量 DDL，不删数据。

---

## D8. 前端发布（静态托管）

当前工作区改动**未提交**，所以线上 `https://ulink.ren` 还是旧前端（没有 `deep_read_video` 工具、
没有降级披露、购买页文案未更新——购买页文案本来就在旧版，不受影响）。

### 步骤

1. 提交前复核（仓库门禁）：

```powershell
npm run verify          # lint + lint:style + typecheck + 全量单测
npm run build
```

2. 提交并推送（**push 到 main 会触发 CI 自动发布**）：

```powershell
git add -A
git commit -m "feat(ai): 视频解析 P0/P1/P2（深链路透明化、ASR/OCR 深度任务、单一真源）"
git push origin main
```

3. 等待 CI（`.github/workflows/ci.yml`：lint-test → e2e → deploy），或在 GitHub Actions 页面手动
   `workflow_dispatch`。
4. 验证线上版本与功能：

```powershell
npm run check:prod        # 0=版本一致；1=不一致；2=线上无端点；3=网络失败
```

- 打开 `/app` → 聊天里贴 B站视频 → 应显示来源中文标签（B站），若降级会明确提示「已降级为 r.jina.ai 网页正文」。
- 让 AI 对无字幕视频执行「口播转写」→ 走 `deep_read_video`（需 D1/D2 已启用）。

> ⚠️ 仓库约定：**不要**手动 `tcb hosting deploy`（会与被 CI 发布互相覆盖）。回滚 = 回滚 commit 后再 push。

---

## D9. 可选项（不阻塞，但建议排期）

1. **其它函数 XFF 加固**：`check-link` / `jina-proxy` / `mimo-chat` / `report-error` / `send-error` 等 10 处
   仍取 `X-Forwarded-For` 第一跳，同样可伪造（本次只修了 `extract-video`）。建议统一改为
   「优先 `x-real-ip`，否则最后一跳」+ 全局限流。
2. **worker 死页误判**：实测 `include_comments=true` 时 yt-dlp 失败 → 浏览器兜底把 B站「出错啦!」页
   当成功返回（`success:true`）；云函数有 `isDeadPageText` 兜住，但 worker 直连会拿到脏数据。
   建议给 worker 浏览器路径补同样的死页判定（小改动，需重建镜像）。
3. **deep 工具前端开关**：若暂不启用深度解析，建议加 `VITE_VIDEO_DEEP_ENABLED` 之类的构建开关，
   避免 AI 调用后只得到「服务不可用」。

---

## 10. 验收清单（全部完成后逐项打勾）

```powershell
# 1) worker 健康
curl.exe -s "$WORKER/health"
#    version=1.2.0 / platform_list_source=file / yt_dlp_loaded=true /
#    asr_provider=mimo & asr_ready=true / ocr_provider=mimo & ocr_ready=true / mimo_configured=true /
#    deep_ready=true；proxy_configured=true 仅当配了 YTDLP_PROXY（D5）

# 2) 同步解析（函数链路）
curl.exe -s -X POST "https://ulink.ren/extract-video" -H "Content-Type: application/json" `
  -d '{"url":"https://www.bilibili.com/video/BV1xx411c7mD"}'
#    期望 200，含 provider 字段（B站当前多为 worker/browser；修 D6 后应为 bilibili-native）

# 3) 深度任务（需登录 + PRO 额度，前端发布后在聊天里触发；或先用 worker 直连验证）
curl.exe -s -X POST "$WORKER/api/video/jobs" -H "Content-Type: application/json" `
  -d '{"url":"https://www.bilibili.com/video/BV1xx411c7mD"}'
#    ⚠️ 实测 2026-10-30：B站云机房 IP 间歇 412，任务可能以 download_failed 结束
#    （MiMo 解决模型问题，不解决源站反爬）；稳定需要 YTDLP_COOKIES 或换出口 IP。

# 4) 配额与错误分型
curl.exe -s -X POST "https://ulink.ren/extract-video" -H "Content-Type: application/json" `
  -d '{"action":"deep","url":"https://www.bilibili.com/video/BV1xx411c7mD"}'
#    未登录应 401 {"code":"login_required"}；PRO 用完应 429 {"code":"deep_quota_exceeded"}

# 5) 前端版本
npm run check:prod
```
