import { defineStore } from 'pinia'

/**
 * Undo store — manages undo/redo stacks per group.
 */
export const useUndoStore = defineStore('undo', {
  state: () => ({
    stacks: {},    // { gid: { undo: [snap, ...], redo: [snap, ...] } }
    timers: {},    // { gid: timeoutId }  — debounce window for grouping edits
    saveTimers: {}, // { gid: timeoutId } — debounce for editor save
    onPushCallback: null, // callback invoked after push (for UI updates)
  }),

  getters: {
    canUndo: (state) => (gid) => {
      const s = state.stacks[gid]
      return !!(s && s.undo && s.undo.length > 0)
    },
    canRedo: (state) => (gid) => {
      const s = state.stacks[gid]
      return !!(s && s.redo && s.redo.length > 0)
    },
  },

  actions: {
    ensureStack(gid) {
      if (!this.stacks[gid]) this.stacks[gid] = { undo: [], redo: [] }
      return this.stacks[gid]
    },

    clearStack(gid) {
      delete this.stacks[gid]
      if (this.timers[gid]) { clearTimeout(this.timers[gid]); delete this.timers[gid] }
    },

    cleanStale(appStore) {
      for (const gid in this.stacks) {
        if (!appStore.groupMap[gid]) {
          this.clearStack(gid)
        }
      }
    },
  },
})
