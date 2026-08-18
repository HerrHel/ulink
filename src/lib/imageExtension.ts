/**
 * imageExtension.ts — 自定义图片扩展（对齐 Word「嵌入型」图片）
 *
 * 组合三个能力：
 * 1. selectable:false —— 图片不可被 ProseMirror 选中，点击只定位光标，
 *    打字/输入不会误删图片（ProseMirror 选中 atom 节点后输入会替换节点）。
 * 2. draggable:false —— 关闭节点拖拽，避免与手柄交互冲突。
 * 3. 内置 ResizableNodeView —— 图片 hover 时显示 4 角手柄，拖拽改大小，
 *    松手后把 width/height 持久化到节点 attrs（随 notes 同步、随分享输出）。
 *
 * 删除图片：光标移到图片右侧 Backspace（或左侧 Delete），同 Word 光标操作。
 */
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { getRenderedAttributes, mergeAttributes, ResizableNodeView } from '@tiptap/core'
import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** resize 期间由 NodeView 内联管理的属性（style 驱动，不写回 DOM attribute） */
const RESIZE_ATTRS = new Set(['src', 'width', 'height'])

export const UploadedImage = Image.extend({
  selectable: false,
  draggable: false,

  addOptions() {
    return {
      ...(this.parent?.() as ImageOptions | undefined),
      // 内联嵌入文本流（光标可在图片前后定位、图片后直接输入）
      inline: true,
      // 禁止 base64 data URL（安全白名单也只放行 https）
      allowBase64: false,
      // 开启内置 resize：默认保持宽高比，限制最小尺寸
      resize: {
        enabled: true,
        alwaysPreserveAspectRatio: true,
        minWidth: 80,
        minHeight: 60,
      },
    } as ImageOptions
  },

  addNodeView(): NodeViewRenderer {
    return ({ node, editor, getPos, HTMLAttributes }: NodeViewRendererProps) => {
      const el = document.createElement('img')
      el.draggable = false
      const mergedAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
      Object.entries(mergedAttributes).forEach(([key, value]) => {
        if (value != null && !RESIZE_ATTRS.has(key)) el.setAttribute(key, String(value))
      })
      if (mergedAttributes.src != null) el.src = String(mergedAttributes.src)

      let previousHTMLAttributes = { ...HTMLAttributes }

      const syncImageSource = (src: unknown) => {
        if (typeof src === 'string' && src !== '') {
          if (el.getAttribute('src') !== src) el.src = src
          return
        }
        if (el.hasAttribute('src')) el.removeAttribute('src')
        if (el.src !== '') el.src = ''
      }
      syncImageSource(HTMLAttributes.src)

      const onUpdate = (updatedNode: ProseMirrorNode) => {
        if (updatedNode.type !== node.type) return false
        const extensionAttributes = editor.extensionManager.attributes.filter(
          (attribute) => attribute.type === updatedNode.type.name,
        )
        const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes)
        Object.keys(previousHTMLAttributes).forEach((key) => {
          if (!RESIZE_ATTRS.has(key) && !(key in newHTMLAttributes)) el.removeAttribute(key)
        })
        Object.entries(newHTMLAttributes).forEach(([key, value]) => {
          if (RESIZE_ATTRS.has(key)) return
          if (value != null) el.setAttribute(key, String(value))
          else el.removeAttribute(key)
        })
        syncImageSource(newHTMLAttributes.src)
        previousHTMLAttributes = newHTMLAttributes
        return true
      }

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          el.style.width = `${width}px`
          el.style.height = `${height}px`
        },
        onCommit: (width, height) => {
          const pos = getPos()
          if (pos === undefined) return
          // selectable:false 下不能用 setNodeSelection 定位，直接用 pos 更新节点属性
          editor.chain().command(({ tr }) => {
            const resolved = editor.state.doc.resolve(pos)
            const currentAttrs = resolved.nodeAfter?.attrs ?? node.attrs
            tr.setNodeMarkup(pos, undefined, { ...currentAttrs, width, height })
            return true
          }).run()
        },
        onUpdate,
        options: {
          // 高度由 CSS height:auto 按宽度等比自动计算（防纵向拉伸），
          // 故只保留角手柄 + 左右边手柄（上下边手柄改高度会失效，不创建）
          directions: ['left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
          min: { width: 80, height: 60 },
          preserveAspectRatio: true,
        },
      })

      // ── 点击选中（Word 行为）：悬停不显示手柄，点击图片才出现选中框 + 手柄 ──
      // 用 NodeView 内部状态自绘"选中"，不创建 ProseMirror NodeSelection，
      // 因此选中态下打字/输入不会替换图片（selectable:false 兜底）。
      const container = nodeView.dom
      let selected = false
      const setSelected = (v: boolean) => {
        selected = v
        container.classList.toggle('lv-img-selected', v)
      }

      const onContainerMouseDown = (e: MouseEvent) => {
        // 手柄交给 ResizableNodeView 的 resize 逻辑
        if ((e.target as HTMLElement).closest('[data-resize-handle]')) return
        // 点击图片本身：阻止 ProseMirror 光标/选中处理，切换为视觉选中态
        if ((e.target as HTMLElement).closest('img')) {
          e.preventDefault()
          e.stopPropagation()
          setSelected(true)
        }
      }
      container.addEventListener('mousedown', onContainerMouseDown)

      // 点击图片外任意处取消选中
      const onDocMouseDown = (e: MouseEvent) => {
        if (!selected) return
        if (!container.contains(e.target as Node)) setSelected(false)
      }
      document.addEventListener('mousedown', onDocMouseDown)

      // 选中态下按 Delete/Backspace 删除图片（Word 行为）
      const onDocKeyDown = (e: KeyboardEvent) => {
        if (!selected) return
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          e.stopPropagation()
          const pos = getPos()
          if (pos !== undefined) {
            editor.chain().command(({ tr }) => {
              tr.delete(pos, pos + node.nodeSize)
              return true
            }).run()
          }
          setSelected(false)
        }
      }
      document.addEventListener('keydown', onDocKeyDown)

      const origDestroy = nodeView.destroy.bind(nodeView)
      nodeView.destroy = () => {
        container.removeEventListener('mousedown', onContainerMouseDown)
        document.removeEventListener('mousedown', onDocMouseDown)
        document.removeEventListener('keydown', onDocKeyDown)
        origDestroy()
      }

      return nodeView
    }
  },
})
