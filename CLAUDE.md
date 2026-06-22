# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

LinkVault — 单页书签管理器（PWA），Vue 3 + Pinia + TipTap 编辑器，Vite 构建，TypeScript。数据持久化于 localStorage + IndexedDB（Dexie），可选 Supabase 云端同步。UI 为中文。

## 常用命令

```bash
npm run dev         # 开发服务器（自动打开浏览器）
npm run build       # 生产构建到 dist/（含 PurgeCSS）
npm run preview     # 预览生产构建
npm run lint        # ESLint 检查 src/
npm run test        # 运行所有测试（vitest run）
npm run test:watch  # 监听模式运行测试
```

运行单个测试文件：`npx vitest run src/__tests__/utils.test.ts`
覆盖率：`npx vitest run --coverage`

## 架构

### Pinia Store 拆分

Store 拆分为 3 个子 Store，`app.ts` 为兼容层（组合 Store），新代码建议直接使用具体 Store：

- **`stores/data.ts`** — bookmarks、siblingGroups、categories、customAttributes 及其 CRUD、过滤、排序
- **`stores/ui.ts`** — 所有运行时 UI 状态（视图、面板、模态框、拖拽上下文等）
- **`stores/undo.ts`** — 每组独立的 undo/redo 栈
- **`stores/app.ts`** — 兼容层，组合上述 3 个 Store，保持向后兼容

### 持久化与数据迁移

- **`stores/persist.ts`**：loadFromLocalStorage → runMigrations → 写回；IndexedDB (`stores/storage.ts`, Dexie) 作为 localStorage 的增强，突破 5MB 限制
- **`stores/migrations.ts`**：旧格式兼容，在加载时自动执行

### 云端同步（Supabase）

- **认证**（`composables/domain/useAuth.ts`）：Supabase Auth，email OTP 登录
- **同步**（`composables/domain/useCloudSync.ts`）：push-first 策略，手动触发同步，增量推送到 Supabase
- **Supabase 客户端**（`lib/supabase.ts`）：配置见 `.env`（VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY）
- **数据库 Schema**（`supabase/migrations/`）：RLS 行级安全策略，表结构含 categories、bookmarks、sibling_groups、custom_attributes、user_security

### Composables 层

composables 按职责分三组：

- `composables/domain/` — 业务逻辑：useBookmark、useGroup、useBatch、useAttrFilter、useDataIO、useUndo、useMention、useCloudSync、useAuth、useDeadLinkChecker
- `composables/interaction/` — 交互行为：useKeyboard、useDragDrop、useMobileDragReorder、useResize、useScrollHeader、useLongPress、useKeyboardOps
- `composables/ui/` — UI 辅助：useUI、useEditorFormat、useInlineRename、useIconPreview、usePasswordVisibility

另有模块级组合文件：`useApp.ts`（初始化协调）、`useAppHandlers.ts`（事件处理）、`useAppLifecycle.ts`（生命周期）、`useGlobalEvents.ts`（全局事件监听）、`useVirtualScroll.ts`（虚拟滚动）、`useInlineCard.ts`（内联卡片 HTML 生成）

**bridge.ts** 是模块级服务注册表（非 provide/inject），解决 composable 模块级代码无法使用 Vue 组件上下文的问题。组件 onMounted 注册 API，composable 消费方通过 bridge 引用。类型定义（ToastAPI、ContextMenuAPI 等）在 bridge.ts 内声明。

### EditorManager

`src/lib/editor.ts` 维护一个编辑器注册表 `_editors`。GroupEditor.vue 在 onMounted 时注册 TipTap 实例，EditorManager 提供格式化命令（bold/heading/list/taskList/color）和内容操作。Group 的 `notes` 字段存储 TipTap HTML。

### 组件结构

- `components/cards/` — BookmarkCard、GroupCard、CardGrid
- `components/editor/` — GroupEditor、FormatToolbar、ColorPalette
- `components/modals/` — BookmarkModal、CategoryModal、AttributeModal、GroupEditModal、ConfirmModal、AuthModal
- `components/overlays/` — ContextMenu、ActionSheet、BatchPopover、SearchSuggest、ToastContainer、MentionDropdown、AddPopover、AttrDropdown
- `components/shell/` — AppHeader、AppNav、FilterBar、BatchBar、BatchBottom、DetailPanel、SettingsPanel、AttrChips

### 数据模型

类型定义见 `src/types.ts`：
- **Bookmark**：id, title, url, username, password（base64 编码）, notes, categoryId, parentId, order, attributes, useCount
- **SiblingGroup**：id, name, categoryId, bookmarkIds[], notes (HTML), attributes, order
- **Category**：id, name, icon, color
- **CustomAttribute**：id, name, type: 'boolean'

### 密码存储

`src/crypto.ts`：密码以 base64 编码存储，`safeDecodePassword` 负责解码。

### 构建配置

- **路径别名**：`@/*` → `src/*`（tsconfig.json + jsconfig.json）
- **手动分包**：tiptap-core、tiptap-extensions、prosemirror、dexie、dompurify、vue-vendor、vendor（vite.config.ts）
- **PurgeCSS**：自定义 Vite 插件，safelist 保护动态类名（`/^card-/`, `/^modal-/`, `/^ctx-/` 等前缀）
- **PWA**：vite-plugin-pwa，缓存策略见 vite.config.ts 中 workbox 配置（favicon-cache、font-cache）
- **安全头**：自定义 headersPlugin 注入 CSP、X-Content-Type-Options 等
- **部署**：GitHub Actions → GitHub Pages（`.github/workflows/static.yml`）

### Chrome 扩展

`extension/` 目录包含 Manifest V3 浏览器扩展，支持快捷键保存当前页面到 LinkVault（Ctrl+Shift+L），通过 content script 注入。

### 样式

CSS 按功能模块拆分到 `src/styles/` 目录：tokens.css（设计变量）、reset.css、layout.css、cards.css、group.css、editor.css、modals.css、overlays.css、header.css、nav.css、filter.css、batch.css、drag.css、settings.css、toast.css、responsive.css、utility.css，由 main.css 统一导入。

## 编码规范

- **禁止 var**，用 const/let
- 新 Vue 组件放入 `src/components/` 对应子目录
- UI 文本用中文，代码注释用中文
- 测试文件放 `src/__tests__/`，使用 vitest + jsdom + @vue/test-utils
- 测试 setup 文件 `src/__tests__/setup.ts`：mock localStorage，每个测试自动创建新 Pinia 实例

## 移动端拖拽排序

`useMobileDragReorder.ts` 是纯原生 pointer events 实现（非第三方库），iOS 原生风格：
- 原元素 `position: fixed` 跟手，无克隆体
- 仅 Y 轴移动，X 轴锁定
- 占位符在原位，其他卡片通过 CSS transition 平滑让位
- 所有 DOM 操作（卡片位置、占位符、边缘滚动）统一在 `requestAnimationFrame` 循环中执行，避免 pointer events 和 rAF 之间的竞争条件
- 仅在 `batchMode` 时通过 `.batch-drag-handle` 手柄触发
- 边缘滚动：靠近滚动容器边缘 60px 内自动滚动，速度与距离成正比