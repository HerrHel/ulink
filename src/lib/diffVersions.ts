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

/** 敏感字段：历史版本 diff UI 直接渲染 DiffField.oldValue/newValue（HistoryPanel.vue
 *  用 {{ f.oldValue }}），若把 password 值塞进去会泄露密码——
 *  EncryptedPassword 对象经 JSON.stringify 暴露 {encrypted,data,iv,salt} 结构与密文，
 *  旧 base64 字符串经 String() 后拷贝即可 atob 解码出明文。这类字段改用占位「••••」表示
 *  「已修改」但不泄露具体值，保留「密码改过」的变更信息供用户辨识 */
const SENSITIVE_KEYS = new Set(['password'])

function _truncate(val: unknown, max = 80): string {
  if (val === null || val === undefined) return '（空）'
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val)
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** 敏感字段的值占位——不暴露原值，仅示意「已修改/存在」 */
const SENSITIVE_PLACEHOLDER = '••••'

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
    // 敏感字段（password）：只标注「已修改」或「新增/移除」不显示原值，避免历史 diff UI 泄露密码
    if (SENSITIVE_KEYS.has(key)) {
      if (oldVal === undefined && newVal !== undefined) {
        result.push({ key, label, type: 'added', newValue: SENSITIVE_PLACEHOLDER })
      } else if (oldVal !== undefined && newVal === undefined) {
        result.push({ key, label, type: 'removed', oldValue: SENSITIVE_PLACEHOLDER })
      } else {
        result.push({ key, label, type: 'changed', oldValue: SENSITIVE_PLACEHOLDER, newValue: SENSITIVE_PLACEHOLDER })
      }
      continue
    }
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
