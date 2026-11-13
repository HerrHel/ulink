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

原实现是 Cloudflare Pages Functions（`functions/api/check-link.ts`）。Pages 项目
退役后 `ulink.pages.dev` 被无关项目占用：实测 `/api/check-link` 的 GET 返回
`200 text/html 1519B`（和根路径同一份无关落地页），POST 返回 `405`。前端因此
在 2026-11-09 起把 `OVERSEAS_PROBE_URL` 置空、`probeOverseas` 直接跳过。

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

## 接到前端

在 `.env.production` 增加一行（**必须是 GET 端点**，`probeOverseas` 用 GET）：

```
VITE_OVERSEAS_PROBE_URL=https://ulink-probe.<子域>.workers.dev/
```

或只配基址让代码自己拼路径：

```
VITE_CF_FN_BASE=https://ulink-probe.<子域>.workers.dev
```

两者都不配 = 保持禁用（当前状态）。改完重新构建部署（`main` 由 CI 自动发布）。

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
