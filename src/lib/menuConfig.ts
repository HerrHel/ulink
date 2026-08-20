/**
 * menuConfig.ts — 右键/长按上下文菜单统一配置（单一来源）
 *
 * ContextMenu.vue（PC 右键）与 useApp.ts（移动端长按）共用同一份菜单定义：
 * - MENU_ITEMS：action → 默认文案 / 危险标记
 * - MENU_RULES：上下文 type → 右键菜单 action 序列（含 per-type 文案覆盖）
 * - LONGPRESS_RULES：上下文 type → 长按菜单 action 子集（移动端空间有限）
 * - dispatchMenuAction：action → 业务执行唯一出口
 * - buildLongPressItems：长按菜单 items 生成（条件项/动态文案在此统一处理）
 *
 * 历史：两套手写配置（ContextMenu.vue RULES/_dispatchAction、useApp.ts 长按 items）
 * 各自维护，增删菜单项需改两处。统一后只改本文件。
 */
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { useAppStore } from '../stores/app.js'
import { useActionSheetStore } from '../stores/actionSheet.js'
import { copyToClipboard } from '../utils.js'
import { ACTIONS } from '../config/constants.js'
import { visit, openBmModal, deleteBookmarkWithUndo, addSub } from '../composables/domain/useBookmark.js'
import { openDetail, deleteCategory, deleteAttribute, openCatModal } from '../composables/ui/useUI.js'
import { editGroup, deleteGroup, removeBmFromGroup, createGroup, toggleGroupFocus } from '../composables/domain/useGroup.js'
import { shareGroup } from '../composables/domain/useDataShare.js'
import { useSpaceMove } from '../composables/domain/useSpaceMove.js'
import { toggleBatchMode } from '../composables/domain/useBatch.js'
import { pushNavState } from '../composables/interaction/useKeyboardOps.js'
import { debouncedSaveAppData } from '../stores/app.js'

export interface MenuEntry {
  action: string
  /** 覆盖默认文案（同 action 在不同上下文语义不同，如 EDIT=编辑组名/编辑书签） */
  label?: string
  danger?: boolean
}

/** 默认文案与危险标记（per-type 可用 MENU_RULES/LONGPRESS_RULES 的 label 覆盖） */
export const MENU_ITEMS: Record<string, { label: string; danger?: boolean }> = {
  [ACTIONS.COPY_URL]: { label: '复制网址' },
  [ACTIONS.VISIT]: { label: '打开网站' },
  [ACTIONS.EDIT]: { label: '编辑' },
  [ACTIONS.HISTORY]: { label: '版本历史' },
  [ACTIONS.PIN]: { label: '置顶' },
  [ACTIONS.MOVE_TO_CAT]: { label: '移动到' },
  [ACTIONS.MOVE_TO_SPACE]: { label: '设为私密' },
  [ACTIONS.MULTI_SELECT]: { label: '多选' },
  [ACTIONS.DETAIL]: { label: '查看详情' },
  [ACTIONS.DELETE]: { label: '删除', danger: true },
  [ACTIONS.SHARE_GROUP]: { label: '分享组' },
  [ACTIONS.ADD_BOOKMARK]: { label: '添加书签' },
  [ACTIONS.ADD_GROUP]: { label: '添加组' },
  [ACTIONS.ADD_CAT]: { label: '添加分类' },
  [ACTIONS.RENAME_ATTR]: { label: '重命名' },
  [ACTIONS.EXPAND]: { label: '展开' },
  [ACTIONS.FOCUS]: { label: '聚焦编辑' },
  [ACTIONS.ADD_SUB]: { label: '添加子网站' },
  [ACTIONS.ADD_TO_GROUP]: { label: '添加书签或组' },
}

/** 右键菜单规则（PC） */
export const MENU_RULES: Record<string, MenuEntry[]> = {
  card: [
    { action: ACTIONS.COPY_URL },
    { action: ACTIONS.ADD_SUB },
    { action: ACTIONS.EDIT },
    { action: ACTIONS.HISTORY },
    { action: ACTIONS.PIN },
    { action: ACTIONS.MOVE_TO_CAT },
    { action: ACTIONS.MOVE_TO_SPACE },
    { action: ACTIONS.MULTI_SELECT },
    { action: ACTIONS.DETAIL },
    { action: ACTIONS.DELETE },
  ],
  sub: [
    { action: ACTIONS.VISIT, label: '查看详情' },
    { action: ACTIONS.EDIT },
    { action: ACTIONS.DELETE },
  ],
  cat: [
    { action: ACTIONS.EDIT, label: '重命名' },
    { action: ACTIONS.MOVE_TO_SPACE },
    { action: ACTIONS.DELETE },
  ],
  attr: [
    { action: ACTIONS.RENAME_ATTR, label: '重命名' },
    { action: ACTIONS.DELETE },
  ],
  group: [
    { action: ACTIONS.DETAIL },
    { action: ACTIONS.EDIT, label: '编辑组名' },
    { action: ACTIONS.ADD_TO_GROUP },
    { action: ACTIONS.HISTORY },
    { action: ACTIONS.PIN },
    { action: ACTIONS.MOVE_TO_CAT },
    { action: ACTIONS.MOVE_TO_SPACE },
    { action: ACTIONS.SHARE_GROUP },
    { action: ACTIONS.DELETE, label: '删除组' },
  ],
  'group-card': [
    { action: ACTIONS.VISIT, label: '查看详情' },
    { action: ACTIONS.EDIT, label: '编辑书签' },
    { action: ACTIONS.DELETE, label: '从组移除' },
  ],
  'rail-empty': [{ action: ACTIONS.ADD_CAT }],
  'grid-empty': [
    { action: ACTIONS.ADD_BOOKMARK },
    { action: ACTIONS.ADD_GROUP },
    { action: ACTIONS.MULTI_SELECT },
  ],
}

/** 长按菜单规则（移动端，子集 + 展开条件项） */
export const LONGPRESS_RULES: Record<string, MenuEntry[]> = {
  card: [
    { action: ACTIONS.EXPAND },
    { action: ACTIONS.PIN },
    { action: ACTIONS.COPY_URL },
    { action: ACTIONS.ADD_SUB },
    { action: ACTIONS.DETAIL },
    { action: ACTIONS.EDIT },
    { action: ACTIONS.MOVE_TO_CAT },
    { action: ACTIONS.MOVE_TO_SPACE },
    { action: ACTIONS.DELETE },
  ],
  group: [
    { action: ACTIONS.EXPAND },
    { action: ACTIONS.PIN },
    { action: ACTIONS.DETAIL },
    { action: ACTIONS.FOCUS },
    { action: ACTIONS.EDIT, label: '编辑组' },
    { action: ACTIONS.ADD_TO_GROUP },
    { action: ACTIONS.MOVE_TO_CAT },
    { action: ACTIONS.MOVE_TO_SPACE },
    { action: ACTIONS.SHARE_GROUP },
    { action: ACTIONS.DELETE, label: '删除组' },
  ],
}

/** 书签/组是否可展开（长按菜单 EXPAND 条件项） */
export function canExpandEntry(type: 'card' | 'group', id: string): boolean {
  const ui = useUIStore()
  if (ui.layoutMode !== 'list') return false
  const ds = useDataStore()
  if (type === 'card') {
    const bm = ds.bookmarkMap[id]
    return !!bm && !!(bm.username || bm.password || (ds.childrenMap[id]?.length))
  }
  const g = ds.groupMap[id]
  return !!g && !!(g.notes && g.notes.trim())
}

/** ADD_SUB 条件项：仅顶层书签（!parentId）可添加子网站 */
export function canAddSub(id: string): boolean {
  const bm = useDataStore().bookmarkMap[id]
  return !!bm && !bm.parentId
}

/** 生成长按菜单 items（条件项过滤 + 置顶/展开动态文案） */
export function buildLongPressItems(
  type: 'card' | 'group',
  id: string,
): Array<{ label: string; action: () => void; danger?: boolean }> {
  const ui = useUIStore()
  const ds = useDataStore()
  const rules = LONGPRESS_RULES[type] || []
  const isMain = ui.curSpace === 'main'
  const items: Array<{ label: string; action: () => void; danger?: boolean }> = []
  for (const entry of rules) {
    if (entry.action === ACTIONS.EXPAND) {
      if (!canExpandEntry(type, id)) continue
      items.push({
        label: ui.expandedIds.includes(id) ? '收起' : '展开',
        action: () => ui.toggleExpanded(id),
      })
      continue
    }
    if (entry.action === ACTIONS.ADD_SUB && !canAddSub(id)) continue
    if (entry.action === ACTIONS.MOVE_TO_SPACE && !isMain) continue
    let label = entry.label || MENU_ITEMS[entry.action]?.label || entry.action
    if (entry.action === ACTIONS.PIN) {
      const pinned = type === 'card' ? !!ds.bookmarkMap[id]?.pinnedAt : !!ds.groupMap[id]?.pinnedAt
      label = pinned ? '取消置顶' : '置顶'
    }
    items.push({
      label,
      danger: MENU_ITEMS[entry.action]?.danger,
      action: () => dispatchMenuAction(type, entry.action, id),
    })
  }
  return items
}

/** 菜单 action → 业务执行唯一出口（右键与长按共用） */
export function dispatchMenuAction(type: string, action: string, id: string) {
  const dataStore = useDataStore()
  const ui = useUIStore()
  if (type === 'card') {
    if (action === ACTIONS.COPY_URL) {
      const bm = dataStore.bookmarkMap[id]
      if (bm && bm.url) copyToClipboard(bm.url, '网址')
      return
    }
    if (action === ACTIONS.ADD_SUB) {
      if (canAddSub(id)) addSub(id)
      return
    }
    if (action === ACTIONS.DETAIL) openDetail(id)
    if (action === ACTIONS.VISIT) visit(null, id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) deleteBookmarkWithUndo(id)
    if (action === ACTIONS.HISTORY) {
      pushNavState()
      ui.historyItemId = id
      ui.historyItemType = 'bookmark'
      ui.panels.history = true
    }
    if (action === ACTIONS.PIN) { dataStore.togglePin('bookmark', id); debouncedSaveAppData() }
    if (action === ACTIONS.MOVE_TO_CAT) useActionSheetStore().showBmCategoryPicker(id)
    if (action === ACTIONS.MOVE_TO_SPACE) void useSpaceMove().moveBookmarksToVault([id])
    if (action === ACTIONS.MULTI_SELECT) {
      if (!ui.batchMode) toggleBatchMode()
      if (id && !ui.batchSelected.includes(id)) ui.batchSelected.push(id)
    }
    return
  }
  if (type === 'sub') {
    if (action === ACTIONS.VISIT) openDetail(id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) deleteBookmarkWithUndo(id)
    return
  }
  if (type === 'cat') {
    if (action === ACTIONS.EDIT) openCatModal()
    if (action === ACTIONS.MOVE_TO_SPACE) {
      const cat = dataStore.categoryMap[id]
      if (cat && window.confirm(`确认将分类「${cat.name}」及其全部书签/组移入私密空间?`)) {
        void useSpaceMove().moveCategoryToVault(id)
      }
    }
    if (action === ACTIONS.DELETE) deleteCategory(id)
    return
  }
  if (type === 'attr') {
    if (action === ACTIONS.RENAME_ATTR) {
      const attr = useAppStore().attributeMap[id]
      if (attr) {
        const input = window.prompt('重命名属性', attr.name)
        if (input && input.trim() && input.trim() !== attr.name) {
          dataStore.renameAttribute(id, input.trim())
          useAppStore().save()
        }
      }
    }
    if (action === ACTIONS.DELETE) deleteAttribute(id)
    return
  }
  if (type === 'group') {
    if (action === ACTIONS.DETAIL) openDetail('group:' + id)
    if (action === ACTIONS.EDIT) editGroup(id)
    if (action === ACTIONS.ADD_TO_GROUP) {
      // 打开「添加书签或组」Popover（无 trigger 位置时 AddPopover 用默认居中定位）
      ui.addToGid = id
      ui._addPopoverTrigger = null
      ui.overlays.addPopover = true
    }
    if (action === ACTIONS.DELETE) deleteGroup(id)
    if (action === ACTIONS.PIN) { dataStore.togglePin('group', id); debouncedSaveAppData() }
    if (action === ACTIONS.MOVE_TO_CAT) useActionSheetStore().showGroupCategoryPicker(id)
    if (action === ACTIONS.MOVE_TO_SPACE) void useSpaceMove().moveGroupsToVault([id])
    if (action === ACTIONS.SHARE_GROUP) shareGroup(id)
    if (action === ACTIONS.FOCUS) toggleGroupFocus(id)
    if (action === ACTIONS.HISTORY) {
      pushNavState()
      ui.historyItemId = id
      ui.historyItemType = 'group'
      ui.panels.history = true
    }
    return
  }
  if (type === 'group-card') {
    if (action === ACTIONS.VISIT) openDetail(id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) removeBmFromGroup(id, ui.ctxGid!)
    return
  }
  if (type === 'grid-empty') {
    if (action === ACTIONS.ADD_BOOKMARK) openBmModal()
    if (action === ACTIONS.ADD_GROUP) createGroup()
    if (action === ACTIONS.MULTI_SELECT) toggleBatchMode()
    return
  }
  if (type === 'rail-empty') {
    if (action === ACTIONS.ADD_CAT) {
      openCatModal()
      setTimeout(() => document.getElementById('newCatName')?.focus(), 200)
    }
    return
  }
  // 长按专用兜底：EXPAND（条件项在 buildLongPressItems 已过滤，此处仅防御性）
  if (action === ACTIONS.EXPAND) ui.toggleExpanded(id)
}
