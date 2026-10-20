/**
 * useChatPanelShell — 面板壳层状态与行为（自 DetailPanel.vue 抽出，行为零变化）
 *
 * 职责：面板开合（isOpen）、输入框聚焦态、会话菜单开合与「点击外部关闭」（含 document 监听生命周期）、
 * 浮动/停靠 HUD 状态与持久化、附件槽位列表组装、note 写回与卡片定位入口、整面板关闭。
 * 纯状态 + 行为，不依赖 useAiChat 的产出；打开联动（高度自适应/聚焦/自动提交）作为接线留在 DetailPanel。
 */
import { computed, ref, onMounted, onUnmounted, type Ref } from 'vue'
import { isMobile } from '../../utils.js'
import { useI18n } from '../../i18n/index.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { locateAndHighlightCard } from '../../lib/ai/cardLocator.js'
import {
  appendAiContentToGroup,
  replaceAiContentToGroup,
  createNoteFromAiContent,
} from '../../lib/ai/noteWriteback.js'

export function useChatPanelShell() {
  const { t } = useI18n()
  const ui = useUIStore()
  const ds = useDataStore()

  const isOpen = computed(() => ui.panels.detail)

  const isInputFocused = ref(false)
  const isSessionMenuOpen = ref(false)

  const isMobileDevice = computed(() => isMobile())
  // 存量写法原样搬运：初始化器函数被直接当作 ref 的值存入（函数未执行，
  // 故初始恒真、localStorage 读取逻辑从未生效）。为保持拆分行为零变化先不动，
  // 该 bug 由后续独立 fix 提交修复（执行初始化器）。
  const isFloatingHud = ref(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('ulink_ai_floating_hud') === 'true'
    } catch {
      return false
    }
  }) as unknown as Ref<boolean>

  function toggleFloatingHud() {
    isFloatingHud.value = !isFloatingHud.value
    try {
      localStorage.setItem('ulink_ai_floating_hud', String(isFloatingHud.value))
    } catch {
      // 忽略持久化异常
    }
  }

  const attachedCardsList = computed(() => {
    return ui.aiAttachedCards.map((ref) => {
      if (ref.type === 'group') {
        const g = ds.groupMap[ref.id]
        return {
          type: 'group' as const,
          id: ref.id,
          title: g?.name || t('cards.note'),
          url: '',
        }
      } else {
        const b = ds.bookmarkMap[ref.id]
        return {
          type: 'bm' as const,
          id: ref.id,
          title: b?.title || b?.url || t('cards.bookmark'),
          url: b?.url || '',
        }
      }
    })
  })

  function handleAppendToNote(noteId: string, content: string) {
    appendAiContentToGroup(noteId, content)
  }

  function handleReplaceNote(noteId: string, content: string) {
    replaceAiContentToGroup(noteId, content)
  }

  function handleSaveAsNewNote(content: string) {
    const res = createNoteFromAiContent({ aiText: content })
    if (res.success && res.groupId) {
      locateAndHighlightCard({ id: res.groupId, type: 'group' })
    }
  }

  function handleLocateCard(id: string, type: 'bookmark' | 'group') {
    locateAndHighlightCard({ id, type, collapseDetailOnMobile: true })
  }

  function closeEntirePanel() {
    ui.panels.detail = false
  }

  /** 点击会话标题区之外时收起会话菜单 */
  function onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (isSessionMenuOpen.value && !target.closest('.chat-top-title-wrap')) {
      isSessionMenuOpen.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('click', onDocumentClick)
  })
  onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick)
  })

  return {
    isOpen,
    isInputFocused,
    isSessionMenuOpen,
    isMobileDevice,
    isFloatingHud,
    toggleFloatingHud,
    attachedCardsList,
    handleAppendToNote,
    handleReplaceNote,
    handleSaveAsNewNote,
    handleLocateCard,
    closeEntirePanel,
  }
}
