/**
 * welcome-data.ts — 默认示例数据（欢迎笔记 + 使用指南）
 *
 * 从 constants.ts 中提取，缩小主 bundle 体积。
 * 仅在首次加载/数据重置时使用。
 *
 * 双语：根据当前 locale（zh-CN / en-US）返回对应语言版本。两版 HTML 结构对齐，
 * 复用同一套示例书签的内联卡片 DOM。
 */

import { FAVICON_PROVIDER_URL } from './urls.js'
import type { Locale } from '../i18n/index.js'

/** 内联卡片公共片段（书签名/域名/「详」按钮 — 「详」改用 cat.refLabel 键由调用方注入）。 */
const _inlineCard = (
  bmId: string,
  domain: string,
  name: string,
  detailLabel: string,
): string =>
  '<span class="group-inline-card" contenteditable="false" data-bm-id="' + bmId + '" draggable="true"><img src="' + FAVICON_PROVIDER_URL + domain + '" alt=""><span class="gic-name">' + name + '</span><span class="gic-domain">' + domain + '</span><span class="gic-btn">' + detailLabel + '</span></span>'

/** zh-CN 上手指南（精简至 5 条核心玩法，与当前版本完全对齐） */
const WELCOME_ZH =
  '<h1>欢迎使用 与链</h1>'
  + '<p>与链不仅是书签收藏夹，还可以将<strong>富文本笔记</strong>与<strong>书签链接</strong>融合整理。</p>'
  + '<h2>快速上手指南</h2>'
  + '<ul data-type="taskList">'
  + '<li data-type="taskItem" data-checked="true"><strong>浏览与检索</strong> — 左侧切换分类，顶栏支持搜索（<code>Ctrl+K</code>）与网格/列表视图切换</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>新建与导入</strong> — 顶栏 <strong>+</strong> 或 <code>Ctrl+N</code> 快速新建；卡片右上角或「设置 → 数据与维护」支持导入书签</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>笔记与排版</strong> — 直接在卡片内编辑正文，点击标题进入全屏聚焦；输入 <code>@</code> 搜索并内嵌书签卡片</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>拖拽与收纳</strong> — 外部书签拖入笔记即可收纳；支持添加嵌套子书签，同一站点多入口轻松归纳</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>同步与安全</strong> — 登录后自动跨设备实时同步；顶栏「设置」支持数据备份导出、主题外观与数据加密</li>'
  + '</ul>'
  + '<h2>内嵌书签示例</h2>'
  + '<p>正文内嵌的书签卡片可拖拽排版，点击名称可直接跳转访问：</p>'
  + _inlineCard('b1', 'github.com', 'GitHub', '详') + ' '
  + _inlineCard('b6', 'www.ilovepdf.com', 'I Love PDF', '详')
  + '<p><br><span style="color: #6B7280; font-size: 0.9em">提示：本笔记为上手引导，可随时编辑或删除。</span></p>'

/** en-US 上手指南（5 条核心玩法，结构与中文版对齐） */
const WELCOME_EN =
  '<h1>Welcome to ulink</h1>'
  + '<p>ulink is both a bookmark manager and a workspace combining <strong>rich-text notes</strong> with <strong>link curation</strong>.</p>'
  + '<h2>Quick Start Guide</h2>'
  + '<ul data-type="taskList">'
  + '<li data-type="taskItem" data-checked="true"><strong>Browse & Search</strong> — Switch categories on the left; use the top bar for search (<code>Ctrl+K</code>) and layout toggles</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>Create & Import</strong> — Click <strong>+</strong> or press <code>Ctrl+N</code> to add; click "Import Bookmarks" on this card or go to Settings → Data &amp; Maintenance</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>Notes & Formatting</strong> — Edit text directly in cards, click titles for full-screen focus; type <code>@</code> to search and embed bookmarks</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>Drag & Hierarchy</strong> — Drag external cards into notes to curate; add nested sub-bookmarks for multi-link websites</li>'
  + '<li data-type="taskItem" data-checked="false"><strong>Sync & Settings</strong> — Log in for automatic real-time sync; use top bar Settings for backups, theme appearance, and encryption</li>'
  + '</ul>'
  + '<h2>Embedded Bookmarks</h2>'
  + '<p>Bookmarks embedded in notes can be dragged to reorder or clicked to visit:</p>'
  + _inlineCard('b1', 'github.com', 'GitHub', 'i') + ' '
  + _inlineCard('b6', 'www.ilovepdf.com', 'I Love PDF', 'i')
  + '<p><br><span style="color: #6B7280; font-size: 0.9em">Tip: This note is an onboarding guide. Feel free to edit or delete it anytime.</span></p>'

/** 向后兼容：保留 WELCOME_NOTES / TIPS_NOTES 常量导出（zh 版本），旧使用指南现统一指向精简版。 */
export const WELCOME_NOTES = WELCOME_ZH
export const TIPS_NOTES = WELCOME_ZH

/** 按 locale 返回欢迎/技巧 HTML。 */
export function getWelcomeNotes(locale: Locale = 'zh-CN'): string {
  return locale === 'en-US' ? WELCOME_EN : WELCOME_ZH
}
export function getTipsNotes(locale: Locale = 'zh-CN'): string {
  return locale === 'en-US' ? WELCOME_EN : WELCOME_ZH
}
