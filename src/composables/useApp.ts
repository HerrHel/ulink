/**
 * useApp — 应用初始化 composable
 * 职责：注册全局交互 composables + 配置长按操作菜单 + 全局事件委派
 * 事件处理函数 → useAppHandlers.js
 * 生命周期管理 → useAppLifecycle.js
 */
import { watch } from 'vue'
import { useUIStore } from '../stores/ui.js'
import { useContextMenuStore } from '../stores/contextMenu.js'
import { useActionSheetStore } from '../stores/actionSheet.js'
import { useDataStore } from '../stores/data.js'
import { toggleGroupFocus, removeBmFromGroup, removeGroupRef, editGroup, deleteGroup } from './domain/useGroup.js'
import { visit, openBmModal, deleteBookmarkWithUndo as deleteBookmark } from './domain/useBookmark.js'
import { openDetail } from './ui/useUI.js'
import { shareGroup } from './domain/useDataShare.js'
import { useGlobalEvents } from './useGlobalEvents.js'
import { useScrollHeader } from './interaction/useScrollHeader.js'
import { useResize } from './interaction/useResize.js'
import { useKeyboard } from './interaction/useKeyboard.js'
import { useDragDrop } from './interaction/useDragDrop.js'
import { useLongPress } from './interaction/useLongPress.js'
import { debouncedSaveAppData } from '../stores/app.js'

export function useApp() {
  // ── 0. 初始化 is-mobile class（CSS 据此区分真手机 vs PC 窄窗口） ──
  const ui = useUIStore()
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('is-mobile', ui.isMobile)
  }

  // ── 1. 注册全局交互 composables ──
  useScrollHeader(); useResize(); useKeyboard(); useDragDrop()

  // ── 2. 长按操作菜单 ──
  const longPress = useLongPress((card) => {
    const bmId = card.dataset.id; const gid = card.dataset.groupId
    const dataStore = useDataStore()
    if (bmId) {
      const bm = dataStore.bookmarkMap[bmId]
      return [
        { label: bm?.pinnedAt ? '取消置顶' : '置顶', action: () => { dataStore.togglePin('bookmark', bmId); debouncedSaveAppData() } },
        { label: '打开链接', action: () => visit(null, bmId) },
        { label: '查看详情', action: () => openDetail(bmId) },
        { label: '编辑', action: () => openBmModal(bmId) },
        { label: '移动到', action: () => useActionSheetStore().showBmCategoryPicker(bmId) },
        { label: '删除', action: () => deleteBookmark(bmId), danger: true }
      ]
    }
    if (gid) {
      const g = dataStore.groupMap[gid]
      return [
        { label: g?.pinnedAt ? '取消置顶' : '置顶', action: () => { dataStore.togglePin('group', gid); debouncedSaveAppData() } },
        { label: '查看详情', action: () => openDetail('group:' + gid) },
        { label: '展开组', action: () => toggleGroupFocus(gid) },
        { label: '编辑组', action: () => editGroup(gid) },
        { label: '移动到', action: () => useActionSheetStore().showGroupCategoryPicker(gid) },
        { label: '分享组', action: () => shareGroup(gid) },
        { label: '删除组', action: () => deleteGroup(gid), danger: true }
      ]
    }
    return null
  })
  // H17：fired 现为 Ref，直接 watch 该 ref 即可响应长按触发
  watch(longPress.fired, (v) => { useUIStore().lpFired = v })

  // ── 3. 全局事件委派 ──
  // longPress.fired 已通过上面的 watch 同步到 uiStore.lpFired，useGlobalEvents
  // 直接读 store（不再通过一次性的快照对象传值——快照会失效）。
  useGlobalEvents({
    onOpenDetail: openDetail,
    onToggleGroupFocus: toggleGroupFocus,
    onRemoveGroupRef: removeGroupRef,
    onRemoveBmFromGroup: removeBmFromGroup,
    onVisit: visit,
    onShowCtxMenu: (e: MouseEvent, type: string, id: string) => {
      useContextMenuStore().show(e, type, id)
    }
  })
}
