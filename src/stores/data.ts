/**
 * data.ts — 数据 Store（组合入口）
 * 职责：管理 bookmarks, siblingGroups, categories, customAttributes 及其 CRUD、过滤、排序。
 * 定义按领域拆分（对外 API 与 store id 均与拆分前 100% 一致）：
 * - dataShared.ts      模块级机械（写保护/影子合并/历史防抖 Map/state 工厂）
 * - dataGetters.ts     全部 getters
 * - dataActionsCore.ts 索引维护/脏标记/搜索版本/本地历史/回收站底层
 * - dataActionsBookmarks.ts / Groups / Categories / Attributes  实体 CRUD
 * - dataActionsIO.ts   加载/导入/空间切换
 * 纯函数（_filterAttrs / _indexOfById / _sortItems / SortableItem）见 src/lib/dataQuery.ts。
 */
import { defineStore } from 'pinia'
import { makeDataState, _cancelPendingHist, __testHistDebounce, DGM_KEY } from './dataShared.js'
import { dataGetters } from './dataGetters.js'
import { coreActions } from './dataActionsCore.js'
import { bookmarkActions } from './dataActionsBookmarks.js'
import { groupActions } from './dataActionsGroups.js'
import { categoryActions } from './dataActionsCategories.js'
import { attributeActions } from './dataActionsAttributes.js'
import { ioActions } from './dataActionsIO.js'
// 既有公共导出保持不变（调用方仍从 data.js 取，lib 内部亦直测）
import { _filterAttrs, _indexOfById, _sortItems } from '../lib/dataQuery.js'
export { _filterAttrs, _indexOfById, _sortItems }
export type { SortableItem } from '../lib/dataQuery.js'
export { _cancelPendingHist, __testHistDebounce, DGM_KEY }

export const useDataStore = defineStore('data', {
  state: makeDataState,

  getters: { ...dataGetters },

  actions: {
    ...coreActions,
    ...bookmarkActions,
    ...groupActions,
    ...categoryActions,
    ...attributeActions,
    ...ioActions,
  },
})

// 漂移护栏：真实 store 必须满足 DataStoreThis（各拆分文件的 this 形状）。
// 若新增 action/state 后忘记同步 DataStoreThis，此处 extends 变 never → `never` 上赋 true 编译报错。
type _StoreIsThisShape = ReturnType<typeof useDataStore> extends import('./dataShared.js').DataStoreThis ? true : never
const _storeIsThisShape: _StoreIsThisShape = true
void _storeIsThisShape
