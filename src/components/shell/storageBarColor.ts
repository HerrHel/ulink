/**
 * 存储条颜色映射：按已用百分比 percent 映射到 CSS 变量。
 *
 * 三档阈值（严格 `>` 边界）：
 *   - p > 90 → var(--danger)  超额风险
 *   - p > 70 → var(--warn)    接近上限警告
 *   - 否则   → var(--accent)  充裕
 *
 * null / undefined / NaN / 0 一律兜底 var(--accent)：
 *   - null/undefined 对应 AppNav.storageInfo 为 null（getStorageInfo 抛错兜底）
 *     经 `storageInfo.value?.percent` 解析成 undefined 传入
 *   - 0 是合法的「完全空闲」percent，原三档条件链中 0 也落 accent
 *     故 `!p` 兜底与原内联 computed 行为逐字一致
 *
 * 调用方 AppNav.vue:85-89 computed 包裹，对 store.getStorageInfo 的 reactive
 * 依赖留在 computed 里，本纯函数仅承担「percent → CSS var」这一纯规则。
 */
export function storageBarColorFor(p: number | null | undefined): string {
  if (!p) return 'var(--accent)'
  return p > 90 ? 'var(--danger)' : p > 70 ? 'var(--warn)' : 'var(--accent)'
}
