import { fixUrl } from '../utils.js'
import type { Bookmark, SiblingGroup } from '../types.js'

/**
 * 构造公开分享组 SEO 注入用的 ItemList JSON-LD 对象。
 *
 * 从 ShareView.vue 的 `_applyShareHead` 抽出的纯拼装核——`_applyShareHead` 把
 * title / og 元信息 / canonical / setJsonLd 等带 location 副作用的注入调用留在外层，
 * 本函数只负责 schema.org ItemList 对象的纯字段构造，可直接单测锁定 itemListElement 派洗契约。
 *
 * 安全语义（M5 二次过滤）：`itemListElement[].url` 经 `fixUrl(b.url)` 派生——`fixUrl` 对
 * `javascript:` / `data:` / `vbscript:` 等危险 scheme 返回空串，故危险 url 书签不会被收录成
 * 可点击的恶意 SEO ItemList 链接（防跨用户恶意书签 url 经 JSON-LD 注入成 schema.org 收录项
 * 被搜索引擎展示成可执行跳转链接）。name 用 `b.title` 原值（已是 sanitized 渲染域文本）。
 *
 * @param g 公开分享组（取 name 兜底 + notes 去 HTML 标签纯文本派生 description）
 * @param bms 该组的书签列表（按当前顺序映射成 itemListElement）
 * @param shareUrl 该组的公开分享 URL（由外层 `location.origin + base + 's/' + g.id` 派生，
 *   入参化绕开 location 副作用使本函数纯）
 */
export function buildItemListJsonLd(
  g: SiblingGroup,
  bms: Bookmark[],
  shareUrl: string,
): {
  '@context': string
  '@type': string
  name: string
  description: string
  url: string
  numberOfItems: number
  itemListElement: Array<{
    '@type': string
    position: number
    name: string
    url: string
  }>
} {
  // 去标签纯文本 + 120 截断 + 兜底文案（与 _applyShareHead 外层 desc 计算同形，行为等价）
  const notesPlain = g.notes ? g.notes.replace(/<[^>]+>/g, '').trim() : ''
  const desc = (notesPlain && notesPlain.slice(0, 120)) || `${bms.length} 个链接 · 由 LinkVault 公开分享`

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: g.name || '分享组',
    description: desc,
    url: shareUrl,
    numberOfItems: bms.length,
    itemListElement: bms.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.title,
      url: fixUrl(b.url),
    })),
  }
}
