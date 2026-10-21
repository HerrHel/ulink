/**
 * useAiChat.ts — AI 侧边栏调度逻辑 Facade（自 DetailPanel.vue 纯搬运抽出，后按分层拆解）
 * 职责：
 * 1. 多会话状态与管理 → useAiChatSessions.ts（创建/切换/删除/清空/持久化/中止）；
 * 2. 核心提交调度 → useAiChatSubmit.ts（视频/网址/自然语言分流、MiMo Tool Calling 循环、
 *    role:'tool' 续轮、history 还原工具链、本地知识库兜底），工具分发 → useAiChatAgent.ts；
 * 3. 行动卡片（Action Card）执行与候选多选微操、草稿层、DAG流水线 → useAiActionCards.ts；
 * 4. 本 Facade 保留：AI 请求状态、斜杠指令快捷联想、空态情境提示、撤回/批量收录、
 *    终端式命令历史状态，并组装各层对外返回统一 API。
 * 仅含数据与调度，不碰任何 DOM：滚动到底、输入框聚焦/高度、会话菜单收起、切回对话 tab
 * 等 UI 副作用由 DetailPanel 通过回调注入（见 UseAiChatOptions），行为与抽取前逐字一致。
 */
import { computed, ref } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useI18n } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import { candidateToBookmark } from '../../lib/ai/candidateSave.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { saveAppData } from '../../stores/app.js'
import { updateSession, type ChatTurn } from '../../lib/ai/chatSessions.js'
import type { AiSearchPreference } from '../../types/ai.js'
import { useAiChatSessions } from './useAiChatSessions.js'
import { useAiChatSubmit } from './useAiChatSubmit.js'
import { useAiActionCards } from './useAiActionCards.js'

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

  // ── 多会话管理层（useAiChatSessions）──
  const {
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
    handleDeleteSession,
    handleClearAllSessions,
  } = useAiChatSessions({
    aiQuery,
    aiLoading,
    t,
    onTurnsChanged,
    onQueryChanged,
    focusInput,
    closeSessionMenu,
  })

  // ── 终端式命令历史回溯 (↑ / ↓) 状态（handleAiSubmit 记录，DetailPanel.handleKeyDown 回溯）──
  const inputHistory = ref<string[]>([])
  const historyCursor = ref(-1)
  const tempInput = ref('')

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

    // 1. 收件箱未分类检测
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId && !b.id.startsWith('bm_ulink_'),
    ).length
    if (uncatCount > 0) {
      hints.push({
        label: isZh.value ? `🧹 整理未分类 (${uncatCount})` : `🧹 Triage Inbox (${uncatCount})`,
        query: isZh.value ? '帮我整理一下未分类书签' : 'Please triage my uncategorized bookmarks',
      })
    }

    // 2. 查重合并
    hints.push({
      label: isZh.value ? '🔍 查重合并' : '🔍 Deduplicate',
      query: isZh.value ? '检查库内是否有重复书签并清理' : 'Check for duplicate bookmarks in my vault',
    })

    // 3. 发现好站
    hints.push({
      label: isZh.value ? '🌐 发现好站' : '🌐 Discover Sites',
      query: isZh.value ? '推荐几个好用的效率工具网站' : 'Recommend some useful productivity websites',
    })

    // 4. 书签库体检
    hints.push({
      label: isZh.value ? '🩺 资产体检' : '🩺 Vault Health',
      query: isZh.value ? '帮我给书签库做一次健康体检' : 'Audit my bookmark vault health',
    })

    return hints.slice(0, 4)
  })

  // ── 行动卡片回写层（useAiActionCards）──
  const {
    handleActionCardClick,
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
    getDiffPayload,
    toggleDiffItemSelection,
    toggleSelectAllDiffItems,
    getDagPlan,
    runSingleDagStep,
  } = useAiActionCards({
    ds,
    ui,
    chatTurns,
    sessions,
    currentSessionId,
    t,
    tN,
    onTurnsChanged,
  })

  // ── 请求编排层（useAiChatSubmit）──
  const { handleAiSubmit, formatFoundCount } = useAiChatSubmit({
    ds,
    ui,
    aiQuery,
    aiLoading,
    loadingTextKey,
    preferences,
    inputHistory,
    historyCursor,
    chatTurns,
    sessions,
    currentSessionId,
    abortSlot,
    isZh,
    t,
    tN,
    persistCurrentSession,
    handleCreateSession,
    onTurnsChanged,
    onQueryChanged,
    showAiTab,
  })

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
    // 虚拟演练草稿与任务规划
    getDiffPayload,
    toggleDiffItemSelection,
    toggleSelectAllDiffItems,
    getDagPlan,
    runSingleDagStep,
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
