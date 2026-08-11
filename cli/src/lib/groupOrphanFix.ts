/**
 * 组的孤儿引用修复纯函数（不依赖 supabase / async / CLI heavy deps）。
 *
 * 从 SiblingGroup.bookmark_ids 中剔除所有指向不存在书签的引用，
 * 一次性集体剔除以避免多孤儿逐个 update 的覆盖回潮问题。
 */

/**
 * 计算组的孤儿引用修复：从 bookmark_ids 中剔除所有指向不存在书签的引用。
 * 纯函数（不依赖 supabase / async），便于单元测试锁多孤儿集体剔除语义。
 *
 * 修复 BG-11：原 maintenance.ts validate 实现遍历 group.bookmark_ids 时
 * 对每个孤儿单独 update，由于 filter 只减当前 bmId 且 group.bookmark_ids
 * （内存数组）遍历中不变，当一个组含 ≥2 个孤儿时，后续 update 会用仍含
 * 前序孤儿的 newIds 覆盖 DB，最终只剩「最后一个孤儿被剔除、前序孤儿全部回潮」。
 * 改为先收集全部孤儿一次性剔除，单次 update 写最终 cleaned 数组。
 */
export function computeGroupOrphanFix(
  groupBookmarkIds: string[] | null | undefined,
  validBookmarkIds: Set<string>
): { orphans: string[]; cleanedIds: string[] } {
  if (!groupBookmarkIds || !Array.isArray(groupBookmarkIds)) {
    return { orphans: [], cleanedIds: [] }
  }
  const orphans: string[] = []
  for (const bmId of groupBookmarkIds) {
    if (!validBookmarkIds.has(bmId)) orphans.push(bmId)
  }
  if (orphans.length === 0) return { orphans: [], cleanedIds: groupBookmarkIds.slice() }
  const orphanSet = new Set(orphans)
  const cleanedIds = groupBookmarkIds.filter((id) => !orphanSet.has(id))
  return { orphans, cleanedIds }
}
