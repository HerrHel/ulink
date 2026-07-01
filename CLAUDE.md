# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

LinkVault — 单页书签管理器（PWA），Vue 3 + Pinia + TipTap 编辑器，Vite 构建，TypeScript。数据持久化于 localStorage + IndexedDB（Dexie），可选 Supabase 云端同步。UI 为中文。

## 常用命令

```bash
npm run dev         # 开发服务器（自动打开浏览器）
npm run build       # 生产构建到 dist/（prebuild 自动跑 Supabase 迁移）
npm run migrate     # 手动执行 Supabase SQL 迁移
npm run preview     # 预览生产构建
npm run lint        # ESLint 检查 src/
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

**架构迁移注意**：原 `composables/bridge.ts` 是模块级服务定位器（ToastAPI/ContextMenuAPI/ActionSheetAPI 等通过组件 onMounted 注册、composable 消费），现已全部迁移至上述 Pinia Store。bridge.ts 仅保留空壳以防遗漏的 import，**新代码一律用对应的 Pinia Store，不要向 bridge 注册任何 API**。

### 持久化与数据迁移

- **`stores/persist.ts`**：loadFromLocalStorage → runMigrations → 写回
- **`stores/storage.ts`**：Dexie IndexedDB 封装，突破 localStorage 5MB 限制
- **`stores/migrations.ts`**：旧格式兼容，在加载时自动执行

### Supabase 数据库迁移

SQL 迁移文件放 `supabase/migrations/`，自动通过 Management API 部署：

- `npm run migrate` — 手动执行未应用的迁移
- `npm run build` — prebuild 自动执行迁移
- 加新迁移只需在 `supabase/migrations/` 中放 `.sql` 文件
- `.migration-state.json` 跟踪已应用状态，幂等重跑安全

迁移脚本：`run-migrations.cjs`。需要 `.env` 中 `SUPABASE_ACCESS_TOKEN`。项目 ref：`yqouglfopbmujkqmjgpu`。

### 云端同步（Supabase）

- **认证**（`composables/domain/useAuth.ts`）：Supabase Auth，email OTP 登录
- **同步**（`composables/domain/useCloudSync.ts`）：push-first 策略，手动触发同步，增量推送到 Supabase
- **实时同步**（`useSyncRealtime.ts`）：Supabase Realtime 订阅，含指数退避重连（最多 10 次）；冲突检测见 `useSyncConflict.ts`，版本历史见 `useSyncHistory.ts`
- **Supabase 客户端**（`lib/supabase.ts`）：配置见 `.env`（VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY）
- **数据库 Schema**（`supabase/migrations/`，11 个迁移文件）：RLS 行级安全策略，表结构含 categories、bookmarks、sibling_groups、custom_attributes、user_security、version_history、link_check_history、error_logs
- **Edge Function**（`supabase/functions/check-link/`）：服务端死链检查，被 useDeadLinkChecker 调用

### Composables 层

composables 按职责分三组：

- `composables/domain/` — 业务逻辑：useBookmark、useGroup、useBatch、useAttrFilter、useDataIO、useDataShare、useUndo、useMention、useCloudSync、useSyncMapping、useSyncConflict、useSyncRealtime、useSyncHistory、useAuth、useDeadLinkChecker、useE2E
- `composables/interaction/` — 交互行为：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useScrollHeader、useLongPress、useKeyboardOps
- `composables/ui/` — UI 辅助：useUI、useEditorFormat、useInlineRename、useInlineEdit、useIconPreview、usePasswordVisibility、useSyncStatus、useCardOverflow

另有模块级文件：`useApp.ts`（初始化协调）、`useAppHandlers.ts`（事件处理）、`useAppLifecycle.ts`（生命周期）、`useGlobalEvents.ts`（全局事件监听）、`useVirtualScroll.ts`（虚拟滚动）、`useInlineCard.ts`（内联卡片 HTML 生成）、`useCombinedList.ts`（从 CardGrid 提取的卡片列表组合逻辑：focus/custom/normal 三种模式）

**bridge.ts** 现为空壳（见上"架构迁移注意"），原服务注册表职责已迁至 Pinia Store。

### 数据模型

类型定义见 `src/types.ts`：
- **Bookmark**：id, title, url, icon, username, password（string | EncryptedPassword）, notes, categoryId, parentId（支持子书签嵌套）, order, useCount, attributes, isExpanded, createdAt, updatedAt, deletedAt
- **SiblingGroup**：id, name, categoryId, icon, order, isExpanded, attributes, bookmarkIds[], notes (HTML), updatedAt, useCount, isPublic
- **Category**：id, name, icon, color
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
- `theme.ts` — 主题切换（亮色/暗色/自动）、theme-style（舒适模式）
- `toast.ts` — 轻量 toast 工具函数，委托 bridge 上的 ToastAPI
- `recoveryKeyPDF.ts` — 纯 HTML+print 生成 Recovery Key PDF 下载

### 组件结构

- `components/cards/` — BookmarkCard、GroupCard、CardGrid
- `components/editor/` — GroupEditor、FormatToolbar、ColorPalette
- `components/modals/` — BookmarkModal、CategoryModal、AttributeModal、GroupEditModal、ConfirmModal、AuthModal、HistoryPanel（版本历史 diff）、TrashPanel（回收站）、E2ESetupModal、E2EUnlockModal
- `components/overlays/` — ContextMenu、ActionSheet、BatchPopover、SearchSuggest、ToastContainer、MentionDropdown、AddPopover、AttrDropdown、CommandPalette、DeadLinksPopover、SyncConflictBanner
- `components/shell/` — AppHeader、AppNav、FilterBar、BatchBar、BatchBottom、DetailPanel、SettingsPanel、AttrChips
- `components/share/` — （分享相关组件，目前为占位）
- `components/ui/` — E2ELockOverlay（主密码锁定覆盖层）、ErrorBoundary

### src/config/

- `constants.ts` — 常量（存储键名、toast 时长、undo 限制、默认示例数据含 HTML 欢迎笔记）
- `icons.ts` — SVG 图标映射表（~65 个图标），`getCategoryIcon` 按名称取图标

### 视图

`src/views/ShareView.vue` — 分享视图（独立路由），用于他人访问共享书签组

### 构建配置

- **路径别名**：`@/*` → `src/*`（tsconfig.json + jsconfig.json）
- **手动分包**：tiptap-core、tiptap-extensions、prosemirror、dexie、dompurify、supabase、vue-vendor、vendor（vite.config.ts）
- **PurgeCSS**：自定义 Vite 插件，safelist 保护动态类名（`/^card-/`, `/^modal-/`, `/^ctx-/` 等前缀）
- **PWA**：vite-plugin-pwa，缓存策略见 vite.config.ts 中 workbox 配置（favicon-cache、font-cache）
- **安全头**：自定义 headersPlugin 注入 CSP、X-Content-Type-Options 等
- **部署**：GitHub Actions → GitHub Pages（`.github/workflows/static.yml`）

### Chrome 扩展

`extension/` 目录包含 Manifest V3 浏览器扩展（background.js、content.js、popup/、sidepanel.html/js），支持快捷键保存当前页面到 LinkVault（Ctrl+Shift+L），通过 content script 注入。

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

- **CSP**：`public/_headers`（生产）和 `vite.config.ts`（dev）。script-src 含 `'unsafe-inline'`（PWA 需要），connect-src 限 Supabase
- **Edge Function**（`supabase/functions/check-link/`）：私有 IP 黑名单防 SSRF，超时/CORS 由 Supabase secrets 控制（`ALLOWED_ORIGINS`、`CHECK_LINK_TIMEOUT_MS`）
- **错误追踪**：Vue errorHandler → `src/lib/errorReporter.ts` → Supabase `error_logs` 表（5s 节流，匿名 INSERT 允许）
- **公开分享**：RLS 策略允许匿名 SELECT `is_public = true` 的组及其书签
- **CI/CD**：`.github/workflows/` — 部署（lint+test+audit+build+deploy）、CI（PR 触发 lint+test）、Dependabot 周检
