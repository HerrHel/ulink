/**
 * stats.ts — 本地匿名使用统计
 *
 * D4: 仅存 localStorage，不上传。用于 PM 了解功能使用频率。
 * 键：lv_stats，值：{ [actionName]: number }
 */
const STATS_KEY = 'lv_stats'

type StatName =
  | 'bookmark_created' | 'bookmark_edited' | 'bookmark_deleted'
  | 'group_created' | 'group_edited' | 'group_deleted'
  | 'export_json' | 'export_html' | 'export_csv' | 'export_raindrop'
  | 'sync_manual' | 'deadlink_check' | 'share_group'
  | 'attribute_added' | 'category_added' | 'import_data'

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
