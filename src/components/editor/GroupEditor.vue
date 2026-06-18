<template>
  <div class="group-body" :id="'sgBody_' + groupId" :data-gid="groupId"
       ref="editorRef" />
</template>

<script setup lang="ts">
import { ref, provide, onMounted, onBeforeUnmount, watch } from 'vue'
import { isMobile, favicon, domain } from '../../utils.js'
import { I } from '../../config/icons.js'
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import Code from '@tiptap/extension-code'
import Heading from '@tiptap/extension-heading'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import History from '@tiptap/extension-history'
import Underline from '@tiptap/extension-underline'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useAppStore } from '../../stores/app.js'
import { useUndoStore } from '../../stores/undo.js'
import { EditorManager } from '../../lib/editor.js'
import { mfbAPI } from '../../composables/bridge.js'
import { pushUndo } from '../../composables/domain/useUndo.js'

const InlineCard = Node.create({
  name: 'inlineCard', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ 'data-bm-id': { default: null } }),
  parseHTML: () => [{ tag: 'span.group-inline-card[data-bm-id]', getAttrs: el => {
    const id = el.getAttribute('data-bm-id')
    // 排除组引用卡片（data-bm-id 以 "ref:" 开头），让 GroupRefCard 节点处理
    if (id && id.startsWith('ref:')) return false
    return id ? { 'data-bm-id': id } : false
  }}],
  renderHTML: ({ node }) => {
    const id = node.attrs['data-bm-id']
    const store = useAppStore()
    const bm = store.bookmarkMap[id]
    if (!bm) return ['span', { class: 'group-inline-card' }, '']
    return ['span', { class: 'group-inline-card', contenteditable: 'false', 'data-bm-id': id, draggable: 'true' },
      ['img', { src: favicon(bm.url, bm.icon), alt: '' }],
      ['span', { class: 'gic-name' }, bm.title],
      ['span', { class: 'gic-domain' }, domain(bm.url)],
      ['span', { class: 'gic-btn' }, '详']
    ]
  },
})

const GroupRefCard = Node.create({
  name: 'groupRefCard', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ 'data-ref-gid': { default: null } }),
  parseHTML: () => [{ tag: 'span.group-ref-card[data-bm-id]', getAttrs: el => {
    const bid = el.getAttribute('data-bm-id')
    if (bid && bid.startsWith('ref:')) return { 'data-ref-gid': bid.slice(4) }
    return false
  }}],
  renderHTML: ({ node }) => {
    const gid = node.attrs['data-ref-gid']
    const store = useAppStore()
    const g = store.groupMap[gid]

    const span = document.createElement('span')
    span.className = 'group-inline-card group-ref-card'
    span.setAttribute('contenteditable', 'false')
    span.setAttribute('data-bm-id', 'ref:' + gid)
    span.setAttribute('draggable', 'true')

    if (!g) {
      span.textContent = ''
      return span
    }

    if (g.icon) {
      const img = document.createElement('img')
      img.src = g.icon
      img.alt = ''
      span.appendChild(img)
    } else {
      const iconWrap = document.createElement('span')
      iconWrap.className = 'gic-note-icon'
      iconWrap.innerHTML = I.note
      span.appendChild(iconWrap)
    }

    const nameSpan = document.createElement('span')
    nameSpan.className = 'gic-name'
    nameSpan.textContent = g.name || '未命名组'
    span.appendChild(nameSpan)

    const countSpan = document.createElement('span')
    countSpan.className = 'gic-count'
    countSpan.textContent = (g.bookmarkIds?.length || 0) + '个书签'
    span.appendChild(countSpan)

    const btnSpan = document.createElement('span')
    btnSpan.className = 'gic-btn'
    btnSpan.textContent = '详'
    span.appendChild(btnSpan)

    return span
  },
})

const props = defineProps({ groupId: { type: String, required: true } })
const store = useAppStore()
const editorRef = ref(null)
const editorInstance = ref(null)
let editor = null

provide('tiptapEditor', editorInstance)

function syncToStore(ed) {
  const sg = store.groupMap[props.groupId]
  if (!sg) return
  sg.notes = ed.getHTML()
  const ids = [], seen = {}
  ed.state.doc.descendants(node => {
    if (node.type.name === 'inlineCard') {
      const bmid = node.attrs['data-bm-id']
      if (bmid && !seen[bmid]) { seen[bmid] = true; ids.push(bmid) }
    }
  })
  sg.bookmarkIds = ids
  store.debouncedSave()
}

onMounted(() => {
  const group = store.groupMap[props.groupId]
  if (!group || !editorRef.value) return

  editor = new Editor({
    element: editorRef.value,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Strike,
      Code,
      Heading.configure({ levels: [1, 2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      History,
      Underline,
      Color,
      TextStyle,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '输入文案…，按 @ 插入书签，按 # 插入组引用' }),
      InlineCard,
      GroupRefCard,
    ],
    content: group.notes || '',
    editable: !isMobile() || store.focusedGroupId === props.groupId,
    editorProps: { attributes: { class: 'group-tiptap' } },
    onUpdate: ({ editor: ed }) => { pushUndo(props.groupId); syncToStore(ed) },
  })

  editor._lvGid = props.groupId
  EditorManager.register(props.groupId, editor)
  editorInstance.value = editor

  // Mobile floating format bar: show on focus, hide on blur
  const el = editorRef.value
  if (el) {
    el.addEventListener('focusin', _onFocusIn)
    el.addEventListener('focusout', _onFocusOut)
  }

  // 移动端：只有聚焦后才可编辑
  if (isMobile()) {
    watch(() => store.focusedGroupId, (fid) => {
      editor?.setEditable(fid === props.groupId)
    })
  }
})

let _mfbBlurTimer = null

const undo = useUndoStore()

function _onFocusIn() {
  // 清除延迟保存定时器
  if (undo.saveTimers[props.groupId]) {
    clearTimeout(undo.saveTimers[props.groupId])
    delete undo.saveTimers[props.groupId]
  }
  // 移动端显示浮动格式栏（由 FormatToolbar.vue 通过 bridge.js 注册）
  if (isMobile() && store.focusedGroupId) {
    mfbAPI?.show?.()
  }
}

function _onFocusOut() {
  // 延迟保存
  undo.saveTimers[props.groupId] = setTimeout(() => {
    // syncToStore already handles saving via TipTap onUpdate
    delete undo.saveTimers[props.groupId]
  }, 200)
  // 延迟隐藏浮动格式栏
  if (_mfbBlurTimer) clearTimeout(_mfbBlurTimer)
  _mfbBlurTimer = setTimeout(() => {
    _mfbBlurTimer = null
    const ae = document.activeElement
    if (!ae?.closest?.('.group-body')) mfbAPI?.hide()
  }, 150)
}

onBeforeUnmount(() => {
  if (EditorManager.get(props.groupId) === editor) {
    EditorManager.unregister(props.groupId)
  }
  if (editor) { editor.destroy(); editor = null }
})
</script>