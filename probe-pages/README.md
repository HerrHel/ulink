# ulink-probe — 海外探针（Cloudflare Pages）

死链检测的「海外第二视角」：境内（CloudBase 上海）判定 `inconclusive` / `connect_err` /
`timeout` 时，浏览器再问一次本端点。

| 探针返回 | 前端处理 |
|---|---|
| `outcome: alive`（2xx/3xx） | 国内不通 + 海外可达 → 判定**被墙** |
| `outcome: dead`（404/410 / DNS 不存在） | 判定**死链** |
| `outcome: error` / `timeout`（403/5xx/超时） | 保持国内原判，**不改判** |

## 现状

- 生产端点：`https://ulink-probe.pages.dev/api/check-link`
- 前端配置：`.env.production` 的 `VITE_OVERSEAS_PROBE_URL`
- 真源：`functions/_lib/probe-core.ts`（本目录的 `functions/api/check-link.js` 是它派生出来的自包含 bundle）

2026-11-13 实测（本机国内直连、不走代理）：

```
GET  /api/check-link?url=https://example.com   → {"outcome":"alive","status":200}
GET  /api/check-link?url=https://www.google.com → {"outcome":"alive","status":204}   # 本机直连 google 超时
GET  /api/check-link?url=https://<不存在域名>    → {"outcome":"dead","reason":"dns_nxdomain"}
GET  /api/check-link?url=http://192.168.1.1/   → 400 {"error":"private_ip_forbidden"}
无 Origin 头                                     → 403 {"error":"origin_required"}
Origin: https://evil.example                    → 403 {"error":"origin_forbidden"}
OPTIONS（Origin: https://ulink.ren）            → 204 + ACAO 回显 + Allow-Methods
```

## 为什么不是 `ulink.pages.dev`，也不是 Worker

- **`ulink.pages.dev`**：原 Pages 项目退役后被无关项目占用（`/api/*` 全返回同一份 1519B HTML、POST 405），
  探针随之失效。
- **`*.workers.dev`**：2026-11-13 部署过 Worker（代码见 `../probe-worker/`），本机直连
  **20s 超时**（DNS 通、TCP 不通），同一时刻 `pages.dev` 直连 200 / 0.43s 建连。
  结论：workers.dev 域名在国内不可直连，绑自有域名才有意义。
- 因此沿用 Pages 形态：域名可达、免费额度 10 万请求/天、且与原实现同构。

## 部署

前置：`npx wrangler login`（本机已有 `2629490959@qq.com` 的 OAuth 令牌）。

```bash
# 1) 重新生成派生 bundle（改了 functions/_lib/probe-core.ts 或 cf-guard/ssrf-guard 后必须跑）
node scripts/build-probe-pages.mjs

# 2) 部署（在 probe-pages/ 目录内执行，wrangler 才会把 ./functions 一起打包）
cd probe-pages && npx --yes wrangler@4.161.0 pages deploy dist --project-name ulink-probe --commit-dirty=true
```

首次部署若提示项目不存在：

```bash
cd probe-pages && npx --yes wrangler@4.161.0 pages project create ulink-probe --production-branch main
```

部署后自测（务必带 Origin，无 Origin 会被 403）：

```bash
curl "https://ulink-probe.pages.dev/api/check-link?url=https://example.com" -H "Origin: https://ulink.ren"
```

## 安全边界（务必了解）

- **Origin 只是门槛，不是鉴权**：Origin 头可伪造；`cf-guard` 的限流是**单 isolate 软闸**
  （60 次/分钟/键），跨边缘节点不共享。真正的硬限流需要 Durable Objects / KV / CF Rate Limiting 规则。
- **只做探测，不返回目标内容**：响应里只有 `outcome` 与状态码，不能当代理用来抓页面。
- **SSRF 防护**：协议白名单、私有段字面量、DoH A/AAAA 校验、每跳重定向重校验、最多 3 跳。
  DNS 解析失败判「死链」而非「私网」，两者语义分开（`reason: dns_nxdomain`）。
- **费用**：Pages Functions 免费额度 100k 请求/天；本场景每本书签最多一次，远低于上限。

## 目录结构

```
probe-pages/
  dist/index.html                 # 占位静态产物（noindex），Pages 部署要求
  functions/api/check-link.js     # 派生：scripts/build-probe-pages.mjs 生成，勿手改
```

CI 会对派生文件做漂移守卫（重新生成后 `git diff --exit-code`），手改会被拦。
