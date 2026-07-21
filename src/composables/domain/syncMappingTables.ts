/**
 * sync 实体类型 (EntityType, 单数 camelCase) 与 Supabase 表名 (snake_case, 复数) 的映射。
 *
 * 统一替换散落多处的手写三元 / Record 映射 (syncPush / useSyncRealtime / useSyncMapping)。
 * 书签='bookmarks'、组='sibling_groups'、分类='categories'、属性='custom_attributes'。
 */
import type { EntityType, TableName } from '../../types.js'

export type { TableName }

export const tableToEntityType: Record<TableName, EntityType> = {
  bookmarks: 'bookmark',
  sibling_groups: 'group',
  categories: 'category',
  custom_attributes: 'attribute',
}

export const entityTypeToTable: Record<EntityType, TableName> = {
  bookmark: 'bookmarks',
  group: 'sibling_groups',
  category: 'categories',
  attribute: 'custom_attributes',
}

/**
 * pull/push/reconcile 实体顺序：分类先于书签/组（无硬依赖，保持历史顺序）。
 * 单一来源，避免 syncPull 与 enqueueDirty 各自硬编码四表漂移。
 */
export const SYNC_ENTITY_ORDER: EntityType[] = ['category', 'bookmark', 'group', 'attribute']
