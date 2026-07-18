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

## H6：DNS TOCTOU 说明（已记录的架构限制）

`index.ts._validateUrl` 用 `Deno.resolveDns` 查 A/AAAA 校验私网后再把原始 URL 传给 `fetch`。
`fetch` 内部会再次独立 DNS 解析，两次解析之间存在 TOCTOU 窗口（攻击者可配权威 DNS 在校验
通过后把记录改为内网 IP）。Edge Function 运行时不支持自定义 fetch resolver，完整消除需
将出口走受限网关——超出本次审计修复能力范围。当前缓解：

- `_fetchWithRedirectGuard` 对每跳重定向 Location 重新走 `_validateUrl`（含 DNS lookup），
  覆盖「重定向后才指向内网」的 TOCTOU。
- `_dnsLookupSafe` 在解析能力降级（resolveDns 不可用/抛错）时按 best-effort 放行，是为保
  DNS 暂时不可用时正常页不被误判 dead；在受控运行时（Supabase Edge）resolveDns 可用，
  正常解析返回私网记录即拒，私网外泄面已显著收窄。

## 环境变量

- `ALLOWED_ORIGINS`：逗号分隔的允许 CORS 来源；未配置则 fail-closed 拒跨域。
- `CHECK_LINK_TIMEOUT_MS`：单跳请求超时（默认 10000ms）。
