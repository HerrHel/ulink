/**
 * #44：「清空所有会话」不清 deletedForUndo / undoBatchTimer / 残留 undo toast，
 * 点旧 toast 撤销会复活已清空会话。清空前须清理撤销栈并 dismiss toast。
 *
 * chatSessions.js / toast.js 用内存桩；mount 一个 defineComponent 提供组件实例
 * （useAiChatSessions 内有 onUnmounted，需实例上下文）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const toastWithUndoMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: toastWithUndoMock,
  showConfirm: vi.fn(async () => true),
}))
const dismissUndoMock = vi.hoisted(() => vi.fn())
vi.mock('../../stores/toast.js', () => ({
  useToastStore: () => ({ dismissUndo: dismissUndoMock }),
}))

const disk = vi.hoisted(() => ({ sessions: [] as any[] }))
vi.mock('../../lib/ai/chatSessions.js', () => ({
  loadSessions: () => [...disk.sessions],
  saveSessions: (s: any[]) => { disk.sessions = [...s] },
  createNewSession: () => ({ id: 'new-' + Math.random().toString(36).slice(2, 7), title: '', turns: [], createdAt: 1, updatedAt: 1 }),
  updateSession: () => [...disk.sessions],
  renameSession: () => [...disk.sessions],
  deleteSessionById: (id: string) => { disk.sessions = disk.sessions.filter((s) => s.id !== id); return [...disk.sessions] },
  clearAllSessions: () => { disk.sessions = [] },
  getCurrentSessionId: () => disk.sessions[0]?.id ?? '',
  setCurrentSessionId: () => {},
  isDefaultSessionTitle: () => true,
  setSessionStorageErrorHandler: () => {},
}))

import { useAiChatSessions } from '../../composables/domain/useAiChatSessions.js'

function makeHarness() {
  let api!: ReturnType<typeof useAiChatSessions>
  const Comp = defineComponent({
    setup() {
      api = useAiChatSessions({
        aiQuery: ref(''),
        aiLoading: ref(false),
        t: ((k: string) => k) as never,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Comp)
  return { api, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  disk.sessions = [{
    id: 's1', title: '会话1',
    turns: [{ id: 't1', role: 'user', content: 'hi', timestamp: 1 }],
    createdAt: 1, updatedAt: 1,
  }]
})

describe('清空所有会话清理撤销栈（#44）', () => {
  it('清空前清空 deletedForUndo、clearTimeout 并 dismiss undo toast；残留 toast 撤销不复活会话', async () => {
    const { api, wrapper } = makeHarness()
    // 先删一个会话，产生带 undoFn 的 toast
    await api.handleDeleteSession(api.currentSessionId.value)
    expect(toastWithUndoMock).toHaveBeenCalledTimes(1)
    const undoFn = toastWithUndoMock.mock.calls[0][1] as () => void

    await api.handleClearAllSessions()
    expect(dismissUndoMock).toHaveBeenCalledTimes(1)

    // 即便用户点了清空前残留的旧 undo toast，也不应把已清空会话写回磁盘
    undoFn()
    expect(disk.sessions.some((s) => s.id === 's1')).toBe(false)
    wrapper.unmount()
  })
})
