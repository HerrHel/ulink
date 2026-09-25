/**
 * share-render — 分享页渲染核（可移植纯函数，零运行时依赖）。
 *
 * 与 `supabase/functions/share-html/index.ts` 中的渲染部分保持同步（该文件为 Deno
 * Edge Function 版，本文件为 Cloudflare Pages Functions 版；两处均为「取数 + 渲染」
 * 结构，渲染核不触碰任何平台特有 API，切换平台只需替换外层薄薄一层胶水）。
 *
 * 品牌：中文「与链」，英文「ulink」。支持中英双语：renderSharePage 传 locale
 * （'zh-CN' | 'en-US'），渲染文案随之切换（og:locale / lang / 全部 UI 文案）。
 *
 * 设计（2026-08-25 改版 v4，对齐 App 组聚焦/列表模式/编辑器语义）：
 * - 白色聚焦卡片包裹内容区（与组聚焦一致：surface 底 + 边框 + accent 竖条 + 光晕），
 *   CTA 在卡片头部右上；书签列表移到卡片外右侧垂直排列（窄屏回退单列）
 * - 组 notes 渲染富文本：白名单 sanitize（对齐 App sanitizeReadonlyHTML）+ 放行
 *   style 中 color 子集（编辑过的文字颜色分享页保留）+ 内联书签转可点击小卡片
 *   （data-bm-id → 组书签 URL，点击跳转）+ taskItem 未完成项可点击勾选（纯前端视觉）
 * - 书签行 favicon/首字母用 :has() 方案共存（App cards.css 同款，杜绝重叠）
 *
 * 使用：Cloudflare Pages Function `functions/s/[gid].ts` 取数后调用
 * `renderSharePage(group, bookmarks, shareUrl, appOrigin, locale)` 生成完整 HTML。
 */

export type ShareLocale = 'zh-CN' | 'en-US'

/** 渲染文案字典（无第三方依赖，保持纯函数可移植性）。品牌词：zh 与链 / en ulink。 */
const T = {
  'zh-CN': {
    lang: 'zh-CN',
    ogLocale: 'zh_CN',
    siteName: 'ulink',
    defaultGroupName: '未命名组',
    defaultCategoryName: '分享分类',
    notFoundTitle: '分享不存在 - 与链',
    notFoundHeading: '该分享不存在',
    notFoundBody: '私有链接可能已失效，或分享者已停止分享',
    unavailableTitle: '分享暂时无法访问 - 与链',
    unavailableHeading: '分享暂时无法访问',
    unavailableBody: '服务暂时不可用，请稍后重试；分享内容并未失效',
    backHome: '返回与链首页',
    logoText: '与链',
    headSub: '私有链接分享',
    desc: '{n} 个链接 · 凭专属私有链接访问',
    empty: '这个分享组还没有书签',
    emptyCategory: '这个分享分类还没有书签',
    count: '{n} 个链接',
    categoryMeta: '{n} 个书签 · {m} 个组',
    // ── 分类页（v2 卡片网格）──
    catDesc: '{n} 个书签 · {m} 个组 · 凭专属私有链接访问',
    catBookmarks: '{n} 个书签',
    catGroups: '{m} 个组',
    catExpand: '展开 / 收起组内书签',
    catGroupEmpty: '这个组还没有书签',
    catNoNotes: '暂无笔记',
    subBookmark: '子书签',
    catChildren: '{n} 个子书签',
    catHide: '收起',
    cipherPlaceholder: '（内容已加密）',
    catSpecialFeature: '合辑展厅 · 策展专题库',
    catEditorialNotes: '编者手记与导读',
    catChapterIndex: '目录索引',
    catCuratedBookmarks: '独立精选与速查资源',
    catQuickLinksSub: '未归入特定专题的高频站点',
    catExplore: '探索专题画卷',
    catCollectionsCount: '{m} 个精选专题',
    catBookmarksInCollection: '本专题收录的书签',
    catDrawerMeta: '原位画卷深度精读',
    catNoExcerpt: '精选专题合辑，点击探索完整收录与手记',
    gridView: '宫格视图',
    listView: '列表视图',
    miniGridView: '小宫格视图',
    updatedAt: '更新于 {d}',
    cta: '保存至我的库',
    tocTitle: '目录',
    bookmarksTitle: '收录的书签',
    searchBookmarks: '搜索书签...',
    jumpToNotes: '导读笔记',
    jumpToBookmarks: '收录书签',
    noBookmarksMatch: '未找到匹配的书签',
    footerBrand: '与链 · ulink',
    footerSlogan: '收藏 · 整理 · 分享',
    themeToggle: '切换深浅色主题',
  },
  'en-US': {
    lang: 'en-US',
    ogLocale: 'en_US',
    siteName: 'ulink',
    defaultGroupName: 'Untitled group',
    defaultCategoryName: 'Shared category',
    notFoundTitle: 'Share not found - ulink',
    notFoundHeading: 'This share no longer exists',
    notFoundBody: 'The link may have expired, or the owner stopped sharing it',
    unavailableTitle: 'Share temporarily unavailable - ulink',
    unavailableHeading: 'Share temporarily unavailable',
    unavailableBody: 'The service is temporarily unavailable. Please try again later — the share itself is fine',
    backHome: 'Back to ulink',
    logoText: 'ulink',
    headSub: 'Private share',
    desc: '{n} links · shared via private link',
    desc_one: '{n} link · shared via private link',
    empty: 'This shared group has no bookmarks yet',
    emptyCategory: 'This shared category has no bookmarks yet',
    count: '{n} links',
    count_one: '{n} link',
    categoryMeta: '{n} bookmarks · {m} groups',
    categoryMeta_one: '{n} bookmark · {m} groups',
    // ── category page (v2 card grid) ──
    catDesc: '{n} bookmarks · {m} groups · shared via private link',
    catDesc_one: '{n} bookmark · {m} groups · shared via private link',
    catBookmarks: '{n} bookmarks',
    catBookmarks_one: '{n} bookmark',
    catGroups: '{m} groups',
    catGroups_one: '{m} group',
    catExpand: 'Show / hide bookmarks in this group',
    catGroupEmpty: 'No bookmarks in this group yet',
    catNoNotes: 'No notes yet',
    subBookmark: 'Sub-item',
    catChildren: '{n} sub-items',
    catHide: 'Collapse',
    cipherPlaceholder: '(encrypted content)',
    catSpecialFeature: 'Curated Gallery Hub',
    catEditorialNotes: 'Editorial notes',
    catChapterIndex: 'Contents',
    catCuratedBookmarks: 'Curated links and resources',
    catQuickLinksSub: 'Standalone bookmarked resources',
    catExplore: 'Explore collection',
    catCollectionsCount: '{m} curated collections',
    catCollectionsCount_one: '{m} curated collection',
    catBookmarksInCollection: 'Bookmarks in this collection',
    catDrawerMeta: 'In-place collection reader',
    catNoExcerpt: 'Curated collection. Click to explore links and notes',
    gridView: 'Grid view',
    listView: 'List view',
    miniGridView: 'Mini grid view',
    updatedAt: 'Updated {d}',
    cta: 'Save to my library',
    tocTitle: 'Contents',
    bookmarksTitle: 'Bookmarks in this group',
    searchBookmarks: 'Search bookmarks...',
    jumpToNotes: 'Notes',
    jumpToBookmarks: 'Bookmarks',
    noBookmarksMatch: 'No matching bookmarks found',
    footerBrand: 'ulink',
    footerSlogan: 'Collect · Organize · Share',
    themeToggle: 'Toggle light/dark theme',
  },
} as const

/** favicon 提供方（与 src/config/urls.ts 的 FAVICON_PROVIDER_URL 一致，国内可访问）。 */
const FAVICON_PROVIDER_URL = 'https://api.xinac.net/icon/?url='

export interface PublicGroup {
  id: string
  name: string
  notes: string
  [k: string]: unknown
}
export interface PublicBookmark {
  id: string
  title: string
  url: string
  notes: string
  [k: string]: unknown
}

/** HTML 转义：& < > " '，使结果在「属性值（双引号）」与「文本节点」两种上下文都安全。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ── E2E 历史密文识别（与 src/crypto.ts 的 isThreePartCipher 语义一致，零依赖）──
// 旧版 E2E 曾加密 bookmarks 的 title/url/notes 与 group 的 name/notes；当前版本不再加密，
// 但云端仍存有历史密文（salt.iv.data 三段）。分享 RPC 直读云端 → 分享页无 key 无法解密，
// 直接渲染会把密文显示成乱码（且密文串外泄是信息泄露面）。分享页遇到密文字段一律
// 降级为占位提示，绝不渲染原文。
const B64_SEG_RE = /^[A-Za-z0-9+/]+={0,2}$/

function isCipherText(s: unknown): boolean {
  if (typeof s !== "string" || !s) return false
  const parts = s.split(".")
  if (parts.length !== 3) return false
  const [salt, iv, data] = parts
  if (!salt || !iv || !data) return false
  if (salt.length !== 44 || iv.length !== 16 || data.length < 24) return false
  return B64_SEG_RE.test(salt) && B64_SEG_RE.test(iv) && B64_SEG_RE.test(data)
}

/** 分享页文本降级：E2E 历史密文 → 占位提示（对齐 App 未解锁时 UI 显空不显乱码的语义）。 */
function deCipherText(dict: typeof T['zh-CN'] | typeof T['en-US'], v: unknown): string {
  const s = typeof v === "string" ? v : ""
  return isCipherText(s) ? dict.cipherPlaceholder : s
}

/** 协议白名单：仅放行 http/https，其余可导航 scheme（javascript:/data:/vbscript: 等）返空串。 */
function fixUrl(u: string): string {
  const t = (u || "").trim()
  if (!t) return ""
  if (/^https?:\/\//i.test(t)) return t
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/i.test(t)) return ""
  return "https://" + t
}

/** 展示域名：合法 URL 取 hostname 去 www.，解析失败返空串（不吐乱码）。 */
function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** 由安全书签 URL 派生 favicon 地址（M5：图标只由 URL 派生，不接受跨用户 b.icon）。 */
function faviconOf(u: string): string {
  const dm = domainOf(u)
  return dm ? FAVICON_PROVIDER_URL + encodeURIComponent(dm) : ""
}

/**
 * 毫秒时间戳 → YYYY-MM-DD（UTC，保证边缘节点时区一致、输出稳定）。
 * ts 非正（无时间）返回空串，调用方据此隐藏「更新于」徽章。
 */
function fmtDate(ts: number): string {
  if (!ts || ts <= 0 || !Number.isFinite(ts)) return ""
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** 带内容的危险容器：整块剥离（含其文本），防脚本内容泄漏为可见文本（如 SEO 描述）。 */
const NOTES_BLOCKLIST = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template']

/**
 * 剥离 HTML 标签得纯文本（组 notes 是 TipTap HTML，用于 SEO 描述等纯文本场景）。
 * 先删危险容器块（script/style 等连同内容），再剥标签——否则 <script>alert(1)</script>
 * 剥标签后剩 alert(1) 文本泄漏进 meta description（内容污染，非 XSS）。
 */
function stripTags(html: string): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  return out.replace(/<[^>]+>/g, "").trim()
}

/** 简单插值：替换 {n} 等占位。 */
function fill(s: string, params: Record<string, string | number>): string {
  let out = s
  for (const [k, v] of Object.entries(params)) {
    out = out.split(`{${k}}`).join(String(v))
  }
  return out
}

/** 英文单复数：选 *_one / 基础键（en 复数规则仅 one/other，0 与 >1 用基础键）。 */
function pick(dict: typeof T['zh-CN'] | typeof T['en-US'], key: string, n: number): string {
  const d = dict as unknown as Record<string, string>
  const one = d[`${key}_one`]
  if (one != null && n === 1) return one
  return d[key] ?? key
}

/** 组 notes 纯文本描述：前 120 字，空则回退「N 个链接 · 由与链公开分享」。
 *  E2E 历史密文整段剥掉（回退默认描述），否则密文串会进 meta description/og:*。 */
function descriptionOf(dict: typeof T['zh-CN'] | typeof T['en-US'], group: PublicGroup, n: number): string {
  const raw = (group.notes || "").trim()
  if (!raw || isCipherText(raw)) return fill(pick(dict, 'desc', n), { n })
  const plain = stripTags(raw)
  return (plain && plain.slice(0, 120)) || fill(pick(dict, 'desc', n), { n })
}

// ── 富文本 notes 白名单清洗（语义对齐 App sanitizeReadonlyHTML，零依赖纯函数）──

/** 允许的标签（与 App _purifyReadonlyConfig.ALLOWED_TAGS 一致 + mark 高亮）。 */
const NOTES_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3',
  'blockquote', 'a', 'code', 'pre', 'hr', 'span', 'img', 'mark',
])
/** 允许的属性（与 App ALLOWED_ATTR 一致 + style 白名单子集；data-* 整族放行）。 */
const NOTES_ATTRS = new Set(['class', 'href', 'target', 'rel', 'src', 'alt', 'style'])
/** class 白名单（其余 class 剥离；data-* 无事件无协议，放行无注入面）。
 *  对齐组内 inlineCardHTML/groupRefCardHTML（useInlineCard.ts）：名称/域名/计数保留样式；
 *  gic-btn（详）/gic-remove 保留 class 由 CSS display:none 隐藏（剥 class 会导致「详」字裸奔） */
const NOTES_CLASSES = new Set(['group-inline-card', 'group-ref-card', 'gic-name', 'gic-domain', 'gic-count', 'gic-btn', 'gic-remove', 'is-deleted'])

/** 书签 id → url/title/icon 映射（用于把内联书签 data-bm-id 转成可跳转 <a> 与补全图标）。 */
export interface NotesBmMap {
  [id: string]: {
    url?: string
    title?: string
    icon?: string
  }
}

/**
 * 颜色值校验（白名单，杜绝 CSS 注入）：仅放行 hex / rgb() / rgba() / hsl() / hsla()
 * （数值域限定 [\d\s.,%] 无字母，无法构造 url()/var()/expression 等）/ 纯字母命名色。
 */
function safeColorValue(c: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c
  if (/^rgba?\([\d\s.,%]+\)$/i.test(c)) return c
  if (/^hsla?\([\d\s.,%]+\)$/i.test(c)) return c
  if (/^[a-zA-Z]{3,20}$/.test(c)) return c
  return ""
}

/**
 * style 值白名单清洗（对齐组内 TipTap 渲染的样式子集）：
 * - color / background-color（文字色 + 高亮底色）
 * - font-size（字号：数值+px/em/rem/% 或 inherit）
 * - text-align（对齐：left/center/right/justify）
 * 其余声明（url()、background 简写等）整体剥除，杜绝 CSS 注入。
 */
function safeStyleValue(v: string): string {
  const out: string[] = []
  const decls = (v || "").split(";")
  for (const d of decls) {
    const m = d.match(/^\s*([a-zA-Z-]+)\s*:\s*(.*?)\s*$/)
    if (!m) continue
    const prop = m[1].toLowerCase()
    const val = m[2].trim()
    if (prop === "color" || prop === "background-color") {
      const c = safeColorValue(val)
      if (c) out.push(`${prop}: ${c}`)
    } else if (prop === "font-size") {
      if (/^\d+(\.\d+)?(px|em|rem|%)$/.test(val) || val === "inherit") out.push(`font-size: ${val}`)
    } else if (prop === "text-align") {
      if (/^(left|center|right|justify)$/.test(val)) out.push(`text-align: ${val}`)
    }
  }
  return out.join("; ")
}

/**
 * 白名单清洗组 notes（TipTap HTML）→ 安全富文本。
 * - 剥危险标签/事件/协议；<a> 强制 target=_blank + rel=noopener noreferrer nofollow
 * - style 仅保留 color 声明（编辑过的文字颜色分享页保留，其余 style 剥除）
 * - 内联书签（.group-inline-card，data-bm-id）转 <a>：bmMap 命中且 URL 安全 → 可点击跳转
 * - taskItem 结构：input/label/div 剥除，data-checked 保留（前端 JS 可点击切换）
 */
function sanitizeNotesHtml(html: string, bmMap?: NotesBmMap): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  // 内联书签包裹深度：>0 表示当前在 .group-inline-card 内部（内部嵌套 gic-name 等 span）
  let icDepth = 0
  let curCardBmId: string | null = null
  return out
    .replace(/<[^>]*>/g, (raw) => {
      const m = raw.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/)
      if (!m) return ""
      const close = !!m[1]
      const tag = m[2].toLowerCase()
      if (close) {
        // 内联书签内部：嵌套 span 的闭标签 → </span>；最外层闭标签 → </a>
        if (tag === 'span' && icDepth > 0) {
          icDepth--
          if (icDepth === 0) curCardBmId = null
          return icDepth === 0 ? '</a>' : '</span>'
        }
        return NOTES_TAGS.has(tag) ? `</${tag}>` : ""
      }
      if (!NOTES_TAGS.has(tag)) return ""
      const attrs: string[] = []
      const attrRe = /([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g
      let am: RegExpExecArray | null
      while ((am = attrRe.exec(raw)) !== null) {
        const name = am[1].toLowerCase()
        if (name.startsWith("on")) continue
        if (!NOTES_ATTRS.has(name) && !name.startsWith("data-")) continue
        const unq = am[2].replace(/^["']|["']$/g, "")
        if (name === "href" || name === "src") {
          // 协议白名单：放行 http://、https:// 与站内绝对路径 /xxx（禁止 // 协议相对跨域与 javascript: 等危险协议）
          if (!/^(https?:\/\/|\/(?!\/))/i.test(unq)) continue
        }
        if (name === "class") {
          const cls = unq.split(/\s+/).filter((c) => NOTES_CLASSES.has(c)).join(" ")
          if (!cls) continue
          attrs.push(`class="${cls}"`)
        } else if (name === "style") {
          const st = safeStyleValue(unq)
          if (!st) continue
          attrs.push(`style="${st}"`)
        } else if (name === "href") {
          attrs.push(`href="${unq.replace(/"/g, "&quot;")}"`, 'target="_blank"', 'rel="noopener noreferrer nofollow"')
        } else {
          attrs.push(`${name}="${unq.replace(/"/g, "&quot;")}"`)
        }
      }
      // 内联书签：转可点击 <a>（data-bm-id → 组书签 URL）；内部嵌套 span 深度计数
      if (tag === 'span') {
        const cls = (attrs.find((a) => a.startsWith("class=")) || "").slice(7).replace(/"/g, "")
        const bmId = (attrs.find((a) => a.startsWith("data-bm-id=")) || "").slice(11).replace(/"/g, "")
        const isInlineCard = cls.split(/\s+/).includes('group-inline-card')
        if (isInlineCard) {
          icDepth++
          curCardBmId = bmId || null
          const url = bmId && bmMap?.[bmId]?.url ? fixUrl(bmMap[bmId].url as string) : ""
          if (url) {
            attrs.push(`href="${esc(url)}"`, 'target="_blank"', 'rel="noopener nofollow"')
            return attrs.length ? `<a ${attrs.join(" ")}>` : `<a>`
          }
          return attrs.length ? `<span ${attrs.join(" ")}>` : `<span>`
        }
        // inline-card 内部的嵌套 span（gic-name/gic-domain/gic-count/gic-note-icon）也要计数，
        // 否则其 </span> 会提前输出为 </a>，导致 gic-domain 等跑到卡片外
        if (icDepth > 0) icDepth++
      }
      // 内联卡片内的 img：若 src 缺失或被过滤，从 bmMap 补齐；并附加 onerror 错误降级隐藏类
      if (tag === 'img' && icDepth > 0) {
        let hasSrc = attrs.some((a) => a.startsWith('src='))
        if (!hasSrc && curCardBmId && bmMap?.[curCardBmId]) {
          const info = bmMap[curCardBmId]
          const rawIcon = typeof info.icon === 'string' ? info.icon.trim() : ''
          const fallbackSrc = rawIcon ? (fixUrl(rawIcon) || (/^\/(?!\/)/.test(rawIcon) ? rawIcon : "")) : (info.url ? faviconOf(info.url) : "")
          if (fallbackSrc) {
            attrs.push(`src="${esc(fallbackSrc)}"`)
            hasSrc = true
          }
        }
        if (hasSrc) {
          attrs.push('data-fb', `onerror="this.classList.add('img-err')"` )
        }
      }
      return attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`
    })
}

// ── 渲染 ──

interface ResolvedGroupTitle {
  name: string
  promotedH1: boolean
}

/**
 * 智能解析公开组的展示标题与首行 H1 提拔状态：
 * 1. 显式组名（明文非密文且非空白）最高优先；
 * 2. 若无显式组名，尝试从 notes（HTML）中提取：
 *    - 开头首个 <h1> 标签（允许前面有空行/空段落/注释），提取纯文本并标记 promotedH1 为 true；
 *    - 若无开头的 <h1>，查找首个 heading (h1/h2/h3) 或首行纯文本（截取前 40 字符），promotedH1 为 false；
 * 3. 若均无内容，回退到 dict.defaultGroupName（'未命名组' / 'Untitled group'）。
 */
function resolveGroupTitle(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
): ResolvedGroupTitle {
  const explicit = deCipherText(dict, group.name).trim()
  if (explicit && explicit !== dict.cipherPlaceholder) {
    return { name: explicit, promotedH1: false }
  }

  const rawNotes = typeof group.notes === "string" ? group.notes.trim() : ""
  if (rawNotes && !isCipherText(rawNotes)) {
    const leadH1 = rawNotes.match(/^(?:\s*|<!--[\s\S]*?-->|<p>\s*(?:<br\s*\/?>)?\s*<\/p>)*<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
    if (leadH1) {
      const txt = stripTags(leadH1[1]).trim()
      if (txt) return { name: txt, promotedH1: true }
    }

    const anyH = rawNotes.match(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/i)
    if (anyH) {
      const txt = stripTags(anyH[2]).trim()
      if (txt) return { name: txt.slice(0, 50), promotedH1: false }
    }

    const plain = stripTags(rawNotes).trim()
    if (plain) {
      const firstLine = plain.split(/\r?\n/)[0].trim()
      if (firstLine) return { name: firstLine.slice(0, 40), promotedH1: false }
    }
  }

  return { name: dict.defaultGroupName, promotedH1: false }
}

/** 构建 <head>：title / description / og:* / twitter:* / canonical。 */
function buildHead(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  ogImage: string,
): string {
  const titleInfo = resolveGroupTitle(dict, group)
  const title = `${titleInfo.name} - ${dict.siteName}`
  const desc = descriptionOf(dict, group, bookmarks.length)
  const escTitle = esc(title)
  const escDesc = esc(desc)
  const escUrl = esc(shareUrl)
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`,
    `<title>${escTitle}</title>`,
    `<meta name="description" content="${escDesc}">`,
    `<link rel="canonical" href="${escUrl}">`,
    // Open Graph
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${dict.siteName}">`,
    `<meta property="og:title" content="${escTitle}">`,
    `<meta property="og:description" content="${escDesc}">`,
    `<meta property="og:url" content="${escUrl}">`,
    `<meta property="og:image" content="${esc(ogImage)}">`,
    `<meta property="og:locale" content="${dict.ogLocale}">`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escTitle}">`,
    `<meta name="twitter:description" content="${escDesc}">`,
    `<meta name="twitter:image" content="${esc(ogImage)}">`,
  ].join("\n")
}

/**
 * 图标位：favicon/URL 图标 + 首字母占位共存（App cards.css 同款 :has() 方案，杜绝重叠）：
 *  - img 加载成功（非 .img-err）→ :has() 匹配，隐藏首字母；
 *  - img 加载失败（onerror/FALLBACK_JS 加 .img-err）→ 隐藏 img，露出首字母。
 */
function iconMarkup(imgSrc: string, letter: string, cls: string): string {
  const img = imgSrc
    ? `<img src="${esc(imgSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb onerror="this.classList.add('img-err', '${cls}-img-err')">`
    : ""
  return `${img}<span class="${cls}-fb">${esc(letter)}</span>`
}

/** 品牌链接图标（与 App 端 ShareView logo 同一枚 SVG）。 */
const LOGO_SVG =
  `<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><style>.s-b{stroke:#122E8A}.s-g{stroke:#10B981}@media(prefers-color-scheme:dark){.s-b{stroke:#4F6BFF}.s-g{stroke:#34D399}}</style><defs><mask id="s-mb"><rect width="240" height="240" fill="white"/><line x1="173" y1="144" x2="211" y2="144" stroke="black" stroke-width="38" stroke-linecap="round"/></mask><mask id="s-mg"><rect width="240" height="240" fill="white"/><line x1="29" y1="96" x2="67" y2="96" stroke="black" stroke-width="38" stroke-linecap="round"/></mask></defs><path class="s-b" d="M 24 96 L 120 96 C 176 96 192 104 192 144 C 192 184 176 192 120 192 L 48 192" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" mask="url(#s-mb)"/><path class="s-g" d="M 216 144 L 120 144 C 64 144 48 136 48 96 C 48 56 64 48 120 48 L 192 48" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" mask="url(#s-mg)"/></svg>`

/** 外链箭头（书签行 hover 时滑入）。 */
const ARROW_SVG =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L12 4"/><path d="M5.5 4H12v6.5"/></svg>`

/** 组卡展开箭头（收起态朝下，展开态旋转 180°）。 */
const CHEVRON_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`

/** 布局切换图标（与 src/config/icons.ts 同款：宫格 / 列表 / 小宫格）。 */
const GRID_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`
const LIST_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 6L21 6.00078M8 12L21 12.0008M8 18L21 18.0007M3 6.5H4V5.5H3V6.5ZM3 12.5H4V11.5H3V12.5ZM3 18.5H4V17.5H3V18.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const MINIGRID_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5.25" cy="5.25" r="1.8"/><circle cx="12" cy="5.25" r="1.8"/><circle cx="18.75" cy="5.25" r="1.8"/><circle cx="5.25" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.75" cy="12" r="1.8"/><circle cx="5.25" cy="18.75" r="1.8"/><circle cx="12" cy="18.75" r="1.8"/><circle cx="18.75" cy="18.75" r="1.8"/></svg>`

/** 浅色/深色主题切换图标（与 src/config/icons.ts 同款）。 */
const SUN_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
const MOON_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`

/** 侧栏书签小图标 */
const BOOKMARK_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`

/** 侧栏搜索小图标 */
const SEARCH_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`

/** 目录小图标 */
const TOC_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`

/** 章节导读小图标 */
const NOTES_TAG_SVG =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`

/** 首屏主题防闪烁脚本（FOUC Guard）：在任何样式与 DOM 渲染前立即注入 data-theme 与 color-scheme。 */
const THEME_SCRIPT = `<script>(function(){try{var t=localStorage.getItem("lv_theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}}catch(e){}})();</script>`

/**
 * 书签列表项（App 列表模式排版）：等高行（icon + 标题 + 域名，无 notes，行高统一）。
 * 标题为空时回退展示域名。纯静态 <a>，无需 JS。
 */
function buildBookmarkItem(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  b: PublicBookmark,
  child = false,
): string {
  // E2E 历史密文 URL 不派生链接（不跳转乱码地址、不派生图标）
  const urlCipher = isCipherText(b.url)
  const safe = urlCipher ? "" : fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, b.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const rawNotes = typeof b.notes === 'string' ? deCipherText(dict, b.notes).trim() : ''
  const notes = rawNotes ? stripTags(rawNotes).slice(0, 120) : ''
  const searchStr = esc((title + ' ' + dm).toLowerCase())
  return [
    `<a class="bm${child ? " is-child" : ""}" href="${href}"${target}${rel} data-search="${searchStr}">`,
    `<div class="bm-main">`,
    `<span class="bm-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bm")}</span>`,
    `<div class="bm-info">`,
    `<span class="bm-title">${esc(title)}</span>`,
    dm ? `<span class="bm-url">${esc(dm)}</span>` : `<span class="bm-url">&nbsp;</span>`,
    `</div>`,
    `<span class="bm-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
    `</div>`,
    notes ? `<p class="bm-notes">${esc(notes)}</p>` : '',
    `</a>`,
  ].join("")
}

/**
 * 组/分类图标位：icon 仅当为 http(s) URL 时渲染 <img>（跨用户数据不可信，
 * 非 URL 一律回退首字母，不把任意字符串当图标键使用）。参数为带 index signature
 * 的宽对象，组与分类分享共用（分类 icon 为图标键，非 URL → 一律回退首字母）。
 */
function groupIconMarkup(group: Record<string, unknown>, letter: string): string {
  const icon = typeof group.icon === "string" ? group.icon.trim() : ""
  const imgSrc = /^https?:\/\//i.test(icon) ? icon : ""
  return iconMarkup(imgSrc, letter, "hero")
}

/**
 * 组/分类头部自定义图标：仅当存在明确的 http(s) URL 时渲染图标徽标，
 * 无自定义图片时完全不渲染（方案 1：极简大标题顶格，杜绝占位方块、问号或单字冗余）。
 */
function heroCustomIconMarkup(entity: Record<string, unknown>, prefix: "group" | "cat"): string {
  const icon = typeof entity.icon === "string" ? entity.icon.trim() : ""
  if (/^https?:\/\//i.test(icon)) {
    return `<span class="${prefix}-hero-icon"><img src="${esc(icon)}" alt="" /></span>`
  }
  return ""
}

/** notes 渲染结果：html（清洗后的富文本）+ toc（左侧标题导航，无数标题为空串）。 */
interface NotesResult {
  html: string
  toc: string
}

/** 组 notes 富文本渲染：白名单清洗 + 内联书签转链接 + 标题提取（TOC 锚点）。空则返回空。 */
function notesHtml(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bmMap?: NotesBmMap,
  skipLeadingH1?: boolean,
): NotesResult {
  let raw = (group.notes || "").trim()
  // E2E 历史密文笔记：整体是 salt.iv.data 三段串，无 key 不可解 → 不渲染（调用方回退「暂无笔记」）
  if (!raw || isCipherText(raw)) return { html: "", toc: "" }
  if (skipLeadingH1) {
    raw = raw.replace(/^(?:\s*|<!--[\s\S]*?-->|<p>\s*(?:<br\s*\/?>)?\s*<\/p>)*<h1\b[^>]*>[\s\S]*?<\/h1>/i, "").trim()
    if (!raw) return { html: "", toc: "" }
  }
  let cleaned = sanitizeNotesHtml(raw, bmMap).trim()
  if (!cleaned) return { html: "", toc: "" }
  // 提取 h1/h2/h3 标题并注入锚点 id（toc-N），文档级滚动定位（纯锚点 + scroll-behavior:smooth）
  let n = 0
  const headings: { level: number; text: string }[] = []
  cleaned = cleaned.replace(/<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/g, (all, level, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim()
    if (!text) return all
    const id = `toc-${n++}`
    headings.push({ level: Number(level), text })
    return `<h${level} id="${id}"${attrs}>${inner}</h${level}>`
  })
  const toc = headings.length
    ? `<nav class="toc" aria-label="${esc(dict.tocTitle)}"><div class="toc-title">${esc(dict.tocTitle)}</div>` +
      headings.map((h, i) => `<a class="toc-item toc-l${h.level}" href="#toc-${i}" title="${esc(h.text)}">${esc(h.text)}</a>`).join("") +
      `</nav>`
    : ""
  return { html: `<div class="focus-notes">${cleaned}</div>`, toc }
}

/**
 * 专栏画卷外壳：吸顶毛玻璃顶栏 + 居中自适应专栏容器 + 品牌传播尾部。
 * 去除原后台侧边栏，以内容为绝对主角，SPA 接管前/后体验统一。
 */
function buildAppShell(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  appOrigin: string,
  opts: { hdrMeta: string; ctaUrl: string; inner: string },
): string {
  const year = new Date().getUTCFullYear()
  const isZh = dict.lang === 'zh-CN'
  const slogan = isZh ? '个人书签与知识库 · 随时随地整理分享' : 'Personal bookmarks & knowledge vault'
  const ctaFoot = isZh ? '免费体验与链 ulink →' : 'Try ulink for free →'
  return [
    `<div class="share-app">`,
    `<header class="share-bar">`,
    `<div class="share-bar-wrap">`,
    `<a class="share-brand" href="${esc(appOrigin)}/" title="${esc(dict.backHome)}">`,
    `<span class="share-logo">${LOGO_SVG}</span>`,
    `<span class="share-brand-title">${esc(dict.logoText)}</span>`,
    `</a>`,
    `<span class="share-badge">${esc(dict.headSub)}</span>`,
    `<div class="share-actions">`,
    opts.hdrMeta,
    `<button class="share-theme-btn" id="themeToggle" type="button" aria-label="${esc(dict.themeToggle)}" title="${esc(dict.themeToggle)}">` +
      `<span class="theme-icon-sun">${SUN_SVG}</span>` +
      `<span class="theme-icon-moon">${MOON_SVG}</span>` +
    `</button>`,
    `<a class="cta" href="${esc(opts.ctaUrl)}">${esc(dict.cta)}</a>`,
    `</div>`,
    `</div>`,
    `</header>`,
    `<main class="share-container">`,
    opts.inner,
    `</main>`,
    `<footer class="share-footer">`,
    `<div class="share-footer-inner">`,
    `<div class="share-footer-brand">`,
    `<span class="footer-logo">${LOGO_SVG}</span>`,
    `<span class="footer-name">${esc(dict.footerBrand)}</span>`,
    `</div>`,
    `<p class="share-footer-slogan">${slogan}</p>`,
    `<a class="share-footer-cta" href="${esc(appOrigin)}/">${ctaFoot}</a>`,
    `<span class="share-footer-copy">© ${year} ulink · ${esc(appOrigin.replace(/^https?:\/\//, ""))}</span>`,
    `</div>`,
    `</footer>`,
    `</div>`,
  ].join("\n")
}

/** 构建 <body>（组分享）：方案 B 策展级单体画卷（自上而下自然流式，上文下签，主角归位）。 */
function buildBody(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  appOrigin: string,
): string {
  const titleInfo = resolveGroupTitle(dict, group)
  const name = esc(titleInfo.name)
  const count = bookmarks.length
  const countTag = `<span class="meta-tag">${esc(fill(pick(dict, 'count', count), { n: count }))}</span>`
  const updated = fmtDate(typeof group.updated_at_num === "number" ? group.updated_at_num : 0)
  const updatedTag = updated ? `<span class="meta-tag">${esc(fill(dict.updatedAt, { d: updated }))}</span>` : ""
  // data-bm-id → 书签信息映射（内联书签转可点击 <a> 与补全图标）
  const bmMap: NotesBmMap = {}
  for (const b of bookmarks) {
    bmMap[b.id] = { url: b.url, title: b.title, icon: typeof b.icon === 'string' ? b.icon : '' }
  }
  const notes = notesHtml(dict, group, bmMap, titleInfo.promotedH1)
  // CTA 跳 App 的 hash 路由（/app#share/<gid>），直达应用主体完成保存
  const appUrl = `${appOrigin}/app#share/${esc(group.id)}`

  const hasNotes = Boolean(notes.html)
  const hasBookmarks = count > 0

  const sections: string[] = []

  if (hasNotes) {
    sections.push(
      `<section class="group-notes-section" id="section-notes">`,
      `<div class="group-notes-content">${notes.html}</div>`,
      `</section>`,
    )
  }

  if (hasNotes && hasBookmarks) {
    sections.push(`<div class="canvas-divider" aria-hidden="true"></div>`)
  }

  if (hasBookmarks) {
    const searchBar = count >= 6
      ? `<div class="bm-search-wrap"><input type="search" class="bm-search-input" id="bmSearchInput" placeholder="${esc(dict.searchBookmarks)}" autocomplete="off" aria-label="${esc(dict.searchBookmarks)}" /><span class="bm-search-icon">${SEARCH_SVG}</span></div>`
      : ''
    sections.push(
      `<section class="group-bookmarks-section" id="section-bookmarks">`,
      `<div class="section-header">`,
      `<div class="section-title-wrap">`,
      `<span class="section-title-icon">${BOOKMARK_SVG}</span>`,
      `<h2 class="section-title">${esc(dict.bookmarksTitle)}</h2>`,
      `<span class="section-count">${count}</span>`,
      `</div>`,
      searchBar,
      `</div>`,
      `<div class="bm-grid" id="bmList">`,
      bookmarks.map((b) => buildBookmarkItem(dict, b, !!b.parent_id)).join("\n"),
      `</div>`,
      `<div class="bm-empty-search" id="bmEmptySearch" style="display:none">${esc(dict.noBookmarksMatch)}</div>`,
      `</section>`,
    )
  }

  if (!hasNotes && !hasBookmarks) {
    sections.push(`<div class="empty">${esc(dict.empty)}</div>`)
  }

  const heroIcon = heroCustomIconMarkup(group, "group")

  const inner = [
    `<article class="group-canvas">`,
    `<header class="group-hero">`,
    heroIcon,
    `<div class="group-hero-info">`,
    `<h1 class="group-hero-title">${name}</h1>`,
    `<div class="group-hero-meta">${countTag}${updatedTag}</div>`,
    `</div>`,
    `</header>`,
    `<div class="group-canvas-body">`,
    sections.join("\n"),
    `</div>`,
    `</article>`,
  ].filter(Boolean).join("\n")

  return buildAppShell(dict, appOrigin, { hdrMeta: "", ctaUrl: appUrl, inner })
}

/**
 * 从主应用 index.html 提取 SPA 资源标签（主 CSS + modulepreload + module script）。
 * 分享页 SSR 注入后，SPA bundle 在同域 /s/<gid> 下启动，detectShareRoute 识别 path
 * 路由自动接管为只读态（不再需要用户手动点击 CTA）。纯函数，供 CF Functions 用
 * env.ASSETS 读 index.html 后调用（Deno 保底版无此能力，跳过注入）。
 */
export function extractAppAssets(indexHtml: string): string {
  const out: string[] = []
  const pushAll = (re: RegExp, wrap: (href: string) => string) => {
    const re2 = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re2.exec(indexHtml))) {
      const href = m[1]
      if (!href || /^https?:\/\//i.test(href)) continue
      out.push(wrap(href))
    }
  }
  pushAll(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i, (h) => `<link rel="stylesheet" href="${h}">`)
  pushAll(/<link\s[^>]*rel="modulepreload"[^>]*href="([^"]+)"[^>]*>/i, (h) => `<link rel="modulepreload" crossorigin href="${h}">`)
  pushAll(/<script\s[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/i, (h) => `<script type="module" crossorigin src="${h}"></script>`)
  return out.join("\n")
}

/** 安全序列化 JSON 到 <script> 中（转义 < 和 \u2028/\u2029，防 XSS 与闭合标签） */
export function serializeScriptData(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** 组装完整 HTML 文档。og:image 从 appOrigin 推导（静态品牌图，随站部署于根路径）。
 *  appAssets：主应用 SPA 的资源标签（stylesheet/modulepreload/module script，由函数层
 *  用 env.ASSETS 读 index.html 经 extractAppAssets 提取）。注入后 SPA 启动即识别
 *  /s/<gid> path 路由（detectShareRoute）自动接管为只读态；body 内 <div id="app">
 *  为 Vue mount 挂载点，接管时整段骨架被主应用重建。 */
export function renderSharePage(
  group: PublicGroup,
  bookmarks: PublicBookmark[],
  shareUrl: string,
  appOrigin: string,
  locale: ShareLocale = 'zh-CN',
  appAssets = '',
): string {
  const dict = T[locale]
  const ogImage = `${appOrigin}/share-cover.png`
  const head = buildHead(dict, group, bookmarks, shareUrl, ogImage)
  const body = buildBody(dict, group, bookmarks, appOrigin)
  const initDataScript = `<script id="__SHARE_DATA__">window.__INITIAL_SHARE_DATA__=${serializeScriptData({
    type: 'group',
    id: group.id,
    data: { group, bookmarks },
  })};</script>`
  return [
    `<!DOCTYPE html>`,
    `<html lang="${dict.lang}">`,
    `<head>${THEME_SCRIPT}${head}${initDataScript}${appAssets}</head>`,
    `<style>${CSS}</style>`,
    `<body><div id="app">${body}</div><script>${FALLBACK_JS}</script></body>`,
    `</html>`,
  ].join("\n")
}

/** 分类分享数据结构（RPC get_public_category 的 category 节点） */
export interface PublicCategory {
  id: string
  name: string
  icon: string
  color: string
  [k: string]: unknown
}

/** 散落卡片下的子书签（含层级，depth 从 1 起 = 直接子级） */
interface CategoryLooseChild {
  bookmark: PublicBookmark
  depth: number
}

/** 散落书签卡：顶层书签 + 其子孙（DFS 扁平化，depth 表示缩进层级） */
interface CategoryLooseCard {
  bookmark: PublicBookmark
  children: CategoryLooseChild[]
}

/**
 * 分类分享：把书签按归属切成「组内书签」与「散落书签」两套视图模型（对齐 App 分类视图的
 * 混排逻辑：组卡在前，散落书签卡在后，一张书签只出现一次）。
 * - 组内书签按 group.bookmark_ids 顺序取（与 App 组内顺序一致），**子书签也保留**，
 *   由渲染层按 parent_id 缩进体现层级
 * - 散落书签 = 不属于任何组的书签；**子书签不丢弃**：父也在散落集合里的挂到父卡片的
 *   children（支持多层级，depth 表示缩进深度），父在组内/不在本分类的孤儿则独立成卡
 *   （渲染层据 parent_id 打「子书签」标记，说明父级不在当前展示范围）
 * - 同一书签被多组引用时以首个组为准（used 去重，避免重复成卡）
 */
interface CategoryItems {
  groupCards: { group: PublicGroup; items: PublicBookmark[] }[]
  loose: CategoryLooseCard[]
}

function splitCategoryItems(groups: PublicGroup[], bookmarks: PublicBookmark[]): CategoryItems {
  const byId: { [id: string]: PublicBookmark } = {}
  for (const b of bookmarks || []) {
    if (b && b.id) byId[String(b.id)] = b
  }
  const used = new Set<string>()
  const groupCards = (groups || []).map((g) => {
    const ids = Array.isArray(g.bookmark_ids) ? (g.bookmark_ids as unknown[]) : []
    const items: PublicBookmark[] = []
    for (const raw of ids) {
      const id = String(raw ?? "")
      const b = byId[id]
      if (!b || used.has(id)) continue
      used.add(id)
      items.push(b)
    }
    return { group: g, items }
  })
  // 未被任何组包含的书签（子书签在内，随后按 parent_id 归位到父卡片）
  const rest: PublicBookmark[] = (bookmarks || []).filter((b) => {
    if (!b || !b.id) return false
    return !used.has(String(b.id))
  })
  const restIds = new Set(rest.map((b) => String(b.id)))
  // 父 id → 直接子书签（保持原顺序）
  const kidsOf: { [pid: string]: PublicBookmark[] } = {}
  for (const b of rest) {
    const pid = typeof b.parent_id === "string" ? b.parent_id.trim() : ""
    if (!pid || !restIds.has(pid)) continue
    ;(kidsOf[pid] = kidsOf[pid] || []).push(b)
  }
  // DFS 收集全部后代（支持孙级），扁平化后由 depth 表达缩进
  const collect = (pid: string, depth: number, out: CategoryLooseChild[]): void => {
    for (const kid of kidsOf[pid] || []) {
      out.push({ bookmark: kid, depth })
      collect(String(kid.id), depth + 1, out)
    }
  }
  const loose: CategoryLooseCard[] = []
  for (const b of rest) {
    const pid = typeof b.parent_id === "string" ? b.parent_id.trim() : ""
    // 父也在散落集合 → 该书签作为父卡片的子项出现（由父那轮 DFS 收集），此处不重复成卡
    if (pid && restIds.has(pid)) continue
    const children: CategoryLooseChild[] = []
    collect(String(b.id), 1, children)
    loose.push({ bookmark: b, children })
  }
  return { groupCards, loose }
}

/** Favicon 叠放堆栈（方案 2 合辑封面专属）：展示前 3 个站点的图标微倾斜叠放 + 剩余数量徽标 */
function buildFaviconStack(items: PublicBookmark[]): string {
  const maxIcons = 3
  const preview = items.slice(0, maxIcons)
  const remainder = items.length - maxIcons
  const icons = preview.map((b) => {
    const safe = isCipherText(b.url) ? "" : fixUrl(b.url)
    const title = b.title ? String(b.title).trim() : ""
    const ch = title.charAt(0).toUpperCase() || "?"
    const fav = safe ? faviconOf(safe) : ""
    return `<span class="stack-icon">${iconMarkup(fav, ch, "stack")}</span>`
  }).join("")
  const rem = remainder > 0 ? `<span class="stack-icon stack-remainder">+${remainder}</span>` : ""
  return `<div class="favicon-stack">${icons}${rem}</div>`
}

/** 方案 2：合辑展厅画廊·专题专辑封面卡（Album Card） */
function buildAlbumCard(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  entry: { group: PublicGroup; items: PublicBookmark[] },
  idx: number,
): string {
  const g = entry.group
  const titleInfo = resolveGroupTitle(dict, g)
  const name = esc(titleInfo.name)
  const n = entry.items.length
  const countText = esc(fill(pick(dict, "catBookmarks", n), { n }))
  const seriesNum = `COLLECTION · ${String(idx + 1).padStart(2, "0")}`

  // 提取 notes 纯文本摘要（前 110 字符，金句斜体呈现）
  const rawNotes = (g.notes || "").trim()
  let excerpt = ""
  if (rawNotes && !isCipherText(rawNotes)) {
    const plain = stripTags(rawNotes)
    if (plain) {
      excerpt = plain.slice(0, 110)
    }
  }
  const excerptHtml = excerpt
    ? `<p class="album-excerpt">“${esc(excerpt)}”</p>`
    : `<p class="album-excerpt album-excerpt-empty">${esc(dict.catNoExcerpt)}</p>`

  const faviconsHtml = buildFaviconStack(entry.items)
  const searchStr = esc((titleInfo.name + ' ' + excerpt + ' ' + entry.items.map(b => (b.title || '') + ' ' + (b.url || '')).join(' ')).toLowerCase())

  return [
    `<a href="#album-drawer-${idx}" class="album-card" data-search="${searchStr}">`,
    `  <div class="album-card-top">`,
    `    <span class="album-series-badge">${seriesNum}</span>`,
    `    <span class="album-count-badge">${countText}</span>`,
    `  </div>`,
    `  <h3 class="album-title">${name}</h3>`,
    `  ${excerptHtml}`,
    `  <div class="album-card-bottom">`,
    `    ${faviconsHtml}`,
    `    <span class="album-action-btn">`,
    `      <span>${esc(dict.catExplore)}</span>`,
    `      <span class="album-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
    `    </span>`,
    `  </div>`,
    `</a>`,
  ].join("\n")
}

/** 方案 2：合辑展厅画廊·沉浸式单体画卷抽屉（Drawer，利用纯 CSS :target 零 JS 优雅展开） */
function buildAlbumDrawer(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  entry: { group: PublicGroup; items: PublicBookmark[] },
  idx: number,
  bmMap: NotesBmMap,
  appUrl: string,
): string {
  const g = entry.group
  const titleInfo = resolveGroupTitle(dict, g)
  const name = esc(titleInfo.name)
  const n = entry.items.length
  const countText = esc(fill(pick(dict, "catBookmarks", n), { n }))
  const seriesNum = `COLLECTION · ${String(idx + 1).padStart(2, "0")}`
  const notesRes = notesHtml(dict, g, bmMap, titleInfo.promotedH1).html
  const itemsHtml = n
    ? entry.items.map((b) => buildBookmarkItem(dict, b, !!b.parent_id)).join("\n")
    : `<div class="chapter-empty">${esc(dict.catGroupEmpty)}</div>`

  const notesBlock = notesRes
    ? [
        `<div class="gallery-drawer-notes">`,
        `  <div class="gallery-notes-tag">${NOTES_TAG_SVG}<span>${esc(dict.catEditorialNotes)}</span></div>`,
        `  <div class="focus-notes">${notesRes}</div>`,
        `</div>`,
      ].join("\n")
    : ""

  return [
    `<div id="album-drawer-${idx}" class="gallery-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title-${idx}">`,
    `  <a href="#close" class="gallery-drawer-backdrop" aria-label="${esc(dict.catHide)}" tabindex="-1"></a>`,
    `  <div class="gallery-drawer-panel">`,
    `    <div class="gallery-drawer-header">`,
    `      <span class="gallery-drawer-badge">${seriesNum}</span>`,
    `      <a href="#close" class="gallery-drawer-close" aria-label="${esc(dict.catHide)}">✕</a>`,
    `    </div>`,
    `    <div class="gallery-drawer-body">`,
    `      <div class="gallery-drawer-title-group">`,
    `        <h2 id="drawer-title-${idx}" class="gallery-drawer-title">${name}</h2>`,
    `        <div class="gallery-drawer-meta">`,
    `          <span>${countText}</span>`,
    `          <span>·</span>`,
    `          <span>${esc(dict.catDrawerMeta)}</span>`,
    `        </div>`,
    `      </div>`,
    `      ${notesBlock}`,
    `      <div class="gallery-drawer-bookmarks">`,
    `        <div class="gallery-drawer-bm-head">${esc(dict.catBookmarksInCollection)}</div>`,
    `        <div class="gallery-bm-list">${itemsHtml}</div>`,
    `      </div>`,
    `    </div>`,
    `    <div class="gallery-drawer-footer">`,
    `      <span class="gallery-footer-brand">${esc(dict.footerBrand)}</span>`,
    `      <a href="${esc(appUrl)}" class="gallery-save-btn">${esc(dict.cta)}</a>`,
    `    </div>`,
    `  </div>`,
    `</div>`,
  ].join("\n")
}

/** 散落精选书签区（Quick Links） */
function buildQuickLinksSection(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  loose: CategoryLooseCard[],
  layoutCls: string,
): string {
  const count = loose.reduce((s, c) => s + 1 + c.children.length, 0)
  const countText = esc(fill(pick(dict, "catBookmarks", count), { n: count }))
  const cardsHtml = loose.map((c) => buildLooseBookmarkCard(dict, c)).join("\n")
  return [
    `<section class="cat-quick-links-section" id="cat-sec-curated">`,
    `  <div class="cat-quick-links-header">`,
    `    <div class="cat-quick-links-title-group">`,
    `      <h2 class="cat-quick-links-title"><span>📌</span><span>${esc(dict.catCuratedBookmarks)}</span></h2>`,
    `      <span class="cat-quick-links-sub">${esc(dict.catQuickLinksSub)}</span>`,
    `    </div>`,
    `    <span class="chapter-count">${countText}</span>`,
    `  </div>`,
    `  <div class="cat-grid${layoutCls}">`,
    `    ${cardsHtml}`,
    `  </div>`,
    `</section>`,
  ].join("\n")
}

/** 子书签行（挂在散落父卡内，depth 决定缩进量）：图标 + 标题 + 域名 + 笔记，属性全保留。 */
function buildLooseChildItem(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  child: CategoryLooseChild,
): string {
  const b = child.bookmark
  const urlCipher = isCipherText(b.url)
  const safe = urlCipher ? "" : fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, b.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const notes = deCipherText(dict, b.notes).trim()
  const pad = 10 + (child.depth - 1) * 14
  return [
    `<a class="bmcard-child" style="padding-left:${pad}px" href="${href}"${target}${rel}>`,
    `<span class="bmcard-child-ic">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bmc")}</span>`,
    `<span class="bmcard-child-text">`,
    `<span class="bmcard-child-title">${esc(title)}</span>`,
    dm ? `<span class="bmcard-child-url">${esc(dm)}</span>` : "",
    notes ? `<p class="bmcard-child-notes">${esc(notes)}</p>` : "",
    `</span>`,
    `</a>`,
  ].join("")
}

/**
 * 分类分享·散落书签卡（对齐 App BookmarkCard 宫格态）：图标 + 标题 + 域名 + 笔记。
 * 卡片下挂子书签区：父卡与子项都是链接，外层用 article（HTML 不允许 <a> 嵌套 <a>）。
 */
function buildLooseBookmarkCard(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  card: CategoryLooseCard,
): string {
  const b = card.bookmark
  const urlCipher = isCipherText(b.url)
  const safe = urlCipher ? "" : fixUrl(b.url)
  const href = safe ? esc(safe) : "#"
  const rel = safe ? ' rel="noopener nofollow"' : ""
  const target = safe ? ' target="_blank"' : ""
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, b.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const notes = deCipherText(dict, b.notes).trim()
  const isChild = !!(typeof b.parent_id === "string" && b.parent_id.trim())
  const searchStr = esc((title + ' ' + dm).toLowerCase())
  const children = card.children.length
    ? [
        `<input type="checkbox" class="bmcard-toggle-input" id="bmc-${esc(String(b.id))}">`,
        `<label class="bmcard-toggle-label" for="bmc-${esc(String(b.id))}">`,
        `<span>${fill(pick(dict, "catChildren", card.children.length), { n: card.children.length })}</span>`,
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
        `</label>`,
        `<div class="bmcard-children">${card.children.map((c) => buildLooseChildItem(dict, c)).join("")}</div>`,
      ].join("")
    : ""
  return [
    `<article class="bmcard${children ? " has-children" : ""}" data-search="${searchStr}">`,
    `<a class="bmcard-main" href="${href}"${target}${rel}>`,
    `<span class="bmcard-head">`,
    `<span class="bmcard-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bmcard")}</span>`,
    `<span class="bmcard-title">${esc(title)}</span>`,
    isChild ? `<span class="bmcard-badge">${esc(dict.subBookmark)}</span>` : "",
    `</span>`,
    dm ? `<span class="bmcard-url">${esc(dm)}</span>` : `<span class="bmcard-url">&nbsp;</span>`,
    notes ? `<p class="bmcard-notes">${esc(notes)}</p>` : "",
    `<span class="bmcard-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
    `</a>`,
    children,
    `</article>`,
  ].join("")
}

/** 分类页布局（对齐主站 uiStore.layoutMode；移动端 CSS 隐藏宫格入口，只留列表/小宫格） */
export type CatLayout = 'grid' | 'list' | 'mini-grid'

/** 布局切换器：三个链接（?layout=xx），当前项高亮；无 JS 也能切换（整页重渲染）。 */
function buildLayoutSwitch(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  baseUrl: string,
  current: CatLayout,
): string {
  const btn = (mode: CatLayout, title: string, svg: string, mobileHidden = false): string => {
    const sep = baseUrl.includes("?") ? "&" : "?"
    const href = `${baseUrl}${sep}layout=${mode}`
    const cls = ["cat-layout-btn", current === mode ? "active" : "", mobileHidden ? "hide-mobile" : ""]
      .filter(Boolean)
      .join(" ")
    return `<a class="${cls}" href="${esc(href)}" data-layout="${mode}" title="${esc(title)}" rel="nofollow">${svg}</a>`
  }
  return [
    `<div class="cat-layout-switch" role="group" aria-label="${esc(dict.gridView)}">`,
    btn("grid", dict.gridView, GRID_SVG, true),
    btn("list", dict.listView, LIST_SVG),
    btn("mini-grid", dict.miniGridView, MINIGRID_SVG),
    `</div>`,
  ].join("")
}

/** 构建 <body>（方案 1 章节式立体专刊）：外壳 + 沉浸式刊头（微光/搜索/Tabs）+ 主题章节流（导读+书签网格）。 */
function buildCategoryBody(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  category: PublicCategory,
  groups: PublicGroup[],
  bookmarks: PublicBookmark[],
  shareId: string,
  shareUrl: string,
  appOrigin: string,
  layout: CatLayout = 'grid',
): string {
  const name = esc(deCipherText(dict, category.name) || dict.defaultCategoryName)
  const { groupCards, loose } = splitCategoryItems(groups, bookmarks)
  // data-bm-id → 书签信息映射（组 notes 内联书签转可点击 <a> 与补全图标）
  const bmMap: NotesBmMap = {}
  for (const b of bookmarks || []) {
    if (b && b.id) {
      bmMap[b.id] = { url: b.url, title: b.title, icon: typeof b.icon === 'string' ? b.icon : '' }
    }
  }
  // 计数口径：与实际收录的书签数一致（组内 + 散落顶层 + 散落子书签，全部计入）
  const count =
    groupCards.reduce((s, e) => s + e.items.length, 0) +
    loose.reduce((s, c) => s + 1 + c.children.length, 0)
  const groupCount = groupCards.length
  // 标签元数据：精选专题数 + 收录站点数
  const tags = [
    groupCount
      ? `<span class="meta-tag">${esc(fill(pick(dict, 'catCollectionsCount', groupCount), { m: groupCount }))}</span>`
      : "",
    `<span class="meta-tag">${esc(fill(pick(dict, 'catBookmarks', count), { n: count }))}</span>`,
  ].filter(Boolean).join("")

  const layoutCls = layout !== 'grid' ? ` ${layout}-view` : ''

  // CTA 跳 App 的 hash 路由（/app#share/c/<share_id>），直达应用主体完成保存
  const appUrl = `${appOrigin}/app#share/c/${esc(shareId)}`
  const emptySearch = `<div id="bmEmptySearch" class="bm-empty-search" style="display:none">${esc(dict.noBookmarksMatch)}</div>`
  const emptyView = `<div class="empty">${esc(dict.emptyCategory)}</div>`

  let bodyContent = ""
  if (groupCount > 0) {
    const albumsGridHtml = `<div class="gallery-albums-grid">${groupCards.map((e, i) => buildAlbumCard(dict, e, i)).join("\n")}</div>`
    const quickLinksHtml = loose.length > 0 ? buildQuickLinksSection(dict, loose, layoutCls) : ""
    const drawersHtml = `<div class="gallery-drawers-container">${groupCards.map((e, i) => buildAlbumDrawer(dict, e, i, bmMap, appUrl)).join("\n")}</div>`
    bodyContent = [albumsGridHtml, quickLinksHtml, emptySearch, drawersHtml].filter(Boolean).join("\n")
  } else if (loose.length > 0) {
    bodyContent = [
      `<div class="cat-grid${layoutCls}">${loose.map((c) => buildLooseBookmarkCard(dict, c)).join("\n")}</div>`,
      emptySearch,
    ].join("\n")
  } else {
    bodyContent = emptyView
  }

  // 搜索条 (总书签 >= 4 条时展示)
  const searchBar = count >= 4 ? [
    `<div class="cat-search-bar">`,
    `  <span class="cat-search-ic" aria-hidden="true">${SEARCH_SVG}</span>`,
    `  <input id="bmSearchInput" class="cat-search-input" type="search" placeholder="${esc(dict.searchBookmarks)}" autocomplete="off" spellcheck="false" aria-label="${esc(dict.searchBookmarks)}">`,
    `</div>`,
  ].join("\n") : ""

  // 分类色：白名单校验后作 CSS 变量注入（非法值回落默认 accent，杜绝 CSS 注入）
  const catColor = typeof category.color === "string" ? safeColorValue(category.color.trim()) : ""
  const accentStyle = catColor ? ` style="--cat: ${esc(catColor)}"` : ""
  const heroIcon = heroCustomIconMarkup(category, "cat")

  const inner = [
    `<section class="cat-hero"${accentStyle}>`,
    `  <div class="cat-hero-glow" aria-hidden="true"></div>`,
    `  <div class="cat-hero-main">`,
    `    ${heroIcon}`,
    `    <div class="cat-hero-text">`,
    `      <div class="cat-hero-badge">`,
    `        <span class="cat-badge-dot" aria-hidden="true"></span>`,
    `        <span class="cat-badge-text">${esc(dict.catSpecialFeature)}</span>`,
    `      </div>`,
    `      <h1 class="cat-hero-name">${name}</h1>`,
    `      <div class="cat-hero-meta">${tags}</div>`,
    `    </div>`,
    `    <div class="cat-hero-actions">`,
    `      ${buildLayoutSwitch(dict, shareUrl, layout)}`,
    `    </div>`,
    `  </div>`,
    searchBar,
    `</section>`,
    bodyContent,
  ].filter(Boolean).join("\n")

  return buildAppShell(dict, appOrigin, { hdrMeta: "", ctaUrl: appUrl, inner })
}

/** 分类分享 <head>：分类名进 title，描述用「N 个书签 · M 个组 · 由与链公开分享」。 */
function buildCategoryHead(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  category: PublicCategory,
  count: number,
  groupCount: number,
  shareUrl: string,
  ogImage: string,
): string {
  const title = `${category.name || dict.defaultCategoryName} - ${dict.siteName}`
  const escTitle = esc(title)
  const escDesc = esc(fill(pick(dict, 'catDesc', count), { n: count, m: groupCount }))
  const escUrl = esc(shareUrl)
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`,
    `<title>${escTitle}</title>`,
    `<meta name="description" content="${escDesc}">`,
    `<link rel="canonical" href="${escUrl}">`,
    // Open Graph
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${dict.siteName}">`,
    `<meta property="og:title" content="${escTitle}">`,
    `<meta property="og:description" content="${escDesc}">`,
    `<meta property="og:url" content="${escUrl}">`,
    `<meta property="og:image" content="${esc(ogImage)}">`,
    `<meta property="og:locale" content="${dict.ogLocale}">`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escTitle}">`,
    `<meta name="twitter:description" content="${escDesc}">`,
    `<meta name="twitter:image" content="${esc(ogImage)}">`,
  ].join("\n")
}

/**
 * 分类分享完整 HTML 文档（/s/c/<share_id>，函数 functions/s/c/[sid].ts 取数后调用）。
 * 与 renderSharePage 同款样式；数据不含 username/password（RPC 列级隔离）。
 */
export function renderShareCategoryPage(
  category: PublicCategory,
  groups: PublicGroup[],
  bookmarks: PublicBookmark[],
  shareId: string,
  shareUrl: string,
  appOrigin: string,
  locale: ShareLocale = 'zh-CN',
  layout: CatLayout = 'grid',
  appAssets = '',
): string {
  const dict = T[locale]
  const ogImage = `${appOrigin}/share-cover.png`
  const { groupCards, loose } = splitCategoryItems(groups, bookmarks)
  const count =
    groupCards.reduce((s, e) => s + e.items.length, 0) +
    loose.reduce((s, c) => s + 1 + c.children.length, 0)
  const head = buildCategoryHead(dict, category, count, groupCards.length, shareUrl, ogImage)
  const body = buildCategoryBody(dict, category, groups, bookmarks, shareId, shareUrl, appOrigin, layout)
  const initDataScript = `<script id="__SHARE_DATA__">window.__INITIAL_SHARE_DATA__=${serializeScriptData({
    type: 'category',
    id: shareId,
    data: { category, groups, bookmarks },
  })};</script>`
  return [
    `<!DOCTYPE html>`,
    `<html lang="${dict.lang}">`,
    `<head>${THEME_SCRIPT}${head}${initDataScript}${appAssets}</head>`,
    `<style>${CSS}</style>`,
    `<body><div id="app">${body}</div><script>${FALLBACK_JS}</script></body>`,
    `</html>`,
  ].join("\n")
}

/** 404 兜底页（分享不存在 / 已取消公开），主应用外壳 + 同一视觉语言。 */
export function renderNotFoundPage(locale: ShareLocale = 'zh-CN'): string {
  const d = T[locale]
  const origin = 'https://ulink.ren'
  return [
    `<!DOCTYPE html>`,
    `<html lang="${d.lang}">`,
    `<head>`,
    THEME_SCRIPT,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>${esc(d.notFoundTitle)}</title>`,
    `</head>`,
    `<style>${CSS}</style>`,
    `<body>`,
    buildAppShell(d, origin, {
      hdrMeta: "",
      ctaUrl: `${origin}/`,
      inner: [
        `<div class="nf">`,
        `<span class="nf-icon">${LOGO_SVG}</span>`,
        `<h1 class="nf-title">${esc(d.notFoundHeading)}</h1>`,
        `<p class="nf-body">${esc(d.notFoundBody)}</p>`,
        `</div>`,
      ].join("\n"),
    }),
    `</body>`,
    `</html>`,
  ].join("\n")
}

/**
 * 503 兜底页（上游 Supabase 不可达 / 5xx），与 404 同视觉骨架但语义不同：
 * 「暂时不可用，分享本身没失效」。调用方必须配 no-store（或不缓存），让恢复后
 * 的下一次请求立即拿到真数据，而不是把故障页缓存进边缘。
 */
export function renderUnavailablePage(locale: ShareLocale = 'zh-CN'): string {
  const d = T[locale]
  const origin = 'https://ulink.ren'
  return [
    `<!DOCTYPE html>`,
    `<html lang="${d.lang}">`,
    `<head>`,
    THEME_SCRIPT,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>${esc(d.unavailableTitle)}</title>`,
    `</head>`,
    `<style>${CSS}</style>`,
    `<body>`,
    buildAppShell(d, origin, {
      hdrMeta: "",
      ctaUrl: `${origin}/`,
      inner: [
        `<div class="nf">`,
        `<span class="nf-icon">${LOGO_SVG}</span>`,
        `<h1 class="nf-title">${esc(d.unavailableHeading)}</h1>`,
        `<p class="nf-body">${esc(d.unavailableBody)}</p>`,
        `</div>`,
      ].join("\n"),
    }),
    `</body>`,
    `</html>`,
  ].join("\n")
}

/**
 * 渐进增强脚本（无 JS 时页面完整可用）：
 * 1) favicon 降级：img[data-fb] 加载失败加 .*-img-err → CSS 隐藏、:has() 露出首字母
 * 2) taskItem 未完成项可点击勾选（纯前端视觉，不持久化）：点击切换 data-checked
 * 3) TOC scrollspy：滚动时给当前可见标题对应的导航项加 .active（高亮）
 * 4) 内容不足以滚动（滚动距离 < 120px）时隐藏 TOC——没法"快速定位"，避免空导航占位
 */
const FALLBACK_JS = `(function(){var tb=document.getElementById('themeToggle');if(tb){tb.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');if(!cur){cur=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);document.documentElement.style.colorScheme=next;try{localStorage.setItem('lv_theme',next)}catch(e){}})}var a=document.querySelectorAll('img[data-fb]');function err(e){e.classList.add('img-err','bm-img-err','hero-img-err','bmcard-img-err','bmc-img-err','stack-img-err')}for(var i=0;i<a.length;i++){(function(im){im.addEventListener('error',function(){err(im)});if(im.complete&&im.naturalWidth===0){err(im)}})(a[i])}var t=document.querySelectorAll('li[data-type="taskItem"]');for(var j=0;j<t.length;j++){(function(li){li.style.cursor='pointer';li.addEventListener('click',function(){li.setAttribute('data-checked',li.getAttribute('data-checked')==='true'?'false':'true')})})(t[j])}var l=document.querySelectorAll('.toc-item');if(l.length){var s=[];for(var k=0;k<l.length;k++){var el=document.getElementById(l[k].getAttribute('href').slice(1));if(el)s.push(el)}if(s.length){function onScroll(){var idx=0;for(var m=0;m<s.length;m++){if(s[m].getBoundingClientRect().top>=0){idx=m;break}}if(window.scrollY>=document.documentElement.scrollHeight-window.innerHeight-4){idx=s.length-1}for(var q=0;q<l.length;q++){l[q].classList.toggle('active',q===idx)}}window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});onScroll()}}var si=document.getElementById('bmSearchInput');if(si){si.addEventListener('input',function(){var q=si.value.trim().toLowerCase();var bms=document.querySelectorAll('.bm, .bmcard');var f=0;for(var n=0;n<bms.length;n++){var sc=bms[n].getAttribute('data-search')||'';var m=!q||sc.indexOf(q)!==-1;bms[n].style.display=m?'':'none';if(m)f++}var albums=document.querySelectorAll('.album-card');for(var c=0;c<albums.length;c++){var asc=albums[c].getAttribute('data-search')||'';var am=!q||asc.indexOf(q)!==-1;albums[c].style.display=am?'':'none';if(am)f++}var ql=document.getElementById('cat-sec-curated');if(ql){var qlbms=ql.querySelectorAll('.bmcard:not([style*="display: none"])');ql.style.display=(!q||qlbms.length>0)?'':'none'}var em=document.getElementById('bmEmptySearch');if(em){em.style.display=(f===0&&q)?'block':'none'}})}var lb=document.querySelectorAll('.cat-layout-btn');if(lb.length){for(var p=0;p<lb.length;p++){(function(b){b.addEventListener('click',function(e){e.preventDefault();var ly=b.getAttribute('data-layout')||'grid';var hf=b.getAttribute('href');for(var u=0;u<lb.length;u++){lb[u].classList.remove('active')}b.classList.add('active');var cgs=document.querySelectorAll('.cat-grid');for(var g=0;g<cgs.length;g++){cgs[g].classList.remove('list-view','mini-grid-view');if(ly!=='grid'){cgs[g].classList.add(ly+'-view')}}if(window.history&&window.history.replaceState&&hf){window.history.replaceState(null,'',hf)}})})(lb[p])}}window.addEventListener('keydown',function(e){if(e.key==='Escape'&&window.location.hash&&window.location.hash.indexOf('album-drawer-')!==-1){if(window.history&&window.history.replaceState){window.history.replaceState(null,'',window.location.pathname+window.location.search)}else{window.location.hash='close'}}});})()`

const CSS = `
/* ==================== DESIGN TOKENS (对齐主站 tokens.css) ==================== */
:root, [data-theme="light"] {
  color-scheme: light;
  --bg: #F5EFEA;
  --bg-alt: #EDE4DA;
  --surface: #FDFBF9;
  --surface-hover: #F7F2EC;
  --surface-active: #EFE8DF;
  --border: #E5DDD3;
  --border-light: #EFE8DF;
  --border-hover: #D5CBBE;
  --text: #2C2824;
  --text-secondary: #5E5852;
  --text-muted: #6A6660;
  --accent: #122E8A;
  --accent-light: rgba(18, 46, 138, 0.07);
  --accent-glow: rgba(18, 46, 138, 0.13);
  --accent-grad: linear-gradient(135deg, #122E8A 0%, #1E40AF 100%);
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.06), 0 4px 8px rgba(0, 0, 0, 0.02);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.03);
  --shadow-card-hover: 0 8px 24px rgba(18, 46, 138, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03);
  --radius-sm: 6px;
  --radius-base: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;
  --radius-full: 999px;
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --bar-bg: rgba(245, 239, 234, 0.85);
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #1A1A1D;
  --bg-alt: #202025;
  --surface: #25252B;
  --surface-hover: #2E2E35;
  --surface-active: #383842;
  --border: #2F2F36;
  --border-light: #28282F;
  --border-hover: #3D3D46;
  --text: #EEE9E2;
  --text-secondary: #B5AFA6;
  --text-muted: #9B968E;
  --accent: #F04A8A;
  --accent-light: rgba(240, 74, 138, 0.1);
  --accent-glow: rgba(240, 74, 138, 0.18);
  --accent-grad: linear-gradient(135deg, #E6397C 0%, #F43F5E 100%);
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
  --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.15);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.35), 0 4px 8px rgba(0, 0, 0, 0.15);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.04);
  --shadow-card-hover: 0 8px 28px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.2);
  --bar-bg: rgba(26, 26, 29, 0.85);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #1A1A1D;
    --bg-alt: #202025;
    --surface: #25252B;
    --surface-hover: #2E2E35;
    --surface-active: #383842;
    --border: #2F2F36;
    --border-light: #28282F;
    --border-hover: #3D3D46;
    --text: #EEE9E2;
    --text-secondary: #B5AFA6;
    --text-muted: #9B968E;
    --accent: #F04A8A;
    --accent-light: rgba(240, 74, 138, 0.1);
    --accent-glow: rgba(240, 74, 138, 0.18);
    --accent-grad: linear-gradient(135deg, #E6397C 0%, #F43F5E 100%);
    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
    --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.15);
    --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.35), 0 4px 8px rgba(0, 0, 0, 0.15);
    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.04);
    --shadow-card-hover: 0 8px 28px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.2);
    --bar-bg: rgba(26, 26, 29, 0.85);
  }
}

/* ==================== BASE ==================== */
* { box-sizing: border-box; margin: 0; padding: 0 }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth }
body {
  background: radial-gradient(circle at 50% -20%, var(--accent-light) 0%, transparent 60%), var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
}

body, .share-bar, .group-hero, .cat-hero, .cat-chapter, .group-notes-card, .bm, .bmcard, .share-footer, .share-theme-btn {
  transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;
}

.share-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* LOGO 颜色响应主题切换 */
.s-b { stroke: #122E8A; transition: stroke 0.25s ease; }
.s-g { stroke: #10B981; transition: stroke 0.25s ease; }
[data-theme="dark"] .s-b { stroke: #4F6BFF !important; }
[data-theme="dark"] .s-g { stroke: #34D399 !important; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .s-b { stroke: #4F6BFF !important; }
  :root:not([data-theme="light"]) .s-g { stroke: #34D399 !important; }
}

/* ==================== 顶栏 (对齐主站 AppHeader) ==================== */
.share-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 54px;
  display: flex;
  align-items: center;
  background: var(--bar-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-light);
}
.share-bar-wrap {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.share-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  color: var(--text);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.3px;
  transition: opacity 0.15s ease;
}
.share-brand:hover { opacity: 0.85 }
.share-logo {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.share-logo svg { width: 100%; height: 100% }
.share-brand-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.share-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.share-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.share-theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-base);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  box-shadow: var(--shadow-xs);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.share-theme-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.share-theme-btn:active {
  transform: translateY(0);
}
.share-theme-btn svg {
  width: 16px;
  height: 16px;
  display: block;
}
.theme-icon-sun { display: none }
.theme-icon-moon { display: flex; align-items: center; justify-content: center }

[data-theme="dark"] .theme-icon-sun { display: flex; align-items: center; justify-content: center }
[data-theme="dark"] .theme-icon-moon { display: none }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-icon-sun { display: flex; align-items: center; justify-content: center }
  :root:not([data-theme="light"]) .theme-icon-moon { display: none }
}
.cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  border-radius: var(--radius-base);
  background: var(--accent-grad);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 8px var(--accent-glow);
  transition: box-shadow 0.2s ease, transform 0.2s var(--ease-out);
  white-space: nowrap;
  flex-shrink: 0;
}
.cta:hover {
  box-shadow: 0 4px 16px var(--accent-glow);
  transform: translateY(-1px);
}
.cta:active {
  transform: translateY(0);
}

/* ==================== 主内容容器 ==================== */
.share-container {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 24px 72px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ==================== 图标与首字母通用绝对居中（解决首字母与图标并排Bug） ==================== */
.bm-icon, .group-hero-icon, .cat-hero-icon, .gcard-icon, .bmcard-icon, .bmcard-child-ic {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}
.bm-fb, .hero-fb, .bmcard-fb, .bmc-fb {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  line-height: 1;
  background: var(--bg-alt);
  z-index: 1;
  user-select: none;
}
.bm-icon img, .group-hero-icon img, .cat-hero-icon img, .gcard-icon img, .bmcard-icon img, .bmcard-child-ic img {
  position: relative;
  z-index: 2;
  object-fit: contain;
  display: block;
}
/* 图片正常渲染时，纯兄弟选择器隐藏后面的首字母（无需 :has()，100% 浏览器兼容） */
.bm-icon img ~ .bm-fb,
.group-hero-icon img ~ .hero-fb,
.cat-hero-icon img ~ .hero-fb,
.gcard-icon img ~ .hero-fb,
.bmcard-icon img ~ .bmcard-fb,
.bmcard-child-ic img ~ .bmc-fb {
  display: none !important;
}
/* 图片加载失败时隐藏图片，显示首字母 */
img.img-err, img.bm-img-err, img.hero-img-err, img.bmcard-img-err, img.bmc-img-err {
  display: none !important;
}
.bm-icon img.img-err ~ .bm-fb,
.bm-icon img.bm-img-err ~ .bm-fb,
.group-hero-icon img.img-err ~ .hero-fb,
.group-hero-icon img.hero-img-err ~ .hero-fb,
.cat-hero-icon img.img-err ~ .hero-fb,
.cat-hero-icon img.hero-img-err ~ .hero-fb,
.gcard-icon img.img-err ~ .hero-fb,
.gcard-icon img.hero-img-err ~ .hero-fb,
.bmcard-icon img.img-err ~ .bmcard-fb,
.bmcard-icon img.bmcard-img-err ~ .bmcard-fb,
.bmcard-child-ic img.img-err ~ .bmc-fb,
.bmcard-child-ic img.bmc-img-err ~ .bmc-fb {
  display: flex !important;
}

/* ==================== 方案 B：策展级单体画卷 (Group Canvas) ==================== */
.group-canvas {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}

/* 一体化 Header */
.group-canvas .group-hero {
  position: relative;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-light);
  padding: 32px 36px 26px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.group-hero-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.group-hero-icon img {
  width: 36px;
  height: 36px;
}
.group-hero-icon .hero-fb {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  background: var(--bg-alt);
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}
.group-hero-info {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-hero-title {
  font-size: 26px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.5px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.group-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.meta-tag {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  padding: 3px 11px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

/* 一体化画卷主体 */
.group-canvas-body {
  padding: 32px 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* 导读笔记区 */
.group-notes-section {
  width: 100%;
}
.group-notes-content {
  width: 100%;
}

/* 导读与书签之间的轻柔分隔线 */
.canvas-divider {
  width: 100%;
  height: 1px;
  background: var(--border-light);
  margin: 0;
}
.focus-notes {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
  word-break: break-word;
}
.focus-notes p { margin: 0.4em 0 }
.focus-notes p:first-child { margin-top: 0 }
.focus-notes p:last-child { margin-bottom: 0 }
.focus-notes strong, .focus-notes b { font-weight: 700 }
.focus-notes mark { background-color: var(--accent-light); color: inherit; padding: 1px 4px; border-radius: 3px }
.focus-notes h1 {
  font-size: 1.45rem;
  font-weight: 700;
  margin: 0.7em 0 0.4em;
  color: var(--text);
  letter-spacing: -0.01em;
}
.focus-notes h2 {
  font-size: 1.22rem;
  font-weight: 650;
  margin: 0.6em 0 0.35em;
  color: var(--text);
}
.focus-notes h3 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
  color: var(--text);
}
.focus-notes ul, .focus-notes ol {
  margin: 0.4em 0;
  padding-left: 1.6rem;
}
.focus-notes ol { list-style: decimal }
.focus-notes ul { list-style: disc }
.focus-notes li { margin: 0.2em 0 }
.focus-notes blockquote {
  border-left: 3px solid var(--border);
  padding: 4px 0 4px 14px;
  color: var(--text-secondary);
  margin: 0.6em 0;
  font-style: normal;
}
.focus-notes code {
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 1.5px 5.5px;
  font-size: 0.88em;
  font-family: var(--font-mono);
  color: var(--text);
}
.focus-notes pre {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}
.focus-notes a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: opacity 0.15s ease;
}
.focus-notes a:hover { opacity: 0.8 }
.focus-notes img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  margin: 0.4em 0;
}
.focus-notes hr {
  border: none;
  border-top: 1px solid var(--border-light);
  margin: 1.2em 0;
}

/* 笔记内联书签卡 (group-inline-card) */
.focus-notes a.group-inline-card,
.focus-notes span.group-inline-card,
.focus-notes .group-ref-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 7px;
  margin: 0 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-base);
  background: var(--surface);
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  vertical-align: middle;
  color: var(--text);
  text-decoration: none;
  box-shadow: var(--shadow-xs);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s var(--ease-out);
}
.focus-notes a.group-inline-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
  transform: translateY(-1px);
}
.focus-notes .group-inline-card img,
.focus-notes .group-ref-card img,
.focus-notes .group-ref-card svg {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  display: block;
  flex-shrink: 0;
  object-fit: contain;
}
.focus-notes .group-inline-card img.img-err,
.focus-notes .group-ref-card img.img-err {
  display: none !important;
}
.focus-notes .gic-name {
  color: var(--text);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-notes .gic-domain {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
}
.focus-notes .gic-count {
  color: var(--text-muted);
  font-size: 11px;
}
.focus-notes .gic-btn, .focus-notes .gic-remove { display: none }

/* 笔记任务清单 (taskList) */
.focus-notes ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
  margin: 0.5em 0;
}
.focus-notes li[data-type="taskItem"] {
  list-style: none;
  position: relative;
  padding-left: 28px;
  margin: 4px 0;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.focus-notes li[data-type="taskItem"]::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1.5px solid var(--border-hover);
  border-radius: var(--radius-sm);
  background: var(--surface);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.focus-notes li[data-type="taskItem"]::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 4px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5L6.5 11.5L12.5 4.5'/%3E%3C/svg%3E");
  background-position: center;
  background-repeat: no-repeat;
  background-size: 11px 11px;
  transform: scale(0);
  opacity: 0;
  transition: transform 0.15s var(--ease-out), opacity 0.15s ease;
  pointer-events: none;
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::before {
  background: var(--accent);
  border-color: var(--accent);
}
.focus-notes li[data-type="taskItem"][data-checked="true"]::after {
  transform: scale(1);
  opacity: 1;
}
.focus-notes li[data-type="taskItem"] p { margin: 0; line-height: 1.6 }
.focus-notes li[data-type="taskItem"][data-checked="true"] {
  text-decoration: line-through;
  color: var(--text-muted);
}

/* ==================== 收录书签网格 (组分享) ==================== */
.group-bookmarks-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.section-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.section-title-icon svg { width: 100%; height: 100% }
.section-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
}
.section-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-glow);
  padding: 1.5px 8px;
  border-radius: var(--radius-full);
}

/* 搜索框 */
.bm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 240px;
  width: 100%;
  margin-left: auto;
}
.bm-search-input {
  width: 100%;
  height: 32px;
  padding: 0 30px 0 10px;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.bm-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
}
.bm-search-input::placeholder {
  color: var(--text-muted);
}
.bm-search-icon {
  position: absolute;
  right: 9px;
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bm-search-icon svg { width: 100%; height: 100% }

.bm-empty-search {
  text-align: center;
  padding: 24px;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-alt);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}

.bm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  width: 100%;
}

/* 单条书签行 (组内卡片) */
.bm {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  box-shadow: var(--shadow-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s var(--ease-out);
  position: relative;
  overflow: hidden;
}
.bm:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}
.bm:active { transform: translateY(0) }
.bm-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.bm-icon {
  width: 38px;
  height: 38px;
}
.bm-icon img {
  width: 24px;
  height: 24px;
}
.bm-fb {
  font-size: 14px;
}
.bm-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bm-title {
  display: block;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.bm:hover .bm-title {
  color: var(--accent);
}
.bm-url {
  display: block;
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm-notes {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.bm-arrow {
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.4;
  transform: translate(-2px, 2px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
  margin-left: auto;
  align-self: center;
}
.bm-arrow svg { width: 15px; height: 15px; display: block }
.bm:hover .bm-arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--accent);
}
.bm.is-child {
  margin-left: 16px;
  position: relative;
}
.bm.is-child::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 50%;
  width: 8px;
  height: 1px;
  background: var(--border-hover);
}

.empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13.5px;
  padding: 36px 0;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
}

/* ==================== 分类分享 HERO (立体专刊刊头 + Ambient Glow) ==================== */
.cat-hero {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 28px 32px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}
.cat-hero-glow {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 800px;
  height: 180px;
  background: radial-gradient(ellipse at 50% 0%, var(--cat, var(--accent)) 0%, transparent 70%);
  opacity: 0.12;
  pointer-events: none;
  border-radius: 50%;
  filter: blur(28px);
}
[data-theme="dark"] .cat-hero-glow { opacity: 0.22; }
.cat-hero-main {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.cat-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--accent-soft);
  color: var(--cat, var(--accent));
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
  border: 1px solid var(--border-light);
}
.cat-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--cat, var(--accent));
}
.cat-hero-icon {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-lg);
  color: var(--accent);
}
.cat-hero-icon img { width: 32px; height: 32px; object-fit: contain }
.cat-hero-icon .hero-fb { font-size: 20px }
.cat-hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cat-hero-name {
  font-size: 26px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.4px;
  line-height: 1.25;
  overflow-wrap: anywhere;
  margin: 0 0 6px;
}
.cat-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.cat-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 搜索条 */
.cat-search-bar {
  position: relative;
  z-index: 1;
  margin-top: 4px;
  max-width: 440px;
  width: 100%;
}
.cat-search-ic {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  color: var(--text-dim);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cat-search-ic svg { width: 100%; height: 100%; display: block }
.cat-search-input {
  width: 100%;
  height: 38px;
  border-radius: var(--radius-md);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 0 14px 0 36px;
  font-size: 13px;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cat-search-input:focus {
  border-color: var(--cat, var(--accent));
  box-shadow: 0 0 0 3px var(--accent-light);
}

/* 章节快速导航胶囊 (Jump Tabs) */
.cat-tabs-nav {
  position: relative;
  z-index: 1;
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  gap: 10px;
}
.cat-tabs-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
  white-space: nowrap;
  flex-shrink: 0;
}
.cat-tabs-scroll {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.cat-tabs-scroll::-webkit-scrollbar { display: none }
.cat-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.cat-tab:hover {
  background: var(--accent-soft);
  border-color: var(--cat, var(--accent));
  color: var(--cat, var(--accent));
  transform: translateY(-1px);
}
.cat-tab-count {
  font-size: 10.5px;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

/* 布局切换器 (三布局按钮) */
.cat-layout-switch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}
.cat-layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.cat-layout-btn:hover { color: var(--text) }
.cat-layout-btn.active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-xs);
}
.cat-layout-btn svg { width: 16px; height: 16px; display: block }
@media (max-width: 768px) { .cat-layout-btn.hide-mobile { display: none } }

/* ==================== 方案 2：合辑展厅画廊 (Curated Gallery Hub) ==================== */
.gallery-albums-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
  margin-bottom: 32px;
}

.album-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 22px 24px;
  box-shadow: var(--shadow-card);
  text-decoration: none;
  color: inherit;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease, border-color 0.2s ease;
  overflow: hidden;
}
.album-card:hover {
  transform: translateY(-4px);
  border-color: var(--cat, var(--accent));
  box-shadow: var(--shadow-card-hover), 0 10px 24px -6px rgba(0, 0, 0, 0.08);
}
.album-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.album-series-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--cat, var(--accent));
}
.album-count-badge {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-light);
}
.album-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 8px;
  line-height: 1.35;
  transition: color 0.15s ease;
}
.album-card:hover .album-title {
  color: var(--cat, var(--accent));
}
.album-excerpt {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  font-style: italic;
  margin: 0 0 16px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.album-excerpt-empty {
  color: var(--text-muted);
  font-style: normal;
}
.album-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid var(--border-light);
  gap: 12px;
}
.favicon-stack {
  display: flex;
  align-items: center;
  padding-left: 6px;
}
.stack-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  border: 2px solid var(--surface);
  background: var(--bg-alt);
  margin-left: -7px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}
.stack-icon img {
  width: 16px;
  height: 16px;
  display: block;
}
.stack-remainder {
  background: var(--border-light);
  font-family: var(--font-mono);
  font-size: 10px;
}
.album-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cat, var(--accent));
  white-space: nowrap;
}
.album-arrow {
  display: inline-flex;
  transition: transform 0.2s ease;
}
.album-arrow svg { width: 14px; height: 14px }
.album-card:hover .album-arrow {
  transform: translateX(3px);
}

/* ==================== 沉浸式单体画卷抽屉 (Drawer via CSS :target) ==================== */
.gallery-drawer {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 999;
}
.gallery-drawer:target {
  display: flex;
  animation: drawerFadeIn 0.2s ease forwards;
}
@keyframes drawerFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.gallery-drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  cursor: default;
}
.gallery-drawer-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  max-width: 640px;
  background: var(--surface);
  box-shadow: -10px 0 35px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  animation: drawerSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes drawerSlideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.gallery-drawer-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
}
.gallery-drawer-badge {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--cat, var(--accent));
  letter-spacing: 0.05em;
}
.gallery-drawer-close {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 15px;
  transition: background 0.15s ease, color 0.15s ease;
}
.gallery-drawer-close:hover {
  background: var(--bg-alt);
  color: var(--text);
}
.gallery-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.gallery-drawer-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gallery-drawer-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  margin: 0;
  line-height: 1.3;
}
.gallery-drawer-meta {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.gallery-drawer-notes {
  padding: 18px 20px;
  background: var(--bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}
.gallery-notes-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--cat, var(--accent));
  margin-bottom: 8px;
}
.gallery-notes-tag svg {
  width: 14px;
  height: 14px;
}
.gallery-drawer-bookmarks {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gallery-drawer-bm-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.gallery-bm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gallery-drawer-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-alt);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gallery-footer-brand {
  font-size: 12px;
  color: var(--text-muted);
}
.gallery-save-btn {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--cat, var(--accent));
  color: #fff;
  padding: 7px 16px;
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: opacity 0.15s ease;
}
.gallery-save-btn:hover {
  opacity: 0.92;
}

/* ==================== 散落精选书签区 (Curated Quick Links) ==================== */
.cat-quick-links-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 24px 28px;
  box-shadow: var(--shadow-card);
}
.cat-quick-links-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}
.cat-quick-links-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cat-quick-links-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}
.cat-quick-links-sub {
  font-size: 12px;
  color: var(--text-muted);
}
.chapter-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
}

/* ==================== 分类卡片网格 ==================== */
.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: start;
}

/* 散落书签卡 (bmcard) */
.bmcard {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s var(--ease-out);
  padding: 14px 16px;
}
.bmcard:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}
.bmcard-main {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-decoration: none;
  color: inherit;
}
.bmcard-head { display: flex; align-items: center; gap: 10px }
.bmcard-icon {
  width: 38px;
  height: 38px;
}
.bmcard-icon img { width: 22px; height: 22px; object-fit: contain }
.bmcard-icon .bmcard-fb { font-size: 14px }
.bmcard-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  transition: color 0.15s ease;
}
.bmcard:hover .bmcard-title { color: var(--accent) }
.bmcard-url {
  display: block;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bmcard-notes {
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.bmcard-arrow {
  position: absolute;
  right: 0;
  top: 6px;
  color: var(--text-muted);
  opacity: 0.4;
  transform: translate(-2px, 2px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
}
.bmcard-arrow svg { width: 15px; height: 15px; display: block }
.bmcard:hover .bmcard-arrow {
  opacity: 1;
  transform: translate(0, 0);
  color: var(--accent);
}

/* 子书签展开与渲染 */
.bmcard-toggle-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none }
.bmcard-toggle-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: var(--bg-alt);
  border-top: 1px solid var(--border-light);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.bmcard-toggle-label svg { width: 12px; height: 12px; transition: transform 0.2s ease }
.bmcard-toggle-input:checked + .bmcard-toggle-label svg { transform: rotate(180deg) }
.bmcard-children { display: none; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--bg-alt); border-top: 1px dashed var(--border) }
.bmcard-toggle-input:checked ~ .bmcard-children { display: flex }
.bmcard-child {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: inherit;
  font-size: 12.5px;
  transition: background 0.15s ease;
}
.bmcard-child:hover { background: var(--surface) }
.bmcard-child-ic { width: 22px; height: 22px }
.bmcard-child-ic img { width: 14px; height: 14px }
.bmcard-child-ic .bmc-fb { font-size: 10px }
.bmcard-child-text { flex: 1; min-width: 0 }
.bmcard-child-title { font-weight: 500; color: var(--text) }
.bmcard-child-url { font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); margin-left: 6px }
.bmcard-badge {
  font-size: 10.5px;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

/* ==================== 布局切换：列表视图 (List View) ==================== */
.cat-grid.list-view {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
}
.cat-grid.list-view .bm,
.cat-grid.list-view .bmcard {
  height: auto !important;
  min-height: 56px !important;
  max-height: none !important;
  border-radius: var(--radius-md) !important;
  padding: 10px 16px !important;
  box-shadow: var(--shadow-card) !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
}
.cat-grid.list-view .bm:hover,
.cat-grid.list-view .bmcard:hover {
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-card-hover) !important;
}
.cat-grid.list-view .bm-main,
.cat-grid.list-view .bmcard-main {
  padding: 0 !important;
  width: 100% !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 12px !important;
}
.cat-grid.list-view .bm-info,
.cat-grid.list-view .bmcard-head {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 12px !important;
  flex: 1 !important;
  min-width: 0 !important;
}
.cat-grid.list-view .bm-icon,
.cat-grid.list-view .bmcard-icon {
  width: 34px !important;
  height: 34px !important;
}
.cat-grid.list-view .bm-icon img,
.cat-grid.list-view .bmcard-icon img {
  width: 20px !important;
  height: 20px !important;
}
.cat-grid.list-view .bm-title,
.cat-grid.list-view .bmcard-title {
  font-size: 14px !important;
  font-weight: 600 !important;
}
.cat-grid.list-view .bm-url,
.cat-grid.list-view .bmcard-url {
  font-size: 11.5px !important;
  font-family: var(--font-mono) !important;
  color: var(--text-muted) !important;
  margin-left: 8px !important;
}
.cat-grid.list-view .bm-notes,
.cat-grid.list-view .bmcard-notes {
  display: none !important;
}
.cat-grid.list-view .bm-arrow,
.cat-grid.list-view .bmcard-arrow {
  position: static !important;
  opacity: 0.6 !important;
  transform: none !important;
  margin-left: auto !important;
  align-self: center !important;
}
.cat-grid.list-view .bm:hover .bm-arrow,
.cat-grid.list-view .bmcard:hover .bmcard-arrow {
  opacity: 1 !important;
  color: var(--accent) !important;
  transform: translateX(2px) !important;
}

/* ==================== 布局切换：小宫格视图 (Mini-Grid View) ==================== */
.cat-grid.mini-grid-view {
  display: grid !important;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
  gap: 8px !important;
}
.cat-grid.mini-grid-view .bm,
.cat-grid.mini-grid-view .bmcard {
  height: 60px !important;
  min-height: 60px !important;
  max-height: 60px !important;
  padding: 8px 12px !important;
  border-radius: var(--radius-md) !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  box-shadow: var(--shadow-card) !important;
}
.cat-grid.mini-grid-view .bm-main,
.cat-grid.mini-grid-view .bmcard-main {
  padding: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
}
.cat-grid.mini-grid-view .bm-info,
.cat-grid.mini-grid-view .bmcard-head {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
  flex: 1 !important;
  min-width: 0 !important;
}
.cat-grid.mini-grid-view .bm-icon,
.cat-grid.mini-grid-view .bmcard-icon {
  width: 28px !important;
  height: 28px !important;
  border-radius: var(--radius-sm) !important;
  flex-shrink: 0 !important;
}
.cat-grid.mini-grid-view .bm-icon img,
.cat-grid.mini-grid-view .bmcard-icon img {
  width: 18px !important;
  height: 18px !important;
}
.cat-grid.mini-grid-view .bm-title,
.cat-grid.mini-grid-view .bmcard-title {
  font-size: 13px !important;
  line-height: 1.3 !important;
  font-weight: 600 !important;
  flex: 1 !important;
}
.cat-grid.mini-grid-view .bm-url,
.cat-grid.mini-grid-view .bmcard-url {
  display: none !important;
}
.cat-grid.mini-grid-view .bm-notes,
.cat-grid.mini-grid-view .bmcard-notes,
.cat-grid.mini-grid-view .bm-arrow,
.cat-grid.mini-grid-view .bmcard-arrow {
  display: none !important;
}

/* ==================== 尾部 FOOTER ==================== */
.share-footer {
  margin-top: auto;
  border-top: 1px solid var(--border-light);
  padding: 48px 24px 36px;
  text-align: center;
}
.share-footer-inner {
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.share-footer-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  color: var(--text);
}
.footer-logo {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
}
.footer-logo svg { width: 100%; height: 100% }
.share-footer-slogan {
  font-size: 12.5px;
  color: var(--text-muted);
}
.share-footer-cta {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
  margin-top: 2px;
  transition: opacity 0.15s ease;
}
.share-footer-cta:hover {
  opacity: 0.8;
  text-decoration: underline;
}
.share-footer-copy {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* ==================== 404 / 503 兜底 ==================== */
.nf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 72px 0 40px;
  text-align: center;
}
.nf-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.nf-icon svg { width: 30px; height: 30px }
.nf-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.4px;
}
.nf-body {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 420px;
}

/* ==================== 响应式适配 ==================== */
@media (max-width: 768px) {
  .share-container {
    padding: 20px 16px 56px;
  }
  .group-canvas .group-hero {
    padding: 24px 22px 20px;
    gap: 16px;
  }
  .group-canvas-body {
    padding: 24px 22px 32px;
    gap: 26px;
  }
}

@media (max-width: 640px) {
  .share-bar-wrap { padding: 0 16px }
  .share-container { padding: 14px 10px 48px; }
  .group-canvas { border-radius: var(--radius-lg); }
  .group-canvas .group-hero { padding: 18px 16px; gap: 14px }
  .group-hero-icon { width: 48px; height: 48px; border-radius: var(--radius-md) }
  .group-hero-title { font-size: 21px }
  .group-canvas-body { padding: 18px 16px 24px; gap: 20px }
  .bm-grid, .cat-grid, .gallery-albums-grid { grid-template-columns: 1fr }
  .gallery-drawer-panel { max-width: 100% }
  .cat-quick-links-section { padding: 18px 16px }
}
`
