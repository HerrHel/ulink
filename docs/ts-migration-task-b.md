# TypeScript 迁移计划 — 任务 B：业务逻辑层

## 概述

**目标**：将项目业务逻辑层从 JavaScript 迁移到 TypeScript

**范围**：Store 层、Composables 层、组件层、测试层

**依赖**：任务 A 产出的类型定义和基础设施

**预计工时**：3-4 小时

---

## 迁移文件清单

### 第一阶段：Store 层（60 分钟）

#### 1.1 迁移 stores/storage.js → stores/storage.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 导入 Dexie 类型

**函数签名**：
```typescript
import Dexie from 'dexie'

interface LinkVaultDB extends Dexie {
  data: Dexie.Table<{ key: string; value: any; updatedAt: number }, string>
}

export async function idbSet(key: string, value: any): Promise<void>
export async function idbGet(key: string): Promise<any | null>
```

#### 1.2 迁移 stores/persist.js → stores/persist.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 导入 AppData 类型

**函数签名**：
```typescript
import type { AppData } from '../types'

export function loadFromLocalStorage(): AppData
export async function loadFromIDB(): Promise<AppData | null>
export function saveToLocalStorage(data: AppData): boolean
export function saveToIDB(data: AppData): void
export function getStorageInfo(data: AppData): { size: number; percent: number; label: string }
```

#### 1.3 迁移 stores/migrations.js → stores/migrations.ts

**迁移步骤**：
1. 重命名文件
2. 添加函数参数和返回值类型
3. 导入 AppData 类型

**函数签名**：
```typescript
import type { AppData, Bookmark, SiblingGroup } from '../types'

export function runMigrations(d: any, result: AppData): boolean
```

#### 1.4 迁移 stores/data.js → stores/data.ts

**迁移步骤**：
1. 重命名文件
2. 添加状态类型定义
3. 添加 getter 和 action 类型
4. 导入 AppData 类型

**状态类型**：
```typescript
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../types'

interface DataState {
  bookmarks: Bookmark[]
  siblingGroups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  _masterCanary: EncryptedPassword | null
  _customCardOrder: Array<{ t: 'g' | 'b'; id: string }> | null
  _cachedStorageInfo: { size: number; percent: number; label: string } | null
  _storageInfoDirty: boolean
  _saveCount: number
  _saveTimer: ReturnType<typeof setTimeout> | null
}
```

#### 1.5 迁移 stores/ui.js → stores/ui.ts

**迁移步骤**：
1. 重命名文件
2. 添加状态类型定义
3. 添加 action 类型

**状态类型**：
```typescript
interface UIState {
  curCat: string
  isMobile: boolean
  sortMode: string
  sortDir: string
  layoutMode: 'grid' | 'list'
  searchQuery: string
  focusedGroupId: string | null
  batchMode: boolean
  batchSelected: string[]
  activeAttrs: string[]
  excludedAttrs: string[]
  detailCards: string[]
  detailOpen: boolean
  editingId: string | null
  themeMode: 'auto' | 'manual'
  themeStyle: string
  // ... 其他状态
}
```

#### 1.6 迁移 stores/security.js → stores/security.ts

**迁移步骤**：
1. 重命名文件
2. 添加状态类型定义
3. 添加 action 类型

**状态类型**：
```typescript
interface SecurityState {
  masterPassword: string
  masterPasswordOpen: boolean
}
```

#### 1.7 迁移 stores/undo.js → stores/undo.ts

**迁移步骤**：
1. 重命名文件
2. 添加状态类型定义
3. 添加 action 类型

**状态类型**：
```typescript
interface UndoSnapshot {
  notes: string
  bookmarkIds: string[]
}

interface UndoStack {
  undo: UndoSnapshot[]
  redo: UndoSnapshot[]
}

interface UndoState {
  stacks: Record<string, UndoStack>
  timers: Record<string, ReturnType<typeof setTimeout>>
  saveTimers: Record<string, ReturnType<typeof setTimeout>>
  onPushCallback: ((gid: string) => void) | null
}
```

#### 1.8 迁移 stores/app.js → stores/app.ts

**迁移步骤**：
1. 重命名文件
2. 添加状态类型定义
3. 添加 action 类型
4. 保留兼容层注释

---

### 第二阶段：Composables 层（90 分钟）

#### 2.1 迁移 composables/bridge.js → composables/bridge.ts

**迁移步骤**：
1. 重命名文件
2. 添加 API 接口定义

**接口定义**：
```typescript
export interface ToastAPI {
  toast(msg: string, ok?: boolean): void
  toastWithUndo(msg: string, undoFn: () => void, duration?: number): void
  showConfirm(msg: string, onConfirm: () => void): void
}

export interface ContextMenuAPI {
  show(e: MouseEvent, type: string, id: string): void
  hide(): void
}

export interface ActionSheetAPI {
  show(items: Array<{ label: string; action: () => void; danger?: boolean }>): void
  showCategoryPicker(bmId: string): void
  showGroupCategoryPicker(gid: string): void
}

export interface AttrDropdownAPI {
  toggle(): void
  close(): void
}

export interface BatchMoveAPI {
  show(): void
  hide(): void
}

export interface MentionAPI {
  init(): void
  destroy(): void
}

export let toastAPI: ToastAPI | null = null
export let ctxMenuAPI: ContextMenuAPI | null = null
export let actionSheetAPI: ActionSheetAPI | null = null
export let attrDropdownAPI: AttrDropdownAPI | null = null
export let batchMoveAPI: BatchMoveAPI | null = null
export let mentionAPI: MentionAPI | null = null

export function setToastAPI(api: ToastAPI): void
export function setCtxMenuAPI(api: ContextMenuAPI): void
export function setActionSheetAPI(api: ActionSheetAPI): void
export function setAttrDropdownAPI(api: AttrDropdownAPI): void
export function setBatchMoveAPI(api: BatchMoveAPI): void
export function setMentionAPI(api: MentionAPI): void
```

#### 2.2 迁移 composables/domain/*.js → composables/domain/*.ts

**迁移步骤**：
1. 重命名所有文件
2. 添加函数参数和返回值类型
3. 导入类型定义

**需要迁移的文件**：
- `useBookmark.ts`
- `useGroup.ts`
- `useBatch.ts`
- `useUndo.ts`
- `useDataIO.ts`
- `useAttrFilter.ts`
- `useMention.ts`

#### 2.3 迁移 composables/interaction/*.js → composables/interaction/*.ts

**迁移步骤**：
1. 重命名所有文件
2. 添加函数参数和返回值类型
3. 导入类型定义

**需要迁移的文件**：
- `useKeyboard.ts`
- `useKeyboardOps.ts`
- `useDragDrop.ts`
- `useMobileDragReorder.ts`
- `useResize.ts`
- `useScrollHeader.ts`
- `useLongPress.ts`

#### 2.4 迁移 composables/ui/*.js → composables/ui/*.ts

**迁移步骤**：
1. 重命名所有文件
2. 添加函数参数和返回值类型
3. 导入类型定义

**需要迁移的文件**：
- `useUI.ts`
- `useEditorFormat.ts`
- `useIconPreview.ts`
- `useInlineRename.ts`
- `usePasswordVisibility.ts`

#### 2.5 迁移 composables/useApp*.js → composables/useApp*.ts

**迁移步骤**：
1. 重命名所有文件
2. 添加函数参数和返回值类型
3. 导入类型定义

**需要迁移的文件**：
- `useApp.ts`
- `useAppHandlers.ts`
- `useAppLifecycle.ts`
- `useGlobalEvents.ts`
- `useInlineCard.ts`
- `useVirtualScroll.ts`

---

### 第三阶段：组件层（60 分钟）

#### 3.1 更新 Vue 组件脚本

**迁移步骤**：
1. 将 `<script>` 改为 `<script setup lang="ts">`
2. 添加组件 props 类型
3. 添加事件 emit 类型
4. 添加 ref/reactive 类型

**示例**：
```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Bookmark } from '../types'

interface Props {
  bookmark: Bookmark
  selected?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selected: false
})

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
}>()

const isExpanded = ref(false)
const title = computed(() => props.bookmark.title)
</script>
```

#### 3.2 迁移组件文件

**需要迁移的文件**：

**cards/**：
- `CardGrid.vue`
- `BookmarkCard.vue`
- `GroupCard.vue`

**editor/**：
- `GroupEditor.vue`
- `FormatToolbar.vue`
- `ColorPalette.vue`

**modals/**：
- `BookmarkModal.vue`
- `CategoryModal.vue`
- `AttributeModal.vue`
- `GroupEditModal.vue`
- `ConfirmModal.vue`
- `MasterPasswordModal.vue`

**overlays/**：
- `ContextMenu.vue`
- `ActionSheet.vue`
- `BatchPopover.vue`
- `SearchSuggest.vue`
- `ToastContainer.vue`
- `MentionDropdown.vue`
- `AddPopover.vue`
- `AttrDropdown.vue`

**shell/**：
- `AppHeader.vue`
- `AppNav.vue`
- `FilterBar.vue`
- `BatchBar.vue`
- `BatchBottom.vue`
- `DetailPanel.vue`
- `SettingsPanel.vue`
- `AttrChips.vue`

**入口**：
- `App.vue`

---

### 第四阶段：测试层（60 分钟）

#### 4.1 更新测试配置

**迁移步骤**：
1. 更新 vitest.config.ts 支持 TypeScript
2. 更新 setup.ts 类型

#### 4.2 迁移测试文件

**迁移步骤**：
1. 重命名所有测试文件
2. 添加测试函数类型
3. 导入类型定义

**需要迁移的文件**：
- `__tests__/setup.ts`
- `__tests__/utils.test.ts`
- `__tests__/utils-advanced.test.ts`
- `__tests__/crypto.test.ts`
- `__tests__/migrations.test.ts`
- `__tests__/store.test.ts`
- `__tests__/store-getters.test.ts`
- `__tests__/attrFilter.test.ts`
- `__tests__/inlineCard.test.ts`
- `__tests__/stores/data.test.ts`
- `__tests__/stores/ui.test.ts`
- `__tests__/stores/security.test.ts`
- `__tests__/composables/useBookmark.test.ts`

---

## 验证检查点

### 每个阶段完成后验证

1. **TypeScript 编译检查**
   ```bash
   npx tsc --noEmit
   ```

2. **ESLint 检查**
   ```bash
   npm run lint
   ```

3. **测试运行**
   ```bash
   npm run test
   ```

4. **开发服务器**
   ```bash
   npm run dev
   ```

5. **生产构建**
   ```bash
   npm run build
   ```

---

## 依赖关系

### 本任务依赖的文件（任务 A 产出）
- `src/types.ts`
- `config/constants.ts`
- `config/icons.ts`
- `utils.ts`
- `crypto.ts`
- `lib/toast.ts`
- `lib/theme.ts`
- `lib/editor.ts`

### 本任务不依赖的文件
- 无（本任务是最后一阶段）

---

## 注意事项

### 1. 渐进式迁移
- 保持 `.js` 文件可用，直到所有依赖都迁移完成
- 使用 `allowJs: true` 在 tsconfig.json 中支持混合文件

### 2. 类型导入
- 使用 `import type` 导入类型，避免运行时开销
- 示例：`import type { Bookmark } from '../types'`

### 3. Vue 组件类型
- 使用 `defineProps<Props>()` 定义 props 类型
- 使用 `defineEmits<Emits>()` 定义事件类型
- 使用 `ref<Type>()` 定义响应式变量类型

### 4. Store 类型
- 使用 `defineStore('name', () => { ... })` 的 setup 语法
- 为 state、getters、actions 添加类型注解

### 5. 测试类型
- 使用 `describe`、`it`、`expect` 的类型
- 为 mock 函数添加类型

---

## 产出物

### 新增文件
- `stores/storage.ts`
- `stores/persist.ts`
- `stores/migrations.ts`
- `stores/data.ts`
- `stores/ui.ts`
- `stores/security.ts`
- `stores/undo.ts`
- `stores/app.ts`
- `composables/bridge.ts`
- `composables/domain/*.ts`（7 个文件）
- `composables/interaction/*.ts`（7 个文件）
- `composables/ui/*.ts`（5 个文件）
- `composables/useApp*.ts`（3 个文件）
- `composables/useGlobalEvents.ts`
- `composables/useInlineCard.ts`
- `composables/useVirtualScroll.ts`
- `__tests__/setup.ts`
- `__tests__/*.test.ts`（12 个文件）

### 修改文件
- `src/App.vue`（添加 `<script setup lang="ts">`）
- `src/components/**/*.vue`（添加 `<script setup lang="ts">`）

### 删除文件
- `stores/storage.js`
- `stores/persist.js`
- `stores/migrations.js`
- `stores/data.js`
- `stores/ui.js`
- `stores/security.js`
- `stores/undo.js`
- `stores/app.js`
- `composables/bridge.js`
- `composables/domain/*.js`（7 个文件）
- `composables/interaction/*.js`（7 个文件）
- `composables/ui/*.js`（5 个文件）
- `composables/useApp*.js`（3 个文件）
- `composables/useGlobalEvents.js`
- `composables/useInlineCard.js`
- `composables/useVirtualScroll.js`
- `__tests__/setup.js`
- `__tests__/*.test.js`（12 个文件）

---

## 并行执行建议

### 任务 A 和任务 B 的并行点

1. **任务 A 第一阶段**（TypeScript 配置）完成后，任务 B 可以开始
2. **任务 A 第二阶段**（类型定义）完成后，任务 B 可以开始 Store 层迁移
3. **任务 A 第三阶段**（配置文件）完成后，任务 B 可以开始 Composables 层迁移

### 避免冲突的策略

1. **文件命名**：任务 A 和任务 B 迁移不同的文件，不会冲突
2. **类型导入**：任务 B 使用 `import type` 导入任务 A 的类型定义
3. **测试验证**：两个任务都运行相同的测试套件，确保兼容性

---

## 最终验证

### 完成所有迁移后

1. **TypeScript 编译检查**
   ```bash
   npx tsc --noEmit
   ```

2. **ESLint 检查**
   ```bash
   npm run lint
   ```

3. **测试运行**
   ```bash
   npm run test
   ```

4. **开发服务器**
   ```bash
   npm run dev
   ```

5. **生产构建**
   ```bash
   npm run build
   ```

6. **类型覆盖率检查**
   ```bash
   npx type-coverage --detail
   ```
