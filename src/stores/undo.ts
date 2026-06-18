import { defineStore } from 'pinia'
import { useDataStore } from './data.js'

interface UndoSnapshot {
  notes: string
  bookmarkIds: string[]
}

interface UndoStack {
  undo: UndoSnapshot[]
  redo: UndoSnapshot[]
}

interface UndoState {
  stacks: Record<string, UndoStack>
  timers: Record<string, ReturnType<typeof setTimeout>>
  saveTimers: Record<string, ReturnType<typeof setTimeout>>
  onPushCallback: ((gid: string) => void) | null
}

/**
 * Undo store — manages undo/redo stacks per group.
 */
export const useUndoStore = defineStore('undo', {
  state: (): UndoState => ({
    stacks: {},
    timers: {},
    saveTimers: {},
    onPushCallback: null,
  }),

  getters: {
    canUndo: (state) => (gid: string): boolean => {
      const s = state.stacks[gid]
      return !!(s && s.undo && s.undo.length > 0)
    },
    canRedo: (state) => (gid: string): boolean => {
      const s = state.stacks[gid]
      return !!(s && s.redo && s.redo.length > 0)
    },
  },

  actions: {
    ensureStack(gid: string): UndoStack {
      if (!this.stacks[gid]) this.stacks[gid] = { undo: [], redo: [] }
      return this.stacks[gid]
    },

    clearStack(gid: string) {
      delete this.stacks[gid]
      if (this.timers[gid]) { clearTimeout(this.timers[gid]); delete this.timers[gid] }
    },

    cleanStale() {
      const ds = useDataStore()
      for (const gid in this.stacks) {
        if (!ds.groupMap[gid]) {
          this.clearStack(gid)
        }
      }
    },
  },
})
