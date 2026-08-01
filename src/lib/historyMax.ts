/**
 * historyMax.ts — 版本历史保留条数上限域值截断纯函数
 *
 * 域值约定为闭区间 [5, 30]：
 * - 下界 5 防「历史不足 5 条导致不可回滚」
 * - 上界 30 防「localStorage 历史快照雪崩膨胀」
 *
 * 共用此规则的两处调用点：
 * - `stores/ui.ts` restoreUIState 反序列化兜底（localStorage 跨会话/同步/导入可能残留异常 historyMax）
 * - `components/shell/SettingsPanel.vue` onHistoryMaxChange 改后即时落盘前 clamp
 *
 * 逐字搬自原内联表达式 `Math.min(30, Math.max(5, n))`，行为一字不变。
 * 注意：NaN 入参经 Math.min/max 传播返回 NaN（现行真实行为，护栏直锁此
 * 既约语义，防未来误加 Number.isFinite 早退把 NaN 稳成 5 改变运行时行为）。
 */
export function clampHistoryMax(n: number): number {
  return Math.min(30, Math.max(5, n))
}
