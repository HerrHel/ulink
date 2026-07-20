# check-link Edge Function

## 部署说明

- **唯一部署源：`index.ts`**。该文件是唯一受信任的 Edge Function 实现，包含完整鉴权链
  （Authorization → `supabase.auth.getUser` → 校验 user → 写 `link_check_history` 用 `user.id`）
  与多层 SSRF 防护（字面私有 IP 校验 + DNS 重绑定 A/AAAA 查询 + 逐跳重定向校验）。

- **`deploy.ts` 已被删除（C1/H5 修复）**。它曾是单文件 ASCII-only 部署镜像，但仅检查
  Authorization 头是否存在便放行、不校验调用者身份、不写 history，且 validateUrl 只复刻了
  字面私有 IP 校验、缺失 DNS 重绑定校验，构成「无鉴权 SSRF 开放代理」（C1）+ 可被公网域名
  绕过私网黑名单（H5）。若误部署到生产，任意持任意 JWT 者即可调用它对任意 http/https
  URL 发起服务端请求（内网/外网探测、绕过自身来源限制）。删除该 hazardous 副本、统一以
  `index.ts` 为唯一部署镜像即可彻底消除该风险。

- **部署方式**：本地 `supabase functions deploy check-link`（CLI）经 `index.ts` 部署；
  若需在 Supabase Dashboard 在线编辑器单文件粘贴，请粘贴 `index.ts` 全文。
  分包加载（`https://esm.sh/@supabase/supabase-js@2`）在 Edge Function 运行时可用。

- **SSRF 纯逻辑唯一真源**：`ssrf-guard.ts`，被 `src/__tests__/ssrf-guard.test.ts` 覆盖
  53 个单测守护。`index.ts` 内联了一份等价镜像纯逻辑（同步注释顶说明），改 SSRF 逻辑时
  请同步两处并保持一致。

## H6：DNS TOCTOU 说明与 fail-closed

`index.ts._validateUrl` 用 `Deno.resolveDns` 查 A/AAAA 校验私网后再把原始 URL 传给 `fetch`。
`fetch` 内部会再次独立 DNS 解析，两次解析之间仍存在 TOCTOU 窗口（攻击者可配权威 DNS 在校验
通过后把记录改为内网 IP）。Edge Function 运行时不支持自定义 fetch resolver 固定已校验 IP，
完整消除需出口走受限网关。当前缓解：

- `_fetchWithRedirectGuard` 对每跳重定向 Location 重新走 `_validateUrl`（含 DNS lookup），
  覆盖「重定向后才指向内网」的路径。
- **H6 修复**：`_dnsLookupSafe` 在 resolveDns 抛错 / 0 条 A+AAAA 时 **fail-closed 拒绝**，
  不再 best-effort 放行。解析能力降级时宁可误拦死链检测，也不跳过私网校验放大 SSRF 面。

## evidence API（契约）

Edge 不再回产品 verdict（dead/blocked），改回 **evidence**，客户端独占属性写入：

```jsonc
// 返回体
{ "fetch_outcome": "ok|timeout|connect_error|ssrf_reject|redirect_denied", "http_status": 200, "details": { "response_time": 123, "final_url": "...", "error": "..." } }
```

| fetch_outcome | 含义 | http_status |
|---|---|---|
| `ok` | 拿到 HTTP 响应（任意状态码，含 5xx） | 有效 |
| `timeout` | 请求超时 / 中断 | 0 |
| `connect_error` | DNS/TLS/连接失败（**不再标 dead**） | 0 |
| `ssrf_reject` | 原始 URL 或 DNS 解析到内网 | 0 |
| `redirect_denied` | 重定向目标不被允许 | 0 |

**history 契约列**：`link_check_history` 只写 `fetch_outcome` + `http_status`（及 url/details 等元数据）。
`status` 列已在迁移 022 废弃；决策依据始终是 `fetch_outcome` + `http_status`。

**Edge 不再 merge attributes**——客户端用 Edge evidence + 本机 no-cors 直连 + 网络基线健康融合出 `LinkVerdict`，独占写入 `dead-link`/`gfw-blocked`。

## HEAD → GET 降级

先 HEAD，若终 hop 仍是 HEAD 且状态属于 CDN/WAF 假报集合（400/401/403/404/405/501），
则对**已校验的 finalUrl** 单趟 GET，跳过中间 redirect hops（避免双全链）。
若 redirect 链中已因 301/302/303 升为 GET，不再从原始 URL 重跑。
HEAD 网络层失败（非超时/SSRF）仍从原始 URL 兜底 GET。

## 状态分类（客户端）

HTTP 分类在**客户端** `useDeadLinkChecker.classifyHttpStatus` 完成，偏「宁可 unknown 也不误杀」：

| 结果 | 条件 |
|------|------|
| `alive` | 2xx/3xx；401/403/405/429；部分 5xx（资源仍存在） |
| `dead` | 404 / 410 |
| `unknown` | 其余 4xx/5xx |

超时回 `fetch_outcome=timeout`，不再映射到任何 verdict。

客户端 `useDeadLinkChecker`：本机网络健康（baseline）+ Edge evidence + no-cors 直连融合出 `LinkVerdict`（alive/dead/gfw/inconclusive）。
- `gfw` 只在「本机网络不 offline + Edge `ok`+http_status 分类 alive + 本机直连不可达」时产出。
- 本机 offline 时一切映射 `inconclusive`，绝不落 `gfw-blocked`/`dead-link`（避免离线笔记本/captive portal 误持久化）。
- Edge `connect_error` + 本机也不可达 → `dead`；Edge 判 dead(404/410) 但本机可达 → `inconclusive`(head_mismatch)，不落标。
- `inconclusive` 不落标也不抹旧标，保留上次状态避免抖动。网络基线用百度/gstatic/cloudflare 多源最短 RTT。

## 环境变量

- `ALLOWED_ORIGINS`：逗号分隔的允许 CORS 来源；未配置则 fail-closed 拒跨域。
- `CHECK_LINK_TIMEOUT_MS`：单跳请求超时（默认 10000ms）。
