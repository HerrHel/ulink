# AI 双后端架构与切解析必做项

> **状态（2026-10-31 核实）**：本文写于 2026-10-26 的方案阶段；文中 §2 的「阻断性问题」（相对路径 `/api/*` 在非 CF 域名下 404）**已在同日 `24c7c206` 按方案 B 修复并上线**：`src/config/urls.ts` 的 `cfApiUrl()` 在生产构建返回绝对地址（`CF_FN_BASE` 默认 `https://ulink.pages.dev`），`OVERSEAS_PROBE_URL` 也是绝对地址。阅读时把 §2/§3 当作「已解决的历史问题」，现行事实见 `AGENTS.md`。
> 记录 2026-10-26 全面转向「真智能」后的后端分布现状。
> **切解析（`ulink.ren` 指向哪个平台）之前必须读完本文。**

---

## 1. 现状：AI 能力分布在三个地方

| 能力 | 运行位置 | 调用方 | 成本归属 |
|---|---|---|---|
| 语义搜索、URL 预填、去重、分类建议、平替兜底 | **浏览器本地**（概念本体 + 演化图谱 + 规则引擎） | 每次交互 | **¥0** |
| AI 对话、AI 补齐（标题/备注/分类建议） | CloudBase 云函数 `mimo-chat` | 用户主动 | CloudBase 资源点 + MiMo API |
| 意图寻站、类似平替（真模型） | **Cloudflare Pages Functions** `/api/ai-candidates` | 用户主动 | CF 函数调用 + CF 出网 + MiMo API |
| 网页元数据抓取 | **Cloudflare Pages Functions** `/api/extract-metadata` | 用户主动 | 同上 |
| 死链二次判定（海外探针） | **Cloudflare Pages Functions** `/api/check-link` | 自动（inconclusive 时） | 同上 |

**关键设计事实**：最高频的"智能"（预填、语义搜索、去重、分类）是**纯本地算法**，
不调模型、不产生 token 成本。这让"AI 融入日常使用"的成本影响远小于直觉——
见 `PRICING.md` §7。

---

## 2. ⚠️ 阻断性问题：三条 `/api/*` 在非 CF 域名下 404

前端有两处用**相对路径** fetch：

- `src/lib/ai/cloudCandidates.ts` → `fetch('/api/ai-candidates', ...)`
- `src/lib/ai/smartIntake.ts` → `fetch('/api/extract-metadata', ...)`

相对路径会打到**当前站点域名**。实测：

| 域名 | `/api/ai-candidates` | `/api/extract-metadata` | `/api/check-link` |
|---|---|---|---|
| `ulink-d1g5srvjo54b1886a-1436146693.tcloudbaseapp.com`（CloudBase 静态托管） | **404** | **404** | **404** |
| `ulink.pages.dev`（Cloudflare Pages） | 200 | 200 | 200 |

（`OVERSEAS_PROBE_URL` 用的是绝对地址 `https://ulink.pages.dev/api/check-link`，不受影响 ✓）

**后果**：站点当前挂在 CloudBase 域名上 → 意图寻站与网页抓取**一直在走本地兜底降级**，
用户拿到的是预置映射库的候选，不是真模型动态生成的结果。

---

## 3. 切解析时的三个选项

| 方案 | `ulink.ren` 指向 | `/api/*` 可用 | 分享页 SSR | 改动量 | 代价 |
|---|---|---|---|---|---|
| **A. 主站回 CF Pages** | Cloudflare | ✓ 天然可用 | 用 CF 版 `functions/s/`（仍在） | 小 | 与"分享 SSR 迁 CloudBase 是终态"的既有结论相反，要回退 |
| **B. 主站留 CloudBase + CF 作出海跳板**（**建议**） | CloudBase | 需把 2 处相对路径改成绝对地址 | CloudBase 版 ✓（已完成） | **最小**（2 处 fetch + 1 个环境变量） | CF Pages 不能退役，需长期保留（只做跳板，不承载主站） |
| C. 全部迁 CloudBase | CloudBase | 需把 3 条路径重写为云函数 | CloudBase 版 ✓ | 大 | **出海能力受损**：`r.jina.ai` 在国内机房不通（当初把探针放 CF 的原因），抓取与探针要重新设计 |

**建议 B**：主站与分享页都留在 CloudBase（刚部署完的 `share-ssr` 带密码门、noindex、
`X-Robots-Tag`），只把**需要出海的**三条路径用绝对地址指向 `ulink.pages.dev`，
CF Pages 从"主站"降级为"出海跳板"。

实施要点：

1. 新增环境变量 `VITE_CF_FN_BASE`（默认 `https://ulink.pages.dev`）
2. `cloudCandidates.ts` / `smartIntake.ts` 改用 `${VITE_CF_FN_BASE}/api/...`，
   **并保留失败降级**（现在就有兜底，别删）
3. `ALLOWED_ORIGINS` 的 CF 侧要放行 `https://ulink.ren`（CF Functions 的 CORS）
4. `OVERSEAS_PROBE_URL` 已有绝对地址，无需改

---

## 4. 上线前自检

- [ ] 在**最终域名**下逐个验证三条 `/api/*`（不是 pages.dev）
- [ ] 意图寻站在 CloudBase 域名下确实走真模型（看候选是否动态生成，而非预置映射）
- [ ] 死链的海外探针能命中（造一个境内不可达但海外可达的 URL，确认判为「被墙」而非「死链」）
- [ ] CF 侧 `MIMO_API_KEY` 未泄漏到前端产物（`functions/api/*.ts` 用 `Env` 绑定，不是 `VITE_` 前缀）
- [ ] CF Pages 的部署仍可用（退役计划推迟到 `/api/*` 全部迁走之后）
