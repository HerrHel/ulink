/**
 * useChatDisplay — AI 聊天展示层纯逻辑（自 DetailPanel.vue 抽出，行为零变化）
 *
 * 职责：展示格式化（时间/思考耗时/复制文本清洗/会话标题）+ 轮次渲染数据组装
 * （随文卡片解析合并 / 附件卡片回溯 / 附件笔记过滤）+ 复制消息（剪贴板 + 已复制态）。
 * 不触碰面板 DOM（滚动/输入框高度/手势等留在 DetailPanel）。
 */
import { computed, ref, type Ref } from 'vue'
import { useI18n } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import { useDataStore } from '../../stores/data.js'
import {
  parseTurnContentSegments,
  mergeParsedCandidates,
  type ChatContentSegment,
} from '../../lib/ai/chatStreamParser.js'
import type { ChatTurn, AiChatSession } from '../../lib/ai/chatSessions.js'
import { isDefaultSessionTitle, type AttachedCardMeta } from '../../lib/ai/chatSessions.js'

export function useChatDisplay(chatTurns: Ref<ChatTurn[]>) {
  const { t, locale } = useI18n()
  const ds = useDataStore()
  const isZh = computed(() => locale.value.startsWith('zh'))

  function formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp
    if (diff < 60000) return t('ai.timeJustNow')
    if (diff < 3600000) return t('ai.timeMinutesAgo', { n: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('ai.timeHoursAgo', { n: Math.floor(diff / 3600000) })
    return new Date(timestamp).toLocaleDateString(isZh.value ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric' })
  }

  function formatReasoningSec(ms?: number): string {
    if (!ms || ms <= 0) return '1'
    const sec = (ms / 1000).toFixed(1)
    return sec.endsWith('.0') ? sec.slice(0, -2) : sec
  }

  function getCleanCopyText(content?: string): string {
    if (!content) return ''
    return content.replace(/```ulink-card\s*([\s\S]*?)```/gi, '').trim()
  }

  /** 会话列表标题：未命名（含存量旧默认标题）回退到 i18n 默认标题 */
  function sessionItemTitle(s: AiChatSession): string {
    return isDefaultSessionTitle(s.title) ? t('ai.sessionDefaultTitle') : s.title
  }

  function getTurnAttachedCards(turn: ChatTurn): AttachedCardMeta[] {
    if (turn.attachedCards && turn.attachedCards.length > 0) {
      return turn.attachedCards
    }
    const idx = chatTurns.value.findIndex((t) => t.id === turn.id)
    if (idx > 0) {
      const prevTurn = chatTurns.value[idx - 1]
      if (prevTurn?.role === 'user' && prevTurn.attachedCards?.length) {
        return prevTurn.attachedCards
      }
    }
    return []
  }

  function getAttachedNotes(turn: ChatTurn): AttachedCardMeta[] {
    return getTurnAttachedCards(turn).filter((c) => c.type === 'group')
  }

  function getTurnSegments(turn: ChatTurn): ChatContentSegment[] {
    if (!turn.content && (!turn.candidates || turn.candidates.length === 0)) {
      return []
    }

    const { segments, allCandidates } = parseTurnContentSegments(
      turn.content || '',
      ds.categories,
      ds.customAttributes
    )

    // 同步随文卡片到 turn.candidates（流式期间持续全量合并去重，保证持久化与一键全部存入不漏卡）
    if (allCandidates.length) {
      const merged = mergeParsedCandidates(turn.candidates, allCandidates)
      if (merged !== turn.candidates) turn.candidates = merged
    }

    // 兜底兼容：若正文没有内嵌卡片语法（例如本地静态搜索），将 candidates 转换为内嵌卡片追加在末尾
    if (allCandidates.length === 0 && turn.candidates?.length) {
      for (const c of turn.candidates) {
        segments.push({
          type: 'card',
          candidate: c,
        })
      }
    }

    return segments
  }

  const copiedActionKey = ref<string | null>(null)
  let _copiedTimer: ReturnType<typeof setTimeout> | null = null

  async function copyMessage(text: string, actionKey?: string) {
    try {
      await navigator.clipboard.writeText(text)
      if (actionKey) {
        copiedActionKey.value = actionKey
        if (_copiedTimer) clearTimeout(_copiedTimer)
        _copiedTimer = setTimeout(() => {
          if (copiedActionKey.value === actionKey) {
            copiedActionKey.value = null
          }
        }, 1500)
      }
    } catch {
      toast(t('ai.copyFailed'), false)
    }
  }

  return {
    formatTimeAgo,
    formatReasoningSec,
    getCleanCopyText,
    sessionItemTitle,
    getTurnAttachedCards,
    getAttachedNotes,
    getTurnSegments,
    copiedActionKey,
    copyMessage,
  }
}
