// 历史版本时间戳相对时间格式化纯函数
// 从 HistoryPanel.vue 抽出（c1 highlight / c3 getPreview 同口径：抽独立纯模块补护栏，逻辑逐字保留零行为变化）。
// 作用：把 ISO 时间字符串格式化成「刚刚 / N 分钟前 / N 小时前 / M/D HH:MM」相对时间，
// 作为版本历史列表项的时间展示（HistoryPanel.vue:49 模板 {{ formatTime(v.created_at) }} 消费）。

/**
 * 把 ISO 时间字符串格式化成相对时间。
 * 规则：与当前 Date.now() 比较 diff，
 *   diff < 60000 → '刚刚'
 *   diff < 3600000 → `N 分钟前`
 *   diff < 86400000 → `N 小时前`
 *   否则 → `M/D HH:MM`（月+1、日原样、时补 2 位 0、分补 2 位 0）
 */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}
