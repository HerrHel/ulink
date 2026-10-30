# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

与链（ulink，原 LinkVault）— 单页书签管理器（PWA），Vue 3 + Pinia + TipTap 编辑器，Vite 构建，TypeScript。数据持久化于 localStorage + IndexedDB（Dexie），云端同步/认证走**腾讯云开发 CloudBase**。**双语文案**：中文「与链」/英文「ulink」，UI 语言切换入口在设置面板；首页静态 SEO 默认中文（应用内可在中文 / English 间切换，文档/首装/重置数据均跟随当前语言）。

> ## ⚠️ 后端现状（2026-10-22 起，务必先读）
>
> **生产已全量切换 CloudBase**（`.env.production` 的 `VITE_BACKEND=cloudbase`），Supabase 仅作历史迁移来源，**不要再往 `supabase/` 目录加功能**。
>
> - 环境 `ulink-d1g5srvjo54b1886a`（ap-shanghai，个人版），PG `postgres-2m9745ae`
> - 7 个 HTTP 云函数：`report-error / check-link / send-feedback / extract-video / jina-proxy / mimo-chat / share-ssr`，代码在 `cloudbase/functions/<name>/`
> - 部署：`node scripts/deploy-cloudbase-fn.mjs <fn>`（`--env-only` 只换环境变量）；派生资产 `node scripts/build-fn-assets.mjs`
> - 客户端双后端入口：`src/lib/dbApi.ts`（`dbFrom`/`dbRpc`）；`VITE_BACKEND` 在 `vitest.config.ts` 钉死为空
> - 网络策略：公开读只能走 SECURITY DEFINER RPC；`consume_rate_limit` 拒绝时返回 `{}`，判定必须 `data !== true`
> - 完整操作手册与坑：`docs/CLOUDBASE_MIGRATION.md`；备案：`docs/ICP_FILING_PREP.md`
> - ⚠️ **改 UI 配色/排版/动效前必读 `docs/BRAND.md`**：四主题四色相（浅蓝/暗粉/绿/米白）是品牌签名而非漂移，accent 令牌有五处副本需逐字同步
>
> **CLI 速查（任何 agent 可直接使用，无需重新登录）**
> - 二进制：`~/.workbuddy/binaries/node/cli-connector-packages/tcb`（bash 脚本 → `bash <path> ...`）
> - 登录态：**机器级共享** `~/.config/.cloudbase/auth.json`——某个 agent 登录后全体可用；报 `No valid identity` 时跑 `tcb login`，把输出的设备码链接交给用户点授权
> - 自检：`bash <tcb> env list`（应见 `ulink-d1g5srvjo54b1886a`）
> - 查库：`bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --json --sql "SELECT ..."`（SQL ≤10KB/批）
> - 函数/路由：`bash <tcb> fn list`、`bash <tcb> routes list --json`
> - 部署（cwd 必须为仓库根）：`node scripts/deploy-cloudbase-fn.mjs <fn> [--env-only]`

## 常用命令

```bash
npm run dev         # 开发服务器（自动打开浏览器）
npm run build       # 生产构建到 dist/
npm run preview     # 预览生产构建
npm run lint        # ESLint 检查 src/
npm run typecheck   # TypeScript 类型检查
npm run test        # 运行所有单元测试（vitest run）
npm run test:watch  # 监听模式运行单元测试
npm run test:ai-eval # AI 真模型 golden 回归评测（手动触发，需 AI_EVAL_TOKEN 或 AI_EVAL_EMAIL/PASSWORD，不进默认 CI）
npm run test:e2e    # Playwright E2E 测试（e2e/，自动起 dev server，端口 5173）
npm run test:e2e:prod # E2E 测试（生产构建模式：build+preview 起 5174，覆盖 PurgeCSS/minify 等仅生产构建生效的回归）
npm run coverage    # 单元测试覆盖率
```

运行单个测试文件：`npx vitest run src/__tests__/utils.test.ts`
Playwright 单个文件：`npx playwright test e2e/app.spec.ts`

**测试按需跑**：日常改动跑定向测试（改动文件对应的单测、相关 spec）即可；全量 `npm run test`（约 4700 测）与全量 e2e 仅在门禁场景跑（提交前自检、CI）。全量 vitest 固定 8 并发（`vitest.config.ts` maxWorkers）、e2e 文件级并行 3 worker；怀疑生产构建（PurgeCSS/minify）回归时用 `npm run test:e2e:prod`——dev server 无法复现该类问题，必须对生产产物测。e2e 首跑单条失败先多轮复跑判定 flake 再定性，勿直接当代码缺陷。

## ESLint

`eslint.config.js`（Flat Config，v10）。TypeScript 解析器，作用于 `src/**/*.{js,ts}`。`no-undef` 由 TS 接管故关闭。主要 error 规则：`no-eval`、`no-implied-eval`、`no-caller`、`no-redeclare`、`no-dupe-keys`、`no-duplicate-case`。warn 规则：`no-unused-vars`（`_` 前缀豁免，args 忽略）、`no-constant-condition`、`no-debugger`、`no-empty`、`no-unreachable`、`eqeqeq`（smart 模式）。

## 架构

### Pinia Store 拆分

Store 按"数据 / UI / 覆盖层 / 同步 / 安全"分多块，`app.ts` 为 Facade：

- **`stores/data.ts`** — bookmarks、siblingGroups、categories、customAttributes 及其 CRUD、过滤、排序
- **`stores/ui.ts`** — 运行时 UI 状态（视图、面板、模态框、拖拽上下文等）
- **`stores/undo.ts`** — 每组独立的 undo/redo 栈
- **`stores/app.ts`** — Facade，组合 data/ui/undo 三个 Store，对外暴露统一接口；新代码也可直接用具体 Store
- **覆盖层 Store**：`toast.ts`（Toast/Confirm/Undo）、`contextMenu.ts`、`actionSheet.ts`、`attrDropdown.ts`、`overlay.ts`（batchMove/mfb/mention 等开关）
- **`stores/auth.ts`** — 认证状态（user/session/OTP）；驱动由 `src/lib/authDriver.ts` 按后端分流（CloudBase / 历史 Supabase）
- **`stores/e2e.ts`** — E2E 加密开关与解锁状态
- **`stores/vault.ts`** — 主密码/生物识别安全状态（与 E2E 加密协作）
- **`stores/sync.ts`** — 云端同步状态（status/lastSyncAt/conflicts/realtime subscription）

**架构迁移注意**：原 `composables/bridge.ts` 是模块级服务定位器（ToastAPI/ContextMenuAPI/ActionSheetAPI 等通过组件 onMounted 注册、composable 消费），现已全部迁移至上述 Pinia Store，bridge.ts 文件已彻底删除（commit 34a2fef9 移除服务定位器、055779e0 删空壳）。**新代码一律用对应的 Pinia Store，不要向 bridge 注册任何 API。**

### 持久化与数据迁移

- **`stores/persist.ts`**：IDB 权威 + localStorage 缓存，saveData/loadFromStorage/getStorageInfo
- **`stores/storage.ts`**：Dexie IndexedDB 封装，突破 localStorage 5MB 限制
- **`stores/migrations.ts`**：旧格式兼容，在加载时自动执行

### Composables 层

composables 按职责分三组：

- `composables/domain/` — 业务逻辑：useBookmark、useGroup、useBatch、useAttrFilter、useDataIO、useDataShare、useUndo、useMention、useCloudSync、useSyncMapping、useSyncConflict、useSyncRealtime、useSyncHistory、useAuth、useDeadLinkChecker、useE2E、useVault、useVaultBiometric、useBiometric、useSpaceMove、attrSlug；sync 子逻辑另有独立模块：syncPush、syncPull、syncMergeCore、syncLocalMerge、syncMappingTables、syncPending、syncRemotePort、syncShare、syncCircuit（客户端同步熔断器：连续失败退避 + half-open 探活 + 恢复自动补推死信）
- `composables/interaction/` — 交互行为：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useScrollHeader、useLongPress、useKeyboardOps、listCardKeyboard
- `composables/ui/` — UI 辅助：useUI、useEditorFormat、useInlineRename、useInlineEdit、useIconPreview、usePasswordVisibility、useSyncStatus、useCardOverflow

另有模块级文件：`useApp.ts`（初始化协调）、`useAppHandlers.ts`（事件处理）、`useAppLifecycle.ts`（生命周期）、`useGlobalEvents.ts`（全局事件监听）、`useVirtualScroll.ts`（虚拟滚动）、`useInlineCard.ts`（内联卡片 HTML 生成）、`useCombinedList.ts`（从 CardGrid 提取的卡片列表组合逻辑：focus/custom/normal 三种模式）

**bridge.ts** 已删除（原服务定位器职责全部迁至 Pinia Store，见上"架构迁移注意"）。

### 数据模型

**单一真相源**：`src/schemas.ts` 用 Zod 定义数据模型并做运行时校验，`src/types.ts` 全部经 `z.infer` 从 schema 推导（勿手写平行 interface）：
- **Bookmark**：id, title, url, icon, username, password（string | EncryptedPassword）, notes, categoryId, parentId（支持子书签嵌套）, order, useCount, attributes, isExpanded, createdAt, updatedAt, deletedAt, pinnedAt（置顶时间戳，可选）
- **SiblingGroup**：id, name, categoryId, icon, order, isExpanded, attributes, bookmarkIds[], notes (HTML), updatedAt, useCount, isPublic, pinnedAt（置顶时间戳，可选）
- **Category**：id, name, icon, color, order
- **CustomAttribute**：id, name, type: 'boolean'
- **EncryptedPassword**：{ encrypted: true, data, iv, salt } — AES-256-GCM 加密后的密码对象

### E2E 加密

`src/crypto.ts` 包含三层密码处理：
1. **旧版兼容** — `safeDecodePassword` base64 解码
2. **E2E 加密（P2）** — PBKDF2（600K iterations）密钥派生 + AES-256-GCM 加密/解密，`encrypt`/`decrypt` 返回 salt:iv:ciphertext 格式
3. **密码迁移** — `encryptPassword` 生成 EncryptedPassword 对象，`autoMigratePassword` 自动识别 3 种格式（EncryptedPassword 对象 → 解密、base64 字符串 → 解码、空 → 返回空）

### EditorManager

`src/lib/editor.ts` 维护编辑器注册表 `_editors`。GroupEditor.vue 在 onMounted 时注册 TipTap 实例，EditorManager 提供格式化命令（bold/heading/list/taskList/color）和内容操作。Group 的 `notes` 字段存储 TipTap HTML。

### 其他 lib 模块

- `search.ts` — Fuse.js 模糊搜索 + pinyin-pro 拼音匹配，统一搜索书签和组
- `ai-classify.ts` — 基于域名关键词的轻量分类器，自动建议书签分类和属性标签
- `diffVersions.ts` — 版本差异对比，用于历史版本 diff UI
- `theme.ts` — 主题切换（亮色/暗色/自动）
- `toast.ts` — 轻量 toast 工具函数，委托 useToastStore（调用方无需在 setup 内使用 useToastStore）
- `errorReporter.ts` — Vue errorHandler/unhandledrejection → Supabase error_logs 表
- `stats.ts` — 本地匿名使用统计（localStorage 计数器），仅存不上传
- `head.ts` — 客户端 `<head>` 动态注入（title/meta/OG/canonical/JSON-LD），幂等、可清理，用于 ShareView 等页面的 SEO 元数据覆盖
- `recoveryKeyPDF.ts` — 纯 HTML+print 生成 Recovery Key PDF 下载
- `legal/renderLegalDoc.ts` — **法律文档构建期渲染器**：把 `docs/legal/*.md`（协议/隐私/退款政策，唯一真源）渲染成自包含 HTML 页面（内联 CSS、零 JS）。只做「标题锚点 / 目录 / 表格包裹 / 段落语义归类」四类 DOM 增强，条款文字逐字保留；末尾「**发布前检查**」内部引用块会自动剥离，绝不外泄。改法律文本**只改 md**，不要改 `public/privacy.html`、`public/terms.html`（现已降级为跳转桩，正文以 `/legal/<slug>.html` 为准）

> 法律文档产出路径（`vite.config.ts` 的 `legalDocsPlugin`）：`/legal/<slug>.html`（站内链接用）、`/legal/<slug>/`、`/legal/` 索引页；`/legal/<slug>.md` 保留原始 Markdown 供取证。站内链接常量在 `src/config/aiProviders.ts` 的 `LEGAL_DOC_LINKS`，落地页页脚在 `index.html`（键 `foot.terms` / `foot.privacy` / `foot.refund`，英文词典同步 `public/landing.js`）。

工具函数模块：`newId.ts`（ID 生成）、`clone.ts`（深拷贝）、`storageSafe.ts`（安全存储访问）、`withLock.ts`（互斥锁）、`boundedCache.ts`（有界缓存）、`dataReady.ts`（数据就绪标志）、`collectSubIds.ts`（子书签 ID 收集）、`download.ts`（文件下载）、`dragHint.ts`（拖拽提示）、`historyMax.ts`（历史上限）、`preview.ts`（预览辅助）、`supabase.ts`（Supabase client 封装）

### 组件结构

- `components/cards/` — BookmarkCard、GroupCard、CardGrid
- `components/editor/` — GroupEditor、FormatToolbar、ColorPalette
- `components/modals/` — BookmarkModal、CategoryModal、AttributeModal、GroupEditModal、ConfirmModal、AuthModal、HistoryPanel（版本历史 diff）、TrashPanel（回收站）、E2ESetupModal、E2EUnlockModal；辅助纯函数模块：bookmarkFormFilters.ts、formatTimeEpoch.ts、groupEditUrl.ts、trashOps.ts
- `components/overlays/` — ContextMenu、ActionSheet、BatchPopover、SearchSuggest、ToastContainer、MentionDropdown、AddPopover、AttrDropdown、CommandPalette、DeadLinksPopover、SyncConflictBanner
- `components/shell/` — AppHeader、AppNav、FilterBar、BatchBar、BatchBottom、DetailPanel、SettingsPanel、AttrChips
- 分享功能（原 `components/share/` 空占位目录已移除）：公开分享与 Fork 的实现位于 `views/ShareView.vue`（分享页 SPA UI，兼容兜底）+ `composables/domain/useDataShare.ts`（分享/Fork 逻辑 + 链接生成）+ `composables/domain/syncShare.ts`（云端公开读写）；后端公开读见 supabase migrations 005/010/012/013/014/015/018 与 `get_public_group` RPC。
- **分享页 SSR（解决 OG 预览/SEO）——终态同域**：分享链接为 `https://ulink.ren/s/<gid>`（`SHARE_BASE`，`src/config/urls.ts`）。**生产由 CloudBase `share-ssr` 云函数服务**（`cloudbase/functions/share-ssr/`：网关 `path=/s` + `enablePathTransmission` 前缀透传，函数内分流 `/s/<gid>` 与 `/s/c/<sid>`；渲染核 `share-render.ts` 原样 `--bundle` 派生；实例内存缓存 300s + 24h 兜底）。CF Pages 版（`functions/s/[gid].ts`，边缘 Cache API 5min+24h，`x-share-cache: MISS/HIT/STALE`）**仍保留但已非生产路径**，备案切解析后退役。历史 Deno 版 `supabase/functions/share-html/index.ts` 仅作旧链接兜底，其 T 字典须与 `share-render.ts` 保持同步。数据走 `get_public_group` RPC；og:image 用静态品牌图 `public/share-cover.png`。
- `components/ui/` — E2ELockOverlay（主密码锁定覆盖层）、ErrorBoundary

### src/config/

- `constants.ts` — 常量（存储键名、toast 时长、undo 限制等）
- `icons.ts` — SVG 图标映射表（~65 个图标），`getCategoryIcon` 按名称取图标
- `welcome-data.ts` — 默认示例数据（欢迎笔记 + 使用指南 HTML），从 constants.ts 拆出以减小 bundle

### 视图

`src/views/ShareView.vue` — 分享视图（独立路由），用于他人访问共享书签组

### 构建配置

- **双入口 MPA**：`/` = 宣传落地页（`index.html` 静态、应用同底色 #F5EFEA 分区叙事：Hero 左文右「星链」Canvas——中心最亮星 = 站点、节点轨道流转 + 脉冲流入（`/hero-visual.js`）——下接深度管理 / 同步与安全 / 主题视图演示（效率/舒适 × 深浅色用主应用真实 tokens 值）/ 创作与分享四屏 + 亮点条 + FAQ + 尾部 CTA；双语由 `/landing.js` 切换，含滚动显现与演示切换；顶栏「登录」→ `/app?login=1`，App.vue 读参直开认证弹窗并清 query），`/app` = 应用主体（`app.html`，noindex，SEO 归落地页；Cloudflare Pages Pretty URL 映射，dev/preview 由 `mpaAliasPlugin` 重写对齐）。`public/landing.js` 跳转决策（优先级递减）：任务参数直通（`?ext_save`/share_target 参数/`#share/`/Supabase token 一律透传直达 `/app`）→ 老用户秒跳（localStorage `linkvault_v2`/`lv_setup_done`，但首次访问 `/` 曝光一次落地页并写 `lv_landing_seen_v1`，此后秒跳）→ `?stay=1` 显式豁免秒跳（应用内官网书签携带；bump 该 key 版本号可对老用户重新曝光）。应用内入口 = 官网书签：`dataActionsBookmarks.ensureOfficialSiteBookmark` 启动时幂等补种固定 id `bm_ulink_home`（未分类置顶、URL 带 `?stay=1`；跨设备靠同 id 去重，`lv_landing_bm_done` 防彻底删除后被启动重灌）。PWA `start_url`、`share_target.action` 与扩展 `pwa-open.js` 均指向 `/app`；分享态退出剥路径回 `/app`（stores/share.ts `_stripSharePath`）
- **路径别名**：`@/*` → `src/*`（tsconfig.json + jsconfig.json）
- **手动分包**：tiptap-core、tiptap-extensions、prosemirror、dexie、dompurify、supabase、fuse、pinyin-pro、vue-vendor、vendor（vite.config.ts）
- **PurgeCSS**：自定义 Vite 插件，safelist 保护动态类名（`/^card-/`, `/^modal-/`, `/^ctx-/` 等前缀）
- **PWA**：vite-plugin-pwa，缓存策略见 vite.config.ts 中 workbox 配置（favicon-cache、font-cache）
- **安全头**：自定义 headersPlugin 注入 CSP、X-Content-Type-Options 等
- **SPA 404 回退**：spa404Plugin 已移除（2026-08-23），GitHub Pages 已停用；现由 Cloudflare Pages 原生 SPA 支持，未知路径回退 `/`（落地页）
- **前端部署**：Cloudflare Pages（`npm run pages:deploy`，wrangler 项目 ulink）；**后端云函数**用 `node scripts/deploy-cloudbase-fn.mjs <fn>`。⚠️ 备案通过后 `ulink.ren` 将切 CloudBase（届时静态产物需同步部署到 CloudBase 静态托管）

### CLI

`cli/` 目录是 与链（ulink，原 LinkVault）命令行工具（独立子项目：commander + @supabase/supabase-js + conf，独立 tsconfig/node_modules，不参与主项目构建与测试；vitest.config 已排除 `cli/node_modules/`）。

### 浏览器扩展

`extension/` 目录包含通用 Manifest V3 浏览器扩展（兼容 Edge、Chrome、Firefox、Brave、Arc 等多浏览器；通过 `npm run ext:pack` 打包），支持快捷键保存当前页面到 ulink（Ctrl+Shift+S，manifest 中 save-to-linkvault 命令），侧边栏（side_panel / sidebar_action）沉浸式操作。**双语文案**：扩展使用标准 WebExtensions i18n（`_locales/zh_CN` + `_locales/en`，`manifest.default_locale = "zh_CN"`），所有用户可见字段（manifest name/description/title 与 context menu/sidepanel 文本）走 `__MSG_xxx__` 占位 + `chrome.i18n.getMessage()`。`extension/lib/supabase.js` **现为 CloudBase shim**（`window.supabase.createClient(envId, publishableKey)` → `{ from: rdb().from, auth }`，`verifyOtp` 闭包适配），配套 `lib/cloudbase-sdk.js`（@cloudbase/js-sdk IIFE bundle）；`npm run ext:bundle-supabase` 的 supabase-js 生成物已废弃。

### 样式

CSS 按功能模块拆分到 `src/styles/` 目录：tokens.css（设计变量）、reset.css、layout.css、cards.css、group.css、editor.css、modals.css、overlays.css、header.css、nav.css、filter.css、batch.css、drag.css、settings.css、toast.css、responsive.css、utility.css，由 main.css 统一导入。

## 编码规范

- **禁止 var**，用 const/let
- 新 Vue 组件放入 `src/components/` 对应子目录
- UI 文本用中文，代码注释用中文
- 测试文件放 `src/__tests__/`，子目录有 `composables/` 和 `stores/`
- 单元测试使用 vitest + jsdom + @vue/test-utils
- E2E 测试在 `e2e/`，使用 Playwright（`playwright.config.ts` 自动起 dev server，baseURL `localhost:5173`，仅 chromium，CI 下重试 2 次）
- 测试 setup 文件 `src/__tests__/setup.ts`：mock localStorage，每个测试自动创建新 Pinia 实例

## 移动端拖拽排序

`useMobileDragReorder.ts` 是纯原生 pointer events 实现（非第三方库），iOS 原生风格：
- 原元素 `position: fixed` 跟手，无克隆体
- 仅 Y 轴移动，X 轴锁定
- 占位符在原位，其他卡片通过 CSS transition 平滑让位
- 所有 DOM 操作（卡片位置、占位符、边缘滚动）统一在 `requestAnimationFrame` 循环中执行，避免 pointer events 和 rAF 之间的竞争条件
- 仅在 `batchMode` 时通过 `.batch-drag-handle` 手柄触发
- 边缘滚动：靠近滚动容器边缘 60px 内自动滚动，速度与距离成正比

## 运维与安全

- **CSP**：`public/_headers`（生产）和 `vite.config.ts`（dev）。生产 script-src `'self'`（无 unsafe-inline），connect-src 有意放宽 `'self' https: wss://*.supabase.co`（死链 checkDirect 直连任意 URL 所需，勿私自收紧，见 vite.config.ts SEC-05 注释）；仅 dev 放宽 script-src 支持 HMR
- **页面/视频读取第三方转发（jina-proxy，2026-10-20 起无前端直连例外）**：AI 页面/视频读取的**降级链路**（`src/lib/ai/jinaReader.ts`）在 extract-video Edge Function 失败时经 `cloudbase/functions/jina-proxy/` 服务端转发（原 `supabase/functions/jina-proxy/` 已迁移）至 `r.jina.ai` 读取（国内网络降级），前端零直连第三方抓取服务。jina-proxy 防护对齐 extract-video/check-link 口径：鉴权（verify_jwt + getUser）+ 每用户限流（034 `consume_rate_limit`，fail-closed）+ SSRF 校验（复用 `check-link/ssrf-guard.ts` 与 `extract-video/video-adapters.ts` 真源，含 DNS fail-closed）+ CORS fail-closed + 上游超时 + 读取长度上限；目标 URL 仍会发送给第三方 r.jina.ai，前端每次触发以 toast 向用户披露。禁止前端直连外部抓取服务，也禁止移除该 toast 披露。
- **云函数 check-link**（生产 `cloudbase/functions/check-link/`，原 `supabase/functions/check-link/` 已迁移）：私有 IP 黑名单防 SSRF，超时/CORS 由 Supabase secrets 控制（`ALLOWED_ORIGINS`、`CHECK_LINK_TIMEOUT_MS`）；每用户限流（迁移 034 `consume_rate_limit` 计数器 + `private.rate_limit_counters`，默认 1200 次/分，`CHECK_LINK_RATE_LIMIT_PER_MIN` 可覆盖）；history 行数由迁移 033 剪枝触发器自动收敛（每书签留 5 条，与客户端 MAX_HIST 同口径）
- **错误追踪**：Vue errorHandler → `src/lib/errorReporter.ts` → CloudBase `error_logs` 表（生产经 `report-error` 云函数写入，5s 节流）
- **公开分享**：RLS 策略允许匿名 SELECT `is_public = true` 的组及其书签
- **CI/CD**：`.github/workflows/ci.yml`（**唯一** workflow）+ `dependabot.yml`（周检）。三个 job：
  - `lint-test`：npm ci → lint → typecheck → 单测 → `npm audit --omit=dev --audit-level=high`（blocking）→ `npm run build` 产物上传 artifact
  - `e2e`：Playwright chromium（带 `~/.cache/ms-playwright` 缓存加速）
  - `deploy`：`needs: [lint-test, e2e]`（**测试全绿才发布**）+ `if: refs/heads/main`（PR 与其它分支绝不发布）→ 复用 `lint-test` 构建产物 → `tcb hosting deploy ./dist --safe`（CloudBase 静态托管；`--safe` 发布前备份+失败回滚，免 `--verify` 加速跨洋部署）
    - 认证：`tcb login --cloudbase-api-key`（非交互），密钥取 `secrets.CLOUDBASE_APIKEY`；**未配该 secret 时跳过部署并告警**，门禁照常执行
    - 手动重部署：`gh workflow run ci.yml --ref main`
    - 线上版本自检：`npm run check:prod` —— 比对 `https://ulink.ren/version.json` 的 `commit` 与本地 HEAD（构建时由 vite `buildInfoPlugin` 注入；设置→关于 也显示短提交号）。退出码 0=一致 / 1=不一致 / 2=线上无该端点（旧版本）/ 3=网络失败
    - ⚠️ **CI 部署与手动 `tcb hosting deploy` 互斥**（会互相覆盖），统一走 CI
  - Supabase 时代的 `supabase-db-test` 门禁已于 2026-10-27 移除（验证的是已停用的 schema，对现网无保护作用）；`supabase/` 现为历史归档，说明见 `supabase/README.md`
