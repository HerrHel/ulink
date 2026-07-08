import { I } from '../config/icons.js'
import { esc, domain, favicon } from '../utils.js'
import type { Bookmark, SiblingGroup } from '../types.js'

export function inlineCardHTML(bm: Bookmark): string {
  // S1：所有插入属性/文本的值均经 esc()，避免 bm.id / domain / title 含 " 或 < 注入。
  return '<span class="group-inline-card" contenteditable="false" data-bm-id="' + esc(bm.id) + '" draggable="true">'
    + '<img src="' + esc(bm.icon || favicon(bm.url || '')) + '" alt="">'
    + '<span class="gic-name">' + esc(bm.title || '') + '</span>'
    + '<span class="gic-domain">' + esc(domain(bm.url || '')) + '</span>'
    + '<span class="gic-btn">详</span>'
    + '</span>'
}

export function groupRefCardHTML(g: SiblingGroup): string {
  // S1：g.id 经 esc()；data-bm-id="ref:..." 前缀固定，g.id 转义后拼接。
  return '<span class="group-inline-card group-ref-card" contenteditable="false" data-bm-id="ref:' + esc(g.id) + '" draggable="true">'
    + (g.icon ? '<img src="' + esc(g.icon) + '" alt="">' : '<span class="gic-note-icon">' + I.note + '</span>')
    + '<span class="gic-name">' + esc(g.name || '未命名组') + '</span>'
    + '<span class="gic-count">' + g.bookmarkIds.length + '个书签</span>'
    + '<span class="gic-btn">详</span>'
    + '</span>'
}
