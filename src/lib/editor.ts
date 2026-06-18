/**
 * editor.js — EditorManager 工具层
 * Phase 5: TipTap 编辑器创建已移至 GroupEditor.vue。
 * 此文件仅保留 EditorManager 工具函数（格式化命令、内容操作），
 * 通过 _editors 注册表访问由 GroupEditor.vue 创建的编辑器实例。
 */
import type { Editor } from '@tiptap/core'

// ---------- Editor Registry ----------
const _editors: Record<string, Editor> = {}

interface IEditorManager {
  register(gid: string, editor: Editor): void
  unregister(gid: string): void
  get(gid: string): Editor | null
  getContentHTML(gid: string): string | null
  insertInlineCardHTML(gid: string, html: string): boolean
  toggleBold(gid: string): void
  setHeading(gid: string, level: number): void
  deleteNode(gid: string, attrName: string, attrValue: string): void
  insertAtCoords(gid: string, html: string, clientX: number, clientY: number): boolean
  insertText(gid: string, text: string): boolean
}

const editorManager: IEditorManager = {
  register: function (gid: string, editor: Editor): void { _editors[gid] = editor },
  unregister: function (gid: string): void { delete _editors[gid] },
  get: function (gid: string): Editor | null { return _editors[gid] || null },
  getContentHTML: function (gid: string): string | null { const ed = _editors[gid]; if (!ed) return null; try { return ed.getHTML() } catch (_) { return null } },
  insertInlineCardHTML: function (gid: string, html: string): boolean { const ed = _editors[gid]; if (!ed) return false; try { ed.chain().insertContent(html).run(); return true } catch (_) { return false } },

  toggleBold: function (gid: string): void { const ed = _editors[gid]; if (ed) (ed.commands as any).toggleBold() },
  setHeading: function (gid: string, level: number): void { const ed = _editors[gid]; if (ed) (ed.commands as any).toggleHeading({ level }) },

  deleteNode: function (gid: string, attrName: string, attrValue: string): void {
    const ed = _editors[gid]; if (!ed) return
    const toRemove: number[] = []
    ed.state.doc.descendants(function (node: { attrs?: Record<string, string> }, pos: number) {
      if (node.attrs && node.attrs[attrName] === attrValue) toRemove.push(pos)
    })
    toRemove.reverse().forEach(function (p: number) {
      try { ed.chain().deleteRange({ from: p, to: p + 1 }).run() } catch (e: any) { console.warn('[Editor] deleteRange error:', e.message) }
    })
  },

  insertAtCoords: function (gid: string, html: string, clientX: number, clientY: number): boolean {
    const ed = _editors[gid]; if (!ed) return false
    try {
      const coords = ed.view.posAtCoords({ left: clientX, top: clientY })
      if (coords) {
        const $pos = ed.state.doc.resolve(coords.pos)
        let insertPos = coords.pos
        if ($pos.depth > 0 && $pos.parentOffset === $pos.parent.content.size) {
          insertPos = Math.max(insertPos - 1, $pos.before(1))
        }
        ed.chain().insertContentAt(insertPos, html).run()
        return true
      }
    } catch (e: any) { console.warn('[Editor] insertAtCoords fallback:', e.message) }
    return this.insertInlineCardHTML(gid, html)
  },
  insertText: function (gid: string, text: string): boolean { const ed = _editors[gid]; if (!ed) return false; try { ed.chain().insertContent(text).run(); return true } catch (_) { return false } },
}

export const EditorManager = editorManager