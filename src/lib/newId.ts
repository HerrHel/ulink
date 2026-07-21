/**
 * 统一实体 id 生成器,消除 7+ 处散落的手拼 `prefix + now.toString(36) + random`。
 *
 * - 默认随机片段 6 位(较原 4 位提升防碰),前缀区分实体(bookmark='b',group='g' 等)。
 * - 循环里同毫秒生成多个 id 时务必传入 uniqHint(如循环 index)兜底防碰。
 * - 非循环单次调用可不传。
 */
export function newId(prefix: string, uniqHint?: number | string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  const hint = uniqHint == null ? '' : uniqHint.toString(36)
  return `${prefix}${ts}${rand}${hint}`
}

/** bookmark id 便捷封装 */
export function newBookmarkId(uniqHint?: number | string): string {
  return newId('b', uniqHint)
}

/** sibling group id 便捷封装 */
export function newGroupId(uniqHint?: number | string): string {
  return newId('g', uniqHint)
}
