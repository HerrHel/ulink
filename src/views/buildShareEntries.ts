/**
 * ShareView 分享页书签列表预渲染条目构造核 —— 从原 ShareView.vue 内联 computed 抽出的纯函数。
 *
 * 职责：把 fixUrl / domain / favicon 对每条书签预计算一次，避免模板内对同 url 重复调用
 * （历史热点：原模板内约 5 次 fixUrl + 2 次 favicon/icon + 1 次 domain / 书签）。
 * 三函数均为纯函数，预计算与原模板内联调用语义等价。
 *
 * M5 安全语义：图标只由 http(s) 书签 URL 派生，跨用户 b.icon 不可信（追踪像素 / 任意 URL）。
 * 故 icon 仅当 safeUrl 非空时取 favicon(safeUrl)——safeUrl 为空（fixUrl 拒 dangerous scheme 返回 ''）
 * 时强制 icon = ''，不对危险 url 派生任何图标 URL，杜绝跨用户图标注入面。
 */
import { fixUrl, domain, favicon } from '../utils.js'
import type { Bookmark } from '../types.js'

/** bookmarkEntries computed 暴露给模板的预渲染条目结构 */
export interface ShareEntry {
  /** 原书签对象（模板仍直接读 b.title / b.notes / b.id 等） */
  b: Bookmark
  /** fixUrl(b.url)：协议白名单后的安全 URL，dangerous scheme → '' */
  safeUrl: string
  /** domain(b.url)：去 www. 的展示域名；非法 url catch 返原串 */
  urlDomain: string
  /** 图标 URL：safeUrl 非空时由 favicon(safeUrl)（仅由书签 url 派生，不接受跨用户 b.icon）派生；safeUrl 为空则 '' */
  icon: string
}

/**
 * 把书签到预渲染条目：对每条 bookmark 预计算 safeUrl / urlDomain / icon。
 * 纯函数：输入 bookmarks 数组 → 输出 ShareEntry 数组，无响应式 / DOM / store 副作用。
 */
export function buildShareEntries(bookmarks: Bookmark[]): ShareEntry[] {
  return bookmarks.map(b => {
    const safeUrl = fixUrl(b.url)
    return { b, safeUrl, urlDomain: domain(b.url), icon: safeUrl ? favicon(safeUrl) : '' }
  })
}
