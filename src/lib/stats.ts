/**
 * stats.ts — 本地匿名使用统计 + 指标事件系统
 *
 * D4: 仅存 localStorage，不上传。用于 PM 了解功能使用频率。
 * v2 新增：带时间序列的 MetricEvent，追踪操作耗时/成功率/数据量。
 *
 * 兼容旧 API：incrementStat / getStats / getStat / STAT_LABELS
 * 新 API：trackMetric(name, opts) / getMetrics / getMetricSummary
 */

const STATS_KEY = 'lv_stats'
const METRICS_KEY = 'lv_metrics'
const MAX_METRICS = 500

type StatName =
  | 'bookmark_created' | 'bookmark_edited' | 'bookmark_deleted'
  | 'group_created' | 'group_edited' | 'group_deleted'
  | 'export_json' | 'export_html' | 'export_csv' | 'export_raindrop'
  | 'sync_manual' | 'deadlink_check' | 'share_group'
  | 'attribute_added' | 'category_added' | 'import_data'

/** 新指标事件类型 */
export type MetricName =
  | StatName
  | 'sync_success' | 'sync_failure'
  | 'deadlink_check_batch' | 'import_done'
  | 'export_done'

export interface MetricEvent {
  name: MetricName
  ts: number           // 事件时间戳 ms
  duration?: number    // 耗时 ms（可选）
  success?: boolean    // 成功/失败（可选）
  count?: number       // 涉及数据量（可选）
}

// ── 旧版计数器兼容（纯计数，无时间维度）──

export function incrementStat(name: StatName): void {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    const stats: Record<string, number> = raw ? JSON.parse(raw) : {}
    stats[name] = (stats[name] || 0) + 1
    localStorage.setItem(STATS_KEY, JSON.stringify(stats))
  } catch { /* ignore */ }
}

export function getStats(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function getStat(name: StatName): number {
  return getStats()[name] || 0
}

export const STAT_LABELS: Record<StatName, string> = {
  bookmark_created: '新建书签',
  bookmark_edited: '编辑书签',
  bookmark_deleted: '删除书签',
  group_created: '新建组',
  group_edited: '编辑组',
  group_deleted: '删除组',
  export_json: '导出 LinkVault JSON',
  export_html: '导出浏览器书签 HTML',
  export_csv: '导出 CSV',
  export_raindrop: '导出 Raindrop JSON',
  sync_manual: '手动同步',
  deadlink_check: '死链检测',
  share_group: '分享组',
  attribute_added: '新建属性',
  category_added: '新建分类',
  import_data: '导入数据',
}

// ── 新指标事件系统 ──

/**
 * 记录一个带时间序列的指标事件。
 * 事件写入 localStorage 中的 lv_metrics 数组，最多保留 MAX_METRICS 条。
 *
 * @example
 * trackMetric('sync_success', { duration: 3200, count: 15 })
 * trackMetric('sync_failure', { duration: 15000 })
 */
export function trackMetric(name: MetricName, opts?: {
  duration?: number
  success?: boolean
  count?: number
}): void {
  try {
    const raw = localStorage.getItem(METRICS_KEY)
    const events: MetricEvent[] = raw ? JSON.parse(raw) : []
    events.push({
      name,
      ts: Date.now(),
      ...(opts?.duration !== undefined && { duration: opts.duration }),
      ...(opts?.success !== undefined && { success: opts.success }),
      ...(opts?.count !== undefined && { count: opts.count }),
    })
    // 保留最近 MAX_METRICS 条
    if (events.length > MAX_METRICS) {
      events.splice(0, events.length - MAX_METRICS)
    }
    localStorage.setItem(METRICS_KEY, JSON.stringify(events))
  } catch { /* ignore */ }
}

/**
 * 取全部指标事件（按时间降序 —— 最新的在前）
 */
export function getMetrics(): MetricEvent[] {
  try {
    const raw = localStorage.getItem(METRICS_KEY)
    const events: MetricEvent[] = raw ? JSON.parse(raw) : []
    return events.sort((a, b) => b.ts - a.ts)
  } catch { return [] }
}

/**
 * 取某类指标的聚合摘要。
 *
 * @example
 * const summary = getMetricSummary('sync_success')
 * // → { count: 12, avgDuration: 2450, lastAt: 1719782400000 }
 */
export function getMetricSummary(name: MetricName): {
  count: number
  avgDuration: number | null
  successRate: number | null
  lastAt: number | null
} {
  const events = getMetrics().filter(e => e.name === name)
  if (!events.length) {
    return { count: 0, avgDuration: null, successRate: null, lastAt: null }
  }
  const durations = events.filter(e => e.duration !== undefined).map(e => e.duration!)
  const successes = events.filter(e => e.success !== undefined)
  return {
    count: events.length,
    avgDuration: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    successRate: successes.length ? successes.filter(e => e.success).length / successes.length : null,
    lastAt: events[0].ts,
  }
}

/**
 * 清除所有统计数据和指标事件
 */
export function clearAllStats(): void {
  try { localStorage.removeItem(STATS_KEY) } catch { /* ignore */ }
  try { localStorage.removeItem(METRICS_KEY) } catch { /* ignore */ }
}
