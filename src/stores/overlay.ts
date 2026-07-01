/**
 * overlay.ts — 覆盖层状态 Store 集合
 *
 * 从 app.ts/ui.ts 拆分而来，每个覆盖层独立 Store。
 * mentionStore 接管 ui.ts 的 mention* 字段。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useBatchMoveStore = defineStore('batchMove', () => {
  const open = ref(false)
  function show() { open.value = true }
  function hide() { open.value = false }
  return { open, show, hide }
})

export const useMfbStore = defineStore('mfb', () => {
  const open = ref(false)
  function show() { open.value = true }
  function hide() { open.value = false }
  return { open, show, hide }
})

export const useMentionStore = defineStore('mention', () => {
  /** 目标分组 ID（为哪个组添加提及） */
  const gid = ref<string | null>(null)
  /** 搜索关键词 */
  const query = ref('')
  /** 当前选中的索引 */
  const idx = ref(0)
  /** 是否激活 */
  const active = ref(false)
  /** 搜索类型：书签 / 分组 */
  const type = ref<'bm' | 'group'>('bm')
  /** 子模式切换 */
  const subMode = ref(false)
  /** 子模式索引 */
  const subIdx = ref(0)

  function open(gidVal: string | null = null) {
    gid.value = gidVal
    active.value = true
    query.value = ''
    idx.value = 0
    subMode.value = false
    subIdx.value = 0
  }

  function hide() {
    active.value = false
    gid.value = null
    query.value = ''
    idx.value = 0
    subMode.value = false
    subIdx.value = 0
  }

  function setQuery(q: string) { query.value = q; idx.value = 0 }
  function setIdx(i: number) { idx.value = i }
  function setType(t: 'bm' | 'group') { type.value = t }

  return {
    gid, query, idx, active, type, subMode, subIdx,
    open, hide, setQuery, setIdx, setType,
  }
})

export const useSyncStatusStore = defineStore('syncStatus', () => {
  const open = ref(false)
  function show() { open.value = true }
  function hide() { open.value = false }
  return { open, show, hide }
})
