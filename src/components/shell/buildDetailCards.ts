// DetailPanel.vue entries computed 抽出的纯模块：把 ui.detailCards 的 rawId 列表
// （含 `group:<gid>` 前缀）解析成可渲染的 DetailEntry 卡片条目。
//
// 两条软删过滤隐式契约（注释原自 DetailPanel.vue:68/73）：
//  - groupMap / bookmarkMap 含软删项；跳过软删组/书签，否则运行时/刷新后面板仍渲染已删卡
//    （detailCards 不会随 deleteBookmark 同步清理，渲染层是防残卡的最后一道兜底）。
//  - group:<gid> 前缀解析成 gid 后查 groupMap；普通 rawId 直接查 bookmarkMap。
//
// maps 入参化纯化：把组件内 ds.groupMap/ds.bookmarkMap 依赖以弱类型 Record 传入，
// domain 函数注入，逻辑逐字保留 entries computed 原实现，零行为变化。

import type { Bookmark, SiblingGroup } from '../../types.js'

export type DetailEntry = {
  rawId: string
  realIdx: number
  isGroup: true
  data: SiblingGroup
  name: string
  domain: string
} | {
  rawId: string
  realIdx: number
  isGroup: false
  data: Bookmark
  name: string
  domain: string
}

/**
 * 把 detailCards 的 rawId 数组解析成可渲染 DetailEntry 卡片条目。
 * 与 DetailPanel.vue entries computed 逐字等价（仅抽离 + maps/domain 入参化）。
 *
 * @param cards  ui.detailCards 原始 id 列表（可能含 `group:<gid>` 前缀项）
 * @param groupMap  ds.groupMap（含软删组，渲染层跳过软删）
 * @param bookmarkMap  ds.bookmarkMap（含软删书签，渲染层跳过软删）
 * @param domainFn  utils.domain —— 算书签卡片副标题域名
 */
export function buildDetailCards(
  cards: string[] | null | undefined,
  groupMap: Record<string, SiblingGroup | undefined>,
  bookmarkMap: Record<string, Bookmark | undefined>,
  domainFn: (url: string) => string,
): DetailEntry[] {
  const list = cards || []
  const out: DetailEntry[] = []
  for (let i = 0; i < list.length; i++) {
    const rawId = list[i]
    if (typeof rawId === 'string' && rawId.startsWith('group:')) {
      const gid = rawId.slice(6)
      const sg = groupMap[gid]
      // groupMap 含软删；跳过软删组，否则运行时/刷新后面板仍渲染已删组卡
      if (sg && !sg.deletedAt) out.push({ rawId, realIdx: i, isGroup: true, data: sg, name: sg.name || '', domain: '' })
      continue
    }
    const bm = bookmarkMap[rawId]
    // bookmarkMap 含软删；跳过软删书签，否则运行时/刷新后面板仍渲染已删书签卡
    if (bm && !bm.deletedAt) out.push({ rawId, realIdx: i, isGroup: false, data: bm, name: bm.title || '', domain: domainFn(bm.url) })
  }
  return out
}
