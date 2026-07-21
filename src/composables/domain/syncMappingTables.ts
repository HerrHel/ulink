/**
 * sync 实体类型 (EntityType, 单数 camelCase) 与 Supabase 表名 (snake_case, 复数) 的双向映射。
 *
 * 统一替换散落多处的手写三元 / Record 映射 (syncPush / useSyncRealtime / useSyncMapping)。
 * 书签='bookmarks'、组='sibling_groups'、分类='categories'、属性='custom_attributes'。
 */
import type { EntityType } from '../../types.js'

export type TableName = 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'

export const entityTypeToTable: Record<EntityType, TableName> = {
  bookmark: 'bookmarks',
  group: 'sibling_groups',
  category: 'categories',
  attribute: 'custom_attributes',
}

export const tableToEntityType: Record<TableName, EntityType> = {
  bookmarks: 'bookmark',
  sibling_groups: 'group',
  categories: 'category',
  custom_attributes: 'attribute',
}

/** EntityType → 展示用单数标签 (history/conflict 类型名) */
export const entityTypeToLabel: Record<EntityType, string> = {
  bookmark: 'bookmark',
  group: 'group',
  category: 'category',
  attribute: 'attribute',
}
