/**
 * universalAgent.ts — ULink 全能管家操作中枢 (Universal Agent Executive Core)
 *
 * 赋予 AI Agent 完备的全端操作能力（用户能做到的任何事，AI 管家都能代办）：
 * 1. 分类管理 (manage_categories): create, rename, delete, restore, update_color, update_icon
 * 2. 标签属性 (manage_tags): create, rename, delete, restore
 * 3. 书签治理 (manage_bookmarks): add, update, move, delete, restore, set_parent, remove_parent, toggle_pin
 * 4. 工作台装配 (manage_workspaces): create, rename, delete, restore, add_bookmarks, remove_bookmarks, update_notes
 * 5. 偏好调度 (manage_settings): toggle_theme, change_view, navigate, empty_trash, export_data
 *
 * 核心设计契约：
 * - 每一个写操作均无缝接入本地撤销事务栈（siteUndoStack），支持随时对话撤销与 ToastWithUndo；
 * - 纯端侧响应，安全合规，实时更新 Pinia Store 并保存至本地 IndexedDB/LocalStorage；
 * - 输出温润、清晰的管家式自然语言汇报与操作结果反馈。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore, type LayoutMode } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { gid, favicon, domain } from '../../utils.js'
import { attrSlug } from '../../composables/domain/attrSlug.js'
import { normalizeUrlForDedup } from './localClustering.js'
import { pushUndoAction } from './siteUndoStack.js'
import { toastWithUndo } from '../toast.js'
import { CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js'
import type { Bookmark, Category, SiblingGroup, CustomAttribute } from '../../types.js'

export interface AgentExecutionContext {
  ds?: ReturnType<typeof useDataStore>
  ui?: ReturnType<typeof useUIStore>
  app?: ReturnType<typeof useAppStore>
  signal?: AbortSignal
}

export interface AgentExecutionResult<T = unknown> {
  success: boolean
  message: string
  data?: T
}

// ─────────────────────────────────────────────────────────────
// 1. 分类管理 (manage_categories)
// ─────────────────────────────────────────────────────────────

export interface ManageCategoriesParams {
  action: 'create' | 'rename' | 'delete' | 'restore' | 'update_color' | 'update_icon'
  name?: string
  newName?: string
  categoryId?: string
  color?: string
  icon?: string
  reason?: string
}

export async function executeManageCategories(
  params: ManageCategoriesParams,
  context?: AgentExecutionContext,
): Promise<AgentExecutionResult<Category>> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  if (context?.signal?.aborted) return { success: false, message: '操作已取消。' }

  const action = params.action
  const rawName = (params.name || '').trim()

  // 辅助定位分类（支持按 ID 或按名称匹配）
  const findCategory = (identifier?: string, includeDeleted = false): Category | undefined => {
    if (!identifier) return undefined
    const idClean = identifier.trim()
    const byId = ds.categories.find((c: Category) => (includeDeleted || !c.deletedAt) && c.id === idClean)
    if (byId) return byId
    const nameLower = idClean.toLowerCase()
    return ds.categories.find(
      (c: Category) => (includeDeleted || !c.deletedAt) && c.name.trim().toLowerCase() === nameLower,
    )
  }

  if (action === 'create') {
    if (!rawName) {
      return { success: false, message: '创建失败：未提供有效的分类名称。' }
    }
    const exists = ds.categories.find((c: Category) => !c.deletedAt && c.name.toLowerCase() === rawName.toLowerCase())
    if (exists) {
      return { success: false, message: `分类「${rawName}」已存在，无需重复创建。` }
    }
    const catId = 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    const newCat: Category = {
      id: catId,
      name: rawName,
      icon: params.icon || 'folder',
      color: params.color || '#122E8A',
      order: ds.categories.length,
      updatedAt: Date.now(),
    }
    ds.addCategory(newCat)
    app.save?.()

    pushUndoAction({
      type: 'category_create',
      description: `新建分类「${rawName}」`,
      revert: () => {
        ds.deleteCategory(catId)
        app.save?.()
        return `已撤销新建分类「${rawName}」`
      },
    })
    toastWithUndo(`已新建分类「${rawName}」`, () => {
      ds.deleteCategory(catId)
      app.save?.()
    })

    return { success: true, message: `已成功为您创建分类「${rawName}」。`, data: newCat }
  }

  if (action === 'rename') {
    const cat = findCategory(params.categoryId || rawName)
    if (!cat) {
      return { success: false, message: `未找到欲重命名的分类「${rawName || params.categoryId}」。` }
    }
    const nextName = (params.newName || '').trim()
    if (!nextName) {
      return { success: false, message: '重命名失败：新分类名称不能为空。' }
    }
    const prevName = cat.name
    ds.renameCategory(cat.id, nextName)
    app.save?.()

    pushUndoAction({
      type: 'category_rename',
      description: `重命名分类「${prevName}」为「${nextName}」`,
      revert: () => {
        ds.renameCategory(cat.id, prevName)
        app.save?.()
        return `已恢复分类名称为「${prevName}」`
      },
    })
    toastWithUndo(`分类已重命名为「${nextName}」`, () => {
      ds.renameCategory(cat.id, prevName)
      app.save?.()
    })

    return { success: true, message: `已成功将分类「${prevName}」重命名为「${nextName}」。` }
  }

  if (action === 'delete') {
    const cat = findCategory(params.categoryId || rawName)
    if (!cat) {
      return { success: false, message: `未找到待删除的分类「${rawName || params.categoryId}」。` }
    }
    if (cat.id === 'all' || cat.id === CAT_UNCATEGORIZED) {
      return { success: false, message: '系统内置分类受保护，不支持删除。' }
    }
    const catName = cat.name
    ds.deleteCategory(cat.id)
    app.save?.()

    pushUndoAction({
      type: 'category_delete',
      description: `删除分类「${catName}」`,
      revert: () => {
        ds.restoreCategory(cat.id)
        app.save?.()
        return `已恢复分类「${catName}」`
      },
    })
    toastWithUndo(`分类「${catName}」已移入回收站`, () => {
      ds.restoreCategory(cat.id)
      app.save?.()
    })

    return { success: true, message: `已将分类「${catName}」移入回收站（所属书签已安全暂存入未分类）。` }
  }

  if (action === 'restore') {
    const cat = findCategory(params.categoryId || rawName, true)
    if (!cat || !cat.deletedAt) {
      return { success: false, message: `回收站中未找到分类「${rawName || params.categoryId}」。` }
    }
    ds.restoreCategory(cat.id)
    app.save?.()

    pushUndoAction({
      type: 'category_restore',
      description: `恢复分类「${cat.name}」`,
      revert: () => {
        ds.deleteCategory(cat.id)
        app.save?.()
        return `已撤销恢复分类「${cat.name}」`
      },
    })

    return { success: true, message: `已为您恢复分类「${cat.name}」。`, data: cat }
  }

  if (action === 'update_color' || action === 'update_icon') {
    const cat = findCategory(params.categoryId || rawName)
    if (!cat) return { success: false, message: `未找到分类「${rawName || params.categoryId}」。` }
    const prevColor = cat.color
    const prevIcon = cat.icon
    const patch: Partial<Category> = {}
    if (params.color) patch.color = params.color
    if (params.icon) patch.icon = params.icon
    ds.updateCategory(cat.id, patch)
    app.save?.()

    pushUndoAction({
      type: 'category_update_style',
      description: `更新分类「${cat.name}」外观`,
      revert: () => {
        ds.updateCategory(cat.id, { color: prevColor, icon: prevIcon })
        app.save?.()
        return `已恢复分类「${cat.name}」的外观设置`
      },
    })
    return { success: true, message: `已成功更新分类「${cat.name}」的外观设置。` }
  }

  return { success: false, message: `不支持的分类操作动作：${action}` }
}

// ─────────────────────────────────────────────────────────────
// 2. 标签与属性管理 (manage_tags)
// ─────────────────────────────────────────────────────────────

export interface ManageTagsParams {
  action: 'create' | 'rename' | 'delete' | 'restore'
  name?: string
  newName?: string
  tagId?: string
  reason?: string
}

export async function executeManageTags(
  params: ManageTagsParams,
  context?: AgentExecutionContext,
): Promise<AgentExecutionResult<CustomAttribute>> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  if (context?.signal?.aborted) return { success: false, message: '操作已取消。' }

  const action = params.action
  const rawName = (params.name || '').trim()

  const findTag = (identifier?: string, includeDeleted = false): CustomAttribute | undefined => {
    if (!identifier) return undefined
    const clean = identifier.trim()
    const byId = ds.customAttributes.find((a: CustomAttribute) => (includeDeleted || !a.deletedAt) && a.id === clean)
    if (byId) return byId
    const lower = clean.toLowerCase()
    return ds.customAttributes.find((a: CustomAttribute) => (includeDeleted || !a.deletedAt) && a.name.toLowerCase() === lower)
  }

  if (action === 'create') {
    if (!rawName) return { success: false, message: '创建失败：未提供标签名称。' }
    const exists = ds.customAttributes.find((a: CustomAttribute) => !a.deletedAt && a.name.toLowerCase() === rawName.toLowerCase())
    if (exists) {
      return { success: false, message: `标签「${rawName}」已存在，无需重复创建。` }
    }
    const tagId = attrSlug(rawName) || gid()
    const newAttr: CustomAttribute = {
      id: ds.attributeMap[tagId] ? `attr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : tagId,
      name: rawName,
      type: 'boolean',
      updatedAt: Date.now(),
    }
    ds.addAttribute(newAttr)
    app.save?.()

    pushUndoAction({
      type: 'tag_create',
      description: `新建标签「${rawName}」`,
      revert: () => {
        ds.deleteAttribute(newAttr.id)
        app.save?.()
        return `已撤销新建标签「${rawName}」`
      },
    })
    toastWithUndo(`已新建标签「${rawName}」`, () => {
      ds.deleteAttribute(newAttr.id)
      app.save?.()
    })
    return { success: true, message: `已成功创建标签「${rawName}」。`, data: newAttr }
  }

  if (action === 'rename') {
    const tag = findTag(params.tagId || rawName)
    if (!tag) return { success: false, message: `未找到标签「${rawName || params.tagId}」。` }
    const nextName = (params.newName || '').trim()
    if (!nextName) return { success: false, message: '重命名失败：新标签名称不能为空。' }
    const prevName = tag.name
    ds.renameAttribute(tag.id, nextName)
    app.save?.()

    pushUndoAction({
      type: 'tag_rename',
      description: `重命名标签「${prevName}」为「${nextName}」`,
      revert: () => {
        ds.renameAttribute(tag.id, prevName)
        app.save?.()
        return `已恢复标签名为「${prevName}」`
      },
    })
    return { success: true, message: `已将标签「${prevName}」重命名为「${nextName}」。` }
  }

  if (action === 'delete') {
    const tag = findTag(params.tagId || rawName)
    if (!tag) return { success: false, message: `未找到待删除的标签「${rawName || params.tagId}」。` }
    const tagName = tag.name
    ds.deleteAttribute(tag.id)
    app.save?.()

    pushUndoAction({
      type: 'tag_delete',
      description: `删除标签「${tagName}」`,
      revert: () => {
        ds.restoreAttribute(tag.id)
        app.save?.()
        return `已恢复标签「${tagName}」`
      },
    })
    toastWithUndo(`标签「${tagName}」已删除`, () => {
      ds.restoreAttribute(tag.id)
      app.save?.()
    })
    return { success: true, message: `已为您删除标签「${tagName}」。` }
  }

  if (action === 'restore') {
    const tag = findTag(params.tagId || rawName, true)
    if (!tag || !tag.deletedAt) return { success: false, message: `未找到可恢复的标签「${rawName || params.tagId}」。` }
    ds.restoreAttribute(tag.id)
    app.save?.()

    pushUndoAction({
      type: 'tag_restore',
      description: `恢复标签「${tag.name}」`,
      revert: () => {
        ds.deleteAttribute(tag.id)
        app.save?.()
        return `已撤销恢复标签「${tag.name}」`
      },
    })
    return { success: true, message: `已为您恢复标签「${tag.name}」。`, data: tag }
  }

  return { success: false, message: `不支持的标签操作动作：${action}` }
}

// ─────────────────────────────────────────────────────────────
// 3. 书签管理 (manage_bookmarks)
// ─────────────────────────────────────────────────────────────

export interface ManageBookmarksParams {
  action: 'add' | 'update' | 'move' | 'delete' | 'restore' | 'set_parent' | 'remove_parent' | 'toggle_pin'
  target?: string
  bookmarkId?: string
  url?: string
  title?: string
  notes?: string
  icon?: string
  targetCategory?: string
  category?: string
  targetParent?: string
  parentId?: string
  tags?: string[]
  reason?: string
}

export async function executeManageBookmarks(
  params: ManageBookmarksParams,
  context?: AgentExecutionContext,
): Promise<AgentExecutionResult<Bookmark>> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  if (context?.signal?.aborted) return { success: false, message: '操作已取消。' }

  const action = params.action

  // 辅助定位书签：支持 ID、完全匹配 URL、规范化 URL、标题完全匹配、标题包含匹配
  const findBookmark = (query?: string, includeDeleted = false): Bookmark | undefined => {
    if (!query) return undefined
    const q = query.trim()
    const active = ds.bookmarks.filter((b: Bookmark) => includeDeleted || !b.deletedAt)

    const byId = active.find((b: Bookmark) => b.id === q)
    if (byId) return byId

    const byUrl = active.find((b: Bookmark) => b.url === q)
    if (byUrl) return byUrl

    const norm = normalizeUrlForDedup(q)
    if (norm) {
      const byNorm = active.find((b: Bookmark) => normalizeUrlForDedup(b.url) === norm)
      if (byNorm) return byNorm
    }

    const qLower = q.toLowerCase()
    const byTitleExact = active.find((b: Bookmark) => b.title?.trim().toLowerCase() === qLower)
    if (byTitleExact) return byTitleExact

    return active.find((b: Bookmark) => b.title?.toLowerCase().includes(qLower))
  }

  if (action === 'add') {
    const rawUrl = (params.url || '').trim()
    if (!rawUrl) return { success: false, message: '添加书签失败：未提供目标网址 URL。' }
    const validUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

    const rawTitle = (params.title || '').trim() || domain(validUrl) || '新书签'

    // 匹配分类
    let targetCatId = CAT_UNCATEGORIZED
    const catInput = params.targetCategory || params.category
    if (catInput) {
      const catQuery = catInput.trim().toLowerCase()
      const foundCat = ds.categories.find(
        (c: Category) => !c.deletedAt && (c.id === catQuery || c.name.toLowerCase() === catQuery || c.name.toLowerCase().includes(catQuery)),
      )
      if (foundCat) targetCatId = foundCat.id
    }

    // 匹配父书签（若有嵌套要求）
    let parentId: string | null = null
    const parentInput = params.targetParent || params.parentId
    if (parentInput) {
      const pBm = findBookmark(parentInput)
      if (pBm) parentId = pBm.id
    }

    // 标签处理
    const attrMap: Record<string, boolean> = {}
    if (Array.isArray(params.tags) && params.tags.length > 0) {
      for (const tName of params.tags) {
        const cleanT = String(tName).trim()
        if (!cleanT) continue
        const existingAttr = ds.customAttributes.find(
          (a: CustomAttribute) => !a.deletedAt && a.name.toLowerCase() === cleanT.toLowerCase(),
        )
        let aId = existingAttr?.id
        if (!aId) {
          aId = attrSlug(cleanT) || gid()
          if (ds.attributeMap[aId]) aId = `attr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          ds.addAttribute({ id: aId, name: cleanT, type: 'boolean' })
        }
        attrMap[aId] = true
      }
    }

    const id = gid()
    const newBm: Bookmark = {
      id,
      title: rawTitle,
      url: validUrl,
      username: '',
      password: '',
      notes: (params.notes || '').trim(),
      icon: (params.icon || '').trim() || favicon(validUrl),
      categoryId: targetCatId,
      parentId,
      order: ds.nextBookmarkOrder?.() ?? ds.bookmarks.length,
      useCount: 0,
      attributes: attrMap,
      isExpanded: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    ds.addBookmark(newBm)
    app.save?.()

    pushUndoAction({
      type: 'bookmark_add',
      description: `添加书签「${rawTitle}」`,
      revert: () => {
        ds.deleteBookmark(id)
        app.save?.()
        return `已撤销添加书签「${rawTitle}」`
      },
    })
    toastWithUndo(`已添加书签「${rawTitle}」`, () => {
      ds.deleteBookmark(id)
      app.save?.()
    })

    const catName = ds.categoryMap[targetCatId]?.name || '未分类'
    return { success: true, message: `已成功为您添加书签「${rawTitle}」（归属「${catName}」）。`, data: newBm }
  }

  // 针对现有书签的操作先定位
  const targetQuery = params.target || params.bookmarkId || params.url || params.title
  const bm = findBookmark(targetQuery, action === 'restore')
  if (!bm) {
    return { success: false, message: `书签库中未能找到与「${targetQuery || '指定条件'}」匹配的书签。` }
  }

  if (action === 'update') {
    const prevSnapshot: Partial<Bookmark> = {
      title: bm.title,
      url: bm.url,
      notes: bm.notes,
      icon: bm.icon,
      attributes: { ...(bm.attributes || {}) },
    }
    const patch: Partial<Bookmark> = {}
    if (params.title) patch.title = params.title.trim()
    if (params.url) patch.url = params.url.trim()
    if (params.notes !== undefined) patch.notes = params.notes.trim()
    if (params.icon) patch.icon = params.icon.trim()

    if (Array.isArray(params.tags)) {
      const nextAttrs = { ...(bm.attributes || {}) }
      for (const tName of params.tags) {
        const cleanT = String(tName).trim()
        if (!cleanT) continue
        const existing = ds.customAttributes.find(
          (a: CustomAttribute) => !a.deletedAt && a.name.toLowerCase() === cleanT.toLowerCase(),
        )
        let aId = existing?.id
        if (!aId) {
          aId = attrSlug(cleanT) || gid()
          if (ds.attributeMap[aId]) aId = `attr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          ds.addAttribute({ id: aId, name: cleanT, type: 'boolean' })
        }
        nextAttrs[aId] = true
      }
      patch.attributes = nextAttrs
    }

    ds.updateBookmark(bm.id, patch)
    app.save?.()

    pushUndoAction({
      type: 'bookmark_update',
      description: `修改书签「${bm.title}」`,
      revert: () => {
        ds.updateBookmark(bm.id, prevSnapshot)
        app.save?.()
        return `已恢复书签「${prevSnapshot.title}」的原始资料`
      },
    })
    return { success: true, message: `已成功更新书签「${bm.title}」的信息。`, data: bm }
  }

  if (action === 'move') {
    const catQuery = (params.targetCategory || params.category || '').trim().toLowerCase()
    if (!catQuery) return { success: false, message: '移动失败：未指明目标分类。' }
    const targetCat = ds.categories.find(
      (c: Category) => !c.deletedAt && (c.name.toLowerCase() === catQuery || c.name.toLowerCase().includes(catQuery)),
    )
    if (!targetCat) return { success: false, message: `未找到目标分类「${params.targetCategory || params.category}」。` }

    const prevCatId = bm.categoryId
    ds.updateBookmark(bm.id, { categoryId: targetCat.id })
    app.save?.()

    pushUndoAction({
      type: 'bookmark_move',
      description: `移动书签「${bm.title}」至「${targetCat.name}」`,
      revert: () => {
        ds.updateBookmark(bm.id, { categoryId: prevCatId })
        app.save?.()
        return `已将书签「${bm.title}」移回原分类`
      },
    })
    toastWithUndo(`已将「${bm.title}」移至「${targetCat.name}」`, () => {
      ds.updateBookmark(bm.id, { categoryId: prevCatId })
      app.save?.()
    })
    return { success: true, message: `已为您将书签「${bm.title}」移动至分类「${targetCat.name}」。`, data: bm }
  }

  if (action === 'set_parent') {
    const parentQuery = (params.targetParent || params.parentId || '').trim()
    if (!parentQuery) return { success: false, message: '请提供欲挂靠的父书签名称或网址。' }
    const parentBm = findBookmark(parentQuery)
    if (!parentBm) return { success: false, message: `未找到父书签「${parentQuery}」。` }
    if (parentBm.id === bm.id) return { success: false, message: '不能将书签自身设置为其父级。' }
    if (parentBm.parentId === bm.id) return { success: false, message: '检测到循环从属关系，无法嵌套。' }

    const prevParent = bm.parentId
    ds.updateBookmark(bm.id, { parentId: parentBm.id })
    app.save?.()

    pushUndoAction({
      type: 'bookmark_nest',
      description: `将「${bm.title}」挂靠于「${parentBm.title}」下`,
      revert: () => {
        ds.updateBookmark(bm.id, { parentId: prevParent })
        app.save?.()
        return `已恢复「${bm.title}」的原从属关系`
      },
    })
    return { success: true, message: `已为您将「${bm.title}」挂靠在父站点「${parentBm.title}」下。`, data: bm }
  }

  if (action === 'remove_parent') {
    const prevParent = bm.parentId
    if (!prevParent) {
      return { success: true, message: `书签「${bm.title}」原本即为顶级独立书签，无需解绑。` }
    }
    ds.updateBookmark(bm.id, { parentId: null })
    app.save?.()

    pushUndoAction({
      type: 'bookmark_unnest',
      description: `将「${bm.title}」解绑为顶级书签`,
      revert: () => {
        ds.updateBookmark(bm.id, { parentId: prevParent })
        app.save?.()
        return `已将「${bm.title}」重新挂回原父级`
      },
    })
    return { success: true, message: `已为您将「${bm.title}」从父级解绑，恢复为独立顶级书签。`, data: bm }
  }

  if (action === 'delete') {
    const title = bm.title
    ds.deleteBookmark(bm.id)
    app.save?.()

    pushUndoAction({
      type: 'bookmark_delete',
      description: `删除书签「${title}」`,
      revert: () => {
        ds.restoreBookmark(bm.id)
        app.save?.()
        return `已恢复书签「${title}」`
      },
    })
    toastWithUndo(`书签「${title}」已移入回收站`, () => {
      ds.restoreBookmark(bm.id)
      app.save?.()
    })
    return { success: true, message: `已为您将书签「${title}」移入回收站。` }
  }

  if (action === 'restore') {
    ds.restoreBookmark(bm.id)
    app.save?.()

    pushUndoAction({
      type: 'bookmark_restore',
      description: `恢复书签「${bm.title}」`,
      revert: () => {
        ds.deleteBookmark(bm.id)
        app.save?.()
        return `已撤销恢复「${bm.title}」`
      },
    })
    return { success: true, message: `已为您从回收站恢复书签「${bm.title}」。`, data: bm }
  }

  if (action === 'toggle_pin') {
    ds.togglePin('bookmark', bm.id)
    app.save?.()
    const nowPinned = !!ds.bookmarkMap[bm.id]?.pinnedAt

    pushUndoAction({
      type: 'bookmark_pin',
      description: `${nowPinned ? '置顶' : '取消置顶'}书签「${bm.title}」`,
      revert: () => {
        ds.togglePin('bookmark', bm.id)
        app.save?.()
        return `已撤销置顶切换`
      },
    })
    return { success: true, message: nowPinned ? `已成功将书签「${bm.title}」置顶。` : `已取消书签「${bm.title}」的置顶。` }
  }

  return { success: false, message: `不支持的书签操作动作：${action}` }
}

// ─────────────────────────────────────────────────────────────
// 4. 工作台/笔记组管理 (manage_workspaces)
// ─────────────────────────────────────────────────────────────

export interface ManageWorkspacesParams {
  action: 'create' | 'rename' | 'delete' | 'restore' | 'add_bookmarks' | 'remove_bookmarks' | 'update_notes'
  workspaceId?: string
  name?: string
  newName?: string
  notes?: string
  targetCategory?: string
  category?: string
  bookmarkQueries?: string[]
  bookmarkIds?: string[]
  reason?: string
}

export async function executeManageWorkspaces(
  params: ManageWorkspacesParams,
  context?: AgentExecutionContext,
): Promise<AgentExecutionResult<SiblingGroup>> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  if (context?.signal?.aborted) return { success: false, message: '操作已取消。' }

  const action = params.action
  const rawName = (params.name || '').trim()

  const findWorkspace = (identifier?: string, includeDeleted = false): SiblingGroup | undefined => {
    if (!identifier) return undefined
    const clean = identifier.trim()
    const byId = ds.siblingGroups.find((g: SiblingGroup) => (includeDeleted || !g.deletedAt) && g.id === clean)
    if (byId) return byId
    const lower = clean.toLowerCase()
    return ds.siblingGroups.find((g: SiblingGroup) => (includeDeleted || !g.deletedAt) && g.name.toLowerCase().includes(lower))
  }

  if (action === 'create') {
    const wsName = rawName || '专属工作台'
    let catId = CAT_UNCATEGORIZED
    const catInput = params.targetCategory || params.category
    if (catInput) {
      const cQ = catInput.trim().toLowerCase()
      const found = ds.categories.find(
        (c: Category) => !c.deletedAt && (c.name.toLowerCase() === cQ || c.name.toLowerCase().includes(cQ)),
      )
      if (found) catId = found.id
    }

    // 匹配欲装配的书签
    const matchedIds: string[] = []
    const queries = params.bookmarkQueries || params.bookmarkIds || []
    if (Array.isArray(queries)) {
      for (const bq of queries) {
        const cleanQ = String(bq).trim().toLowerCase()
        if (!cleanQ) continue
        const matched = ds.bookmarks.find(
          (b: Bookmark) =>
            !b.deletedAt &&
            (b.id === cleanQ ||
              b.url === cleanQ ||
              b.title?.toLowerCase() === cleanQ ||
              b.title?.toLowerCase().includes(cleanQ)),
        )
        if (matched && !matchedIds.includes(matched.id)) {
          matchedIds.push(matched.id)
        }
      }
    }

    const id = gid()
    const newGroup: SiblingGroup = {
      id,
      name: wsName,
      categoryId: catId,
      icon: 'folder',
      order: ds.siblingGroups.length,
      isExpanded: false,
      attributes: { [ATTR_IS_GROUP]: true },
      bookmarkIds: matchedIds,
      notes: (params.notes || '').trim(),
      updatedAt: Date.now(),
      useCount: 0,
    }
    ds.addGroup(newGroup)
    app.save?.()

    pushUndoAction({
      type: 'workspace_create',
      description: `创建工作台「${wsName}」`,
      revert: () => {
        ds.deleteGroup(id)
        app.save?.()
        return `已撤销创建工作台「${wsName}」`
      },
    })
    toastWithUndo(`已搭建工作台「${wsName}」`, () => {
      ds.deleteGroup(id)
      app.save?.()
    })

    return {
      success: true,
      message: `已为您成功搭建工作台「${wsName}」（内含 ${matchedIds.length} 个工具书签）。`,
      data: newGroup,
    }
  }

  const grp = findWorkspace(params.workspaceId || rawName, action === 'restore')
  if (!grp) {
    return { success: false, message: `未找到工作台「${rawName || params.workspaceId}」。` }
  }

  if (action === 'rename') {
    const nextName = (params.newName || '').trim()
    if (!nextName) return { success: false, message: '重命名失败：新工作台名称不能为空。' }
    const prevName = grp.name
    ds.updateGroup(grp.id, { name: nextName })
    app.save?.()

    pushUndoAction({
      type: 'workspace_rename',
      description: `重命名工作台「${prevName}」为「${nextName}」`,
      revert: () => {
        ds.updateGroup(grp.id, { name: prevName })
        app.save?.()
        return `已恢复工作台名称为「${prevName}」`
      },
    })
    return { success: true, message: `已成功将工作台「${prevName}」重命名为「${nextName}」。` }
  }

  if (action === 'update_notes') {
    const prevNotes = grp.notes
    ds.updateGroup(grp.id, { notes: params.notes || '' })
    app.save?.()

    pushUndoAction({
      type: 'workspace_notes',
      description: `更新工作台「${grp.name}」笔记`,
      revert: () => {
        ds.updateGroup(grp.id, { notes: prevNotes })
        app.save?.()
        return `已恢复工作台「${grp.name}」的历史笔记`
      },
    })
    return { success: true, message: `已成功更新工作台「${grp.name}」的笔记内容。` }
  }

  if (action === 'add_bookmarks' || action === 'remove_bookmarks') {
    const prevIds = [...(grp.bookmarkIds || [])]
    const curIdsSet = new Set(prevIds)
    const queries = params.bookmarkQueries || params.bookmarkIds || []

    if (Array.isArray(queries)) {
      for (const bq of queries) {
        const cleanQ = String(bq).trim().toLowerCase()
        const targetBm = ds.bookmarks.find(
          (b: Bookmark) =>
            !b.deletedAt &&
            (b.id === cleanQ ||
              b.url === cleanQ ||
              b.title?.toLowerCase() === cleanQ ||
              b.title?.toLowerCase().includes(cleanQ)),
        )
        if (targetBm) {
          if (action === 'add_bookmarks') curIdsSet.add(targetBm.id)
          else curIdsSet.delete(targetBm.id)
        }
      }
    }

    const nextIds = Array.from(curIdsSet)
    ds.updateGroup(grp.id, { bookmarkIds: nextIds })
    app.save?.()

    pushUndoAction({
      type: 'workspace_modify_bms',
      description: `调整工作台「${grp.name}」的书签集合`,
      revert: () => {
        ds.updateGroup(grp.id, { bookmarkIds: prevIds })
        app.save?.()
        return `已恢复工作台「${grp.name}」书签成员`
      },
    })

    const diff = Math.abs(nextIds.length - prevIds.length)
    return {
      success: true,
      message:
        action === 'add_bookmarks'
          ? `已成功向工作台「${grp.name}」增补 ${diff} 个书签工具。`
          : `已成功从工作台「${grp.name}」移出 ${diff} 个书签工具。`,
    }
  }

  if (action === 'delete') {
    ds.deleteGroup(grp.id)
    app.save?.()

    pushUndoAction({
      type: 'workspace_delete',
      description: `删除工作台「${grp.name}」`,
      revert: () => {
        ds.restoreGroup(grp.id)
        app.save?.()
        return `已恢复工作台「${grp.name}」`
      },
    })
    toastWithUndo(`工作台「${grp.name}」已移入回收站`, () => {
      ds.restoreGroup(grp.id)
      app.save?.()
    })
    return { success: true, message: `已将工作台「${grp.name}」移入回收站。` }
  }

  if (action === 'restore') {
    ds.restoreGroup(grp.id)
    app.save?.()

    pushUndoAction({
      type: 'workspace_restore',
      description: `恢复工作台「${grp.name}」`,
      revert: () => {
        ds.deleteGroup(grp.id)
        app.save?.()
        return `已撤销恢复工作台「${grp.name}」`
      },
    })
    return { success: true, message: `已恢复工作台「${grp.name}」。`, data: grp }
  }

  return { success: false, message: `不支持的工作台操作动作：${action}` }
}

// ─────────────────────────────────────────────────────────────
// 5. 设置与系统偏好调度 (manage_settings)
// ─────────────────────────────────────────────────────────────

export interface ManageSettingsParams {
  action: 'toggle_theme' | 'change_view' | 'navigate' | 'empty_trash' | 'export_data'
  themeMode?: 'dark' | 'light' | 'auto'
  viewLayout?: 'grid' | 'list' | 'compact'
  navigateTarget?: 'category' | 'workspace' | 'trash' | 'settings'
  targetName?: string
  exportFormat?: 'json' | 'html'
  reason?: string
}

export async function executeManageSettings(
  params: ManageSettingsParams,
  context?: AgentExecutionContext,
): Promise<AgentExecutionResult> {
  const ds = context?.ds ?? useDataStore()
  const ui = context?.ui ?? useUIStore()
  const app = context?.app ?? useAppStore()
  if (context?.signal?.aborted) return { success: false, message: '操作已取消。' }

  const action = params.action

  if (action === 'toggle_theme') {
    const mode = params.themeMode || 'auto'
    const prevMode = ui.themeMode
    const prevColor = ui.themeColor
    if (mode === 'auto') {
      if (ui.themeMode !== 'auto') {
        ui.toggleAutoTheme?.()
      }
    } else {
      ui.setThemeColor?.(mode)
    }
    ui.saveUIState?.()

    pushUndoAction({
      type: 'theme_toggle',
      description: `切换主题模式为「${mode}」`,
      revert: () => {
        if (prevMode === 'auto') {
          if (ui.themeMode !== 'auto') ui.toggleAutoTheme?.()
        } else {
          ui.setThemeColor?.(prevColor)
        }
        ui.saveUIState?.()
        return `已恢复主题模式为「${prevMode === 'auto' ? '跟随系统' : prevColor}」`
      },
    })
    return { success: true, message: `已为您将主题外观切换为「${mode}」模式。` }
  }

  if (action === 'change_view') {
    const rawLayout = params.viewLayout || 'grid'
    const layout: LayoutMode = rawLayout === 'compact' ? 'mini-grid' : rawLayout
    const prevLayout = ui.layoutMode
    ui.layoutMode = layout
    ui.saveUIState?.()

    pushUndoAction({
      type: 'view_change',
      description: `切换布局排版为「${layout}」`,
      revert: () => {
        ui.layoutMode = prevLayout
        ui.saveUIState?.()
        return `已恢复布局为「${prevLayout}」`
      },
    })
    return { success: true, message: `已为您将主视图排版切换为「${layout}」布局。` }
  }

  if (action === 'navigate') {
    const targetType = params.navigateTarget || 'category'
    const nameQ = (params.targetName || '').trim().toLowerCase()

    if (targetType === 'category') {
      const cat = ds.categories.find(
        (c: Category) => !c.deletedAt && (c.id === nameQ || c.name.toLowerCase() === nameQ || c.name.toLowerCase().includes(nameQ)),
      )
      if (cat) {
        ui.curCat = cat.id
        ui.focusedGroupId = null
        return { success: true, message: `已为您跳转至分类视图：「${cat.name}」。` }
      }
      return { success: false, message: `未能定位到名称包含「${params.targetName}」的分类。` }
    }

    if (targetType === 'workspace') {
      const grp = ds.siblingGroups.find(
        (g: SiblingGroup) => !g.deletedAt && (g.id === nameQ || g.name.toLowerCase() === nameQ || g.name.toLowerCase().includes(nameQ)),
      )
      if (grp) {
        ui.focusedGroupId = grp.id
        if (grp.categoryId) ui.curCat = grp.categoryId
        return { success: true, message: `已为您聚焦进入工作台：「${grp.name}」。` }
      }
      return { success: false, message: `未能定位到名称包含「${params.targetName}」的工作台。` }
    }

    if (targetType === 'trash') {
      ui.panels.trash = true
      return { success: true, message: '已为您在右侧展开回收站管理面板。' }
    }

    if (targetType === 'settings') {
      ui.panels.settings = true
      return { success: true, message: '已为您打开偏好设置弹窗。' }
    }
  }

  if (action === 'empty_trash') {
    const bmsCount = ds.bookmarks.filter((b: Bookmark) => b.deletedAt).length
    const grpsCount = ds.siblingGroups.filter((g: SiblingGroup) => g.deletedAt).length
    const catsCount = ds.categories.filter((c: Category) => c.deletedAt).length
    const totalTrash = bmsCount + grpsCount + catsCount
    if (totalTrash === 0) {
      return { success: true, message: '当前回收站内无任何暂存项目，无需清空。' }
    }
    ds.emptyTrash()
    app.save?.()
    return { success: true, message: `已为您彻底清空回收站，共永久抹除了 ${totalTrash} 个暂存项目。` }
  }

  if (action === 'export_data') {
    return { success: true, message: '已为您准备好全库数据导出任务，请在卡片中确认下载。' }
  }

  return { success: false, message: `不支持的设置操作动作：${action}` }
}
