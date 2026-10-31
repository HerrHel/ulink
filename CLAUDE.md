# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

与链（ulink，原 LinkVault）— 单页书签管理器（PWA）。Vue 3 + Pinia + TipTap 编辑器，Vite + TypeScript，localStorage + IndexedDB（Dexie）持久化，云端同步/认证走**腾讯云开发 CloudBase**。**双语**：中文「与链」/英文「ulink」，UI 语言切换入口在设置面板（设置→语言）；源码注释沿用中文。

> ⚠️ **后端现状（2026-10-22 起）**：生产已全量切换 CloudBase（`VITE_BACKEND=cloudbase` 在 `.env.production`），Supabase 仅为历史迁移来源，**勿在 `supabase/` 目录加功能**。云函数在 `cloudbase/functions/<name>/`，部署 `node scripts/deploy-cloudbase-fn.mjs <fn>`。完整说明见 `AGENTS.md` 顶部「后端现状」区块与 `docs/CLOUDBASE_MIGRATION.md`。

> 本文档为精简版，完整架构与模块清单见根目录 `AGENTS.md`（两者需同步维护）。

## 常用命令

```bash
npm run dev          # 开发服务器（自动打开浏览器）
npm run build        # 生产构建到 dist/
npm run preview      # 预览生产构建
npm run lint         # ESLint 检查 src/（--max-warnings 0，warn 也阻断）
npm run typecheck    # TypeScript 类型检查
npm run test         # 单元测试（vitest run）；test:watch 监听、coverage 覆盖率
npm run test:e2e     # Playwright E2E（e2e/，自动起 dev server）
```

单文件：`npx vitest run src/__tests__/utils.test.ts`；`npx playwright test e2e/app.spec.ts`

## 编码规范（硬性要求）

- **禁止 var**，用 const/let
- UI 文本、代码注释一律用中文
- 新组件放 `src/components/` 对应子目录；测试放 `src/__tests__/`（子目录 `composables/`、`stores/`）
- 单测：vitest + jsdom + @vue/test-utils，setup 为 `src/__tests__/setup.ts`（mock localStorage，每测试自动建新 Pinia 实例）
- E2E：Playwright 仅 chromium，baseURL `localhost:5173`，CI 下重试 2 次；默认 L1 注入 mock Supabase URL（e2e/helpers/supabaseMock page.route 拦截），`LV_E2E_L2=1` 切 L2 真后端
- CI：两个 workflow —— `.github/workflows/ci.yml`（门禁 + 部署，三 job：`lint-test`、`e2e`、`deploy`）+ `cert-check.yml`（证书到期监控）。`deploy` 仅 main 且测试全绿才发：复用 build 产物 → `tcb login --cloudbase-api-key` → `tcb hosting deploy ./dist --safe`（CloudBase 静态托管）。未配 secret 时跳过部署但门禁照常执行；手动重部署 `gh workflow run ci.yml --ref main`；线上版本自检 `npm run check:prod`。⚠️ **CI 部署与手动 `tcb hosting deploy` 互斥**，统一走 CI
- ESLint（`eslint.config.js`，Flat Config，v10）：ts/js 基础规则作用 `src/**/*.{js,ts}`（no-undef 由 TS 接管故关闭），`.vue` 由 vue flat/recommended 管理，高价值规则（require-v-for-key / no-mutating-props 等）钉 error：
  - error：no-eval / no-implied-eval / no-caller / no-redeclare / no-dupe-keys / no-duplicate-case
  - warn：no-unused-vars（`_` 前缀豁免，args 忽略）/ no-constant-condition / no-debugger / no-empty / no-unreachable / eqeqeq（smart）

## 架构要点

### Store（`src/stores/`，`app.ts` 为 Facade）

- `data.ts` — 数据 CRUD（bookmarks / siblingGroups / categories / customAttributes）、过滤、排序
- `ui.ts` — 运行时 UI 状态；`undo.ts` — 每组独立 undo/redo 栈
- 覆盖层：`toast.ts` / `contextMenu.ts` / `actionSheet.ts` / `attrDropdown.ts` / `overlay.ts`
- 其余：`auth.ts`（认证状态；CloudBase / 历史 Supabase 由 `src/lib/authDriver.ts` 分流）、`e2e.ts`（加密开关与解锁状态）、`vault.ts`（主密码/生物识别安全）、`sync.ts`（同步状态/conflicts/realtime）、`share.ts`（分享只读态）+ `shareShadow.ts`（影子数据）
- ⚠️ **禁止使用 bridge 服务定位器**：原 `composables/bridge.ts` 已彻底删除（commit 34a2fef9、055779e0），组件间通信一律走对应 Pinia Store

### 持久化

`persist.ts`（IDB 权威 + localStorage 缓存）、`storage.ts`（Dexie，突破 5MB 限制）、`migrations.ts`（旧格式加载时自动兼容）

### Composables（`src/composables/`）

- `domain/` — 业务逻辑：useBookmark、useGroup、useBatch、useCloudSync、useAuth、useE2E、useVault、useBiometric、useSpaceMove 等（sync 子逻辑拆为 syncPush/syncPull/syncMergeCore/syncLocalMerge/syncMapping*/syncPending/syncRemotePort/syncShare 等）
- `interaction/` — 交互：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useLongPress、listCardKeyboard 等
- `ui/` — UI 辅助：useUI、useInlineEdit、useSyncStatus、useCardOverflow 等
- 模块级：useApp*（初始化/事件/生命周期）、useGlobalEvents、useVirtualScroll、useInlineCard、useCombinedList

### 数据模型

**单一真相源**：`src/schemas.ts` 用 Zod 定义模型并做运行时校验，`src/types.ts` 全部经 `z.infer` 推导（**不要手写平行 interface，也不存在"两者手动保持同步"**）：
- **Bookmark**：id, title, url, icon, username, password（string | EncryptedPassword）, notes, categoryId, **parentId**（子书签嵌套）, order, useCount, attributes, isExpanded, createdAt, updatedAt, deletedAt, **pinnedAt**（置顶，可选）
- **SiblingGroup**：id, name, categoryId, icon, order, isExpanded, attributes, bookmarkIds[], **notes（TipTap HTML）**, updatedAt, useCount, isPublic, **pinnedAt**
- **Category**：id, name, icon, color, order；**CustomAttribute**：id, name, type: 'boolean'
- **EncryptedPassword**：`{ encrypted: true, data, iv, salt }` — AES-256-GCM

### 关键模块

- `src/crypto.ts` — PBKDF2（600K iterations）密钥派生 + AES-256-GCM；`encryptPassword` 生成 EncryptedPassword，`autoMigratePassword` 自动识别 3 种格式（对象/字符串/空）
- `src/lib/editor.ts` — TipTap 实例注册表，GroupEditor.vue 在 onMounted 注册；Group.notes 存 TipTap HTML
- 其余 lib：search（Fuse.js + pinyin-pro）、ai-classify、diffVersions、theme、toast（委托 useToastStore，setup 外可用）、errorReporter（→ report-error 云函数）、stats、head（SEO 注入）、recoveryKeyPDF；工具函数：newId、clone、storageSafe、withLock、boundedCache、dataReady、collectSubIds、download、dragHint、historyMax、preview、supabase（Supabase client 兼容层）
- **AI 工作台**：`src/lib/ai/`（~45 模块：mimo 主链路、universalAgent/tools、knowledge/localRAG、smartIntake、video* 等）+ `components/chat/`（AiWorkspace 等 6 个组件）+ `useAiChat*`；云端 `mimo-chat`（SSE，按 uid 限流/额度，线上 `BILLING_MODE=enforce`）
- **计费会员**：`pay`/`redeem`/`account` 云函数 + `PurchaseModal.vue` + `usePayment`/`usePurchasePlans`/`useRedeem`/`useEntitlement`/`useTransactions`；价格与权益唯一来源 = `plans` 表（`price_cents` + `features`），前端不硬编码
- **i18n**：`src/i18n/index.ts`（`t`/`tN`/`detect`）+ `src/locales/{zh,en}.ts` + `src/locales/parts/*`；落地页 `public/landing.js` 自带词典（不引用 src），改文案两边同步

### 配置与视图

- `src/config/`：`constants.ts`（存储键名、toast/undo 常量）、`icons.ts`（SVG 图标映射，`getCategoryIcon`）、`welcome-data.ts`（默认示例数据）、`aiProviders.ts`（供应商目录 + `LEGAL_DOC_LINKS`）、`site.ts`（ICP/MPS 备案号）、`urls.ts`（域名常量）、`videoPlatforms.json`（视频平台真源）
- `src/views/` 仅存分享页纯函数模块；**`ShareView.vue` 已于 2026-08-31 删除**，分享页是主应用内只读态（`stores/share.ts` + CloudBase `share-ssr` 渲染 `/s/*`）

### 构建 / 扩展 / 样式

- 别名 `@/*` → `src/*`；`vite.config.ts` 手动分包 + PurgeCSS（safelist `/^card-/`、`/^modal-/`、`/^ctx-/` 等前缀）+ PWA（workbox）+ 安全头（dev/preview）；**生产部署 = CloudBase 静态托管**（CI `tcb hosting deploy ./dist --safe`），GitHub Pages / spa404Plugin 均已停用，Cloudflare Pages 仅保留 `functions/` 的 `/api/*` 边缘函数（非主站）
- `cli/` — 独立命令行工具子项目（commander + Supabase，独立 tsconfig/node_modules，不参与主项目构建与测试）；**仍以 Supabase 为目标，未适配 CloudBase**
- `extension/` — Manifest V3 扩展（v1.2.1），Ctrl+Shift+S 保存当前页（manifest `save-to-linkvault` 命令）+ 视频深度解析入口
- `src/styles/` — tokens/reset/layout/cards/group/editor/modals/overlays/header/nav/filter/batch/drag/settings/toast/responsive/utility.css，由 main.css 统一导入

### 移动端拖拽（`useMobileDragReorder.ts`）

纯原生 pointer events（无第三方库）：原元素 `position: fixed` 跟手、仅 Y 轴移动；所有 DOM 操作统一在 `requestAnimationFrame` 循环执行（避免竞争条件）；仅 batchMode 时经 `.batch-drag-handle` 触发；靠近容器边缘 60px 内自动滚动，速度与距离成正比。

## 安全与运维

- CSP / 安全头：规则定义在 `vite.config.ts`（script-src `'self'`、无 unsafe-inline；connect-src 有意放宽 `'self' https: wss://*.supabase.co`——死链 checkDirect 直连任意 URL 所需，**勿私自收紧**）。dev/preview 由 `headersPlugin` 注入响应头；CloudBase 静态托管不支持自定义响应头，生产由 `securityMetaPlugin` 构建期注入 `<meta>` CSP（无 frame-ancestors）与 Referrer-Policy，XCTO 仍缺（`docs/TECH_DEBT.md`）；`npm run check:prod` 缺失时退出码 4
- 云函数 check-link（生产 `cloudbase/functions/check-link/`）：私有 IP 黑名单防 SSRF；CORS/超时/限流由云函数环境变量控制
- 错误追踪：errorHandler → `src/lib/errorReporter.ts` → `report-error` 云函数 → CloudBase `error_logs`（5s 节流）
- 公开分享：RLS 允许匿名 SELECT `is_public = true` 的组及其书签；分享页由 `share-ssr` 云函数渲染
- CI/CD：`ci.yml`（lint+typecheck+test+e2e+audit 门禁，测试全绿才部署 CloudBase 静态托管）+ `cert-check.yml`（证书周检）+ Dependabot（npm 周检）
