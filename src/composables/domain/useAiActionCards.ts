/**
 * useAiActionCards.ts — 行动卡片（Action Card）回写执行（自 useAiChat.ts 纯搬运拆出）
 * 职责：
 * 1. 行动卡片执行（handleActionCardClick 全部分支：查重合并/回收站清空/收件箱清零/
 *    应用聚类/装配工作台/死链治愈/虚拟演练草稿应用/任务规划流水线执行）；
 * 2. 候选多选微操（初始化/勾选/全选/计数）；
 * 3. 虚拟演练草稿微操（单项切换/全选切换）；
 * 4. 任务规划流水线调度（单步触发/全量流式调度）；
 * 5. 卡片导航（getActionCardNavTarget / navigateToActionTarget）与域名格式化。
 * 共享状态由 useAiChat Facade 显式注入，行为与拆分前逐字一致。
 */
import { toast } from '../../lib/toast.js'
import {
  dispatchSiteCommand,
  mergeDuplicateBookmarks,
  applyInboxZeroClustering,
  createTopicWorkspace,
  healDeadlink,
} from '../../lib/ai/siteCommander.js'
import { updateSession, type AiChatSession, type ChatTurn, type ChatActionCard } from '../../lib/ai/chatSessions.js'
import { applyDraftDiff, type DraftDiffPayload } from '../../lib/ai/draftDiff.js'
import { executeDagStep, executeAllDagSteps, type TaskDagPlan } from '../../lib/ai/taskPlanner.js'
import type { useI18n } from '../../i18n/index.js'
import type { useDataStore } from '../../stores/data.js'
import type { useUIStore } from '../../stores/ui.js'
import type { Ref } from 'vue'

/** 行动卡片 payload 内的候选条目（与原 DetailPanel 内联 any 形态一致） */
interface ActionCardCandidate {
  title: string
  url: string
  [key: string]: unknown
}

/** 本层依赖的共享状态与回调（由 useAiChat Facade 注入） */
export interface AiActionCardsContext {
  ds: ReturnType<typeof useDataStore>
  ui: ReturnType<typeof useUIStore>
  chatTurns: Ref<ChatTurn[]>
  sessions: Ref<AiChatSession[]>
  currentSessionId: Ref<string>
  t: ReturnType<typeof useI18n>['t']
  tN: ReturnType<typeof useI18n>['tN']
  /** 对话轮次变化后需要滚动到底部时回调 */
  onTurnsChanged?: () => void
}

export function useAiActionCards(context: AiActionCardsContext) {
  const { ds, ui, chatTurns, sessions, currentSessionId, t, tN, onTurnsChanged } = context

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

  // ── 虚拟演练草稿层辅助 ──
  function getDiffPayload(card: ChatActionCard): DraftDiffPayload | null {
    return ((card.payload as any)?.diffPayload as DraftDiffPayload) || null
  }

  function toggleDiffItemSelection(card: ChatActionCard, itemId: string) {
    if (card.completed || card.executing) return
    const diff = getDiffPayload(card)
    if (!diff) return
    const item = diff.items.find((i) => i.id === itemId)
    if (item) {
      item.selected = !item.selected
    }
  }

  function toggleSelectAllDiffItems(card: ChatActionCard) {
    if (card.completed || card.executing) return
    const diff = getDiffPayload(card)
    if (!diff || diff.items.length === 0) return
    const allSelected = diff.items.every((i) => i.selected)
    for (const item of diff.items) {
      item.selected = !allSelected
    }
  }

  // ── 任务规划流水线辅助 ──
  function getDagPlan(card: ChatActionCard): TaskDagPlan | null {
    return ((card.payload as any)?.plan as TaskDagPlan) || null
  }

  async function runSingleDagStep(card: ChatActionCard, stepId: string) {
    const plan = getDagPlan(card)
    if (!plan || card.completed || card.executing) return
    card.executing = true
    try {
      await executeDagStep(plan, stepId, async (step) => {
        if (step.actionName === 'audit_vault') {
          const res = await dispatchSiteCommand('/health', { ds, ui, app: (ui as any).app })
          return { success: true, output: res.reply }
        } else if (step.actionName === 'inbox_zero') {
          const res = await applyInboxZeroClustering({ ds, ui, app: (ui as any).app })
          const ok = (res.movedCount > 0 || res.nestedCount > 0) || !res.message.includes('取消')
          return { success: ok, output: res.message }
        } else if (step.actionName === 'merge_duplicates') {
          const res = await mergeDuplicateBookmarks({ ds, ui, app: (ui as any).app })
          const ok = res.mergedCount > 0 || !res.message.includes('取消')
          return { success: ok, output: res.message }
        }
        return { success: true, output: t('ai.dagStepSuccess') }
      })
      if (plan.status === 'completed') {
        card.completed = true
      }
    } finally {
      card.executing = false
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      onTurnsChanged?.()
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
      if (card.type === 'draft_diff' || card.actionName === 'apply_inbox_zero_diff' || card.actionName === 'apply_dedup_diff') {
        const payload = getDiffPayload(card)
        if (payload) {
          const res = await applyDraftDiff(payload, { ds, app: (ui as any).app })
          card.completed = true
          toast(res.message, true)
          chatTurns.value.push({
            id: 'turn-' + Date.now() + '-assistant',
            role: 'assistant',
            content: res.message,
            steps: [{ text: res.message, done: true }],
            timestamp: Date.now(),
          })
          onTurnsChanged?.()
          sessions.value = updateSession(currentSessionId.value, chatTurns.value)
        }
      } else if (card.type === 'dag_plan' || card.actionName === 'execute_dag_plan') {
        const plan = getDagPlan(card)
        if (plan) {
          await executeAllDagSteps(plan, async (step) => {
            if (step.actionName === 'audit_vault') {
              const res = await dispatchSiteCommand('/health', { ds, ui, app: (ui as any).app })
              return { success: true, output: res.reply }
            } else if (step.actionName === 'inbox_zero') {
              const res = await applyInboxZeroClustering({ ds, ui, app: (ui as any).app })
              const ok = (res.movedCount > 0 || res.nestedCount > 0) || !res.message.includes('取消')
              return { success: ok, output: res.message }
            } else if (step.actionName === 'merge_duplicates') {
              const res = await mergeDuplicateBookmarks({ ds, ui, app: (ui as any).app })
              const ok = res.mergedCount > 0 || !res.message.includes('取消')
              return { success: ok, output: res.message }
            }
            return { success: true, output: t('ai.dagStepSuccess') }
          })
          card.completed = plan.status === 'completed'
          if (plan.status === 'completed') {
            toast(t('ai.dagPlanCompleted'), true)
          } else if (plan.status === 'paused') {
            toast(t('ai.dagPlanPaused') || '任务暂停', false)
          } else {
            toast(t('ai.actionFailed'), false)
          }
          onTurnsChanged?.()
          sessions.value = updateSession(currentSessionId.value, chatTurns.value)
        }
      } else if (card.actionName === 'merge_dedup') {
        const res = await mergeDuplicateBookmarks({ ds, ui, app: (ui as any).app })
        if (res.mergedCount > 0) {
          card.completed = true
          toast(res.message, true)
          chatTurns.value.push({
            id: 'turn-' + Date.now() + '-assistant',
            role: 'assistant',
            content: res.message,
            steps: [{ text: t('ai.mergeStep', { n: res.mergedCount }), done: true }],
            timestamp: Date.now(),
          })
          onTurnsChanged?.()
          sessions.value = updateSession(currentSessionId.value, chatTurns.value)
        } else {
          if (res.message) toast(res.message, false)
        }
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
          payload.topic || t('ai.wsTopicDefault'),
          finalCandidates,
          payload.targetCatId,
          { ds, ui, app: (ui as any).app },
        )
        if (res.success) {
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
        } else {
          if (res.message) toast(res.message, false)
        }
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
          if (res.success !== false && !res.message?.includes('取消')) {
            card.completed = true
            toast(res.message, true)
            chatTurns.value.push({
              id: 'turn-' + Date.now() + '-assistant',
              role: 'assistant',
              content: res.message,
              steps: [
                { text: t('ai.deadlinkVerifyStep'), done: true },
                { text: t('ai.deadlinkReplaceStep', { title: payload.replacement.title }), done: true },
              ],
              timestamp: Date.now(),
            })
            onTurnsChanged?.()
            sessions.value = updateSession(currentSessionId.value, chatTurns.value)
          } else {
            if (res.message) toast(res.message, false)
          }
        }
      }
    } catch (err: any) {
      console.error('handleActionCardClick error:', err)
      toast(err?.message || t('ai.actionFailed'), false)
    } finally {
      card.executing = false
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    }
  }

  return {
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
  }
}
