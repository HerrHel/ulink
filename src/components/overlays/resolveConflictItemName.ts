import type { SyncConflict } from '../../stores/sync.js'

/**
 * 同步冲突横幅「冲突项展示名」解析（D1-49）。
 *
 * SyncConflictBanner.vue 每条冲突项 `{{ itemName(c) }}` 渲染什么名字的唯一承载决定
 * 逻辑——它是用户在多端冲突横幅里快速辨认「这条冲突是哪个书签/组/分类/属性」的
 * 唯一文案。抽取自 SyncConflictBanner.vue script setup 内的 `itemName`，逻辑逐字
 * 保留零行为变化（c6 typeLabel / c3 getPreview / d1-48 resolveGroupIconSvg 同款
 * 「抽独立纯模块」口径），仅把对 store 的 4 个 O(1) Map getter 依赖 maps 入参化。
 *
 * 四级联优先级（逐字保留原 itemName 实现）：
 *   1. 命中对应 store Map 且有 name/title 字段 → 用 store 当前名（最新可见态）
 *   2. 否则取冲突快照 c.local 的同名字段（冲突发生时的本地态）
 *   3. 都无 → 回退 c.id（兜底不丢展示）
 * 注：map 命中后 `?.` + `||` 短路——命中但无 name 字段也会回退 local 名再回退 id。
 */

export function resolveConflictItemName(
  c: SyncConflict,
  maps: {
    bookmarkMap: Record<string, { title?: string } | undefined>
    groupMap: Record<string, { name?: string } | undefined>
    categoryMap: Record<string, { name?: string } | undefined>
    attributeMap: Record<string, { name?: string } | undefined>
  },
): string {
  const d = c.local as Record<string, unknown>
  if (c.type === 'bookmark') {
    const bm = maps.bookmarkMap[c.id]
    return bm?.title || (d?.title as string) || c.id
  }
  if (c.type === 'group') {
    const g = maps.groupMap[c.id]
    return g?.name || (d?.name as string) || c.id
  }
  if (c.type === 'category') {
    const cat = maps.categoryMap[c.id]
    return cat?.name || (d?.name as string) || c.id
  }
  const attr = maps.attributeMap[c.id]
  return attr?.name || (d?.name as string) || c.id
}
