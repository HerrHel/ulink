# CLAUDE.md

LinkVault — 单页书签管理器（PWA）。Vue 3 + Pinia + TipTap 编辑器，Vite + TypeScript，localStorage + IndexedDB（Dexie）持久化，可选 Supabase 云端同步。UI 与注释用中文。

> 本文档为精简版，完整架构与模块清单见根目录 `AGENTS.md`（两者需同步维护）。

## 常用命令

```bash
npm run dev          # 开发服务器（自动打开浏览器）
npm run build        # 生产构建到 dist/
npm run preview      # 预览生产构建
npm run lint         # ESLint 检查 src/
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
- E2E：Playwright 仅 chromium，baseURL `localhost:5173`，CI 下重试 2 次
- ESLint（`eslint.config.js`，Flat Config v10，作用 `src/**/*.{js,ts}`，no-undef 由 TS 接管故关闭）：
  - error：no-eval / no-implied-eval / no-caller / no-redeclare / no-dupe-keys / no-duplicate-case
  - warn：no-unused-vars（`_` 前缀豁免，args 忽略）/ no-constant-condition / no-debugger / no-empty / no-unreachable / eqeqeq（smart）

## 架构要点

### Store（`src/stores/`，`app.ts` 为 Facade）

- `data.ts` — 数据 CRUD（bookmarks / siblingGroups / categories / customAttributes）、过滤、排序
- `ui.ts` — 运行时 UI 状态；`undo.ts` — 每组独立 undo/redo 栈
- 覆盖层：`toast.ts` / `contextMenu.ts` / `actionSheet.ts` / `attrDropdown.ts` / `overlay.ts`
- 其余：`auth.ts`（Supabase 认证）、`e2e.ts`（加密开关与解锁状态）、`vault.ts`（主密码/生物识别安全）、`sync.ts`（同步状态/conflicts/realtime）
- ⚠️ **禁止使用 bridge 服务定位器**：原 `composables/bridge.ts` 已彻底删除（commit 34a2fef9、055779e0），组件间通信一律走对应 Pinia Store

### 持久化

`persist.ts`（IDB 权威 + localStorage 缓存）、`storage.ts`（Dexie，突破 5MB 限制）、`migrations.ts`（旧格式加载时自动兼容）

### Composables（`src/composables/`）

- `domain/` — 业务逻辑：useBookmark、useGroup、useBatch、useCloudSync、useAuth、useE2E、useVault、useBiometric、useSpaceMove 等（sync 子逻辑拆为 syncPush/syncPull/syncMergeCore/syncLocalMerge/syncMapping*/syncPending/syncRemotePort/syncShare 等）
- `interaction/` — 交互：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useLongPress、listCardKeyboard 等
- `ui/` — UI 辅助：useUI、useInlineEdit、useSyncStatus、useCardOverflow 等
- 模块级：useApp*（初始化/事件/生命周期）、useGlobalEvents、useVirtualScroll、useInlineCard、useCombinedList

### 数据模型

类型定义 `src/types.ts` 与 Zod 运行时校验 `src/schemas.ts` **必须保持同步**：
- **Bookmark**：id, title, url, icon, username, password（string | EncryptedPassword）, notes, categoryId, **parentId**（子书签嵌套）, order, useCount, attributes, isExpanded, createdAt, updatedAt, deletedAt, **pinnedAt**（置顶，可选）
- **SiblingGroup**：id, name, categoryId, icon, order, isExpanded, attributes, bookmarkIds[], **notes（TipTap HTML）**, updatedAt, useCount, isPublic, **pinnedAt**
- **Category**：id, name, icon, color, order；**CustomAttribute**：id, name, type: 'boolean'
- **EncryptedPassword**：`{ encrypted: true, data, iv, salt }` — AES-256-GCM

### 关键模块

- `src/crypto.ts` — PBKDF2（600K iterations）密钥派生 + AES-256-GCM；`encryptPassword` 生成 EncryptedPassword，`autoMigratePassword` 自动识别 3 种格式（对象/字符串/空）
- `src/lib/editor.ts` — TipTap 实例注册表，GroupEditor.vue 在 onMounted 注册；Group.notes 存 TipTap HTML
- 其余 lib：search（Fuse.js + pinyin-pro）、ai-classify、diffVersions、theme、toast（委托 useToastStore，setup 外可用）、errorReporter、stats、head（SEO 注入）、recoveryKeyPDF；工具函数：newId、clone、storageSafe、withLock、boundedCache、dataReady、collectSubIds、download、dragHint、historyMax、preview、supabase（Supabase client 封装）

### 配置与视图

- `src/config/`：`constants.ts`（存储键名、toast/undo 常量）、`icons.ts`（SVG 图标映射，`getCategoryIcon`）、`welcome-data.ts`（默认示例数据，从 constants.ts 拆出减小 bundle）
- `src/views/ShareView.vue` — 分享视图（独立路由）

### 构建 / 扩展 / 样式

- 别名 `@/*` → `src/*`；`vite.config.ts` 手动分包 + PurgeCSS（safelist `/^card-/`、`/^modal-/`、`/^ctx-/` 等前缀）+ PWA（workbox）+ 安全头 + spa404Plugin；部署 GitHub Actions → Pages
- `extension/` — Manifest V3 扩展，Ctrl+Shift+L 保存当前页
- `src/styles/` — tokens/reset/layout/cards/group/editor/modals/overlays/header/nav/filter/batch/drag/settings/toast/responsive/utility.css，由 main.css 统一导入

### 移动端拖拽（`useMobileDragReorder.ts`）

纯原生 pointer events（无第三方库）：原元素 `position: fixed` 跟手、仅 Y 轴移动；所有 DOM 操作统一在 `requestAnimationFrame` 循环执行（避免竞争条件）；仅 batchMode 时经 `.batch-drag-handle` 触发；靠近容器边缘 60px 内自动滚动，速度与距离成正比。

## 安全与运维

- CSP：script-src 含 `'unsafe-inline'`（PWA 必需），connect-src 限 Supabase；生产在 `public/_headers`
- Edge Function（`supabase/functions/check-link/`）：私有 IP 黑名单防 SSRF，超时/CORS 由 secrets 控制
- 错误追踪：errorHandler → `src/lib/errorReporter.ts` → Supabase `error_logs` 表（5s 节流，匿名 INSERT）
- 公开分享：RLS 允许匿名 SELECT `is_public = true` 的组及其书签
- CI/CD：`.github/workflows/` — 部署（lint+test+build+deploy）、PR CI（lint+test）、Dependabot 周检
