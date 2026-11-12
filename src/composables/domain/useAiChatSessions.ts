/**
 * useAiChatSessions.ts — AI 多会话管理（自 useAiChat.ts 纯搬运拆出）
 * 职责：
 * 1. 多会话状态与初始化（创建/切换/删除/清空/持久化、空会话自动清理）；
 * 2. 在途检索中止（abortInFlight）与停止生成；
 * 3. 终止态收尾（思考气泡置停、会话持久化）。
 * 共享状态（aiQuery/aiLoading/在途控制器槽位）由 useAiChat Facade 显式注入，
 * 不建模块级单例；行为与拆分前逐字一致。
 */
import { computed, onUnmounted, ref, type Ref } from 'vue'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import {
  loadSessions,
  saveSessions,
  createNewSession,
  updateSession,
  renameSession,
  deleteSessionById,
  clearAllSessions,
  getCurrentSessionId,
  setCurrentSessionId,
  isDefaultSessionTitle,
  setSessionStorageErrorHandler,
  type AiChatSession,
  type ChatTurn,
} from '../../lib/ai/chatSessions.js'
import type { useI18n } from '../../i18n/index.js'

/** 在途请求控制器槽位：请求编排层写入/接管，本层负责中止（等同原模块内 let 变量的可变句柄） */
export interface AbortControllerSlot {
  current: AbortController | null
}

/** 本层依赖的共享状态与 UI 回调（由 useAiChat Facade 注入） */
export interface AiChatSessionsContext {
  aiQuery: Ref<string>
  aiLoading: Ref<boolean>
  t: ReturnType<typeof useI18n>['t']
  /** 对话轮次变化后需要滚动到底部时回调 */
  onTurnsChanged?: () => void
  /** aiQuery 被代码改写后回调（供调用方重置输入框高度） */
  onQueryChanged?: () => void
  /** 需要聚焦输入框时回调 */
  focusInput?: () => void
  /** 收起会话历史下拉菜单时回调 */
  closeSessionMenu?: () => void
}

export function useAiChatSessions(context: AiChatSessionsContext) {
  const { aiQuery, aiLoading, t, onTurnsChanged, onQueryChanged, focusInput, closeSessionMenu } = context

  // 写盘失败不能只 console.error：界面看起来正常、刷新却丢整段，必须让用户看见
  setSessionStorageErrorHandler(() => toast(t('ai.sessionStorageWriteFailed'), false))

  /**
   * 单次撤销窗口内被删的所有会话。toastWithUndo 是单例（第二次会顶掉第一次），
   * 但闭包持有同一个数组，所以最后一次 toast 的撤销能一次性恢复全部，不再丢数据。
   */
  const deletedForUndo: AiChatSession[] = []
  let undoBatchTimer: ReturnType<typeof setTimeout> | null = null

  // ── 多会话管理 (方案 A) ──
  const sessions = ref<AiChatSession[]>(loadSessions())
  const currentSessionId = ref<string>(getCurrentSessionId() || '')
  const chatTurns = ref<ChatTurn[]>([])

  const isCurrentSessionEmpty = computed(() => chatTurns.value.length === 0)

  // 初始化当前会话
  if (!currentSessionId.value || !sessions.value.some((s) => s.id === currentSessionId.value)) {
    if (sessions.value.length > 0) {
      currentSessionId.value = sessions.value[0].id
      setCurrentSessionId(sessions.value[0].id)
      chatTurns.value = [...sessions.value[0].turns]
    } else {
      const fresh = createNewSession()
      currentSessionId.value = fresh.id
      sessions.value = [fresh]
      chatTurns.value = []
    }
  } else {
    const cur = sessions.value.find((s) => s.id === currentSessionId.value)
    if (cur) chatTurns.value = [...cur.turns]
  }

  // 自动清理历史中非当前会话的无内容空会话，保持会话列表整洁
  if (sessions.value.length > 1) {
    const cleaned = sessions.value.filter(
      (s) => s.id === currentSessionId.value || s.turns.length > 0,
    )
    if (cleaned.length !== sessions.value.length) {
      saveSessions(cleaned)
      sessions.value = cleaned
    }
  }

  const currentSessionTitle = computed(() => {
    const s = sessions.value.find((x) => x.id === currentSessionId.value)
    if (!s || isDefaultSessionTitle(s.title)) return t('ai.sessionDefaultTitle')
    return s.title
  })

  /** 手动重命名当前/指定会话；空标题 = 用内存首问恢复自动命名 */
  function handleRenameSession(id: string, title: string, fallbackQuery?: string) {
    if (!id) return
    sessions.value = renameSession(id, title, fallbackQuery)
  }

  // ── 停止生成 ──
  const abortSlot: AbortControllerSlot = { current: null }

  /** 持久化当前会话；会话可能已被删除，守卫防 updateSession 重建已删会话 */
  function persistCurrentSession() {
    if (currentSessionId.value && sessions.value.some((s) => s.id === currentSessionId.value)) {
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    }
  }

  /** 中止在途检索并收尾：终止请求、收起思考气泡、持久化当前会话（停止按钮/切会话/新建会话共用） */
  function abortInFlight() {
    if (abortSlot.current) {
      abortSlot.current.abort()
      abortSlot.current = null
    }
    aiLoading.value = false
    const last = chatTurns.value[chatTurns.value.length - 1]
    if (last && last.role === 'assistant' && last.loading) {
      last.loading = false
      last.isThinking = false
      if (!last.content && !last.reasoning) {
        last.content = t('ai.stopped')
      }
    }
    persistCurrentSession()
  }

  function handleStopGenerating() {
    abortInFlight()
    onTurnsChanged?.()
  }

  function handleCreateSession() {
    // 若当前已经是新会话且已有空会话存在，不再重复创建新会话
    if (isCurrentSessionEmpty.value && sessions.value.length > 0) {
      closeSessionMenu?.()
      focusInput?.()
      return
    }
    abortInFlight()
    const fresh = createNewSession()
    currentSessionId.value = fresh.id
    sessions.value = loadSessions()
    chatTurns.value = []
    aiQuery.value = ''
    closeSessionMenu?.()
    onQueryChanged?.()
    focusInput?.()
  }

  function switchSession(id: string) {
    if (id === currentSessionId.value) {
      closeSessionMenu?.()
      return
    }
    // 离开前中止在途检索并持久化旧会话（含被停止的思考气泡），防悬挂气泡被带走/丢失
    abortInFlight()
    // 若离开当前会话时，当前会话未产生任何问答，自动清理此空会话，防止残留无用草稿
    if (chatTurns.value.length === 0 && currentSessionId.value) {
      deleteSessionById(currentSessionId.value)
      sessions.value = loadSessions()
    }
    const target = sessions.value.find((s) => s.id === id)
    if (!target) return
    currentSessionId.value = id
    setCurrentSessionId(id)
    chatTurns.value = [...target.turns]
    closeSessionMenu?.()
    onTurnsChanged?.()
    focusInput?.()
  }

  async function handleDeleteSession(id: string) {
    const isCurrent = currentSessionId.value === id
    // 非当前会话的磁盘副本可能落后，先同步一次；当前会话直接用内存 chatTurns 备份，
    // 否则「生成中删除再撤销」会恢复成空/旧会话。
    if (!isCurrent) persistCurrentSession()
    const target = sessions.value.find((s) => s.id === id)
    if (!target) return
    const title = target.title || t('ai.thisSession')

    const backupSession: AiChatSession = {
      ...target,
      turns: (isCurrent ? chatTurns.value : target.turns).map((turn) => ({ ...turn })),
    }
    sessions.value = deleteSessionById(id)
    if (isCurrent) {
      if (sessions.value.length > 0) {
        switchSession(sessions.value[0].id)
      } else {
        handleCreateSession()
      }
    }

    deletedForUndo.push(backupSession)
    if (undoBatchTimer) clearTimeout(undoBatchTimer)
    undoBatchTimer = setTimeout(() => {
      deletedForUndo.length = 0
      undoBatchTimer = null
    }, 6500)

    const msg = deletedForUndo.length > 1
      ? t('ai.sessionDeletedMany', { n: deletedForUndo.length })
      : t('ai.sessionDeleted', { title })
    toastWithUndo(msg, () => {
      const all = loadSessions()
      for (const backup of deletedForUndo) {
        if (!all.some((s) => s.id === backup.id)) all.unshift(backup)
      }
      saveSessions(all)
      const firstId = deletedForUndo[0]?.id
      deletedForUndo.length = 0
      if (undoBatchTimer) clearTimeout(undoBatchTimer)
      undoBatchTimer = null
      sessions.value = loadSessions()
      if (firstId) switchSession(firstId)
    })
  }

  async function handleClearAllSessions() {
    closeSessionMenu?.()
    const ok = await showConfirm(t('ai.clearAllConfirm'))
    if (!ok) return

    clearAllSessions()
    sessions.value = []
    handleCreateSession()
    toast(t('ai.clearedAllToast'), true)
  }

  // AiWorkspace 与 DetailPanel 各持一份本 composable；切视图时旧组件卸载，
  // 若不中止在途请求，旧实例的 finally 会用旧 chatTurns 覆盖磁盘。
  onUnmounted(() => {
    if (abortSlot.current) {
      abortSlot.current.abort()
      abortSlot.current = null
    }
    if (chatTurns.value.length > 0) persistCurrentSession()
    if (undoBatchTimer) clearTimeout(undoBatchTimer)
  })

  return {
    sessions,
    currentSessionId,
    chatTurns,
    isCurrentSessionEmpty,
    currentSessionTitle,
    persistCurrentSession,
    abortSlot,
    abortInFlight,
    handleStopGenerating,
    handleCreateSession,
    switchSession,
    handleRenameSession,
    handleDeleteSession,
    handleClearAllSessions,
  }
}
