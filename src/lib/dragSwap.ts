/**
 * dragSwap.ts — 拖拽交换辅助（从 composables/interaction/useDragDrop.ts 抽取）
 *
 * _samePinStatus / _swapAndMarkDirty 组成「交换书签/组顺序」的独立子功能，
 * 从拖拽事件编排中剥离，降低 useDragDrop.ts 体积（TECH_DEBT A 类：DnD 内核 vs 业务绑定分离）。
 * 仍依赖 useDataStore / useUIStore（顺序变更需落脏与 _customCardOrder 同步），非纯函数。
 */
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { swapOrder } from '../utils.js'

/** 检查置顶状态是否一致（都置顶或都不置顶） */
export function _samePinStatus(a: { id: string }, b: { id: string }): boolean {
  const ds = useDataStore()
  const aPinned = !!(ds.bookmarkMap[a.id]?.pinnedAt || ds.groupMap[a.id]?.pinnedAt)
  const bPinned = !!(ds.bookmarkMap[b.id]?.pinnedAt || ds.groupMap[b.id]?.pinnedAt)
  return aPinned === bPinned
}

/** swapOrder + 标记 dirty（确保排序变更可同步到云端）。返回 false 表示被置顶检查阻止 */
export function _swapAndMarkDirty(a: { id: string; order: number; updatedAt?: number }, b: { id: string; order: number; updatedAt?: number }): boolean {
  // 置顶项不能与非置顶项交换位置
  if (!_samePinStatus(a, b)) return false
  swapOrder(a, b)
  // PERF-3 修复：swap 只改 order 不改 updatedAt 会让 _fingerprint 的 maxUp 不变，
  // app.save() 命中 fp===_lastSavedFp 早退不落盘，刷新后 order 还原。同步 LWW 亦依赖
  // updatedAt 递增才让远端采纳新顺序。故交换后同步刷新两 id 的 updatedAt 为当前时刻。
  const now = Date.now()
  a.updatedAt = now
  b.updatedAt = now
  const ds = useDataStore()
  ds._markDirty(a.id, b.id)
  // A1-003：已有自定义序时同步交换 _customCardOrder，避免 PC 拖拽 DOM 换位后 Vue 弹回
  // R25：原仅 sortMode==='order' 时同步，非 order 模式拖拽改 order 字段但不同步 _customCardOrder，
  // 切回 order 模式后 _customCardOrder 仍持有旧顺序，useCombinedList 用旧序渲染致拖拽结果与
  // 视觉不一致。改为只要 _customCardOrder 存在就同步，无论当前 sortMode。
  const ui = useUIStore()
  if (ds._customCardOrder) {
    const order = ds._customCardOrder
    // 单次遍历找两个索引，避免双 findIndex O(2n)
    let ia = -1, ib = -1
    for (let i = 0; i < order.length; i++) {
      const e = order[i]
      if (e.id === a.id) ia = i
      else if (e.id === b.id) ib = i
      if (ia >= 0 && ib >= 0) break
    }
    if (ia >= 0 && ib >= 0) {
      const tmp = order[ia]
      order[ia] = order[ib]
      order[ib] = tmp
      ds._customCardOrder = order // 触发响应式
      ui.saveUIState()
    }
  }
  return true
}
