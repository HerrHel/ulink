import { I } from '../config/icons.js'
import { esc, domain, favicon, isMobile } from '../utils.js'
import type { Bookmark, SiblingGroup } from '../types.js'

// 移动端 inline card 关闭 draggable：Chrome 移动端会对长按 draggable 元素启动
// HTML5 拖拽幽灵（~300ms），抢占 useLongPress 的 500ms 长按定时器，导致长按 inline card
// 不弹菜单而误触发拖拽。桌面端保留 draggable=true 用于编辑态拖拽插入。inline card 经
// v-html 字符串渲染，无法走 Vue :draggable 响应式，故在生成时按 isMobile() 固化为属性值。
const _draggable = isMobile() ? 'false' : 'true'

export function inlineCardHTML(bm: Bookmark): string {
  // S1：所有插入属性/文本的值均经 esc()，避免 bm.id / domain / title 含 " 或 < 注入。
  return '<span class="group-inline-card" contenteditable="false" data-bm-id="' + esc(bm.id) + '" draggable="' + _draggable + '">'
    + '<img src="' + esc(bm.icon || favicon(bm.url || '')) + '" alt="">'
    + '<span class="gic-name">' + esc(bm.title || '') + '</span>'
    + '<span class="gic-domain">' + esc(domain(bm.url || '')) + '</span>'
    + '<span class="gic-btn">详</span>'
    + '</span>'
}

export function groupRefCardHTML(g: SiblingGroup): string {
  // S1：g.id 经 esc()；data-bm-id="ref:..." 前缀固定，g.id 转义后拼接。
  return '<span class="group-inline-card group-ref-card" contenteditable="false" data-bm-id="ref:' + esc(g.id) + '" draggable="' + _draggable + '">'
    + (g.icon ? '<img src="' + esc(g.icon) + '" alt="">' : '<span class="gic-note-icon">' + I.note + '</span>')
    + '<span class="gic-name">' + esc(g.name || '未命名组') + '</span>'
    + '<span class="gic-count">' + g.bookmarkIds.length + '个书签</span>'
    + '<span class="gic-btn">详</span>'
    + '</span>'
}
