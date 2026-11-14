# ulink-probe（Worker 形态）— 备选，当前未生产使用

> ⚠️ **2026-11-13 实测结论：`*.workers.dev` 在国内直连超时（DNS 通、TCP 20s 不通），
> 而 `*.pages.dev` 同条件直连 200 / 0.43s。生产探针因此走 Pages，见 `../probe-pages/README.md`。**
>
> 本目录保留为「将来绑自有域名（需接入 Cloudflare）」时的现成实现：Worker 与 Pages
> 共用同一份 `functions/_lib/probe-core.ts`，只需改绑定域名即可切换。
> 已部署的 `ulink-probe.<subdomain>.workers.dev` 若确认不用，可 `npx wrangler delete`。

给死链检测补「海外自由视角」的二次探活。境内 CloudBase（上海）判定 `inconclusive` /
`connect_err` / `timeout` 时，浏览器向本 Worker 再问一次：

| Worker 返回 | 前端判定 |
|---|---|
| `outcome: alive`（2xx/3xx） | 国内不通 + 海外可达 → **被墙** |
| `outcome: dead`（404/410） | **死链** |
| `outcome: error` / `timeout` | 保持国内原判，不改判 |

## 为什么不是原来的 `ulink.pages.dev`

原实现是 Cloudflare Pages Functions（`functions/api/check-link.ts`）。`*.pages.dev`
是全局命名空间：项目释放/改名后子域被回收，另一个账号注册同名项目即可占用。
证据：该域有 A 记录（未分配子域本应 NXDOMAIN）、响应头 `Server: cloudflare` +
`CF-RAY: …-LAX`、页面是第三方 link-in-bio 模板站（配置仍是模板默认值
`"Proud Ulink User"`）。前端因此在 2026-11-09 起把 `OVERSEAS_PROBE_URL` 置空、
`probeOverseas` 直接跳过。

探测逻辑没有丢，已抽到 `functions/_lib/probe-core.ts`；本 Worker 只是它的一个
新的部署形态，SSRF 校验仍复用 `supabase/functions/check-link/ssrf-guard.ts` 真源。

## 部署

前置：Cloudflare 账号 + `npx wrangler login`（或 `CLOUDFLARE_API_TOKEN`）。

```bash
# 仓库根执行
npx wrangler deploy --config probe-worker/wrangler.toml
```

成功后会打印类似：

```
https://ulink-probe.<你的子域>.workers.dev
```

先自测（必须带 Origin，Worker 对无 Origin 请求直接 403）：

```bash
curl -i "https://ulink-probe.<子域>.workers.dev/?url=https://example.com" \
  -H "Origin: https://ulink.ren"
# 期望：{"ok":true,"outcome":"alive","status":200}

curl -i "https://ulink-probe.<子域>.workers.dev/?url=https://example.com"
# 期望：403 {"error":"origin_required"}

curl -i "https://ulink-probe.<子域>.workers.dev/?url=http://127.0.0.1:8080"
# 期望：400 {"error":"private_ip_forbidden","outcome":"error","status":0}
```

> ⚠️ 上面这些 `*.workers.dev` 地址只用于本 Worker 形态的本地/备选验证，国内直连不可达，
> **不要写进 `.env.production`、不要用于生产**（生产端点见下一节）。

## 接到前端（⚠️ 备选形态、国内不可直连、不要用于生产）

> **本 Worker 只是「将来绑自有域名」时的备选实现，不是当前生产端点。**
> 2026-11-13 实测（见文件头）：`*.workers.dev` 在国内 DNS 通、TCP 20s 不通，直连超时；
> 把 workers.dev 地址写进 `.env.production` 会让探针**静默失效**（`probeOverseas` 4500ms
> abort 后保持国内原判，用户无感知）。`*.pages.dev` 同条件 200 / 0.43s，故**生产走 Pages**。
>
> **当前生产实际值**（见仓库根 `.env.production`，`probeOverseas` 用 GET，必须是带端点路径的
> 完整 GET 地址；只给 `*.pages.dev` 根路径会拿到 HTML / 404）：
>
> ```
> VITE_OVERSEAS_PROBE_URL=https://ulink-probe.pages.dev/api/check-link
> ```
>
> 请勿把 `VITE_OVERSEAS_PROBE_URL` / `VITE_CF_FN_BASE` 指向本文档的 `*.workers.dev` 地址，
> 也不要照抄本页 curl 自测里的 `...workers.dev/?url=...` 根路径去配生产。

只有在「已给 Worker 绑了国内可直连的自有域名、并实测可达」之后，才考虑把生产切到本
Worker 形态。届时 `.env.production` 应写**完整的 GET 端点**（`VITE_OVERSEAS_PROBE_URL` 直接
用完整 URL；若改用 `VITE_CF_FN_BASE` 只给基址，`src/config/urls.ts` 会拼 `/api/check-link`）：

```
# 仅备选：需先验证该自有域名国内可达；不要指向 *.workers.dev、不要用于生产
VITE_OVERSEAS_PROBE_URL=https://<你的自有域名>/api/check-link
```

> 注：`wrangler deploy` 打印的 `https://ulink-probe.<子域>.workers.dev` 与上面「先自测」里的
> `...workers.dev/?url=...` 是 Worker 形态的根路径入口（其 `fetch` 不限路径），**仅用于本地
> `wrangler dev` / 备选形态验证，不是生产探针端点**。

保持 `.env.production` 现有的 Pages 值 = 生产探针走 Pages（当前状态）。改完重新构建部署
（`main` 由 CI 自动发布）。

## 边界与风险（务必了解）

- **Origin 只是门槛，不是鉴权**。Origin 头可伪造，本端点本质上是匿名可用的
  「单页探测」服务；`cf-guard` 的限流是单 isolate 软闸（60 次/分钟），跨节点不共享。
  真要硬限流需要 Durable Objects / KV / Cloudflare Rate Limiting 规则。
- **没有海外可用性保证**。`*.workers.dev` 在国内部分地区 DNS 可能被污染/丢包；
  如果实测不稳，可给 Worker 绑一个自有域名（需该域名接入 Cloudflare，注意
  `ulink.ren` 现解析在 DNSPod 指向 CloudBase，不要为此整体迁走）。
- **SSRF 已防护**：协议白名单、字面量私有段、DoH A/AAAA 全程校验、每跳重定向重校验、
  最多 3 跳、只允许 http/https。只做探测，不返回目标内容（只回状态码）。
- **费用**：Workers 免费额度 10 万请求/天，本场景（每本书签最多一次）远低于上限。

## 本地开发

```bash
npx wrangler dev --config probe-worker/wrangler.toml --port 8787
# 另开一个终端：
curl "http://127.0.0.1:8787/?url=https://example.com" -H "Origin: http://localhost:5173"
```
