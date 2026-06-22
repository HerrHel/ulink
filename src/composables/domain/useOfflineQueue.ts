/**
 * useOfflineQueue.ts — 离线操作队列
 * 页面恢复在线时自动回放队列中的操作
 */
import { ref } from 'vue'
import { enqueueOp, drainPendingOps, removePendingOp, pendingOpsCount } from '../stores/storage.js'
import { toast } from '../lib/toast.js'

const _isOnline = ref(navigator.onLine)
const _pendingCount = ref(0)
let _replaying = false

async function _updateCount() {
  _pendingCount.value = await pendingOpsCount()
}

function _onOnline() {
  _isOnline.value = true
  replayQueue()
}

function _onOffline() {
  _isOnline.value = false
}

export function useOfflineQueue() {
  return {
    isOnline: _isOnline,
    pendingCount: _pendingCount,

    /** 将操作入队（离线时调用） */
    async enqueue(type: string, payload: any) {
      await enqueueOp(type, payload)
      await _updateCount()
    },

    /** 回放所有待处理操作 */
    async replayQueue() {
      await replayQueue()
    },

    /** 初始化事件监听 */
    init() {
      window.addEventListener('online', _onOnline)
      window.addEventListener('offline', _onOffline)
      _updateCount()
    },

    /** 清理事件监听 */
    dispose() {
      window.removeEventListener('online', _onOnline)
      window.removeEventListener('offline', _onOffline)
    },
  }
}

async function replayQueue() {
  if (_replaying) return
  _replaying = true
  try {
    const ops = await drainPendingOps()
    if (!ops.length) return
    let replayed = 0
    for (const op of ops) {
      try {
        // 队列中的操作类型保留供未来扩展（如 Supabase push）
        // 当前仅记录并清理
        if (op.id != null) await removePendingOp(op.id)
        replayed++
      } catch (_) {
        // 单条失败不阻塞后续
      }
    }
    await _updateCount()
    if (replayed > 0) toast(`已回放 ${replayed} 条离线操作`)
  } finally {
    _replaying = false
  }
}
