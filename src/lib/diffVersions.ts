/**
 * diffVersions.ts — 版本差异对比工具
 * 比较两个版本的字段级差异，用于历史版本 diff UI
 */
export interface DiffField {
  key: string
  label: string
  type: 'added' | 'removed' | 'changed'
  oldValue?: string
  newValue?: string
}

const FIELD_LABELS: Record<string, string> = {
  title: '标题', name: '名称', url: '链接', username: '账户',
  password: '密码', notes: '备注', icon: '图标', categoryId: '分类',
  parentId: '父级', order: '排序', useCount: '使用次数',
  attributes: '属性', isExpanded: '展开状态', bookmarkIds: '书签列表',
  isPublic: '公开', deletedAt: '删除时间',
}

function _truncate(val: unknown, max = 80): string {
  if (val === null || val === undefined) return '（空）'
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val)
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function diffVersions(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  excludeKeys: string[] = ['id', 'updatedAt', 'createdAt', 'updated_at', 'created_at'],
): DiffField[] {
  const result: DiffField[] = []
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)])

  for (const key of allKeys) {
    if (excludeKeys.includes(key)) continue
    const oldVal = oldData[key]
    const newVal = newData[key]

    const oldStr = JSON.stringify(oldVal)
    const newStr = JSON.stringify(newVal)
    if (oldStr === newStr) continue

    const label = FIELD_LABELS[key] || key
    if (oldVal === undefined && newVal !== undefined) {
      result.push({ key, label, type: 'added', newValue: _truncate(newVal) })
    } else if (oldVal !== undefined && newVal === undefined) {
      result.push({ key, label, type: 'removed', oldValue: _truncate(oldVal) })
    } else {
      result.push({ key, label, type: 'changed', oldValue: _truncate(oldVal), newValue: _truncate(newVal) })
    }
  }

  return result
}
