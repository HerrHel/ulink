/**
 * useUndo — 撤销/重做系统
 * 从 group.js 迁移：performUndo, performRedo, restoreSnapshot, updateUndoRedoButtons
 * 使用 useUndoStore 替代 LV.undoStacks / LV.undoTimers
 */
import { useAppStore } from '../../stores/app.js'
import { useUndoStore } from '../../stores/undo.js'
import { MAX_UNDO, UNDO_WINDOW, MAX_UNDO_BYTES } from '../../config/constants.js'
import { EditorManager } from '../../lib/editor.js'
import { toastAPI } from '../bridge.js'

interface UndoSnapshot {
  notes: string
  bookmarkIds: string[]
}

let _restoring = false  // true while restoreSnapshot is running; suppress pushUndo

function snapSize(s: UndoSnapshot): number { return (s.notes ? s.notes.length * 2 : 0) + (s.bookmarkIds ? s.bookmarkIds.length * 20 : 0) }

let _totalUndoBytes = 0
let _undoBytesDirty = true

function _recalcUndoBytes() {
  const undo = useUndoStore()
  _totalUndoBytes = 0
  for (const gid in undo.stacks) {
    const st = undo.stacks[gid]
    if (st.undo) st.undo.forEach(function (s) { _totalUndoBytes += snapSize(s) })
    if (st.redo) st.redo.forEach(function (s) { _totalUndoBytes += snapSize(s) })
  }
  _undoBytesDirty = false
}

function totalUndoBytes(): number { if (_undoBytesDirty) _recalcUndoBytes(); return _totalUndoBytes }

function evictOldestUndo() {
  const undo = useUndoStore()
  let oldestGid: string | null = null
  for (const gid in undo.stacks) {
    const st = undo.stacks[gid]
    if (st.undo && st.undo.length) { if (!oldestGid || gid < oldestGid) { oldestGid = gid } }
  }
  if (oldestGid && undo.stacks[oldestGid].undo.length) {
    _totalUndoBytes -= snapSize(undo.stacks[oldestGid].undo[0])
    undo.stacks[oldestGid].undo.shift()
    if (!undo.stacks[oldestGid].undo.length && !undo.stacks[oldestGid].redo.length) { delete undo.stacks[oldestGid] }
  }
}

export function pushUndo(gid: string) {
  if (_restoring) return  // suppress during programmatic restore
  const store = useAppStore()
  const undo = useUndoStore()
  const sg = store.groupMap[gid]
  if (!sg) return
  const stack = undo.ensureStack(gid)
  if (undo.timers[gid]) { clearTimeout(undo.timers[gid]) }
  else {
    if (stack.redo.length) {
      stack.redo.forEach(function (s) { _totalUndoBytes -= snapSize(s) })
    }
    stack.redo = []
    if (stack.undo.length >= MAX_UNDO) {
      _totalUndoBytes -= snapSize(stack.undo[0])
      stack.undo.shift()
    }
    const newSnap: UndoSnapshot = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() }
    stack.undo.push(newSnap)
    _totalUndoBytes += snapSize(newSnap)
    while (totalUndoBytes() > MAX_UNDO_BYTES && stack.undo.length > 1) {
      evictOldestUndo()
    }
  }
  undo.timers[gid] = setTimeout(function () { delete undo.timers[gid] }, UNDO_WINDOW)
  if (undo.onPushCallback) undo.onPushCallback(gid)
}

export function restoreSnapshot(gid: string, snap: UndoSnapshot) {
  const store = useAppStore()
  const sg = store.groupMap[gid]
  if (!sg) return
  sg.bookmarkIds = snap.bookmarkIds.filter(function (bid) {
    return store.bookmarkMap[bid]
  })
  sg.notes = snap.notes
  // Sync TipTap editor if it's mounted (visible group)
  const ed = EditorManager.get(gid)
  if (ed) {
    _restoring = true
    try { ed.commands.setContent(sg.notes || '') }
    finally { _restoring = false }
  }
  // If no editor (group not visible), Vue reactivity renders sg.notes on next mount
}

export function performUndo(gid: string): boolean {
  const store = useAppStore()
  const undo = useUndoStore()
  const stack = undo.stacks[gid]
  if (!stack || !stack.undo.length) return false
  const sg = store.groupMap[gid]
  if (!sg) return false
  // sg.notes is always current — GroupEditor.syncToStore runs on every onUpdate
  // Capture the latest from editor if available (handles edge case of rapid typing)
  const editorHTML = EditorManager.getContentHTML(gid)
  if (editorHTML !== null) sg.notes = editorHTML
  if (stack.redo.length >= MAX_UNDO) {
    _totalUndoBytes -= snapSize(stack.redo[0])
    stack.redo.shift()
  }
  const redoSnap: UndoSnapshot = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() }
  stack.redo.push(redoSnap)
  _totalUndoBytes += snapSize(redoSnap)
  const snap = stack.undo.pop()!
  _totalUndoBytes -= snapSize(snap)
  restoreSnapshot(gid, snap)
  store.debouncedSave()
  toastAPI?.toast('已撤销')
  return true
}

export function performRedo(gid: string): boolean {
  const store = useAppStore()
  const undo = useUndoStore()
  const stack = undo.stacks[gid]
  if (!stack || !stack.redo || !stack.redo.length) return false
  const sg = store.groupMap[gid]
  if (!sg) return false
  const editorHTML = EditorManager.getContentHTML(gid)
  if (editorHTML !== null) sg.notes = editorHTML
  if (stack.undo.length >= MAX_UNDO) {
    _totalUndoBytes -= snapSize(stack.undo[0])
    stack.undo.shift()
  }
  const undoSnap: UndoSnapshot = { notes: sg.notes, bookmarkIds: sg.bookmarkIds.slice() }
  stack.undo.push(undoSnap)
  _totalUndoBytes += snapSize(undoSnap)
  const snap = stack.redo.pop()!
  _totalUndoBytes -= snapSize(snap)
  restoreSnapshot(gid, snap)
  store.debouncedSave()
  toastAPI?.toast('已前进')
  return true
}
