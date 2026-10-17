/**
 * useAiChat.ts — AI 侧边栏调度逻辑（自 DetailPanel.vue 纯搬运抽出）
 * 职责：
 * 1. 多会话状态与管理（创建/切换/删除/清空/持久化）；
 * 2. AI 请求状态（输入、加载态文案、检索偏好）与核心提交调度（视频/网址/自然语言分流、
 *    MiMo Tool Calling 循环、role:'tool' 续轮、history 还原工具链、本地知识库兜底）；
 * 3. 行动卡片（Action Card）执行与候选多选微操；
 * 4. 斜杠指令快捷联想与空态情境提示。
 * 仅含数据与调度，不碰任何 DOM：滚动到底、输入框聚焦/高度、会话菜单收起、切回对话 tab
 * 等 UI 副作用由 DetailPanel 通过回调注入（见 UseAiChatOptions），行为与抽取前逐字一致。
 */
import { computed, ref } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { domain } from '../../utils.js'
import { useI18n } from '../../i18n/index.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'
import { askMiMoStream, getMiMoConfig, sanitizeToolResult, type MiMoChatMessage } from '../../lib/ai/mimoClient.js'
import {
  dispatchSiteCommand,
  mergeDuplicateBookmarks,
  applyInboxZeroClustering,
  createTopicWorkspace,
  healDeadlink,
} from '../../lib/ai/siteCommander.js'
import { candidateToBookmark } from '../../lib/ai/candidateSave.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { saveAppData } from '../../stores/app.js'
import {
  loadSessions,
  saveSessions,
  createNewSession,
  updateSession,
  deleteSessionById,
  clearAllSessions,
  getCurrentSessionId,
  setCurrentSessionId,
  type AiChatSession,
  type ChatTurn,
  type ChatActionCard,
} from '../../lib/ai/chatSessions.js'
import type { AiSearchPreference } from '../../types/ai.js'

/** 行动卡片 payload 内的候选条目（与原 DetailPanel 内联 any 形态一致） */
interface ActionCardCandidate {
  title: string
  url: string
  [key: string]: unknown
}

/** 斜杠指令项（title/desc 由 titleKey/descKey 经 t() 渲染） */
interface SlashCommandItem {
  cmd: string
  titleKey: string
  descKey: string
}

/** 空态快捷提示项 */
interface QuickHint {
  label: string
  query: string
}

/** useAiChat 可选回调：全部为 UI 侧（DetailPanel）注入的副作用钩子，composable 不碰 DOM */
export interface UseAiChatOptions {
  /** 对话轮次变化后需要滚动到底部时回调（handleAiSubmit / handleActionCardClick / handleStopGenerating / switchSession 收尾处） */
  onTurnsChanged?: () => void
  /** aiQuery 被代码改写后回调（供调用方重置输入框高度） */
  onQueryChanged?: () => void
  /** 需要聚焦输入框时回调（新建/切换会话、撤回消息、斜杠补全后） */
  focusInput?: () => void
  /** 收起会话历史下拉菜单时回调 */
  closeSessionMenu?: () => void
  /** 提交对话需切回「对话」tab 时回调 */
  showAiTab?: () => void
}

export function useAiChat(options: UseAiChatOptions = {}) {
  const { onTurnsChanged, onQueryChanged, focusInput, closeSessionMenu, showAiTab } = options

  const { t, tN, locale } = useI18n()
  const isZh = computed(() => locale.value.startsWith('zh'))

  const ui = useUIStore()
  const ds = useDataStore()

  // ── AI 请求状态 ──
  const aiQuery = ref('')
  const aiLoading = ref(false)
  // 加载态提示按分流切换：思考中 → 甄选/分析/提炼中
  const loadingTextKey = ref('ai.thinking')
  const loadingText = computed(() => t(loadingTextKey.value))
  // 默认采用最佳偏好（完全免费 + 国内直连），无需用户在界面手动配置
  const preferences = ref<AiSearchPreference[]>(['free', 'no_proxy'])

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
    if (!s || s.title === '新会话') return t('ai.sessionDefaultTitle')
    return s.title
  })

  // ── 终端式命令历史回溯 (↑ / ↓) 状态（handleAiSubmit 记录，DetailPanel.handleKeyDown 回溯）──
  const inputHistory = ref<string[]>([])
  const historyCursor = ref(-1)
  const tempInput = ref('')

  // ── 停止生成 ──
  let currentAbortController: AbortController | null = null

  /** 持久化当前会话；会话可能已被删除，守卫防 updateSession 重建已删会话 */
  function persistCurrentSession() {
    if (currentSessionId.value && sessions.value.some((s) => s.id === currentSessionId.value)) {
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    }
  }

  /** 中止在途检索并收尾：终止请求、收起思考气泡、持久化当前会话（停止按钮/切会话/新建会话共用） */
  function abortInFlight() {
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
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
    const target = sessions.value.find((s) => s.id === id)
    if (!target) return
    const title = target.title || t('ai.thisSession')
    closeSessionMenu?.()
    const ok = await showConfirm(t('ai.deleteSessionConfirm', { title }))
    if (!ok) return

    const backupSession: AiChatSession = {
      ...target,
      turns: target.turns.map((turn) => ({ ...turn })),
    }
    sessions.value = deleteSessionById(id)
    if (currentSessionId.value === id) {
      if (sessions.value.length > 0) {
        switchSession(sessions.value[0].id)
      } else {
        handleCreateSession()
      }
    }

    toastWithUndo(
      t('ai.sessionDeleted', { title }),
      () => {
        const all = loadSessions()
        all.unshift(backupSession)
        saveSessions(all)
        sessions.value = loadSessions()
        switchSession(backupSession.id)
      },
    )
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

  // ── 斜杠指令快捷联想（文案走 i18n，与语言包 slash* 键一一对应）──
  const SLASH_COMMANDS: SlashCommandItem[] = [
    { cmd: '/help', titleKey: 'ai.slashHelpTitle', descKey: 'ai.slashHelpDesc' },
    { cmd: '/health', titleKey: 'ai.slashHealthTitle', descKey: 'ai.slashHealthDesc' },
    { cmd: '/inbox', titleKey: 'ai.slashInboxTitle', descKey: 'ai.slashInboxDesc' },
    { cmd: '/pack', titleKey: 'ai.slashPackTitle', descKey: 'ai.slashPackDesc' },
    { cmd: '/theme', titleKey: 'ai.slashThemeTitle', descKey: 'ai.slashThemeDesc' },
    { cmd: '/view', titleKey: 'ai.slashViewTitle', descKey: 'ai.slashViewDesc' },
    { cmd: '/cat', titleKey: 'ai.slashCatTitle', descKey: 'ai.slashCatDesc' },
    { cmd: '/trash', titleKey: 'ai.slashTrashTitle', descKey: 'ai.slashTrashDesc' },
    { cmd: '/dedup', titleKey: 'ai.slashDedupTitle', descKey: 'ai.slashDedupDesc' },
    { cmd: '/deadlink', titleKey: 'ai.slashDeadlinkTitle', descKey: 'ai.slashDeadlinkDesc' },
    { cmd: '/export', titleKey: 'ai.slashExportTitle', descKey: 'ai.slashExportDesc' },
    { cmd: '/stats', titleKey: 'ai.slashStatsTitle', descKey: 'ai.slashStatsDesc' },
    { cmd: '/undo', titleKey: 'ai.slashUndoTitle', descKey: 'ai.slashUndoDesc' },
    { cmd: '/clean', titleKey: 'ai.slashCleanTitle', descKey: 'ai.slashCleanDesc' },
    { cmd: '/clear', titleKey: 'ai.slashClearTitle', descKey: 'ai.slashClearDesc' },
  ]

  const dynamicQuickHints = computed<QuickHint[]>(() => {
    const hints: QuickHint[] = []

    // 1. 情境感知：若当前聚焦在某个笔记组（工作台）
    if (ui.focusedGroupId && ds.groupMap[ui.focusedGroupId]) {
      const group = ds.groupMap[ui.focusedGroupId]
      const gName = group.name.length > 8 ? group.name.slice(0, 8) + '…' : group.name
      hints.push({
        label: isZh.value ? `📦 扩展「${gName}」工具` : `📦 Tools for ${gName}`,
        query: `/pack ${group.name}`,
      })
      hints.push({
        label: isZh.value ? '🔍 查重清理' : '/dedup',
        query: '/dedup',
      })
    } else if (ui.curCat && ui.curCat !== CAT_ALL && ui.curCat !== CAT_UNCATEGORIZED) {
      // 2. 情境感知：若当前选定了特定分类
      const cat = ds.categories.find((c: any) => !c.deletedAt && c.id === ui.curCat)
      if (cat?.name) {
        const cName = cat.name.length > 8 ? cat.name.slice(0, 8) + '…' : cat.name
        hints.push({
          label: isZh.value ? `📁 探索「${cName}」精选` : `📁 ${cName} tools`,
          query: `/pack ${cat.name}`,
        })
      }
    }

    // 3. 收件箱未分类检测
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId && !b.id.startsWith('bm_ulink_'),
    ).length
    if (uncatCount > 0) {
      hints.push({
        label: isZh.value ? `未分类 (${uncatCount})` : `Uncategorized (${uncatCount})`,
        query: '/inbox',
      })
    } else if (hints.length === 0) {
      hints.push({
        label: isZh.value ? '/health 体检' : '/health',
        query: '/health',
      })
    }

    // 4. 回收站堆积感知
    const trashCount =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: any) => c.deletedAt).length
    if (trashCount > 0 && hints.length < 4) {
      hints.push({
        label: isZh.value ? `回收站 (${trashCount})` : `Trash (${trashCount})`,
        query: '/trash',
      })
    }

    if (hints.length < 4) {
      hints.push({
        label: isZh.value ? '/dedup 查重' : '/dedup',
        query: '/dedup',
      })
    }
    if (hints.length < 4) {
      hints.push({
        label: isZh.value ? '/stats 统计' : '/stats',
        query: '/stats',
      })
    }
    if (hints.length < 4) {
      hints.push({
        label: isZh.value ? '/help 指令' : '/help',
        query: '/help',
      })
    }

    return hints.slice(0, 4)
  })

  function getActionCardNavTarget(card: ChatActionCard): string | null {
    if (card.resultGid && ds.groupMap[card.resultGid]) {
      return card.resultGid
    }
    const payloadGid = (card.payload as any)?.createdGid
    if (payloadGid && ds.groupMap[payloadGid]) {
      return payloadGid
    }
    return null
  }

  function navigateToActionTarget(card: ChatActionCard) {
    const gid = getActionCardNavTarget(card)
    if (!gid) return
    const group = ds.groupMap[gid]
    if (group) {
      if (group.categoryId) {
        ui.curCat = group.categoryId
      }
      ui.focusedGroupId = group.id
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        ui.panels.detail = false
      }
    }
  }

  function getCardCandidateList(card: ChatActionCard): ActionCardCandidate[] {
    const payload = card.payload as any
    if (Array.isArray(payload?.candidates)) {
      return payload.candidates
    }
    return []
  }

  function initCardCandidateSelection(card: ChatActionCard) {
    if (!card.selectedCandidateUrls) {
      const list = getCardCandidateList(card)
      card.selectedCandidateUrls = list.map((c) => c.url).filter(Boolean)
    }
  }

  function isCandidateSelected(card: ChatActionCard, url: string): boolean {
    initCardCandidateSelection(card)
    return card.selectedCandidateUrls?.includes(url) ?? true
  }

  function getSelectedCandidateCount(card: ChatActionCard): number {
    initCardCandidateSelection(card)
    return card.selectedCandidateUrls?.length ?? 0
  }

  function isAllCandidatesSelected(card: ChatActionCard): boolean {
    const all = getCardCandidateList(card)
    if (all.length === 0) return false
    return getSelectedCandidateCount(card) === all.length
  }

  function toggleCandidateSelection(card: ChatActionCard, url: string) {
    if (card.completed || card.executing) return
    initCardCandidateSelection(card)
    const current = card.selectedCandidateUrls || []
    if (current.includes(url)) {
      card.selectedCandidateUrls = current.filter((u) => u !== url)
    } else {
      card.selectedCandidateUrls = [...current, url]
    }
  }

  function toggleSelectAllCandidates(card: ChatActionCard) {
    if (card.completed || card.executing) return
    const all = getCardCandidateList(card)
    if (isAllCandidatesSelected(card)) {
      card.selectedCandidateUrls = []
    } else {
      card.selectedCandidateUrls = all.map((c) => c.url).filter(Boolean)
    }
  }

  function formatDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url.slice(0, 20)
    }
  }

  async function handleActionCardClick(card: ChatActionCard, _turn: ChatTurn) {
    if (card.completed || card.executing) return
    const candidatesInCard = getCardCandidateList(card)
    if (
      card.actionName === 'create_topic_workspace' &&
      candidatesInCard.length > 0 &&
      getSelectedCandidateCount(card) === 0
    ) {
      toast(t('ai.noCandidatesSelected'), false)
      return
    }
    card.executing = true
    try {
      if (card.actionName === 'merge_dedup') {
        const res = await mergeDuplicateBookmarks({ ds, ui, app: (ui as any).app })
        card.completed = true
        toast(res.message, true)
        chatTurns.value.push({
          id: 'turn-' + Date.now() + '-assistant',
          role: 'assistant',
          content: res.message,
          steps: [{ text: `合并了 ${res.mergedCount} 个重复副本`, done: true }],
          timestamp: Date.now(),
        })
        onTurnsChanged?.()
        sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      } else if (card.actionName === 'trash_clear') {
        const res = await dispatchSiteCommand('/trash clear', { ds, ui, app: (ui as any).app })
        if (res.success !== false) {
          card.completed = true
        }
        chatTurns.value.push({
          id: 'turn-' + Date.now() + '-assistant',
          role: 'assistant',
          content: res.reply,
          steps: res.steps,
          timestamp: Date.now(),
        })
        onTurnsChanged?.()
        sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      } else if (card.actionName === 'inbox_zero') {
        const res = await dispatchSiteCommand('/inbox', { ds, ui, app: (ui as any).app })
        chatTurns.value.push({
          id: 'turn-' + Date.now() + '-assistant',
          role: 'assistant',
          content: res.reply,
          steps: res.steps,
          actionCard: res.actionCard,
          timestamp: Date.now(),
        })
        onTurnsChanged?.()
        sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      } else if (card.actionName === 'apply_inbox_zero') {
        const res = await applyInboxZeroClustering({ ds, ui, app: (ui as any).app })
        card.completed = true
        toast(res.message, true)
        chatTurns.value.push({
          id: 'turn-' + Date.now() + '-assistant',
          role: 'assistant',
          content: res.message,
          steps: [{ text: tN('ai.inboxStepDone', res.movedCount, { n: res.movedCount }), done: true }],
          timestamp: Date.now(),
        })
        onTurnsChanged?.()
        sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      } else if (card.actionName === 'create_topic_workspace') {
        const payload = (card.payload || {}) as {
          topic?: string
          candidates?: any[]
          targetCatId?: string
        }
        const rawCandidates = payload.candidates || []
        initCardCandidateSelection(card)
        const selectedUrls = new Set(card.selectedCandidateUrls || [])
        const finalCandidates = rawCandidates.filter((c: any) => selectedUrls.has(c.url))

        const res = await createTopicWorkspace(
          payload.topic || '精选工作台',
          finalCandidates,
          payload.targetCatId,
          { ds, ui, app: (ui as any).app },
        )
        card.completed = true
        if (res.group?.id) {
          card.resultGid = res.group.id
          card.resultCatId = res.group.categoryId
        }
        toast(res.message, true)
        chatTurns.value.push({
          id: 'turn-' + Date.now() + '-assistant',
          role: 'assistant',
          content: res.message,
          steps: res.group
            ? [
                { text: tN('ai.wsStepStore', res.totalBookmarks, { n: res.totalBookmarks }), done: true },
                { text: t('ai.wsStepCreateGroup', { name: res.group.name }), done: true },
                { text: t('ai.wsStepFocus'), done: true },
              ]
            : [],
          timestamp: Date.now(),
        })
        onTurnsChanged?.()
        sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      } else if (card.actionName === 'heal_deadlink') {
        const payload = (card.payload || {}) as {
          deadBmId?: string
          replacement?: any
        }
        if (payload.deadBmId && payload.replacement) {
          const res = await healDeadlink(payload.deadBmId, payload.replacement, {
            ds,
            ui,
            app: (ui as any).app,
          })
          card.completed = true
          toast(res.message, true)
          chatTurns.value.push({
            id: 'turn-' + Date.now() + '-assistant',
            role: 'assistant',
            content: res.message,
            steps: [
              { text: '核验失效死链', done: true },
              { text: `替换为现役平替「${payload.replacement.title}」`, done: true },
            ],
            timestamp: Date.now(),
          })
          onTurnsChanged?.()
          sessions.value = updateSession(currentSessionId.value, chatTurns.value)
        }
      }
    } catch (err: any) {
      console.error('handleActionCardClick error:', err)
      toast(err?.message || '执行失败，请稍后重试', false)
    } finally {
      card.executing = false
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    }
  }

  function revokeUserMessage(turn: ChatTurn) {
    const idx = chatTurns.value.findIndex((t) => t.id === turn.id)
    if (idx === -1) return

    // 1. 将原输入内容填回输入框
    aiQuery.value = turn.content
    onQueryChanged?.()

    // 2. 从对话流中移除该条消息及其伴随的助手回复
    const nextTurn = chatTurns.value[idx + 1]
    const removeCount = nextTurn && nextTurn.role === 'assistant' ? 2 : 1
    chatTurns.value.splice(idx, removeCount)

    // 3. 持久化当前会话
    sessions.value = updateSession(currentSessionId.value, chatTurns.value)

    // 4. 聚焦输入框便于修改重发（视觉状态已清晰直达，无需全局弹窗阻断）
    focusInput?.()
  }

  /** 检索结果摘要：0 结果时改用空态引导文案，避免「甄选到 0 个」；
   *  全为通用兜底入口时不冒充个性化「甄选」，如实标注非个性化结果 */
  function formatFoundCount(n: number, videoTitle?: string, items?: Array<{ generic?: boolean }>): string {
    if (n <= 0) return t('ai.emptyResultsHint')
    const base = items && items.length > 0 && items.every((c) => c.generic)
      ? t('ai.foundCountFallback', { n })
      : t('ai.foundCountGeneric', { n })
    return videoTitle ? `${videoTitle} (${base})` : base
  }

  /** 核心提交分流：自动识别视频 / 网址 / 自然语言需求 */
  async function handleAiSubmit() {
    const raw = aiQuery.value.trim()
    if (!raw || aiLoading.value) return

    if (raw === '/clear') {
      handleCreateSession()
      return
    }

    showAiTab?.()
    aiLoading.value = true
    loadingTextKey.value = 'ai.thinking'
    aiQuery.value = ''
    onQueryChanged?.()

    const turnId = 'turn-' + Date.now()
    chatTurns.value.push({
      id: turnId + '-user',
      role: 'user',
      content: raw,
      timestamp: Date.now(),
    })

    const assistantTurn: ChatTurn = {
      id: turnId + '-assistant',
      role: 'assistant',
      content: '',
      reasoning: '',
      reasoningTimeMs: 0,
      isThinking: false,
      _thinkingOpen: true,
      loading: true,
      candidates: [],
      timestamp: Date.now(),
    }
    chatTurns.value.push(assistantTurn)
    onTurnsChanged?.()

    // 捕获局部 controller 引用：handleStopGenerating 会把 currentAbortController 置 null，
    // 在途代码必须读自己的 controller.signal，否则「停止生成」实际不生效
    const controller = new AbortController()
    currentAbortController = controller

    try {
      // 优先尝试站内指令/In-App Agent CLI 调度
      const siteCmd = await dispatchSiteCommand(raw, { ds, ui, app: (ui as any).app })
      if (siteCmd.handled) {
        assistantTurn.loading = false
        assistantTurn.content = siteCmd.reply
        assistantTurn.steps = siteCmd.steps
        assistantTurn.actionCard = siteCmd.actionCard
        return
      }

      const isVideo = /bilibili\.com|b23\.tv|douyin\.com|tiktok\.com|xiaohongshu\.com|xhslink\.com/.test(raw)
      const isUrl = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/.test(raw)
      loadingTextKey.value = isVideo ? 'ai.extracting' : isUrl ? 'ai.analyzing' : 'ai.searching'

      if (isVideo) {
        const res = await extractBookmarksFromVideo(raw, ds.categories, ds.customAttributes)
        if (controller.signal.aborted) return
        assistantTurn.loading = false
        assistantTurn.candidates = res.bookmarks
        assistantTurn.content = formatFoundCount(res.bookmarks.length, res.videoTitle, res.bookmarks)
      } else if (isUrl) {
        const res = await findSimilarWebsites(raw, domain(raw), preferences.value, ds.categories, ds.customAttributes)
        if (controller.signal.aborted) return
        assistantTurn.loading = false
        assistantTurn.candidates = res
        assistantTurn.content = formatFoundCount(res.length, undefined, res)
      } else {
        const mimoConf = getMiMoConfig()
        let mimoSuccess = false

        if (mimoConf.enabled) {
          try {
            const history: MiMoChatMessage[] = []
            for (const t of chatTurns.value) {
              if (t.loading || t.id === assistantTurn.id) continue
              if (t.role === 'user') {
                if (t.content) history.push({ role: 'user', content: t.content })
                continue
              }
              // assistant 轮：无工具链则直接回传文本；有工具链则还原
              // assistant(tool_calls) → tool(结果) → assistant(续轮结论) 的协议序列，
              // 多轮对话不再对已执行的工具结果失忆
              if (t.toolCalls?.length && t.toolResults?.length) {
                history.push({
                  role: 'assistant',
                  content: t.preToolContent || '',
                  tool_calls: t.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) },
                  })),
                })
                for (const r of t.toolResults) {
                  history.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.resultText })
                }
                if (t.content) history.push({ role: 'assistant', content: t.content })
              } else if (t.content) {
                history.push({ role: 'assistant', content: t.content })
              }
            }

            let thinkingStartTime = 0

            // 动态构建情境切片 (Dynamic Context Slice)
            let focusedGroupName: string | undefined
            let focusedGroupBookmarks: Array<{ title: string; url: string }> | undefined
            if (ui.focusedGroupId && ds.groupMap[ui.focusedGroupId]) {
              const grp = ds.groupMap[ui.focusedGroupId]
              focusedGroupName = grp.name
              focusedGroupBookmarks = (grp.bookmarkIds || [])
                .map((id: string) => ds.bookmarkMap[id])
                .filter((b: any) => b && !b.deletedAt)
                .slice(0, 10)
                .map((b: any) => ({ title: b.title, url: b.url }))
            }

            let currentCategoryName: string | undefined
            if (ui.curCat && ui.curCat !== 'all' && ui.curCat !== 'uncategorized') {
              const cat = ds.categories.find((c: any) => c.id === ui.curCat && !c.deletedAt)
              if (cat) currentCategoryName = cat.name
            }

            let selectedBookmarks: Array<{ title: string; url: string }> | undefined
            if (ui.batchMode && ui.batchSelected?.length) {
              selectedBookmarks = ui.batchSelected
                .map((id: string) => ds.bookmarkMap[id])
                .filter((b: any) => b && !b.deletedAt)
                .slice(0, 8)
                .map((b: any) => ({ title: b.title, url: b.url }))
            }

            const mimoRes = await askMiMoStream(
              raw,
              {
                categories: ds.categories,
                customAttributes: ds.customAttributes,
                isZh: isZh.value,
                signal: controller.signal,
                history,
                contextSlice: {
                  currentCategoryName,
                  focusedGroupName,
                  focusedGroupBookmarks,
                  selectedBookmarks,
                },
              },
              {
                onReasoningDelta(_delta, accumulatedReasoning) {
                  if (controller.signal.aborted) return
                  if (!thinkingStartTime) {
                    thinkingStartTime = Date.now()
                    assistantTurn.isThinking = true
                    assistantTurn._thinkingOpen = true
                  }
                  assistantTurn.reasoning = accumulatedReasoning
                  onTurnsChanged?.()
                },
                onContentDelta(_delta, accumulatedContent) {
                  if (controller.signal.aborted) return
                  if (assistantTurn.isThinking) {
                    assistantTurn.isThinking = false
                    assistantTurn.reasoningTimeMs = Date.now() - (thinkingStartTime || Date.now())
                    // 正式回答开始流出时，默认折叠思考过程，让出核心视线（用户可随时点击展开）
                    assistantTurn._thinkingOpen = false
                  }
                  assistantTurn.content = accumulatedContent
                  onTurnsChanged?.()
                },
              }
            )

            if (controller.signal.aborted) return
            assistantTurn.loading = false
            assistantTurn.isThinking = false
            if (thinkingStartTime && !assistantTurn.reasoningTimeMs) {
              assistantTurn.reasoningTimeMs = Date.now() - thinkingStartTime
            }
            assistantTurn.content = mimoRes.reply
            assistantTurn.reasoning = mimoRes.reasoning || assistantTurn.reasoning
            assistantTurn.candidates = mimoRes.candidates
            assistantTurn.steps = [{ text: `小米 ${mimoRes.model} 推理完成`, done: true }]

            // 核心：若大模型自主触发了标准 Tool Calling (Function Calling)，即刻调度并挂载行动卡片
            if (mimoRes.toolCalls?.length) {
              const toolResults: Array<{ id: string; name: string; resultText: string }> = []
              for (const call of mimoRes.toolCalls) {
                assistantTurn.steps.push({ text: t('ai.toolCallStep', { name: call.name }), done: true })
                let resultText = ''
                if (call.name === 'audit_vault') {
                  const siteRes = await dispatchSiteCommand('/health', { ds, ui, app: (ui as any).app })
                  if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                  if (!assistantTurn.content) assistantTurn.content = siteRes.reply
                  resultText = siteRes.reply
                } else if (call.name === 'inbox_zero') {
                  const siteRes = await dispatchSiteCommand('/inbox', { ds, ui, app: (ui as any).app })
                  if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                  if (!assistantTurn.content) assistantTurn.content = siteRes.reply
                  resultText = siteRes.reply
                } else if (call.name === 'create_workspace') {
                  const topic = call.arguments?.topic || '精选工作台'
                  assistantTurn.actionCard = {
                    type: 'custom',
                    actionName: 'create_topic_workspace',
                    title: t('ai.wsCardTitle', { name: topic }),
                    desc: tN('ai.wsCardDesc', (assistantTurn.candidates || []).length, { n: (assistantTurn.candidates || []).length }),
                    buttonText: t('ai.wsCardButton'),
                    payload: {
                      topic,
                      candidates: assistantTurn.candidates,
                    },
                  }
                  resultText = tN('ai.toolResultWorkspaceCard', (assistantTurn.candidates || []).length, { topic, n: (assistantTurn.candidates || []).length })
                } else if (call.name === 'merge_duplicates') {
                  const siteRes = await dispatchSiteCommand('/dedup', { ds, ui, app: (ui as any).app })
                  if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                  if (!assistantTurn.content) assistantTurn.content = siteRes.reply
                  resultText = siteRes.reply
                } else if (call.name === 'heal_deadlinks') {
                  const siteRes = await dispatchSiteCommand('/deadlink', { ds, ui, app: (ui as any).app })
                  if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                  if (!assistantTurn.content) assistantTurn.content = siteRes.reply
                  resultText = siteRes.reply
                } else if (call.name === 'toggle_theme') {
                  const mode = call.arguments?.mode || 'auto'
                  const siteRes = await dispatchSiteCommand(`/theme ${mode}`, { ds, ui, app: (ui as any).app })
                  resultText = siteRes.reply || t('ai.toolResultTheme', { mode })
                } else if (call.name === 'change_view') {
                  const layout = call.arguments?.layout || 'grid'
                  const siteRes = await dispatchSiteCommand(`/view ${layout}`, { ds, ui, app: (ui as any).app })
                  resultText = siteRes.reply || t('ai.toolResultView', { layout })
                } else if (call.name === 'export_data') {
                  const siteRes = await dispatchSiteCommand('/export', { ds, ui, app: (ui as any).app })
                  resultText = siteRes.reply || t('ai.toolResultExport')
                } else {
                  resultText = t('ai.toolResultUnknown', { name: call.name })
                }
                toolResults.push({ id: call.id, name: call.name, resultText })
              }

              // 持久化到会话轮次：多轮对话还原 assistant→tool→assistant 协议链用
              assistantTurn.preToolContent = mimoRes.reply || ''
              assistantTurn.toolCalls = mimoRes.toolCalls.map((c) => ({
                id: c.id,
                name: c.name,
                arguments: c.arguments,
              }))
              assistantTurn.toolResults = toolResults.map((r) => ({
                toolCallId: r.id,
                name: r.name,
                resultText: r.resultText,
              }))
              sessions.value = updateSession(currentSessionId.value, chatTurns.value)

              // 真 Agent 循环：tool 结果以 role:'tool' 回传模型，发起续轮让它基于真实结果作答
              if (toolResults.length > 0 && !controller.signal.aborted) {
                const followUpHistory: MiMoChatMessage[] = [
                  ...history,
                  { role: 'user', content: raw },
                  {
                    role: 'assistant',
                    content: mimoRes.reply || '',
                    tool_calls: mimoRes.toolCalls.map((c) => ({
                      id: c.id,
                      type: 'function' as const,
                      function: {
                        name: c.name,
                        arguments: JSON.stringify(c.arguments || {}),
                      },
                    })),
                  },
                  ...toolResults.map((r) => ({
                    role: 'tool' as const,
                    tool_call_id: r.id,
                    content: sanitizeToolResult(r.resultText),
                  })),
                ]

                try {
                  const followUpRes = await askMiMoStream(
                    '',
                    {
                      categories: ds.categories,
                      customAttributes: ds.customAttributes,
                      isZh: isZh.value,
                      signal: controller.signal,
                      history: followUpHistory,
                      enableTools: false,
                    },
                    {
                      onContentDelta(_delta, accumulatedContent) {
                        if (controller.signal.aborted) return
                        assistantTurn.content = accumulatedContent
                        onTurnsChanged?.()
                      },
                    },
                  )
                  if (controller.signal.aborted) return
                  if (followUpRes.reply.trim()) {
                    assistantTurn.content = followUpRes.reply
                    assistantTurn.candidates = followUpRes.candidates?.length ? followUpRes.candidates : assistantTurn.candidates
                  }
                  assistantTurn.steps.push({ text: t('ai.toolFollowUpStep'), done: true })
                } catch (followUpErr: unknown) {
                  // 续轮失败不覆盖第一轮已执行的真实结果，仅记录
                  console.warn('[ulink AI] tool result follow-up failed:', followUpErr)
                }
              }
            }

            mimoSuccess = true
            persistCurrentSession()
          } catch (mimoErr: unknown) {
            if (controller.signal.aborted) return
            console.warn('[ulink AI] MiMo API call failed, falling back to local dataset:', mimoErr)
          }
        }

        // 若未开启 MiMo 或 MiMo 请求异常，优雅回退至本地离线知识库
        if (!mimoSuccess) {
          const res = await searchWebsitesByIntent(raw, preferences.value, ds.categories, ds.customAttributes)
          if (controller.signal.aborted) return
          assistantTurn.loading = false
          assistantTurn.candidates = res
          assistantTurn.content = formatFoundCount(res.length, undefined, res)
        }
      }

      // 智能挂载行动卡片：当单轮甄选到 3 个及以上候选站点且未挂载卡片时，出具一键装配工作台卡片
      if (assistantTurn.candidates && assistantTurn.candidates.length >= 3 && !assistantTurn.actionCard) {
        const topicRaw =
          raw
            .replace(/^(?:请?帮?我?)?(?:推荐|找|搜|整理|搭建|介绍|有哪些|看下)?\s*/i, '')
            .replace(/[?？!！。]+$/, '')
            .trim()
            .slice(0, 16) || '精选工具'
        const cleanTopic =
          topicRaw.endsWith('工作台') || topicRaw.endsWith('工具箱') ? topicRaw : `${topicRaw} 工作台`
        assistantTurn.actionCard = {
          type: 'custom',
          actionName: 'create_topic_workspace',
          title: t('ai.wsCardTitle', { name: cleanTopic }),
          desc: tN('ai.wsCardDesc', assistantTurn.candidates.length, { n: assistantTurn.candidates.length }),
          buttonText: t('ai.wsCardButton'),
          payload: {
            topic: cleanTopic,
            candidates: assistantTurn.candidates,
          },
        }
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      assistantTurn.loading = false
      assistantTurn.content = t('ai.searchFailed')
      console.error('[ulink AI] search error:', err)
    } finally {
      // 兜底收尾：任何路径遗留的思考气泡（如 abort 竞态）一律置为已停止，防悬挂
      if (assistantTurn.loading) {
        assistantTurn.loading = false
        if (!assistantTurn.content) assistantTurn.content = t('ai.stopped')
      }

      // 记录输入历史
      if (raw && !inputHistory.value.includes(raw)) {
        inputHistory.value.push(raw)
        if (inputHistory.value.length > 30) inputHistory.value.shift()
      }
      historyCursor.value = inputHistory.value.length

      // 仅当本次请求仍持有控制器时才收尾共享状态；
      // 若已被停止/切会话接管（abortInFlight 已收尾持久化），不得覆盖其状态
      if (currentAbortController === controller) {
        aiLoading.value = false
        currentAbortController = null
        persistCurrentSession()
        onTurnsChanged?.()
      }
    }
  }

  function hasUnaddedInTurn(turn: ChatTurn): boolean {
    return !!turn.candidates?.some(c => !c.isAdded)
  }

  function addAllInTurn(turn: ChatTurn) {
    if (!turn.candidates) return
    let count = 0
    for (const c of turn.candidates) {
      if (!c.isAdded) {
        ds.addBookmark(candidateToBookmark(ds, c))
        c.isAdded = true
        count++
      }
    }
    if (count) saveAppData()
    toast(t('ai.addedBatchSuccess', { n: count }), true)
  }

  function applySlashCommand(cmd: string) {
    aiQuery.value = cmd + ' '
    onQueryChanged?.()
    focusInput?.()
  }

  return {
    // 会话状态与管理
    sessions,
    currentSessionId,
    chatTurns,
    isCurrentSessionEmpty,
    currentSessionTitle,
    handleCreateSession,
    switchSession,
    handleDeleteSession,
    handleClearAllSessions,
    persistCurrentSession,
    // AI 请求状态
    aiQuery,
    aiLoading,
    loadingTextKey,
    loadingText,
    preferences,
    // 核心调度
    handleAiSubmit,
    handleActionCardClick,
    formatFoundCount,
    hasUnaddedInTurn,
    addAllInTurn,
    revokeUserMessage,
    abortInFlight,
    handleStopGenerating,
    // 卡片辅助
    getActionCardNavTarget,
    navigateToActionTarget,
    getCardCandidateList,
    initCardCandidateSelection,
    isCandidateSelected,
    getSelectedCandidateCount,
    isAllCandidatesSelected,
    toggleCandidateSelection,
    toggleSelectAllCandidates,
    formatDomain,
    // 斜杠命令
    SLASH_COMMANDS,
    dynamicQuickHints,
    applySlashCommand,
    // 终端式命令历史状态（DetailPanel.handleKeyDown 回溯用）
    inputHistory,
    historyCursor,
    tempInput,
    // 语言判断（formatTimeAgo / copyMessage 等 UI 格式化用）
    isZh,
  }
}
