/**
 * useUndo — 撤销/重做系统
 * 从 group.js 迁移：performUndo, performRedo, restoreSnapshot, updateUndoRedoButtons
 * 使用 useUndoStore 替代 LV.undoStacks / LV.undoTimers
 */
import { useDataStore } from '../../stores/data.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { useUndoStore, type UndoSnapshot } from '../../stores/undo.js'
import { MAX_UNDO, UNDO_WINDOW, MAX_UNDO_BYTES } from '../../config/constants.js'
import { EditorManager } from '../../lib/editor.js'
import { toast } from '../../lib/toast.js'

let _restoring = false  // true while restoreSnapshot is running; suppress pushUndo

function snapSize(s: UndoSnapshot): number { return (s.notes ? s.notes.length * 2 : 0) + (s.bookmarkIds ? s.bookmarkIds.length * 20 : 0) }

/** 实算所有 stack（undo + redo）的总字节。
 *  旧实现维护模块级 `_totalUndoBytes` 缓存 `+= / -=` 增量记账，存在三类记账 bug：
 *  ① clearStack 清空被删组的 stack 时不减字节 → 已删组 undo 字节永久泄漏、越用越涨；
 *  ② `_undoBytesDirty` 在测试间不重置，模块级单例跨 Pinia 实例残留上轮值，新栈空却读到旧字节；
 *  ③ 增量记账与遍历实算混用致长期失真。
 *  缓存带来的性能收益不值这三类缺陷（snapshot 总数受 MAX_UNDO×组数 上界，遍历可接受），
 *  改为每次实算，记账与 stacks 真相永远单一同步。 */
function totalUndoBytes(): number {
  const undo = useUndoStore()
  let total = 0
  for (const gid in undo.stacks) {
    const st = undo.stacks[gid]
    if (st.undo) for (const s of st.undo) total += snapSize(s)
    if (st.redo) for (const s of st.redo) total += snapSize(s)
  }
  return total
}

function evictOldestUndo(): boolean {
  // 按「全局最久远的 undo 项」逐条驱逐，而非按 gid 字典序选组——
  // gid 形如 'g'+ts.toString(36)+random，含随机段，字典序与 push 时间序不等价，
  // 旧实现 `gid < oldestGid` 会误驱逐时间较新但字典序较小的组，丢失近期编辑的撤销能力。
  // 各 stack 的 undo[0] 是该组最老项（push 顺序），跨组比其 pushedAt 最小者即全局最老。
  const undo = useUndoStore()
  let targetGid: string | null = null
  let oldestAt = Infinity
  for (const gid in undo.stacks) {
    const st = undo.stacks[gid]
    if (st.undo && st.undo.length) {
      const at = st.undo[0].pushedAt ?? 0
      if (at < oldestAt) { oldestAt = at; targetGid = gid }
    }
  }
  if (!targetGid) return false
  const st = undo.stacks[targetGid]
  st.undo.shift()
  if (!st.undo.length && !st.redo.length) delete undo.stacks[targetGid]
  return true
}

export function pushUndo(gid: string) {
  if (_restoring) return  // suppress during programmatic restore
  const ds = useDataStore()
  const undo = useUndoStore()
  const sg = ds.groupMap[gid]
  if (!sg) return
  const stack = undo.ensureStack(gid)
  if (undo.timers[gid]) { clearTimeout(undo.timers[gid]) }
  else {
    stack.redo = []
    if (stack.undo.length >= MAX_UNDO) {
      stack.undo.shift()
    }
    const newSnap: UndoSnapshot = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice(), pushedAt: Date.now() }
    stack.undo.push(newSnap)
    // 字节超限时驱逐「全局最久远」的 undo 项，直到达标或无可驱逐（所有组 undo 已空）。
    // 旧实现守卫 `stack.undo.length > 1` 用的是当前 push 组的栈深度，但 evict 驱逐的是
    // 全局最老组——当前组刚首次 push（undo 仅 1 条）时即便全局字节超限也不驱逐，
    // 超限状态无法靠这条 push 修复；且旧 evict 按字典序选组可能驱逐错组。改纯按字节达标驱动。
    while (totalUndoBytes() > MAX_UNDO_BYTES) {
      if (!evictOldestUndo()) break
    }
  }
  undo.timers[gid] = setTimeout(function () { delete undo.timers[gid] }, UNDO_WINDOW)
  if (undo.onPushCallback) undo.onPushCallback(gid)
}

export function restoreSnapshot(gid: string, snap: UndoSnapshot) {
  const ds = useDataStore()
  const sg = ds.groupMap[gid]
  if (!sg) return
  // H15 配套：软删除书签仍在 bookmarkMap，恢复时也需过滤 deletedAt，
  // 与 GroupEditor.syncToStore / 历史恢复一致，避免 undo 把悬空 id 写回 bookmarkIds。
  const filteredIds = snap.bookmarkIds.filter(function (bid) {
    const bm = ds.bookmarkMap[bid]
    return !!(bm && !bm.deletedAt)
  })
  ds.updateGroup(gid, { notes: snap.notes, bookmarkIds: filteredIds })
  // Sync TipTap editor if it's mounted (visible group)
  const ed = EditorManager.get(gid)
  if (ed) {
    _restoring = true
    try { ed.commands.setContent(snap.notes || '') }
    finally { _restoring = false }
  }
  // If no editor (group not visible), Vue reactivity renders sg.notes on next mount
}

/** M7：undo/redo 成功后清掉该组 pushUndo 防抖 timer，
 *  否则窗口内下一次 pushUndo 走 if 分支只续 timer、不建栈也不清 redo，
 *  新编辑被静默吞掉且 redo 仍指向旧分叉。 */
function _clearPushTimer(gid: string) {
  const undo = useUndoStore()
  if (undo.timers[gid]) {
    clearTimeout(undo.timers[gid])
    delete undo.timers[gid]
  }
}

export function performUndo(gid: string): boolean {
  const ds = useDataStore()
  const undo = useUndoStore()
  const stack = undo.stacks[gid]
  if (!stack || !stack.undo.length) return false
  const sg = ds.groupMap[gid]
  if (!sg) return false
  // sg.notes is always current — GroupEditor.syncToStore runs on every onUpdate
  // Capture the latest from editor if available (handles edge case of rapid typing)
  const editorHTML = EditorManager.getContentHTML(gid)
  if (editorHTML !== null) sg.notes = editorHTML
  if (stack.redo.length >= MAX_UNDO) {
    stack.redo.shift()
  }
  const redoSnap: UndoSnapshot = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice(), pushedAt: Date.now() }
  stack.redo.push(redoSnap)
  const snap = stack.undo.pop()!
  restoreSnapshot(gid, snap)
  // M7：清 timer，下一次 pushUndo 必走 else 真正建栈并清 redo
  _clearPushTimer(gid)
  debouncedSaveAppData()
  toast('已撤销')
  return true
}

export function performRedo(gid: string): boolean {
  const ds = useDataStore()
  const undo = useUndoStore()
  const stack = undo.stacks[gid]
  if (!stack || !stack.redo || !stack.redo.length) return false
  const sg = ds.groupMap[gid]
  if (!sg) return false
  const editorHTML = EditorManager.getContentHTML(gid)
  if (editorHTML !== null) sg.notes = editorHTML
  if (stack.undo.length >= MAX_UNDO) {
    stack.undo.shift()
  }
  const undoSnap: UndoSnapshot = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice(), pushedAt: Date.now() }
  stack.undo.push(undoSnap)
  const snap = stack.redo.pop()!
  restoreSnapshot(gid, snap)
  // M7：同 performUndo，清 timer 使后续编辑真正建撤销点
  _clearPushTimer(gid)
  debouncedSaveAppData()
  toast('已前进')
  return true
}
