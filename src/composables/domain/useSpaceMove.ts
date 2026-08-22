/**
 * useSpaceMove — 移入私密空间（独立数据集）
 *
 * 把主页数据"移动"到私密空间：
 * - 单卡片 / 批量书签：移入私密空间的「未分类」（CAT_UNCATEGORIZED，私密空间自带虚拟分类兜底）
 * - 整分类：连同该分类 + 其下书签（含子书签）+ 命中组一并迁入，保留分类结构
 * - 单/批量组：连同组的 bookmarkIds 引用的书签一并迁入
 *
 * 移动 = 主页数据集删除 + 私密数据集建立副本（深拷贝）。两套数据集物理隔离：
 * 主页读 `linkvault_v2`，私密读 `linkvault_vault_v1`，互不进对方。
 *
 * 关键复用：
 * - dataStore.childrenMap / bookmarkMap / groupMap / categoryMap — 仅主页数据
 * - collectDescendantIds — 子书签 BFS 递归
 * - dataStore.permanentDeleteBookmark/Group/Category — 主页删除（含软删历史清理）
 * - dataStore.getSpaceSnapshot('vault') / persist.saveData(snapshot,'vault') — 私密数据集读写
 *
 * 只有在主页空间（curSpace === 'main'）时才允许移入；私密空间内调用无意义（已在该空间）。
 */
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import * as persist from '../../stores/persist.js'
import { collectDescendantIds } from '../../lib/collectSubIds.js'
import { toast } from '../../lib/toast.js'
import { t, tN } from '../../i18n/index.js'
import { cloneDeep } from '../../lib/clone.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { AppData, Bookmark, SiblingGroup, Category } from '../../types.js'

/** 私密空间空库时的初始空数据集 */
function _emptyVault(): AppData {
  return { bookmarks: [], siblingGroups: [], categories: [], customAttributes: [] }
}

/** deep clone + 去掉 _脏字段（书签可能带 _changedFields 等运行时态，不进私密数据集） */
function _clean<T extends Record<string, unknown>>(item: T): T {
  const copy = cloneDeep(item) as Record<string, unknown>
  for (const k of Object.keys(copy)) {
    if (k.startsWith('_')) delete copy[k]
  }
  return copy as T
}

/** 以 id 为键合并：vault 已有同 id 则跳过（不覆盖，避免同 id 误合并） */
export function _mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const idSet = new Set(existing.map(x => x.id))
  const out = [...existing]
  for (const it of incoming) {
    if (idSet.has(it.id)) continue
    idSet.add(it.id)
    out.push(it)
  }
  return out
}

/** 收集这些书签引用到的 customAttribute id（书签/组的 attributes 键名） */
export function _attrIdsUsed(bms: Bookmark[], groups: SiblingGroup[]): Set<string> {
  const ids = new Set<string>()
  for (const b of bms) for (const k of Object.keys(b.attributes || {})) ids.add(k)
  for (const g of groups) for (const k of Object.keys(g.attributes || {})) ids.add(k)
  return ids
}

/**
 * 把指定书签/分类/组并入私密数据集快照并写库。
 * @param vault 私密空间当前快照（会被原地扩展后写回）
 * @param toVaultBookmarks 要并入的书签（已 _clean）
 * @param toVaultGroups 要并入的组（已 _clean）
 * @param toVaultCategories 要并入的分类（已 _clean）
 * @param sourceBms 原始主页书签引用（用于收集 attr id，不并入私密）
 */
async function _persistIntoVault(
  vault: AppData,
  toVaultBookmarks: Bookmark[],
  toVaultGroups: SiblingGroup[],
  toVaultCategories: Category[],
): Promise<AppData> {
  vault.bookmarks = _mergeById(vault.bookmarks, toVaultBookmarks)
  vault.siblingGroups = _mergeById(vault.siblingGroups, toVaultGroups)
  // 分类：若私密空间尚无目标分类则并入手动分类（CAT_UNCATEGORIZED/CAT_ALL 是虚拟常量不进 state.categories）
  const realCats = toVaultCategories.filter(c => c.id !== CAT_UNCATEGORIZED && c.id !== 'all')
  vault.categories = _mergeById(vault.categories, realCats)
  // customAttributes 随迁：把书签/组引用到的 attr 一并并入密空间（避免 boolean 标记失联）
  const usedAttrIds = _attrIdsUsed(toVaultBookmarks, toVaultGroups)
  const sourceAttrs = useDataStore().customAttributes.filter(a => usedAttrIds.has(a.id))
  vault.customAttributes = _mergeById(vault.customAttributes, sourceAttrs.map(_clean))
  await persist.saveData(vault, 'vault')
  return vault
}

export function useSpaceMove() {
  const dataStore = useDataStore()
  const uiStore = useUIStore()

  /** 仅在主页空间允许移入私密 */
  function _assertMain(): boolean {
    if (uiStore.curSpace !== 'main') {
      toast(t('msg.alreadyInVault'), false)
      return false
    }
    return true
  }

  /** 读私密空间快照；无落库数据则空库 */
  async function _loadVault(): Promise<AppData> {
    const snap = await dataStore.getSpaceSnapshot('vault')
    return snap ?? _emptyVault()
  }

  /**
   * 移入书签到私密空间（单卡片 / 多选批量）。
   * 自动收集子书签（collectSubIds 递归），并入私密的未分类（CAT_UNCATEGORIZED）。
   * 移入的书签若属于某组，对应组也一并迁入（保留组结构，组的其余成员仍留主页）。
   */
  async function moveBookmarksToVault(ids: string[]): Promise<void> {
    if (!ids.length) return
    if (!_assertMain()) return
    const allIds = new Set<string>()
    for (const id of ids) {
      for (const sid of collectDescendantIds(pid => dataStore.childrenMap[pid], id)) allIds.add(sid)
    }
    const bms: Bookmark[] = []
    for (const id of allIds) {
      const b = dataStore.bookmarkMap[id]
      if (b) bms.push(_clean(b))
    }
    if (!bms.length) return
    // 移入私密的书签改挂未分类（私密空间根级，无原始分类上下文）
    for (const b of bms) {
      b.categoryId = CAT_UNCATEGORIZED
      b.parentId = null
    }
    // 命中组：任一成员在迁入集合则整组迁入（组在主页其余成员则保留在主页一个无该成员的新组——
    // 但组结构复制语义较复杂，第一版简化：仅当组所有成员都被移入时整组迁入，否则组留在主页）
    const bmIdSet = allIds
    const groupsFull: SiblingGroup[] = []
    for (const g of dataStore.siblingGroups) {
      const hitIds = (g.bookmarkIds || []).filter(bid => bmIdSet.has(bid))
      if (hitIds.length === (g.bookmarkIds || []).length && hitIds.length > 0) {
        // 组全员都被移入 → 整组迁入私密
        groupsFull.push(_clean(g))
      }
    }

    const vault = await _loadVault()
    await _persistIntoVault(vault, bms, groupsFull, [])

    // 从主页删除：整组先删（避免组引用悬空），再删书签（含子）
    for (const g of groupsFull) dataStore.permanentDeleteGroup(g.id)
    for (const id of allIds) dataStore.permanentDeleteBookmark(id)
    dataStore._syncMaps()
    // 落主页数据集
    await useDataStoreSave()
    toast(tN('msg.movedToVault', bms.length) + (groupsFull.length ? tN('msg.movedGroupsSuffix', groupsFull.length) : ''))
  }

  /**
   * 移入整分类：该分类 + 其下书签（含子书签）+ 命中组一并迁入私密空间，保留分类结构。
   * 移入后从主页删除分类（片状联动）。
   */
  async function moveCategoryToVault(catId: string): Promise<void> {
    if (!catId || catId === CAT_UNCATEGORIZED || catId === 'all') return
    if (!_assertMain()) return
    const cat = dataStore.categoryMap[catId]
    if (!cat) return
    // 收集该分类下所有书签（含子书签）
    const rootBms = dataStore.bookmarks.filter(b => b.categoryId === catId && !b.deletedAt)
    const allIds = new Set<string>()
    for (const b of rootBms) {
      for (const sid of collectDescendantIds(pid => dataStore.childrenMap[pid], b.id)) allIds.add(sid)
    }
    const bms: Bookmark[] = []
    for (const id of allIds) {
      const b = dataStore.bookmarkMap[id]
      if (b) bms.push(_clean(b))
    }
    // 该分类下所有组
    const groupsRaw: SiblingGroup[] = dataStore.siblingGroups.filter(g => g.categoryId === catId && !g.deletedAt)
    // 组引用的书签若不在该分类（如组跨分类引用）也一并纳入迁入集合
    for (const g of groupsRaw) {
      for (const bid of g.bookmarkIds || []) {
        const b = dataStore.bookmarkMap[bid]
        if (b && !allIds.has(bid)) {
          // 跨分类引用的书签单独迁入私密未分类（不归本分类），并从主页删
          allIds.add(bid)
          bms.push({ ..._clean(b), categoryId: CAT_UNCATEGORIZED, parentId: null })
        }
      }
    }
    const groups = groupsRaw.map(_clean)

    const vault = await _loadVault()
    await _persistIntoVault(vault, bms, groups, [_clean(cat)])

    // 从主页删除：整组先删，再删书签（含子），最后删分类本身
    for (const g of groupsRaw) dataStore.permanentDeleteGroup(g.id)
    for (const id of allIds) dataStore.permanentDeleteBookmark(id)
    dataStore.permanentDeleteCategory(catId)
    dataStore._syncMaps()
    await useDataStoreSave()
    toast(t('msg.categoryMovedToVault', { name: cat.name, bookmarks: bms.length, groups: groups.length }))
  }

  /**
   * 移入组（单组 / 多选批量）：组 + 组的全部成员书签一并迁入私密空间。
   */
  async function moveGroupsToVault(ids: string[]): Promise<void> {
    if (!ids.length) return
    if (!_assertMain()) return
    const groupsRaw: SiblingGroup[] = ids.map(id => dataStore.groupMap[id]).filter(Boolean) as SiblingGroup[]
    if (!groupsRaw.length) return
    const allBmIds = new Set<string>()
    for (const g of groupsRaw) for (const bid of g.bookmarkIds || []) allBmIds.add(bid)
    // 收集子书签
    const descendantIds = new Set<string>()
    for (const id of allBmIds) {
      for (const sid of collectDescendantIds(pid => dataStore.childrenMap[pid], id)) descendantIds.add(sid)
    }
    const bms: Bookmark[] = []
    for (const id of descendantIds) {
      const b = dataStore.bookmarkMap[id]
      if (b) bms.push({ ..._clean(b), categoryId: CAT_UNCATEGORIZED, parentId: null })
    }
    const groups = groupsRaw.map(_clean)

    const vault = await _loadVault()
    await _persistIntoVault(vault, bms, groups, [])

    // 组及其成员从主页删除：组先删，成员书签删（含子）；非该组成员不删
    for (const g of groupsRaw) dataStore.permanentDeleteGroup(g.id)
    for (const id of descendantIds) dataStore.permanentDeleteBookmark(id)
    dataStore._syncMaps()
    await useDataStoreSave()
    toast(t('msg.groupsMovedToVault', { groups: groups.length, bookmarks: bms.length }))
  }

  return {
    moveBookmarksToVault,
    moveCategoryToVault,
    moveGroupsToVault,
  }
}

/**
 * 批量按钮统一入口：batchSelected 元素以 `group:` 前缀区分组/书签，分别迁入私密空间。
 * 主页空间批选按钮调用。
 */
export async function moveBatchSelectedToVault(batchSelected: string[]): Promise<void> {
  if (!batchSelected.length) return
  const uiStore = useUIStore()
  if (uiStore.curSpace !== 'main') { toast(t('msg.alreadyInVault'), false); return }
  const bmIds: string[] = []
  const groupIds: string[] = []
  for (const id of batchSelected) {
    if (id.startsWith('group:')) groupIds.push(id.slice(6))
    else bmIds.push(id)
  }
  const spaceMove = useSpaceMove()
  if (bmIds.length) await spaceMove.moveBookmarksToVault(bmIds)
  if (groupIds.length) await spaceMove.moveGroupsToVault(groupIds)
}

/** 触发主页数据落盘（经 app facade save 走当前空间 key） */
async function useDataStoreSave(): Promise<void> {
  // 延迟 import 避免与 app.ts 的初始化顺序耦合；app facade save 走 curSpace 选键
  const app = await import('../../stores/app.js')
  await app.saveAppData()
}

