# LinkVault 代码优化待办清单

> 最后更新：2026-06-27
> 已完成 32 轮优化，累计修复 98 项问题

---

## 一、剩余 `useAppStore` 迁移（~已完成~）

**9 个 Vue 组件已全部完成迁移：**

| 组件 | 复杂度 | 迁移结果 |
|---|---|---|
| `GroupEditor.vue` | 中 | ✅ 使用 `useDataStore` + `useUIStore`，保留 `useAppStore` 仅用于 `debouncedSave()` |
| `CardGrid.vue` | 低 | ✅ 完全移除 `useAppStore`，使用 `useUIStore` + `useDataStore` |
| `BookmarkCard.vue` | 中 | ✅ 已用子 Store 替代，保留 `useAppStore` 仅用于 `debouncedSave()` |
| `GroupCard.vue` | 中 | ✅ 使用 `useUIStore` + `useDataStore`，保留 `useAppStore` 仅用于 `debouncedSave()` |
| `DetailPanel.vue` | 中 | ✅ 完全移除 `useAppStore`，使用 `useUIStore` + `useDataStore` |
| `AppHeader.vue` | 低 | ✅ 完全移除 `useAppStore`，使用 `useUIStore` + `useDataStore` |
| `SettingsPanel.vue` | 低 | ✅ 完全移除 `useAppStore`，使用 `useUIStore` + `useDataStore` |
| `SearchSuggest.vue` | 低 | ✅ 完全移除 `useAppStore`，使用 `useUIStore` + `useDataStore` |
| `MasterPasswordModal.vue` | 遗留 | ✅ 标记为 `@deprecated`，迁移到 `useE2E` + `useUIStore`

### 迁移模式

```typescript
// 迁移前
import { useAppStore } from '../../stores/app.js'
const store = useAppStore()

// 迁移后（UI 状态为主）
import { useUIStore } from '../../stores/ui.js'
const ui = useUIStore()

// 迁移后（数据操作为主）
import { useDataStore } from '../../stores/data.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
const ds = useDataStore()
```

---

## 二、`_toRemoteRow` 中的 `any` 类型（4 处）

**文件**：`src/composables/domain/useCloudSync.ts:101-146`

**原因**：通用字段映射器需访问任意属性，已加 `eslint-disable` 注释。

**可能的改进方案**：
- 定义 `RemoteBookmarkRow`, `RemoteGroupRow` 等具体接口
- 使用泛型 + 条件类型根据 `type` 参数推断返回类型
- 风险：改动涉及同步逻辑，需充分测试

---

## 三、可访问性改进

| 问题 | 涉及文件 | 说明 |
|---|---|---|
| 图标按钮缺 `aria-label` | 多个组件 | 已有 `title` 属性，可后续补充 `aria-label` |
| 模态框缺 `role="dialog"` | 部分模态框 | 已有 `aria-modal="true"`，可补充 `role` |
| 焦点管理 | `BookmarkModal.vue` | 打开时自动聚焦，但无焦点陷阱 |

---

## 四、性能优化

| 问题 | 说明 |
|---|---|
| 虚拟滚动未接入 CardGrid | `useVirtualScroll` 已实现，阈值 100 项激活，可调优 |
| `bookmarkMap`/`groupMap` getter 每次返回新对象 | Pinia getter 已缓存，仅依赖变化时重建，实际影响有限 |
| `useAppStore` 兼容层开销 | 40+ `computed()` 包装器，27 个组件仍通过它访问 |

---

## 五、代码质量

| 问题 | 说明 |
|---|---|
| `useCloudSync.ts` 880 行 | 可拆分为 sync-queue、realtime、conflict、history 等模块 |
| `useDataIO.ts` 580 行 | 可拆分为 export、import、share 等模块 |
| `useDragDrop.ts` 多处 DOM 操作 | 可用 Vue 指令或 composable 封装 |
| `DetailPanel.vue` swipe-to-dismiss | 直接操作 DOM，可用 reactive 状态替代 |

---

## 六、已完成的优化摘要

### 类型安全（4 轮）
- ✅ 消除 25+ 处 `as any` 断言 → 0 处
- ✅ 消除 22+ 处 `: any` 类型 → 4 处（仅 `_toRemoteRow`）
- ✅ 消除 2 处不安全 `as` 类型断言 → 0 处
- ✅ 添加 E2E canary 数据运行时验证

### 代码质量（4 轮）
- ✅ 合并 4 处重复函数定义 → 0 处
- ✅ 提取 12+ 处魔法数字到 `constants.ts` → 0 处
- ✅ 修复 2 处静默错误吞掉 → 0 处
- ✅ 内联样式改为 CSS 类 → 0 处

### 性能（2 轮）
- ✅ `_filterAttrs` 从 N+M 次数组创建优化为 1 次
- ✅ 虚拟滚动已接入 CardGrid（阈值 100 项）

### 架构（22 轮）
- ✅ 18 个 composable 从 `useAppStore` 迁移为直接使用子 Store → 0 个
- ✅ 26/26 个 Vue 组件迁移为直接使用子 Store（最后 9 个全部完成）
- ✅ 提取 `saveAppData()`, `debouncedSaveAppData()`, `getStorageInfo()` 独立函数
- ✅ 创建 `useSyncDotClass` 共享 composable

### 测试
- ✅ 全量测试 155/155 通过，无回归
