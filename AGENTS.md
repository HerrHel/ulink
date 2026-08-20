# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

LinkVault — 单页书签管理器（PWA），Vue 3 + Pinia + TipTap 编辑器，Vite 构建，TypeScript。数据持久化于 localStorage + IndexedDB（Dexie），可选 Supabase 云端同步。UI 为中文。

## 常用命令

```bash
npm run dev         # 开发服务器（自动打开浏览器）
npm run build       # 生产构建到 dist/
npm run preview     # 预览生产构建
npm run lint        # ESLint 检查 src/
npm run typecheck   # TypeScript 类型检查
npm run test        # 运行所有单元测试（vitest run）
npm run test:watch  # 监听模式运行单元测试
npm run test:e2e    # Playwright E2E 测试（e2e/，自动起 dev server）
npm run coverage    # 单元测试覆盖率
```

运行单个测试文件：`npx vitest run src/__tests__/utils.test.ts`
Playwright 单个文件：`npx playwright test e2e/app.spec.ts`

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
- **`stores/auth.ts`** — Supabase 认证状态（user/session/OTP）
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

- `composables/domain/` — 业务逻辑：useBookmark、useGroup、useBatch、useAttrFilter、useDataIO、useDataShare、useUndo、useMention、useCloudSync、useSyncMapping、useSyncConflict、useSyncRealtime、useSyncHistory、useAuth、useDeadLinkChecker、useE2E、useVault、useVaultBiometric、useBiometric、useSpaceMove、attrSlug；sync 子逻辑另有独立模块：syncPush、syncPull、syncMergeCore、syncLocalMerge、syncMappingTables、syncPending、syncRemotePort、syncShare
- `composables/interaction/` — 交互行为：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useScrollHeader、useLongPress、useKeyboardOps、listCardKeyboard
- `composables/ui/` — UI 辅助：useUI、useEditorFormat、useInlineRename、useInlineEdit、useIconPreview、usePasswordVisibility、useSyncStatus、useCardOverflow

另有模块级文件：`useApp.ts`（初始化协调）、`useAppHandlers.ts`（事件处理）、`useAppLifecycle.ts`（生命周期）、`useGlobalEvents.ts`（全局事件监听）、`useVirtualScroll.ts`（虚拟滚动）、`useInlineCard.ts`（内联卡片 HTML 生成）、`useCombinedList.ts`（从 CardGrid 提取的卡片列表组合逻辑：focus/custom/normal 三种模式）

**bridge.ts** 已删除（原服务定位器职责全部迁至 Pinia Store，见上"架构迁移注意"）。

### 数据模型

类型定义见 `src/types.ts`，Zod 运行时校验见 `src/schemas.ts`（两者需保持同步）：
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

工具函数模块：`newId.ts`（ID 生成）、`clone.ts`（深拷贝）、`storageSafe.ts`（安全存储访问）、`withLock.ts`（互斥锁）、`boundedCache.ts`（有界缓存）、`dataReady.ts`（数据就绪标志）、`collectSubIds.ts`（子书签 ID 收集）、`download.ts`（文件下载）、`dragHint.ts`（拖拽提示）、`historyMax.ts`（历史上限）、`preview.ts`（预览辅助）、`supabase.ts`（Supabase client 封装）

### 组件结构

- `components/cards/` — BookmarkCard、GroupCard、CardGrid
- `components/editor/` — GroupEditor、FormatToolbar、ColorPalette
- `components/modals/` — BookmarkModal、CategoryModal、AttributeModal、GroupEditModal、ConfirmModal、AuthModal、HistoryPanel（版本历史 diff）、TrashPanel（回收站）、E2ESetupModal、E2EUnlockModal；辅助纯函数模块：bookmarkFormFilters.ts、formatTimeEpoch.ts、groupEditUrl.ts、trashOps.ts
- `components/overlays/` — ContextMenu、ActionSheet、BatchPopover、SearchSuggest、ToastContainer、MentionDropdown、AddPopover、AttrDropdown、CommandPalette、DeadLinksPopover、SyncConflictBanner
- `components/shell/` — AppHeader、AppNav、FilterBar、BatchBar、BatchBottom、DetailPanel、SettingsPanel、AttrChips
- 分享功能（原 `components/share/` 空占位目录已移除）：公开分享与 Fork 的实现位于 `views/ShareView.vue`（分享页 SPA UI，兼容兜底）+ `composables/domain/useDataShare.ts`（分享/Fork 逻辑 + 链接生成）+ `composables/domain/syncShare.ts`（云端公开读写）；后端公开读见 supabase migrations 005/010/012/013/014/015/018 与 `get_public_group` RPC。
- **分享页 SSR（解决 OG 预览/SEO）**：`supabase/functions/share-html/index.ts` 是 Supabase Edge Function（Deno），取数与渲染 HTML 拆为纯函数（不碰 Deno 特有 API，便于迁 Netlify/Vercel），复用 `get_public_group` RPC，渲染 head 元数据 + 书签列表 + JSON-LD；og:image 一期用静态品牌图 `public/share-cover.png`；分享链接由 `SHARE_FUNCTION_BASE`（`src/config/urls.ts`）收口，指向该函数 `?gid=<gid>`。旧 `/s/<gid>` SPA 路由保留作向后兼容。
- `components/ui/` — E2ELockOverlay（主密码锁定覆盖层）、ErrorBoundary

### src/config/

- `constants.ts` — 常量（存储键名、toast 时长、undo 限制等）
- `icons.ts` — SVG 图标映射表（~65 个图标），`getCategoryIcon` 按名称取图标
- `welcome-data.ts` — 默认示例数据（欢迎笔记 + 使用指南 HTML），从 constants.ts 拆出以减小 bundle

### 视图

`src/views/ShareView.vue` — 分享视图（独立路由），用于他人访问共享书签组

### 构建配置

- **路径别名**：`@/*` → `src/*`（tsconfig.json + jsconfig.json）
- **手动分包**：tiptap-core、tiptap-extensions、prosemirror、dexie、dompurify、supabase、fuse、pinyin-pro、vue-vendor、vendor（vite.config.ts）
- **PurgeCSS**：自定义 Vite 插件，safelist 保护动态类名（`/^card-/`, `/^modal-/`, `/^ctx-/` 等前缀）
- **PWA**：vite-plugin-pwa，缓存策略见 vite.config.ts 中 workbox 配置（favicon-cache、font-cache）
- **安全头**：自定义 headersPlugin 注入 CSP、X-Content-Type-Options 等
- **SPA 404 回退**：spa404Plugin 为 GitHub Pages 生成 404.html
- **部署**：GitHub Actions → GitHub Pages（`.github/workflows/static.yml`）

### CLI

`cli/` 目录是 LinkVault 命令行工具（独立子项目：commander + @supabase/supabase-js + conf，独立 tsconfig/node_modules，不参与主项目构建与测试；vitest.config 已排除 `cli/node_modules/`）。

### Chrome 扩展

`extension/` 目录包含 Manifest V3 浏览器扩展（background.js、sidepanel.html/js、config.js、crypto.js、auth-flow.js、keypress.js、notes-update.js、pwa-open.js），支持快捷键保存当前页面到 LinkVault（Ctrl+Shift+S，manifest 中 save-to-linkvault 命令），侧边栏模式操作。`extension/lib/supabase.js` 为 `npm run ext:bundle-supabase` 生成的 bundle（不提交）。

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
- **Edge Function**（`supabase/functions/check-link/`）：私有 IP 黑名单防 SSRF，超时/CORS 由 Supabase secrets 控制（`ALLOWED_ORIGINS`、`CHECK_LINK_TIMEOUT_MS`）
- **错误追踪**：Vue errorHandler → `src/lib/errorReporter.ts` → Supabase `error_logs` 表（5s 节流，匿名 INSERT 允许）
- **公开分享**：RLS 策略允许匿名 SELECT `is_public = true` 的组及其书签
- **CI/CD**：`.github/workflows/` — 部署（lint+test+build+deploy）、CI（PR 触发 lint+test）、Dependabot 周检
