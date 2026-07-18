/**
 * editor.js — EditorManager 工具层
 * Phase 5: TipTap 编辑器创建已移至 GroupEditor.vue。
 * 此文件仅保留 EditorManager 工具函数（格式化命令、内容操作），
 * 通过 _editors 注册表访问由 GroupEditor.vue 创建的编辑器实例。
 */
import type { Editor } from '@tiptap/core'
// ── 副作用 import：触发 TipTap v3 extension 对 ChainedCommands 的类型 augmentation ──
import '@tiptap/extension-bold'
import '@tiptap/extension-heading'

// ---------- Editor Registry ----------
const _editors: Record<string, Editor> = {}

/** G1-003：silent setContent 期间为 true，GroupEditor onUpdate 应跳过 syncToStore/_markDirty */
let _silentContentDepth = 0
export function isSilentSetContent(): boolean { return _silentContentDepth > 0 }

interface IEditorManager {
  register(gid: string, editor: Editor): void
  unregister(gid: string): void
  get(gid: string): Editor | null
  getContentHTML(gid: string): string | null
  insertInlineCardHTML(gid: string, html: string): boolean
  toggleBold(gid: string): void
  setHeading(gid: string, level: number): void
  deleteNode(gid: string, attrName: string, attrValue: string): void
  /** 在 silent 上下文中执行，抑制 GroupEditor onUpdate→syncToStore */
  withSilent(fn: () => void): void
  insertAtCoords(gid: string, html: string, clientX: number, clientY: number): boolean
  insertText(gid: string, text: string): boolean
  /** 远端/程序化写回 notes：不触发 onUpdate→syncToStore 标脏回推 */
  silentSetContent(gid: string, html: string): boolean
}

const editorManager: IEditorManager = {
  register: function (gid: string, editor: Editor): void { _editors[gid] = editor },
  unregister: function (gid: string): void { delete _editors[gid] },
  get: function (gid: string): Editor | null { return _editors[gid] || null },
  getContentHTML: function (gid: string): string | null { const ed = _editors[gid]; if (!ed) return null; try { return ed.getHTML() } catch (_) { return null } },
  insertInlineCardHTML: function (gid: string, html: string): boolean { const ed = _editors[gid]; if (!ed) return false; try { ed.chain().insertContent(html).run(); return true } catch (_) { return false } },

  toggleBold: function (gid: string): void { const ed = _editors[gid]; if (ed) ed.chain().focus().toggleBold().run() },
  setHeading: function (gid: string, level: number): void { const ed = _editors[gid]; if (ed) ed.chain().focus().toggleHeading({ level: level as any }).run() },

  deleteNode: function (gid: string, attrName: string, attrValue: string): void {
    const ed = _editors[gid]; if (!ed) return
    const toRemove: number[] = []
    ed.state.doc.descendants(function (node: { attrs?: Record<string, string> }, pos: number) {
      if (node.attrs && node.attrs[attrName] === attrValue) toRemove.push(pos)
    })
    toRemove.reverse().forEach(function (p: number) {
      try { ed.chain().deleteRange({ from: p, to: p + 1 }).run() } catch (e: unknown) { console.warn('[Editor] deleteRange error:', e instanceof Error ? e.message : e) }
    })
  },

  withSilent: function (fn: () => void): void {
    _silentContentDepth++
    try { fn() } finally { _silentContentDepth-- }
  },

  insertAtCoords: function (gid: string, html: string, clientX: number, clientY: number): boolean {
    const ed = _editors[gid]; if (!ed) return false
    try {
      const coords = ed.view.posAtCoords({ left: clientX, top: clientY })
      if (coords) {
        ed.chain().insertContentAt(coords.pos, html).run()
        return true
      }
    } catch (e: unknown) { console.warn('[Editor] insertAtCoords fallback:', e instanceof Error ? e.message : e) }
    return this.insertInlineCardHTML(gid, html)
  },
  insertText: function (gid: string, text: string): boolean { const ed = _editors[gid]; if (!ed) return false; try { ed.chain().insertContent(text).run(); return true } catch (_) { return false } },

  silentSetContent: function (gid: string, html: string): boolean {
    const ed = _editors[gid]
    if (!ed) return false
    _silentContentDepth++
    try {
      ed.commands.setContent(html)
      return true
    } catch (e: unknown) {
      console.warn('[Editor] silentSetContent error:', e instanceof Error ? e.message : e)
      return false
    } finally {
      _silentContentDepth--
    }
  },
}

export const EditorManager = editorManager