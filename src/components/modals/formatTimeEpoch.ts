// 回收站列表项时间戳相对时间格式化纯函数
// 从 TrashPanel.vue 抽出（c1 highlight / c3 getPreview / c4 HistoryPanel.formatTime 同口径：抽独立纯模块补护栏，逻辑逐字保留零行为变化）。
// 作用：把毫秒时间戳（ms）格式化成「刚刚 / N 分钟前 / N 小时前 / M/D HH:MM」相对时间，
// 作为回收站列表项的时间展示（TrashPanel.vue:17/28 模板 {{ formatTime(b.deletedAt) }} / {{ formatTime(g.deletedAt) }} 消费）。
//
// 与 src/components/modals/formatTime.ts（HistoryPanel 版，入参 ISO 字符串 + diff = now - d.getTime()）
// 同形但不同实现：本版入参是 ms 时间戳，且 `if (!ts) return ''` falsy 短路（0/undefined/null/NaN→空串），
// diff = now - ts（直减入参而非 d.getTime()）。两份重复实现固留并行，护栏另用一致性断言锁防止未来漂移。
// 是否合并去重需评估入参语义改 frozen-outward-facing 行为，标 needs-user-review 留人工裁，自主不合并。

/**
 * 把毫秒时间戳（ms）格式化成相对时间。
 * 规则：
 *   - falsy 入参（0/undefined/null/NaN）→ 返回空串 ''
 *   - 与当前 Date.now() 比较 diff = now - ts，
 *     diff < 60000 → '刚刚'
 *     diff < 3600000 → `N 分钟前`（Math.floor）
 *     diff < 86400000 → `N 小时前`（Math.floor）
 *     否则 → `M/D HH:MM`（月+1、日原样、时补 2 位 0、分补 2 位 0）
 */
export function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
