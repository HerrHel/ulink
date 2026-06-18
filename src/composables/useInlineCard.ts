import { I } from '../config/icons.js'
import { esc, domain, favicon } from '../utils.js'
import type { Bookmark, SiblingGroup } from '../types.js'

export function inlineCardHTML(bm: Bookmark): string {
  return '<span class="group-inline-card" contenteditable="false" data-bm-id="' + bm.id + '" draggable="true">'
    + '<img src="' + esc(bm.icon || favicon(bm.url || '')) + '" alt="">'
    + '<span class="gic-name">' + esc(bm.title || '') + '</span>'
    + '<span class="gic-domain">' + domain(bm.url || '') + '</span>'
    + '<span class="gic-btn">详</span>'
    + '</span>'
}

export function groupRefCardHTML(g: SiblingGroup): string {
  return '<span class="group-inline-card group-ref-card" contenteditable="false" data-bm-id="ref:' + g.id + '" draggable="true">'
    + (g.icon ? '<img src="' + esc(g.icon) + '" alt="">' : '<span class="gic-note-icon">' + I.note + '</span>')
    + '<span class="gic-name">' + esc(g.name || '未命名组') + '</span>'
    + '<span class="gic-count">' + g.bookmarkIds.length + '个书签</span>'
    + '<span class="gic-btn">详</span>'
    + '</span>'
}
