/**
 * useMention — @书签 / #组引用 提及系统
 * 从 MentionDropdown.vue 提取的核心逻辑。
 */
import { ref } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { toastAPI } from '../bridge.js'
import { MAX_SUGGESTIONS } from '../../config/constants.js'
import { saveGroupBody } from './useGroup.js'
import { groupRefCardHTML, inlineCardHTML } from '../useInlineCard.js'
import { EditorManager } from '../../lib/editor.js'
import type { Bookmark } from '../../types.js'

interface MentionItem {
  type: 'bookmark' | 'group'
  subItems?: Bookmark[]
  [key: string]: any
}

export function useMention() {
  const store = useAppStore()
  const isVisible = ref(false)
  const candidates = ref<MentionItem[]>([])
  const activeIdx = ref(0)
  const activeSubIdx = ref(0)
  const mentionType = ref<'bm' | 'group'>('bm')
  const pos = ref({ x: 0, y: 0 })
  let _mentionRange: Range | null = null

  function hide() {
    isVisible.value = false
    candidates.value = []
    activeIdx.value = 0
    activeSubIdx.value = 0
    mentionType.value = 'bm'
    _mentionRange = null
    store.mentionGid = null
    store.mentionQuery = ''
    store.mentionActive = false
    store.mentionType = 'bm'
    store.mentionSubMode = false
    store.mentionSubIdx = 0
  }

  function showNear(query: string) {
    const isGroup = store.mentionType === 'group'
    const matches = isGroup
      ? store.siblingGroups.filter(g => g.id !== store.mentionGid && (g.name || '').toLowerCase().includes(query)).slice(0, MAX_SUGGESTIONS)
      : store.bookmarks.filter(b => !b.parentId && (b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query))).slice(0, MAX_SUGGESTIONS)

    if (!matches.length) { isVisible.value = false; return }

    candidates.value = isGroup
      ? matches.map(g => ({ ...g, type: 'group' as const }))
      : matches.map(b => ({ ...b, type: 'bookmark' as const, subItems: store.bookmarks.filter(s => s.parentId === b.id) || null }))

    activeIdx.value = 0
    mentionType.value = isGroup ? 'group' : 'bm'

    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getClientRects()[0]
      if (r) pos.value = { x: Math.min(r.left, window.innerWidth - 310), y: Math.min(r.bottom + 4, window.innerHeight - 220) }
    }
    isVisible.value = true
  }

  function _toPMRange(ed: any, range: Range): { from: number; to: number } | null {
    if (!range) return null
    try {
      const from = ed.view.posAtDOM(range.startContainer, range.startOffset)
      const to = ed.view.posAtDOM(range.endContainer, range.endOffset)
      if (from != null && to != null && from <= to) return { from, to }
    } catch (_) { /* range 无效时返回 null */ }
    return null
  }

  function _insertHTML(ed: any, html: string) {
    if (!ed) return
    const trigger = store.mentionType === 'group' ? '#' : '@'
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const node = sel.focusNode
    if (node && node.nodeType === 3) {
      const text = node.textContent || ''
      const offset = sel.focusOffset
      const atIdx = text.lastIndexOf(trigger, offset - 1)
      if (atIdx >= 0 && atIdx < offset) {
        const pmFrom = ed.view.posAtDOM(node, atIdx)
        const pmTo = ed.view.posAtDOM(node, offset)
        if (pmFrom != null && pmTo != null && pmFrom <= pmTo) {
          ed.chain().deleteRange({ from: pmFrom, to: pmTo }).insertContent(html).run()
          return
        }
      }
    }
    if (_mentionRange) {
      const pmRange = _toPMRange(ed, _mentionRange)
      if (pmRange) { ed.chain().deleteRange(pmRange).insertContent(html).run(); return }
      _mentionRange.deleteContents()
    }
    ed.chain().insertContent(html).run()
  }

  function selectBookmark(bmId: string) {
    if (!store.mentionGid) return
    const sg = store.groupMap[store.mentionGid]
    const b = store.bookmarkMap[bmId]
    if (!sg || !b) { hide(); return }
    const ed = EditorManager.get(store.mentionGid)
    _insertHTML(ed, inlineCardHTML(b))
    if (sg.bookmarkIds.indexOf(bmId) === -1) {
      store.updateGroup(store.mentionGid, { bookmarkIds: [...sg.bookmarkIds, bmId] })
    }
    saveGroupBody(store.mentionGid); store.save(); hide()
  }

  function selectGroupRef(refGid: string) {
    if (!store.mentionGid || refGid === store.mentionGid) { hide(); return }
    const src = store.groupMap[refGid]
    if (!src) { hide(); return }
    const ed = EditorManager.get(store.mentionGid)
    _insertHTML(ed, groupRefCardHTML(src))
    saveGroupBody(store.mentionGid); store.save(); hide()
    toastAPI?.toast('已添加组引用')
  }

  // 键盘/输入事件处理
  function onTrigger(e: KeyboardEvent) {
    if (e.key !== '@' && e.key !== '#') return
    const gb = (e.target as HTMLElement).closest('.group-body')
    if (!gb || !(e.target as HTMLElement).isContentEditable) return
    store.mentionGid = gb.closest('.group-card')?.getAttribute('data-group-id') || null
    store.mentionQuery = ''
    store.mentionActive = true
    store.mentionType = e.key === '@' ? 'bm' : 'group'
    _mentionRange = null
  }

  function onInput(e: Event) {
    if (!store.mentionActive || !store.mentionGid) return
    const gb = (e.target as HTMLElement).closest('.group-body')
    if (!gb || !(e.target as HTMLElement).isContentEditable || (gb.closest('.group-card')?.getAttribute('data-group-id') || null) !== store.mentionGid) { hide(); return }
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) { hide(); return }
    const node = sel.focusNode
    if (!node || node.nodeType !== 3) { hide(); return }
    const text = node.textContent || ''
    const trigger = store.mentionType === 'group' ? '#' : '@'
    const atIdx = text.lastIndexOf(trigger, sel.focusOffset - 1)
    if (atIdx >= 0 && atIdx < sel.focusOffset) {
      store.mentionQuery = text.slice(atIdx + 1, sel.focusOffset).toLowerCase()
      _mentionRange = document.createRange()
      _mentionRange.setStart(node, atIdx)
      _mentionRange.setEnd(node, sel.focusOffset)
      showNear(store.mentionQuery)
    } else { hide() }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!isVisible.value) return
    if (!document.activeElement?.closest?.('.group-body')) { hide(); return }
    const items = document.querySelectorAll('#mentionDrop > .mention-item')
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx.value = (activeIdx.value + 1) % items.length; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx.value = (activeIdx.value - 1 + items.length) % items.length; return }
    if (e.key === 'Escape') { hide(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const s = candidates.value[activeIdx.value]
      if (s) mentionType.value === 'group' ? selectGroupRef(s.id) : selectBookmark(s.id)
    }
  }

  return {
    isVisible, candidates, activeIdx, activeSubIdx, mentionType, pos,
    hide, selectBookmark, selectGroupRef,
    onTrigger, onInput, onKeydown
  }
}
