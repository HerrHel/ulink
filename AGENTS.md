# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

与链（ulink，原 LinkVault）— 单页书签管理器（PWA）+ AI 工作台，Vue 3 + Pinia + TipTap 编辑器，Vite 构建，TypeScript。数据持久化于 localStorage + IndexedDB（Dexie），云端同步/认证走**腾讯云开发 CloudBase**；另有订阅会员（PRO，`plans` 表为价格/权益唯一来源）与视频解析能力。**双语文案**：中文「与链」/英文「ulink」，UI 语言切换入口在设置面板；首页静态 SEO 默认中文（应用内可在中文 / English 间切换，文档/首装/重置数据均跟随当前语言）。

> ## ⚠️ 后端与线上部署现状（2026-10-31 核对，务必先读）
>
> **生产已全量切换 CloudBase**（`.env.production` 的 `VITE_BACKEND=cloudbase`），Supabase 仅作历史迁移来源，**不要再往 `supabase/` 目录加功能**。ICP 备案已于 **2026-10-27 通过**（`鄂ICP备2026061718号-1`，展示在 `src/config/site.ts` / `public/landing.js`），`ulink.ren` 自 **2026-10-28** 起解析到 CloudBase（网关 `/` → 静态托管），不再经 Cloudflare。
>
> - 环境 `ulink-d1g5srvjo54b1886a`（ap-shanghai，个人版），PG `postgres-2m9745ae`
> - 11 个 HTTP 云函数 + `maintenance` 定时任务：`report-error / check-link / send-feedback / extract-video / jina-proxy / mimo-chat / share-ssr / pay / redeem / account / share-admin`，代码在 `cloudbase/functions/<name>/`
> - 视频解析微服务 `ulink-video-worker`（CloudBase 云托管，`scripts/video-worker/`，yt-dlp + Playwright + ffmpeg，可选 ASR/OCR 深度解析）；`extract-video` 函数通过 `VIDEO_WORKER_URL` 调用，接口契约见 `docs/VIDEO_DEEP_EXTRACT.md`
> - 云函数部署：`node scripts/deploy-cloudbase-fn.mjs <fn>`（`--env-only` 只换环境变量）；派生资产 `node scripts/build-fn-assets.mjs`
> - **前端部署**：`ulink.ren` = **CloudBase 静态托管**，由 `.github/workflows/ci.yml` 的 `deploy` job 用 `tcb hosting deploy ./dist --safe` 发布（测试全绿才发）。Cloudflare Pages（`ulink.pages.dev`）**已不是主站**，仅保留 `/api/*` 边缘函数（`functions/`）与历史兜底；`npm run pages:deploy` 是手动遗留通道，**不要用它发布主站**
> - 线上自检：`npm run check:prod`（比对 `https://ulink.ren/version.json` 的 commit 与本地 HEAD；构建时 `buildInfoPlugin` 注入）
> - 客户端双后端入口：`src/lib/dbApi.ts`（`dbFrom`/`dbRpc`）；`VITE_BACKEND` 在 `vitest.config.ts` 钉死为空
> - 网络策略：公开读只能走 SECURITY DEFINER RPC；`consume_rate_limit` 拒绝时返回 `{}`，判定必须 `data !== true`
> - 完整操作手册与坑：`docs/CLOUDBASE_MIGRATION.md`（迁移/备案均已完成，文中"切解析前"属历史方案记录）；备案底稿：`docs/ICP_FILING_PREP.md`（2026-10-27 已通过，保留取证）
> - ⚠️ **改 UI 配色/排版/动效前必读 `docs/BRAND.md`**：四主题四色相（浅蓝/暗粉/绿/米白）是品牌签名而非漂移，accent 令牌有五处副本需逐字同步
>
> **CLI 速查（任何 agent 可直接使用，无需重新登录）**
> - 二进制：`~/.workbuddy/binaries/node/cli-connector-packages/tcb`（bash 脚本 → `bash <path> ...`；**Windows 无 bash 时直接执行同目录 `tcb.cmd`**，参数相同）
> - 登录态：**机器级共享** `~/.config/.cloudbase/auth.json`——某个 agent 登录后全体可用；报 `No valid identity` 时跑 `tcb login`，把输出的设备码链接交给用户点授权
> - 自检：`bash <tcb> env list`（应见 `ulink-d1g5srvjo54b1886a`）
> - 查库：`bash <tcb> db execute -e ulink-d1g5srvjo54b1886a --json --sql "SELECT ..."`（SQL ≤10KB/批）
> - 函数/路由：`bash <tcb> fn list`、`bash <tcb> routes list --json`
> - 应用迁移（多行 SQL；CLI 只有 `--sql` 没有 `--file`）：`node scripts/apply-cloudbase-migration.mjs cloudbase/migrations/<file>.sql`
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

**测试按需跑**：日常改动跑定向测试（改动文件对应的单测、相关 spec）即可；全量 `npm run test`（约 5200 个用例 / 360+ 测试文件）与全量 e2e 仅在门禁场景跑（提交前自检、CI）。全量 vitest 固定 8 并发（`vitest.config.ts` maxWorkers）、e2e 文件级并行 3 worker；怀疑生产构建（PurgeCSS/minify）回归时用 `npm run test:e2e:prod`——dev server 无法复现该类问题，必须对生产产物测。e2e 首跑单条失败先多轮复跑判定 flake 再定性，勿直接当代码缺陷。

## ESLint

`eslint.config.js`（Flat Config，v10）。两块配置：`src/**/*.{js,ts}` 用 `@typescript-eslint/parser`，`src/**/*.vue` 走 `vue.configs['flat/base']` + `flat/recommended`（模板解析交给 vue-eslint-parser，`<script lang="ts">` 再交 TS 解析器）。`no-undef` 由 TS 接管故关闭。主要 error 规则：`no-eval`、`no-implied-eval`、`no-caller`、`no-redeclare`、`no-dupe-keys`、`no-duplicate-case`（vue 侧另有 `vue/require-v-for-key`、`vue/no-mutating-props` 等高价值规则钉 error）。warn 规则：`@typescript-eslint/no-unused-vars`（`_` 前缀豁免，args 忽略）、`no-constant-condition`、`no-debugger`、`no-empty`、`no-unreachable`、`eqeqeq`（smart 模式）。`npm run lint` 带 `--max-warnings 0`，warn 也阻断。

## 架构

### Pinia Store 拆分

Store 按"数据 / UI / 覆盖层 / 同步 / 安全"分多块，`app.ts` 为 Facade：

- **`stores/data.ts`** — 数据 Store 的**组合入口**（bookmarks、siblingGroups、categories、customAttributes 的 CRUD、过滤、排序；对外 API 不变）。实现已拆到同目录：`dataShared.ts`（写保护/影子合并/历史防抖/state 工厂）、`dataGetters.ts`（全部 getters）、`dataActionsCore.ts` / `dataActionsBookmarks.ts` / `dataActionsGroups.ts` / `dataActionsCategories.ts` / `dataActionsAttributes.ts` / `dataActionsIO.ts`；纯函数在 `src/lib/dataQuery.ts`
- **`stores/ui.ts`** — 运行时 UI 状态（视图、面板、模态框、拖拽上下文等；`activeView: 'bookmarks' | 'ai'`）
- **`stores/undo.ts`** — 每组独立的 undo/redo 栈
- **`stores/app.ts`** — Facade，组合 data/ui/undo 三个 Store，对外暴露统一接口；新代码也可直接用具体 Store
- **`stores/share.ts`** — 分享**只读态**（`ui.shareMode`）：分享链接不再走独立页面，而是主应用的一种只读状态（大组卡片 + 只读笔记 / 分类卡片网格），含 `_stripSharePath`、detectShareRoute、fork；`stores/shareShadow.ts` 是零依赖影子数据容器，分享内容只以 Map 合并进 getter，**绝不写进本机 data 数组**
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

- `composables/domain/` — 业务逻辑，按域分组：书签/组/批量/属性/导入导出/分享（useBookmark、useGroup、useBatch、useAttrFilter、useDataIO、useDataShare、useUndo、useMention、useSpaceMove、attrSlug、useImageUpload）；同步（useCloudSync、useSyncMapping、useSyncConflict、useSyncRealtime、useSyncHistory + 子模块 syncPush/syncPull/syncMergeCore/syncLocalMerge/syncMappingTables/syncPending/syncRemotePort/syncPortCore/syncRemotePort.cloudbase/syncShare/syncDedup/syncCircuit——熔断器：连续失败退避 + half-open 探活 + 恢复自动补推死信）；安全与账号（useAuth、useE2E、useVault、useVaultBiometric、useBiometric、useAccountDeletion、useSharePassword）；AI 工作台（useAiChat、useAiChatSubmit、useAiChatAgent、useAiChatSessions、useAiActionCards）；计费会员（usePayment、usePurchasePlans、useRedeem、useEntitlement、useTransactions）；死链检测（useDeadLinkChecker）
- `composables/interaction/` — 交互行为：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useScrollHeader、useLongPress、useKeyboardOps、listCardKeyboard
- `composables/ui/` — UI 辅助：useUI、useEditorFormat、useInlineRename、useInlineEdit、useIconPreview、usePasswordVisibility、useSyncStatus、useCardOverflow、useMaskClose、useRotatingPlaceholder；聊天面板（useChatDisplay、useChatInputInteraction、useChatPanelDom、useChatPanelShell）

另有模块级文件：`useApp.ts`（初始化协调）、`useAppHandlers.ts`（事件处理）、`useAppLifecycle.ts`（生命周期）、`useGlobalEvents.ts`（全局事件监听）、`useVirtualScroll.ts`（虚拟滚动）、`useInlineCard.ts`（内联卡片 HTML 生成）、`useCombinedList.ts`（从 CardGrid 提取的卡片列表组合逻辑：focus/custom/normal 三种模式）、`useListNav.ts`（列表键盘导航）

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
- `ai-classify.ts` — 基于域名关键词的轻量分类器（本地兜底，不调模型）
- `ai/` — **AI 工作台内核（约 45 个模块）**，见下方「AI 工作台」小节
- `authDriver.ts` — 认证驱动分流（CloudBase / 历史 Supabase），`stores/auth.ts` 消费
- `cloudbase.ts` / `dbApi.ts` / `supabase.ts` — 后端客户端与兼容层（`invokeCbFunction`、`dbFrom`/`dbRpc`；`supabase.ts` 仅历史兼容）
- `diffVersions.ts` — 版本差异对比，用于历史版本 diff UI
- `theme.ts` — 主题切换（亮色/暗色/自动）
- `toast.ts` — 轻量 toast 工具函数，委托 useToastStore（调用方无需在 setup 内使用 useToastStore）
- `errorReporter.ts` — Vue errorHandler/unhandledrejection → `report-error` 云函数 → CloudBase `error_logs`（历史 Supabase 通道保留）
- `stats.ts` — 本地匿名使用统计（localStorage 计数器），仅存不上传
- `head.ts` — 客户端 `<head>` 动态注入（title/meta/OG/canonical/JSON-LD），幂等、可清理，用于分享页等 SEO 元数据覆盖
- `recoveryKeyPDF.ts` — 纯 HTML+print 生成 Recovery Key PDF 下载
- `deadLinkDecision.ts` — 死链判定纯函数（状态分类 / 评分 / 决策）；`bookmarkDedup.ts` — 书签去重；`dragSwap.ts` — 置顶/换序内核；`importParse.ts` — 导入解析（Raindrop JSON / 书签 HTML / CSV）；`dataQuery.ts` — 数据过滤/排序纯函数；`e2eFields.ts` — 加密字段集；`imageCompress.ts` / `imageExtension.ts` / `imageStorage.ts` — 图片压缩、TipTap 图片扩展、图片存储；`menuConfig.ts` — 右键菜单配置；`pow.ts` — 前端 PoW 挑战；`secureContext.ts` — 生物识别可用环境判定；`avatar.ts` — 头像占位；`preview.ts` — 预览辅助
- `legal/renderLegalDoc.ts` — **法律文档构建期渲染器**：把 `docs/legal/*.md`（协议/隐私/退款政策，唯一真源）渲染成自包含 HTML 页面（内联 CSS、零 JS）。只做「标题锚点 / 目录 / 表格包裹 / 段落语义归类」四类 DOM 增强，条款文字逐字保留；末尾「**发布前检查**」内部引用块会自动剥离，绝不外泄。改法律文本**只改 md**，不要改 `public/privacy.html`、`public/terms.html`（现已降级为跳转桩，正文以 `/legal/<slug>.html` 为准）

> 法律文档产出路径（`vite.config.ts` 的 `legalDocsPlugin`）：`/legal/<slug>.html`（站内链接用）、`/legal/<slug>/`、`/legal/` 索引页；`/legal/<slug>.md` 保留原始 Markdown 供取证。站内链接常量在 `src/config/aiProviders.ts` 的 `LEGAL_DOC_LINKS`，落地页页脚在 `index.html`（键 `foot.terms` / `foot.privacy` / `foot.refund`，英文词典同步 `public/landing.js`）。

工具函数模块：`newId.ts`（ID 生成）、`clone.ts`（深拷贝）、`storageSafe.ts`（安全存储访问）、`withLock.ts`（互斥锁）、`boundedCache.ts`（有界缓存）、`dataReady.ts`（数据就绪标志）、`collectSubIds.ts`（子书签 ID 收集）、`download.ts`（文件下载）、`dragHint.ts`（拖拽提示）、`historyMax.ts`（历史上限）、`preview.ts`（预览辅助）、`supabase.ts`（Supabase client 兼容层）。根级还有 `src/utils.ts`（DOM/HTML 净化等杂项工具）与 `src/version.ts`（构建信息：版本号 + 短提交号，`/version.json` 同源）。

### 组件结构

- `components/cards/` — BookmarkCard、GroupCard、CardGrid、AiInlineCard（AI 候选卡片）
- `components/chat/` — AI 工作台：AiWorkspace（`activeView === 'ai'` 时的异步加载主视图）、ChatStream、ChatInputDock、ChatTopBar、ChatDagPlan、ChatDraftDiff
- `components/editor/` — GroupEditor、FormatToolbar、ColorPalette
- `components/modals/` — BookmarkModal、ChildBookmarkEditModal、CategoryModal、AttributeModal、GroupEditModal、ConfirmModal、ChoiceModal、AuthModal、HistoryPanel（版本历史 diff）、TrashPanel（回收站）、E2ESetupModal、E2EUnlockModal、E2ECanaryConflictModal、VaultSetupModal、VaultUnlockModal、SetPasswordModal、SetupGuide、ShareModal、PurchaseModal（购买/续费：选套餐 → 二维码 → 轮询 → 到账）、AiEnrichModal；辅助纯函数模块：bookmarkFormFilters.ts、formatTimeEpoch.ts、groupEditUrl.ts、trashOps.ts、e2eHintText.ts、validatePwResetInput.ts
- `components/overlays/` — ContextMenu、ActionSheet、BatchPopover、SearchSuggest、ToastContainer、MentionDropdown、AddPopover、AttrDropdown、CommandPalette、DeadLinksPopover、SyncConflictBanner、SyncStatusPopover、UserPopover、ShortcutHelpPanel
- `components/shell/` — AppHeader、AppNav、FilterBar、BatchBar、BatchBottom、DetailPanel、SettingsPanel、AttrChips、CornerInspectorCard、EdgeStagingSidebar
- 分享功能（**`views/ShareView.vue` 已于 2026-08-31 删除，不要按旧文档去找**）：公开分享与 Fork 逻辑在 `composables/domain/useDataShare.ts`（分享/Fork + 链接生成）+ `composables/domain/syncShare.ts`（云端公开读写）；**只读态 UI 在主应用内**（`stores/share.ts` + `stores/shareShadow.ts`，App.vue 按 `ui.shareMode` 渲染只读大组/分类网格）；后端公开读走 `get_public_group` RPC。
- **分享页 SSR（解决 OG 预览/SEO）——终态同域**：分享链接为 `https://ulink.ren/s/<gid>`（`SHARE_BASE`，`src/config/urls.ts`）。**生产由 CloudBase `share-ssr` 云函数服务**（`cloudbase/functions/share-ssr/`：网关 `path=/s` + `enablePathTransmission` 前缀透传，函数内分流 `/s/<gid>` 与 `/s/c/<sid>`；渲染核 `share-render.js` 由 `functions/_lib/share-render.ts` 经 `node scripts/build-fn-assets.mjs` 派生；实例内存缓存 300s + 24h 兜底）。CF Pages 版（`functions/s/[gid].ts`，边缘 Cache API 5min+24h，`x-share-cache: MISS/HIT/STALE`）**仍保留但已非生产路径**（备案 10-27 已通过，主路径固定在 CloudBase）。历史 Deno 版 `supabase/functions/share-html/index.ts` 仅作旧链接兜底，其 T 字典须与 `share-render.js` 保持同步。数据走 `get_public_group` RPC；og:image 用静态品牌图 `public/share-cover.png`。
- `components/ui/` — E2ELockOverlay（主密码锁定覆盖层）、ErrorBoundary、BrandLogo

### src/config/

- `constants.ts` — 常量（存储键名、toast 时长、undo 限制、favicon/探活 URL 等）
- `icons.ts` — SVG 图标映射表（~65 个图标），`getCategoryIcon` 按名称取图标
- `welcome-data.ts` — 默认示例数据（欢迎笔记 + 使用指南 HTML），从 constants.ts 拆出以减小 bundle
- `aiProviders.ts` — AI 供应商目录/默认模型 + `LEGAL_DOC_LINKS`（法律文档站内链接常量）
- `site.ts` — 站点主体与备案信息（`ICP_NUMBER` / `MPS_NUMBER` / `MPS_CODE` / `MIIT_URL`）
- `urls.ts` — 域名常量（`APP_CANONICAL_BASE`、`SHARE_BASE`、`CF_FN_BASE`、海外探针）
- `videoPlatforms.json` — 视频平台域名清单**唯一真源**，由 `node scripts/build-fn-assets.mjs` 派生到 `cloudbase/functions/extract-video/` 与扩展

### 视图

`src/views/` 现仅存分享页拆分出的纯函数模块（`buildItemListJsonLd` / `buildShareEntries` / `deriveShareUrl` / `resolveGroupIconSvg` / `splitCategoryItems`）。**`ShareView.vue` 已于 2026-08-31（commit `6c72f61b`）删除**：分享页改为主应用内只读态（`stores/share.ts`）+ CloudBase `share-ssr` 渲染 `/s/*`；找分享 UI 请去 `App.vue` 与 `components/`。

### AI 工作台（2026-10 新增，`activeView === 'ai'`）

- 入口：`ui.activeView = 'ai'`；`App.vue` 异步加载 `components/chat/AiWorkspace.vue`（不进首屏 bundle）
- 内核 `src/lib/ai/`（约 45 个模块，按职责）：
  - 主链路：mimoClient / mimoStream / mimoPrompt / mimoReply（经 `mimo-chat` 云函数 SSE 流式，**前端不直连模型**）
  - 智能体：universalAgent、tools、siteCommander / siteActions / siteIntents / siteHitl / siteUndoStack、taskPlanner
  - 检索与知识：knowledge、localRAG、evolvingGraph、semanticSearch、localClustering、mentalModel、queryExpand、serendipityEngine、ambientInsights / ambientGrooming
  - 录入与整理：smartIntake、smartPrefill、bookmarkEnrich、candidateSave、cloudCandidates、similarWebsites、noteWriteback、draftDiff
  - 卡片与场景：cardReader、cardLocator、chatSessions、chatStreamParser、attachmentHelper、sendSummary
  - 视频/网页：videoExtract、videoHarvest、deepVideoExtract、videoPlatforms、jinaReader、deepLinkExtract、universalUrlInference
  - 安全：secretFilter、urlGuard、aiProfile
- 云端：`cloudbase/functions/mimo-chat/`（按 uid 限流 + 额度；线上 `BILLING_MODE=enforce`）；模型密钥只在云函数/云托管环境变量，**绝不进前端**
- 额度口径见 `docs/PRICING.md`；改额度先改 `plans.features`，再同步文档

### 计费与会员（2026-10 上线）

- 云函数：`pay`（微信 Native / 支付宝当面付：下单 / 回调 / 查单 + 幂等发货）、`redeem`（兑换码）、`account`（注销 + 交易记录）
- 数据：迁移 `20261025000002_billing_core.sql`（plans / entitlements / orders / usage_ledger）、`20261025000004_redeem_code.sql`、`20261028000010_payment_flow.sql`；**价格与权益唯一来源 = `plans` 表（`price_cents` + `features`）**，前端不硬编码
- 前端：`PurchaseModal.vue` + `usePayment`（下单/轮询/到账）、`usePurchasePlans`、`useTransactions`、`useRedeem`、`useEntitlement`，设置面板会员区
- 计费模式：`BILLING_MODE`（`shadow` 只计量 / `enforce` 超额 429）；线上 `mimo-chat` 已配 `enforce`。改额度展示前先读 `docs/BILLING_OPS.md`
- 上线手册：`docs/WXPAY_ROLLOUT.md`、`docs/ALIPAY_ROLLOUT.md`；当前仅微信渠道完成密钥配置（支付宝待开通）

### 国际化（i18n）

- `src/i18n/index.ts`：`t(key, params)` / `tN(key, n)`（复数）、`detect()`（localStorage `lv_locale` → 浏览器语言 → 中国时区 → 英文）、`setLocale`；缺 key 运行时回落中文
- 语言包：`src/locales/zh.ts`（键全集基准）/ `en.ts`，按域拆到 `src/locales/parts/`（aiCommander、aiPro、purchase、shareApp、modals、e2eVault、editorOverlay、programmatic）；`src/__tests__/i18n.test.ts` 保障键对齐
- 落地页是独立静态脚本 `public/landing.js`，自带词典、**不引用 src**；改落地页双语文案要两边同步
- 规则：新增 UI 文案必须 zh/en 同时加 key，禁止在模板里硬编码中文

### 构建配置

- **双入口 MPA**：`/` = 宣传落地页（`index.html` 静态、应用同底色 #F5EFEA 分区叙事：Hero 左文右「星链」Canvas——中心最亮星 = 站点、节点轨道流转 + 脉冲流入（`/hero-visual.js`）——下接深度管理 / 同步与安全 / 主题视图演示（效率/舒适 × 深浅色用主应用真实 tokens 值）/ 创作与分享四屏 + 亮点条 + FAQ + 尾部 CTA；双语由 `/landing.js` 切换，含滚动显现与演示切换；顶栏「登录」→ `/app?login=1`，App.vue 读参直开认证弹窗并清 query），`/app` = 应用主体（`app.html`，noindex，SEO 归落地页；CloudBase 网关直接映射，dev/preview 由 `mpaAliasPlugin` 重写对齐）。`public/landing.js` 跳转决策（**2026-10-29 起，commit `156fa65e`**）：**默认一律直达 `/app`**（任务参数 `?ext_save` / share_target / `#share/` / token 原样透传）；**只有 URL 带 `?stay=1` 才停留展示宣传页**（应用内官网书签携带）。脚本里「老用户秒跳 + `lv_landing_seen_v1` 首次曝光」的旧逻辑仍保留，但已不参与默认路径，改动时勿混淆。应用内入口 = 官网书签：`dataActionsBookmarks.ensureOfficialSiteBookmark` 启动时幂等补种固定 id `bm_ulink_home`（未分类置顶、URL 带 `?stay=1`；跨设备靠同 id 去重，`lv_landing_bm_done` 防彻底删除后被启动重灌）。PWA `start_url`、`share_target.action` 与扩展 `pwa-open.js` 均指向 `/app`；分享态退出剥路径回 `/app`（stores/share.ts `_stripSharePath`）
- **路径别名**：`@/*` → `src/*`（tsconfig.json + jsconfig.json）
- **手动分包**：tiptap-core、tiptap-extensions、prosemirror、dexie、dompurify、supabase、fuse、pinyin-pro、vue-vendor、vendor（vite.config.ts）
- **PurgeCSS**：自定义 Vite 插件，safelist 保护动态类名（`/^card-/`, `/^modal-/`, `/^ctx-/` 等前缀）
- **PWA**：vite-plugin-pwa，缓存策略见 vite.config.ts 中 workbox 配置（favicon-cache、font-cache）
- **安全头**：dev/preview 由 vite `headersPlugin` 注入真实响应头；生产（CloudBase 静态托管不支持响应头）由 `securityMetaPlugin` 在构建期注入 `<meta>` CSP（剔除 frame-ancestors）+ Referrer-Policy，法律页由 `renderLegalDoc` 注入 `default-src 'none'` 的严格 CSP；XCTO / frame-ancestors 仍缺（见 `docs/TECH_DEBT.md` §零 #1）
- **未知路径**：CloudBase 静态托管（腾讯云 COS）对不存在路径返回 404（2026-10-31 实测），不再是 Cloudflare 的 SPA 回退；应用自身不依赖 history 路由（入口固定 `/app`，分享走网关 `/s/*`），新增前端路由需同时在托管侧配回退
- **前端部署**：`npm run build` 产物由 CI 部署到 **CloudBase 静态托管**（`tcb hosting deploy ./dist --safe`）；**后端云函数**用 `node scripts/deploy-cloudbase-fn.mjs <fn>`。Cloudflare Pages 仅保留 `functions/` 下的 `/api/*` 边缘函数（手动 `npm run pages:deploy` 才更新，非主站发布通道）

### CLI

`cli/` 目录是 与链（ulink，原 LinkVault）命令行工具（独立子项目：commander + @supabase/supabase-js + conf，独立 tsconfig/node_modules，不参与主项目构建与测试；vitest.config 已排除 `cli/node_modules/`）。⚠️ **CLI 仍以 Supabase 为目标**（README 与 `config set-url/set-key` 都指 Supabase）；后端迁 CloudBase 后 CLI 未适配，连生产会读到迁移前的历史数据，当前仅作参考实现。

### 浏览器扩展

`extension/` 目录包含通用 Manifest V3 浏览器扩展（兼容 Edge、Chrome、Firefox、Brave、Arc 等多浏览器；通过 `npm run ext:pack` 打包），支持快捷键保存当前页面到 ulink（Ctrl+Shift+S，manifest 中 save-to-linkvault 命令），侧边栏（side_panel / sidebar_action）沉浸式操作。**当前版本 1.2.1**（2026-10-31：移除遗留 Supabase host 权限、`config.js` 改为 CloudBase 配置）。v1.2.0 起还有「视频深度解析」：视频页右键菜单 → 读取 B站 `__playinfo__` / 抖音页面态/DOM hook → 打开 `video-extract.html` 调云函数 `extract-video` 的 `client` 媒体通道（不装扩展时网页端会提示需扩展；B站正式支持、抖音/小红书实验性）。**双语文案**：扩展使用标准 WebExtensions i18n（`_locales/zh_CN` + `_locales/en`，`manifest.default_locale = "zh_CN"`），所有用户可见字段（manifest name/description/title 与 context menu/sidepanel 文本）走 `__MSG_xxx__` 占位 + `chrome.i18n.getMessage()`。`extension/lib/supabase.js` **现为 CloudBase shim**（`window.supabase.createClient(envId, publishableKey)` → `{ from: rdb().from, auth }`，`verifyOtp` 闭包适配），配套 `lib/cloudbase-sdk.js`（@cloudbase/js-sdk IIFE bundle）；`npm run ext:bundle-supabase` 的 supabase-js 生成物已废弃。

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

- **CSP / 安全响应头**：规则定义仍是 `vite.config.ts` 的 `securityHeaders`（script-src `'self'`、无 unsafe-inline；connect-src 有意放宽 `'self' https: wss://*.supabase.co`——死链 checkDirect 直连任意 URL 所需，勿私自收紧，见 SEC-05 注释）。dev/preview 由 `headersPlugin` 注入真实响应头；**生产（CloudBase 静态托管）不支持自定义响应头**（`public/_headers` 只对 CF Pages 生效），因此构建期由 `securityMetaPlugin` 把 CSP（剔除 meta 不支持的 `frame-ancestors`）与 Referrer-Policy 以 `<meta>` 注入两个 HTML 入口，零 JS 的法律页由 `renderLegalDoc` 自带更严格的 CSP meta（`default-src 'none'`）作为降级防线；**X-Content-Type-Options 与 frame-ancestors 仍缺**，需平台侧支持（见 `docs/TECH_DEBT.md` §零 #1）。`npm run check:prod` 会探测线上安全防护，缺失时退出码 4。
- **页面/视频读取第三方转发（jina-proxy，2026-10-20 起无前端直连例外）**：AI 页面/视频读取的**降级链路**（`src/lib/ai/jinaReader.ts`）在 extract-video Edge Function 失败时经 `cloudbase/functions/jina-proxy/` 服务端转发（原 `supabase/functions/jina-proxy/` 已迁移）至 `r.jina.ai` 读取（国内网络降级），前端零直连第三方抓取服务。jina-proxy 防护对齐 extract-video/check-link 口径：鉴权（verify_jwt + getUser）+ 每用户限流（034 `consume_rate_limit`，fail-closed）+ SSRF 校验（复用 `check-link/ssrf-guard.ts` 与 `extract-video/video-adapters.ts` 真源，含 DNS fail-closed）+ CORS fail-closed + 上游超时 + 读取长度上限；目标 URL 仍会发送给第三方 r.jina.ai，前端每次触发以 toast 向用户披露。禁止前端直连外部抓取服务，也禁止移除该 toast 披露。
- **视频解析链路（extract-video → worker → r.jina.ai）**：`extract-video` 云函数内部顺序为「B站原生适配器 → YouTube Data API（需 `YOUTUBE_API_KEY`）→ yt-dlp worker（`VIDEO_WORKER_URL`）→ r.jina.ai 兜底」，响应如实带 `provider` / `degraded` / `fallback_reason`，前端必须消费 `degraded` 并对用户披露降级。worker 公网暴露必须配 `WORKER_TOKEN`（云函数同值注入）。深度解析（口播 ASR + 画面 OCR）是异步任务（`action=deep` / `deep_status`），额度独立计 `video.deep.daily`；**实现上由 worker 直连境内大模型服务商**（`MIMO_API_KEY` 放云托管环境变量，不进前端、不进云函数请求体），音频/画面会离开服务端，隐私政策须同步披露（**只写服务类别、不写具体模型名称**；实际供应商名单维护在 `src/config/aiProviders.ts`，原「设置 → 关于 → AI 服务商」UI 已于 2026-10-29 `73c5f6e2` 移除，恢复入口是待办，见 `docs/TECH_DEBT.md`）。平台域名清单唯一真源 `src/config/videoPlatforms.json`，三端经 `node scripts/build-fn-assets.mjs` 派生，禁止再各写一份。⚠️ **CloudBase 网关不回填可信客户端 IP，`X-Forwarded-For` 可伪造**：任何按 IP 的配额/限流都能被绕过（2026-10-30 实测），`extract-video` 已加与 IP 无关的全局限流（`EXTRACT_VIDEO_RATE_LIMIT_GLOBAL_PER_MIN`）与匿名全局日额度（`EXTRACT_VIDEO_ANON_GLOBAL_DAILY`）兜底；登录用户按 uid 计量不受影响，其它函数同类改造待做。
- **云函数 check-link**（生产 `cloudbase/functions/check-link/`，原 `supabase/functions/check-link/` 已迁移）：私有 IP 黑名单防 SSRF；超时/CORS/限流由云函数环境变量控制（`ALLOWED_ORIGINS`、`CHECK_LINK_TIMEOUT_MS`、`CHECK_LINK_RATE_LIMIT_PER_MIN`）；每用户限流（迁移 034 `consume_rate_limit` 计数器 + `private.rate_limit_counters`，默认 1200 次/分）；history 行数由迁移 033 剪枝触发器自动收敛（每书签留 5 条，与客户端 MAX_HIST 同口径）
- **错误追踪**：Vue errorHandler → `src/lib/errorReporter.ts` → CloudBase `error_logs` 表（生产经 `report-error` 云函数写入，5s 节流）
- **公开分享**：RLS 策略允许匿名 SELECT `is_public = true` 的组及其书签
- **CI/CD**：两个 workflow —— `.github/workflows/ci.yml`（门禁 + 部署，三个 job）与 `cert-check.yml`（证书到期监控）；依赖更新走 `.github/dependabot.yml`（npm 周检 / GitHub Actions 月检）。`ci.yml` 三个 job：
  - `lint-test`：npm ci → lint → typecheck → 单测 → `npm audit --omit=dev --audit-level=high`（blocking）→ `npm run build` 产物上传 artifact
  - `e2e`：Playwright chromium（带 `~/.cache/ms-playwright` 缓存加速）
  - `deploy`：`needs: [lint-test, e2e]`（**测试全绿才发布**）+ `if: refs/heads/main`（PR 与其它分支绝不发布）→ 复用 `lint-test` 构建产物 → `tcb hosting deploy ./dist --safe`（CloudBase 静态托管；`--safe` 发布前备份+失败回滚，免 `--verify` 加速跨洋部署）
    - 认证：`tcb login --cloudbase-api-key`（非交互），密钥取 `secrets.CLOUDBASE_APIKEY`；**未配该 secret 时跳过部署并告警**，门禁照常执行
    - 手动重部署：`gh workflow run ci.yml --ref main`
    - 线上版本自检：`npm run check:prod` —— 比对 `https://ulink.ren/version.json` 的 `commit` 与本地 HEAD（构建时由 vite `buildInfoPlugin` 注入；设置→关于 也显示短提交号），并探测安全防护（CSP/Referrer/XCTO）。退出码 0=一致且安全防护完整 / 1=不一致 / 2=线上无该端点（旧版本）/ 3=网络失败 / 4=版本一致但安全防护不完整
    - ⚠️ **CI 部署与手动 `tcb hosting deploy` 互斥**（会互相覆盖），统一走 CI
  - Supabase 时代的 `supabase-db-test` 门禁已于 2026-10-27 移除（验证的是已停用的 schema，对现网无保护作用）；`supabase/` 现为历史归档，说明见 `supabase/README.md`
- **证书监控**：`cert-check.yml` 每周一 02:00 UTC 检查 `ulink.ren` 证书剩余天数（腾讯云免费 DV 仅 90 天），将到期时自动开 issue；**只提醒、不自动申请**——真要续期需手动触发并勾选 `apply`，且最后一步要在 CloudBase 控制台手动关联证书
