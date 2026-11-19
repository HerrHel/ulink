/**
 * candidateSave.ts — AI 候选网站入库的统一构造器
 * 背景：dataStore.addBookmark 要求完整 Bookmark（含 id/order/时间戳等必备字段）且返回 void，
 * DetailPanel / AiInlineCard 曾各自传残缺对象导致入库链路损坏。
 * 这里统一补齐字段，调用方只需 ds.addBookmark(bm) + saveAppData()。
 */
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { newBookmarkId } from '../newId.js'
import { fixUrl } from '../../utils.js'
import type { Bookmark } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import type { useDataStore } from '../../stores/data.js'

type DataStore = ReturnType<typeof useDataStore>

/** 候选网站 → 完整 Bookmark（不入库，调用方自行 ds.addBookmark + saveAppData） */
export function candidateToBookmark(
  ds: DataStore,
  c: AiCandidateBookmark,
  icon = '',
): Bookmark {
  const now = Date.now()
  const attributes: Record<string, boolean> = {}
  if (c.suggestedAttrIds?.length) {
    const validAttrIds = new Set(
      ds?.customAttributes?.filter(a => !a.deletedAt && a.id !== 'is-group').map(a => a.id) ?? []
    )
    for (const aid of c.suggestedAttrIds) {
      if (aid === 'is-group') continue
      if (validAttrIds.size === 0 || validAttrIds.has(aid)) {
        attributes[aid] = true
      }
    }
  }
  let categoryId = c.categoryId
  if (categoryId && categoryId !== CAT_UNCATEGORIZED) {
    const cat = ds?.categoryMap?.[categoryId]
    if (!cat || cat.deletedAt) {
      categoryId = CAT_UNCATEGORIZED
    }
  } else {
    categoryId = CAT_UNCATEGORIZED
  }
  return {
    id: newBookmarkId(),
    title: c.title,
    url: fixUrl(c.url) || c.url,
    username: '',
    password: '',
    notes: c.notes || '',
    icon: icon || c.icon || '',
    iconDark: c.iconDark || '',
    categoryId,
    parentId: null,
    order:
      typeof ds?.nextBookmarkOrder === 'function'
        ? ds.nextBookmarkOrder()
        : (ds?.bookmarks?.reduce((m: number, b: any) => (b.order > m ? b.order : m), 0) ?? 0) + 1,
    useCount: 0,
    attributes,
    isExpanded: false,
    createdAt: now,
    updatedAt: now,
  }
}
