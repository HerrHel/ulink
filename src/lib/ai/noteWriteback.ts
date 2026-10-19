/**
 * noteWriteback.ts — AI 对话产物反向沉淀与写回笔记引擎
 *
 * 职责：
 * 1. 将 AI 回复（含随文嵌入卡片）规范化转换为轻量富文本 HTML；
 * 2. 支持追加（Append）到指定笔记组（时间戳注记、TipTap 同步、数据层写入）；
 * 3. 支持替换（Replace）原笔记内容；
 * 4. 支持新建（New）知识沉淀笔记组；
 * 5. 全链路集成带撤销的 toastWithUndo，确保用户笔记数据 100% 安全可逆。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { EditorManager } from '../editor.js'
import { saveAppData } from '../../stores/app.js'
import { toast, toastWithUndo } from '../toast.js'
import { t } from '../../i18n/index.js'
import { gid } from '../../utils.js'
import { formatLightMarkdown } from './chatStreamParser.js'
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js'
import type { SiblingGroup } from '../../types.js'

/**
 * 将 AI 生成的回复文本转换为适合存入笔记的规范 HTML
 * 将 ```ulink-card ... ``` 代码块转为优雅的笔记链接项，并利用 formatLightMarkdown 完成富文本渲染
 */
export function convertAiContentToNoteHtml(aiContent: string): string {
  if (!aiContent || !aiContent.trim()) return ''

  // 1. 处理 ```ulink-card ... ``` 随文卡片区块，将其转化为人类可读的结构化书签链接行
  const cardBlockRegex = /```ulink-card\s*([\s\S]*?)```/gi
  let processed = aiContent.replace(cardBlockRegex, (_, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr.trim())
      const title = parsed.title || parsed.url || '参考网站'
      const url = parsed.url || '#'
      const notes = parsed.notes ? ` — ${parsed.notes}` : ''
      return `\n- 🔗 **[${title}](${url})**${notes}\n`
    } catch {
      return ''
    }
  })

  // 2. 清理多余空行
  processed = processed.replace(/\n{3,}/g, '\n\n').trim()

  // 3. 利用已验证的安全轻量 Markdown 格式化产出标准 HTML
  return formatLightMarkdown(processed)
}

export interface AppendOptions {
  noteTitle?: string
}

/**
 * 📥 追加 AI 回复到指定笔记组
 */
export function appendAiContentToGroup(
  groupId: string,
  aiContent: string,
  _options?: AppendOptions
): { success: boolean; error?: string } {
  const ds = useDataStore()
  const rawGid = groupId.replace(/^group:/, '')
  const group = ds.groupMap[rawGid] || ds.siblingGroups.find((g) => g.id === rawGid)

  if (!group) {
    return { success: false, error: 'Group not found' }
  }

  const oldNotes = EditorManager.getContentHTML(rawGid) ?? group.notes ?? ''
  const newSectionHtml = convertAiContentToNoteHtml(aiContent)
  if (!newSectionHtml) {
    return { success: false, error: 'Empty content' }
  }

  // 构造带时间戳的追加内容
  const now = new Date()
  const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

  let mergedHtml = ''
  if (!oldNotes || oldNotes.trim() === '' || oldNotes === '<p></p>') {
    mergedHtml = newSectionHtml
  } else {
    mergedHtml = `${oldNotes}<hr class="ai-divider"><p class="ai-writeback-meta"><em>AI 补充记录 · ${timeLabel}</em></p>${newSectionHtml}`
  }

  // 同步 TipTap 编辑器（静默模式）与数据层
  EditorManager.silentSetContent(rawGid, mergedHtml)
  ds.updateGroup(rawGid, { notes: mergedHtml, updatedAt: Date.now() })
  saveAppData()

  // 注册安全撤销操作
  toastWithUndo(t('ai.noteAppendedSuccess'), () => {
    EditorManager.silentSetContent(rawGid, oldNotes)
    ds.updateGroup(rawGid, { notes: oldNotes, updatedAt: Date.now() })
    saveAppData()
    toast(t('ai.writebackRevertedToast'))
  })

  return { success: true }
}

/**
 * 🔄 替换原笔记内容为 AI 回复
 */
export function replaceAiContentToGroup(
  groupId: string,
  aiContent: string
): { success: boolean; error?: string } {
  const ds = useDataStore()
  const rawGid = groupId.replace(/^group:/, '')
  const group = ds.groupMap[rawGid] || ds.siblingGroups.find((g) => g.id === rawGid)

  if (!group) {
    return { success: false, error: 'Group not found' }
  }

  const oldNotes = EditorManager.getContentHTML(rawGid) ?? group.notes ?? ''
  const newHtml = convertAiContentToNoteHtml(aiContent)
  if (!newHtml) {
    return { success: false, error: 'Empty content' }
  }

  EditorManager.silentSetContent(rawGid, newHtml)
  ds.updateGroup(rawGid, { notes: newHtml, updatedAt: Date.now() })
  saveAppData()

  toastWithUndo(t('ai.noteReplacedSuccess'), () => {
    EditorManager.silentSetContent(rawGid, oldNotes)
    ds.updateGroup(rawGid, { notes: oldNotes, updatedAt: Date.now() })
    saveAppData()
    toast(t('ai.writebackRevertedToast'))
  })

  return { success: true }
}

export interface CreateNoteOptions {
  aiText: string
  topicTitle?: string
  categoryId?: string
}

/**
 * 📝 将 AI 回复存为新的笔记组
 */
export function createNoteFromAiContent(options: CreateNoteOptions): {
  success: boolean
  groupId?: string
  error?: string
} {
  const ds = useDataStore()
  const ui = useUIStore()

  const htmlContent = convertAiContentToNoteHtml(options.aiText)
  if (!htmlContent) {
    return { success: false, error: 'Empty content' }
  }

  // 推导笔记标题
  let finalTitle = options.topicTitle?.trim() || ''
  if (!finalTitle) {
    const matchHeading = options.aiText.match(/^#+\s*(.+)$/m)
    if (matchHeading && matchHeading[1]) {
      finalTitle = matchHeading[1].trim()
    } else {
      const firstLine = options.aiText.trim().split('\n')[0].replace(/[*#`_]/g, '').trim()
      finalTitle = firstLine ? firstLine.slice(0, 24) : t('ai.newNoteDefaultTitle')
    }
  }

  const targetCategory =
    options.categoryId || (ui.curCat === CAT_ALL ? CAT_UNCATEGORIZED : ui.curCat)

  const newGid = 'sg_' + gid()
  const maxBmOrder = ds.bookmarks.reduce(
    (m, b) => (b.parentId ? m : b.order > m ? b.order : m),
    -1
  )
  const maxGrpOrder = ds.siblingGroups.reduce((m, g) => (g.order > m ? g.order : m), -1)

  const newGroup: SiblingGroup = {
    id: newGid,
    name: finalTitle,
    categoryId: targetCategory,
    icon: '',
    order: Math.max(maxBmOrder, maxGrpOrder) + 1,
    isExpanded: false,
    attributes: { [ATTR_IS_GROUP]: true },
    bookmarkIds: [],
    notes: htmlContent,
    updatedAt: Date.now(),
    useCount: 0,
  }

  ds.addGroup(newGroup)
  saveAppData()

  toastWithUndo(t('ai.noteCreatedSuccess', { title: finalTitle }), () => {
    ds.deleteGroup(newGid)
    saveAppData()
    toast(t('ai.writebackRevertedToast'))
  })

  return { success: true, groupId: newGid }
}
