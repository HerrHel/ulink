# share-html Edge Function

## 用途

公开分享页**服务端渲染**：爬虫（微信 / WhatsApp / Facebook / Twitter）不执行 JS，
靠 GitHub Pages 纯静态托管拿不到前端动态注入的 og:* 元数据，导致社交预览卡一直
显示 `index.html` 静态默认值。本函数在 Supabase Edge Function 运行时把"取数 + 渲
染完整 HTML"搬到服务端，爬虫与人类都拿到同一份预渲染页面（title / description /
og:title / og:description / og:url / og:image / twitter:card / canonical / JSON-LD +
书签列表 + 「在 LinkVault 中打开」跳转按钮）。

## 架构要点

- **数据来源**：复用现有 `get_public_group` RPC（migration 018，SECURITY DEFINER，
  列级隔离，已排除 username / password / user_id），以 anon key 调用即可——最小权限、
  零额外授权。
- **渲染核可移植**：`esc` / `fixUrl` / `domainOf` / `stripTags` / `buildHead` /
  `buildBody` / `buildItemListJsonLd` / `renderSharePage` 全部为纯函数，**不触碰
  Deno 特有 API**（`serve` / `Deno.env`）。未来迁 Netlify / Vercel / Cloudflare Pages
  的 edge function 时只换外层薄薄一层胶水。
- **安全语义**：
  - `esc`：转义 `& < > " '`，覆盖属性值与文本节点两种上下文，防属性注入。
  - `fixUrl`：协议白名单仅 http/https，javascript: / data: / vbscript: 返空串，
    杜绝跨用户恶意 url 被渲染成可点击链接。
  - `stripTags`：组 notes 是 TipTap HTML，服务端不做 DOM 清洗，**降级为纯文本**
    展示（避免在 Edge 引入 DOMPurify 复杂度）。
  - `gid` 入参用 `/^[a-zA-Z0-9_-]{2,64}$/` 二次白名单校验，失败返 400。

## 部署

```bash
# 链接 Supabase 项目（已在 memory 记录）
supabase functions deploy share-html
# 必设环境变量
supabase secrets set SUPABASE_URL=https://<ref>.supabase.co
supabase secrets set SUPABASE_ANON_KEY=<anon key>
supabase secrets set APP_ORIGIN=https://ulink.ren
```

`APP_ORIGIN` 用于 og:image 绝对地址与底部「在 LinkVault 中打开」跳转地址，默认
`https://ulink.ren`。**买自定义域名后只需改这一处**。

## 契约

**请求**：`GET https://<ref>.supabase.co/functions/v1/share-html?gid=<gid>`

| 情形 | 响应 |
|---|---|
| gid 缺失 / 不合法 | `400 bad request` |
| gid 合法但组不存在 / 已取消公开 / 已软删除 | `404` + 简明 HTML 提示 |
| 成功 | `200`，完整预渲染 HTML，`cache-control: public, max-age=60, stale-while-revalidate=300` |

**响应 HTML 结构**：
- `<head>`：title / description / og:* / twitter:card=summary_large_image /
  canonical / ItemList JSON-LD
- `<body>`：组名 + 组 notes（纯文本） + 「N 个链接」 + 书签列表（首字母占位 +
  标题 + 域名，`<a target=_blank rel=noopener nofollow>`）+ 底部跳转按钮 →
  `${APP_ORIGIN}/s/<gid>`

## og:image

一期用静态品牌图 `public/share-cover.png`（1200×630，深蓝背景 + 链环图标 +
"LinkVault" + 副标题），随静态站部署在 `${APP_ORIGIN}/share-cover.png`。二期
可做动态 OG 图（再挂一个 `og-image` 函数，用组名/链接数画卡片图）。

## 链接生成

前端 `useDataShare.shareGroup` 通过 `SHARE_BASE`（`src/config/urls.ts`）拼出
**同域链接** `https://ulink.ren/s/<gid>`（终态，由 Cloudflare Pages Function 服务端渲染）。
旧 `SHARE_FUNCTION_BASE`（Supabase 函数域）保留导出，仅作旧链接向后兼容。

## 与 SPA 路由的关系

旧 `/s/<gid>` + `#share/<gid>` 路由（`detectShareRoute` + `ShareView.vue`）保留：
- 分享链接指向同域 `/s/<gid>`（主入口，OG 友好）
- 渲染页底部按钮跳转 `${APP_ORIGIN}/#share/<gid>`（人类点击进 SPA 走"复制到我的库"流程）
- 旧链接（直接粘 `/s/<gid>`）仍能自举 SPA（GitHub Pages 404.html 兜底，命中 `detectShareRoute`）

## 终态：Cloudflare Pages 同域 SSR（2026-08-21 已落地）

分享链接已从 Supabase 函数域升级为**同域 `https://ulink.ren/s/<gid>`**：

- **渲染核**：`functions/_lib/share-render.ts`（与 `supabase/functions/share-html/index.ts`
  渲染部分同步的纯函数，零运行时依赖，可继续平移到任意 edge 平台）。
- **入口**：`functions/s/[gid].ts`（Pages Function，`GET /s/<gid>`），复用
  `get_public_group` RPC（anon key + 列级隔离），输出与 Deno 版一致的 HTML。
- **路由**：`functions/_routes.json` 仅 `/s/*` 走 Function；`public/_redirects`
  提供 SPA fallback（`/* /index.html 200`），真实静态资源优先。
- **环境变量**（Cloudflare Pages → Settings → Environment variables）：
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `APP_ORIGIN=https://ulink.ren`。
- **部署**：
  ```bash
  npm run pages:deploy   # = npm run build && npx wrangler pages deploy dist --project-name linkvault
  ```
  首次需 `npx wrangler login`。自定义域在 CF Dashboard → Workers & Pages → 项目 →
  Custom domains 添加 `ulink.ren`，并按提示把 DNS（DNSPod）改为 CNAME 指向
  `<project>.pages.dev`（apex 需 CNAME 扁平化）。
- **Deno 版（Supabase 函数）保留**作旧链接兜底，DNS 切换完成后可下线。
