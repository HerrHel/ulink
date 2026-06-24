import { reactive, ref } from 'vue'
import type { Editor } from '@tiptap/core'

export const PALETTE = [
  { hex: '#EF4444', name: '红' }, { hex: '#F97316', name: '橙' },
  { hex: '#EAB308', name: '黄' }, { hex: '#22C55E', name: '绿' },
  { hex: '#06B6D4', name: '青' }, { hex: '#3B82F6', name: '蓝' },
  { hex: '#A855F7', name: '紫' }, { hex: '#EC4899', name: '粉' },
  { hex: '#6B7280', name: '灰' }
]

export type FormatKey = 'bold' | 'underline' | 'h1' | 'h2' | 'h3' | 'ol' | 'ul' | 'task'

interface EditorFormatState {
  bold: boolean
  underline: boolean
  h1: boolean
  h2: boolean
  h3: boolean
  ol: boolean
  ul: boolean
  task: boolean
  color: string
}

export function useEditorFormat(getEditor: () => Editor | null) {
  const fmt = reactive<EditorFormatState>({
    bold: false, underline: false, h1: false, h2: false, h3: false,
    ol: false, ul: false, task: false, color: ''
  })
  const colorOpen = ref(false)

  function syncFmt() {
    const ed = getEditor()
    if (!ed) return
    fmt.bold = ed.isActive('bold')
    fmt.underline = ed.isActive('underline')
    fmt.h1 = ed.isActive('heading', { level: 1 })
    fmt.h2 = ed.isActive('heading', { level: 2 })
    fmt.h3 = ed.isActive('heading', { level: 3 })
    fmt.ol = ed.isActive('orderedList')
    fmt.ul = ed.isActive('bulletList')
    fmt.task = ed.isActive('taskList')
    fmt.color = ed.getAttributes('textStyle').color || ''
  }

  function fmtToggle(f: FormatKey) {
    const ed = getEditor()
    if (!ed) return
    const chain = ed.chain().focus()
    switch (f) {
      case 'bold': chain.toggleBold(); break
      case 'underline': chain.toggleUnderline(); break
      case 'h1': chain.toggleHeading({ level: 1 }); break
      case 'h2': chain.toggleHeading({ level: 2 }); break
      case 'h3': chain.toggleHeading({ level: 3 }); break
      case 'ol': chain.toggleOrderedList(); break
      case 'ul': chain.toggleBulletList(); break
      case 'task': chain.toggleTaskList(); break
    }
    chain.run()
    syncFmt()
  }

  function applyColor(hex: string) {
    const ed = getEditor()
    if (!ed) return
    if (hex) ed.chain().focus().setColor(hex).run()
    else ed.chain().focus().unsetColor().run()
    colorOpen.value = false
    syncFmt()
  }

  return { fmt, colorOpen, syncFmt, fmtToggle, applyColor }
}
