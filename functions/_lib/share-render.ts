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
    defaultGroupName: '未命名',
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
    empty: '这个分享笔记还没有书签',
    emptyCategory: '这个分享分类还没有书签',
    count: '{n} 个链接',
    categoryMeta: '{n} 个书签 · {m} 个笔记',
    // ── 分类页（v2 卡片网格）──
    catDesc: '{n} 个书签 · {m} 个笔记 · 凭专属私有链接访问',
    catBookmarks: '{n} 个书签',
    catGroups: '{m} 个笔记',
    catExpand: '展开 / 收起笔记内书签',
    catGroupEmpty: '这个笔记还没有书签',
    catNoNotes: '暂无笔记',
    subBookmark: '子书签',
    catChildren: '{n} 个子书签',
    catHide: '收起',
    cipherPlaceholder: '（内容已加密）',
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
    defaultGroupName: 'Untitled',
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
    empty: 'This shared note has no bookmarks yet',
    emptyCategory: 'This shared category has no bookmarks yet',
    count: '{n} links',
    count_one: '{n} link',
    categoryMeta: '{n} bookmarks · {m} notes',
    categoryMeta_one: '{n} bookmark · {m} notes',
    // ── category page (v2 card grid) ──
    catDesc: '{n} bookmarks · {m} notes · shared via private link',
    catDesc_one: '{n} bookmark · {m} notes · shared via private link',
    catBookmarks: '{n} bookmarks',
    catBookmarks_one: '{n} bookmark',
    catGroups: '{m} notes',
    catGroups_one: '{m} note',
    catExpand: 'Show / hide bookmarks in this note',
    catGroupEmpty: 'No bookmarks in this note yet',
    catNoNotes: 'No notes yet',
    subBookmark: 'Sub-item',
    catChildren: '{n} sub-items',
    catHide: 'Collapse',
    cipherPlaceholder: '(encrypted content)',
    gridView: 'Grid view',
    listView: 'List view',
    miniGridView: 'Mini grid view',
    updatedAt: 'Updated {d}',
    cta: 'Save to my library',
    tocTitle: 'Contents',
    bookmarksTitle: 'Bookmarks in this note',
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

/** 分享页文本降级：E2E 历史密文 → 占位提示（用于标题/组名等不可或缺的字段）。 */
function deCipherText(dict: typeof T['zh-CN'] | typeof T['en-US'], v: unknown): string {
  const s = typeof v === "string" ? v : ""
  return isCipherText(s) ? dict.cipherPlaceholder : s
}

/** 备注字段降级：密文直接隐去不展示（对齐 App 端 displayText 语义），杜绝公开卡片展示刺眼的「（内容已加密）」。 */
function safeNotes(v: unknown): string {
  const s = typeof v === "string" ? v : ""
  return isCipherText(s) ? "" : s
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
 * 先删危险容器块（script/style/svg 等连同内容），再剥标签——防脚本与富媒体内容泄漏进描述；
 * 剥离内联书签卡片/引用组卡片的噪音结构（gic-btn/gic-domain/gic-remove/gic-count/gic-edit-btn），
 * 确保不泄漏域名、"详"字等操作按钮，并在块级元素处保留换行、卡片容器周围保留空格。
 */
export function stripTags(html: string): string {
  let out = (html || "").replace(/<!--[\s\S]*?-->/g, "")
  for (const t of NOTES_BLOCKLIST) {
    out = out
      .replace(new RegExp(`<\\s*${t}[\\s\\S]*?<\\s*/\\s*${t}\\s*>`, "gi"), "")
      .replace(new RegExp(`<\\s*/?\\s*${t}[\\s\\S]*?>`, "gi"), "")
  }
  // 剥离内联卡片噪音子节点整块（含其内容）：.gic-domain、.gic-btn、.gic-remove、.gic-count、.gic-edit-btn
  out = out.replace(
    /<([a-zA-Z0-9]+)\b[^>]*\bclass=(?:"[^"]*\b(?:gic-btn|gic-remove|gic-domain|gic-count|gic-edit-btn)\b[^"]*"|'[^']*\b(?:gic-btn|gic-remove|gic-domain|gic-count|gic-edit-btn)\b[^']*'|[^\s>]*\b(?:gic-btn|gic-remove|gic-domain|gic-count|gic-edit-btn)\b[^\s>]*)[^>]*>[\s\S]*?<\/\1>/gi,
    ""
  )
  // 内联卡片容器前后补空格隔离，避免与相邻文字或紧贴的卡片粘连
  out = out.replace(
    /<\s*(?:\/?\s*(?:span|a))\b[^>]*\bclass=(?:"[^"]*\bgroup-inline-card\b[^"]*"|'[^']*\bgroup-inline-card\b[^']*')[^>]*>/gi,
    " "
  )
  // 块级标签转换行为 \n
  out = out.replace(
    /<\s*(?:\/\s*(?:p|div|h[1-6]|li|blockquote|tr|table|section|article|header|footer|pre)|br\s*\/?>)\s*>/gi,
    "\n"
  )
  // 剥除所有剩余 HTML 标签（行内标签不插入额外空格）
  out = out.replace(/<[^>]+>/g, "")
  // 还原常见 HTML 实体
  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
  // 规范化空格与空白行，以换行符连接各非空行
  return out
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
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
 * 解析公开组的展示标题：
 * 1. 显式组名（明文非密文且非空白）最高优先；
 * 2. 未设置组名时直接回退至 dict.defaultGroupName（'未命名' / 'Untitled'）。
 */
export function resolveGroupTitle(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  group: PublicGroup,
): ResolvedGroupTitle {
  const explicit = deCipherText(dict, group.name).trim()
  if (explicit && explicit !== dict.cipherPlaceholder) {
    return { name: explicit, promotedH1: false }
  }

  return { name: dict.defaultGroupName, promotedH1: false }
}

/** 高级排版字体栈预连接与样式（对齐主站与落地页，加载 Satoshi / Clash Display / Noto Sans SC） */
const FONT_LINKS = [
  `<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>`,
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
  `<link href="/fonts/fonts.css" rel="stylesheet">`,
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600;700&display=swap">`,
].join("\n")

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
    FONT_LINKS,
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
  const fbCls = cls === "card-logo" ? "card-logo-fallback card-logo-fb" : `${cls}-fb`
  return `${img}<span class="${fbCls}">${esc(letter)}</span>`
}

/** 品牌链接图标（与 App 端 ShareView logo 同一枚 SVG，CSS 变量响应深浅色过渡）。 */
const LOGO_SVG =
  `<svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><mask id="s-mb"><rect width="240" height="240" fill="white"/><line x1="173" y1="144" x2="211" y2="144" stroke="black" stroke-width="38" stroke-linecap="round"/></mask><mask id="s-mg"><rect width="240" height="240" fill="white"/><line x1="29" y1="96" x2="67" y2="96" stroke="black" stroke-width="38" stroke-linecap="round"/></mask></defs><path class="brand-logo-blue s-b" d="M 24 96 L 120 96 C 176 96 192 104 192 144 C 192 184 176 192 120 192 L 48 192" stroke="var(--brand-logo-blue, #122E8A)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" mask="url(#s-mb)"/><path class="brand-logo-green s-g" d="M 216 144 L 120 144 C 64 144 48 136 48 96 C 48 56 64 48 120 48 L 192 48" stroke="var(--brand-logo-green, #10B981)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" mask="url(#s-mg)"/></svg>`

/** 外链箭头（书签行 hover 时滑入）。 */
const ARROW_SVG =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L12 4"/><path d="M5.5 4H12v6.5"/></svg>`

/** 卡片外链提示小图标（App BookmarkCard 同款）。 */
const EXTERNAL_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

/** 返回箭头（组聚焦返回分类，App I.back 同款）。 */
const BACK_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`


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
const NOTE_SVG =
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.6602 10.44L20.6802 14.62C19.8402 18.23 18.1802 19.69 15.0602 19.39C14.5602 19.35 14.0202 19.26 13.4402 19.12L11.7602 18.72C7.59018 17.73 6.30018 15.67 7.28018 11.49L8.26018 7.30001C8.46018 6.45001 8.70018 5.71001 9.00018 5.10001C10.1702 2.68001 12.1602 2.03001 15.5002 2.82001L17.1702 3.21001C21.3602 4.19001 22.6402 6.26001 21.6602 10.44Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path opacity="0.4" d="M15.0603 19.3901C14.4403 19.8101 13.6603 20.1601 12.7103 20.4701L11.1303 20.9901C7.16034 22.2701 5.07034 21.2001 3.78034 17.2301L2.50034 13.2801C1.22034 9.3101 2.28034 7.2101 6.25034 5.9301L7.83034 5.4101C8.24034 5.2801 8.63034 5.1701 9.00034 5.1001C8.70034 5.7101 8.46034 6.4501 8.26034 7.3001L7.28034 11.4901C6.30034 15.6701 7.59034 17.7301 11.7603 18.7201L13.4403 19.1201C14.0203 19.2601 14.5603 19.3501 15.0603 19.3901Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

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

/** 首屏主题防闪烁与移动端列表布局即时自适应脚本（FOUC Guard）：在任何样式与 DOM 渲染前立即注入 data-theme 与 color-scheme，并在移动端且未显式指定 layout 时注入 share-mobile-list */
const THEME_SCRIPT = `<script>(function(){try{var t=localStorage.getItem("lv_theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}}catch(e){}try{var p=new URLSearchParams(window.location.search);if(!p.has("layout")){var m=window.matchMedia&&window.matchMedia("(max-width: 768px)").matches;if(m){document.documentElement.classList.add("share-mobile-list");}}}catch(e){}})();</script>`

/** 树状深度优先重排：顶层书签先行，子书签紧随各自父书签下方（DFS） */
function orderBookmarksHierarchically(bms: PublicBookmark[]): PublicBookmark[] {
  const byId = new Map<string, PublicBookmark>()
  for (const b of bms || []) {
    if (b && b.id) byId.set(String(b.id), b)
  }
  const kidsOf = new Map<string, PublicBookmark[]>()
  const topBms: PublicBookmark[] = []
  for (const b of bms || []) {
    const pid = typeof b.parent_id === 'string' ? b.parent_id.trim() : ''
    if (pid && byId.has(pid)) {
      const list = kidsOf.get(pid) || []
      list.push(b)
      kidsOf.set(pid, list)
    } else {
      topBms.push(b)
    }
  }
  const ordered: PublicBookmark[] = []
  const visited = new Set<string>()
  const collect = (bm: PublicBookmark) => {
    const id = String(bm.id)
    if (visited.has(id)) return
    visited.add(id)
    ordered.push(bm)
    for (const kid of kidsOf.get(id) || []) {
      collect(kid)
    }
  }
  for (const tb of topBms) {
    collect(tb)
  }
  return ordered
}

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
  const rawNotes = typeof b.notes === 'string' ? safeNotes(b.notes).trim() : ''
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
  if (imgSrc) {
    return iconMarkup(imgSrc, letter, "hero")
  }
  return NOTE_SVG
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
    const text = stripTags(inner).trim()
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
      orderBookmarksHierarchically(bookmarks).map((b) => buildBookmarkItem(dict, b, !!b.parent_id)).join("\n"),
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

/**
 * 分类分享·组卡片（100% 对齐主站 App GroupCard 宫格态结构与类名）：
 * - .card.group-card 外层
 * - .group-card-accent 左侧装饰条
 * - .group-card-head 头部（38px 图标 + titlewrap）
 * - .card-body.grp-scroll-body 笔记预览（带淡出遮罩）
 * - .card-preview 文本摘要（列表/小宫格显示）
 * - .card-foot 底部书签计数
 * - .card-focus-overlay 纯 CSS 点击进入 #focus-<gid> 聚焦态（无 JS 亦可无缝聚焦）
 */
function buildGroupCard(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  entry: { group: PublicGroup; items: PublicBookmark[] },
  idx: number,
  bmMap: NotesBmMap,
): string {
  const g = entry.group
  const titleInfo = resolveGroupTitle(dict, g)
  const name = esc(titleInfo.name)
  const initial = esc(((titleInfo.name || "?").trim().charAt(0) || "?").toUpperCase())
  const notes = notesHtml(dict, g, bmMap, titleInfo.promotedH1).html
  const body = notes || `<div class="focus-notes gcard-nonotes">${esc(dict.catNoNotes)}</div>`
  const n = entry.items.length
  const preview = stripTags(notes || dict.catNoNotes).slice(0, 100)
  const gid = esc(String(g.id))

  return [
    `<article class="card group-card" data-group-id="${gid}">`,
    `<a class="card-focus-overlay" href="#focus-${gid}" title="${name}" aria-label="${name}"></a>`,
    `<div class="group-card-accent"></div>`,
    `<div class="group-card-head">`,
    `<div class="card-logo group-card-icon">${groupIconMarkup(g, initial)}</div>`,
    `<div class="card-titlewrap">`,
    `<div class="card-titlewrap-text">`,
    `<div class="card-name">${name}</div>`,
    `<div class="card-domain group-domain"></div>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `<div class="card-body grp-scroll-body">`,
    `<div class="card-scroll-wrap">`,
    `<div class="group-body group-body-readonly">${body}</div>`,
    `</div>`,
    `</div>`,
    `<div class="card-preview">${esc(preview)}</div>`,
    `<div class="card-foot">`,
    `<span class="card-stat">${esc(fill(pick(dict, 'catBookmarks', n), { n }))}</span>`,
    `</div>`,
    `</article>`,
  ].join("")
}

/**
 * 分类分享·组聚焦画卷（100% 对齐主站 App 组聚焦态 Focus Mode）：
 * - 纯 CSS :target 触发显示（#focus-<gid>）
 * - 顶部返回条（← 返回「分类名」）
 * - 聚焦大卡片（.card.group-card.group-card-focus）
 * - 完整笔记正文 + 组内收录书签网格（.group-bookmarks-section + .bm-grid）
 */
function buildGroupFocusPanel(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  entry: { group: PublicGroup; items: PublicBookmark[] },
  bmMap: NotesBmMap,
  catName: string,
): string {
  const g = entry.group
  const titleInfo = resolveGroupTitle(dict, g)
  const name = esc(titleInfo.name)
  const initial = esc(((titleInfo.name || "?").trim().charAt(0) || "?").toUpperCase())
  const notes = notesHtml(dict, g, bmMap, titleInfo.promotedH1).html
  const orderedItems = orderBookmarksHierarchically(entry.items)
  const n = orderedItems.length
  const itemsHtml = n
    ? orderedItems.map((b) => buildBookmarkItem(dict, b, !!b.parent_id)).join("")
    : `<div class="gcard-empty">${esc(dict.catGroupEmpty)}</div>`
  const gid = esc(String(g.id))

  return [
    `<div class="group-focus-panel" id="focus-${gid}">`,
    `<div class="focus-bar">`,
    `<a href="#" class="exit-focus-btn" title="${catName}">${BACK_SVG} <span>${catName}</span></a>`,
    `<span class="focus-bar-title">${name}</span>`,
    `<span class="panel-count">${esc(fill(pick(dict, 'catBookmarks', n), { n }))}</span>`,
    `</div>`,
    `<article class="card group-card group-card-focus" data-group-id="${gid}">`,
    `<div class="group-card-accent"></div>`,
    `<div class="group-card-head">`,
    `<div class="card-logo group-card-icon">${groupIconMarkup(g, initial)}</div>`,
    `<div class="card-titlewrap">`,
    `<div class="card-titlewrap-text">`,
    `<div class="card-name">${name}</div>`,
    `<div class="card-domain group-domain"></div>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `<div class="card-body grp-scroll-body">`,
    `<div class="card-scroll-wrap">`,
    notes ? `<div class="group-body group-body-readonly">${notes}</div>` : '',
    `<div class="group-bookmarks-section">`,
    `<div class="section-header">`,
    `<h2 class="section-title">${esc(dict.bookmarksTitle)}</h2>`,
    `<span class="section-count">${n}</span>`,
    `</div>`,
    `<div class="bm-grid">${itemsHtml}</div>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `</article>`,
    `</div>`,
  ].join("")
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
  const notes = safeNotes(b.notes).trim()
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
 * 分类分享·散落书签卡（100% 对齐主站 App BookmarkCard 宫格态结构与类名）：
 * - .card.bookmark-card 外层
 * - .card-topline > .card-toprow（38px 图标 + 标题 + 域名 + 外链提示）
 * - .card-body（2 行备注截断 + 子站点网格）
 * - .card-foot（点击统计）
 * - .card-link-overlay 整体可点击直达目标外链
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
  const rawNotes = safeNotes(b.notes).trim()
  const notes = rawNotes ? stripTags(rawNotes).slice(0, 140) : ""

  const subSites = card.children.length
    ? `<div class="sub-sites">${card.children.map((c) => {
        const cb = c.bookmark
        const cUrlSafe = isCipherText(cb.url) ? "" : fixUrl(cb.url)
        const cHref = cUrlSafe ? esc(cUrlSafe) : "#"
        const cDm = cUrlSafe ? domainOf(cUrlSafe) : ""
        const cTitle = deCipherText(dict, cb.title).trim() || cDm || "?"
        const cCh = cTitle.charAt(0).toUpperCase()
        return `<a class="group-inline-card" href="${cHref}"${cUrlSafe ? ' target="_blank" rel="noopener nofollow"' : ''} title="${esc(cTitle)}">` +
          `<span class="gic-ic">${iconMarkup(cUrlSafe ? faviconOf(cUrlSafe) : "", cCh, "gic-ic")}</span>` +
          `<span class="gic-name">${esc(cTitle)}</span>` +
          `</a>`
      }).join("")}</div>`
    : ""

  return [
    `<article class="card bookmark-card" data-id="${esc(String(b.id))}">`,
    `<a class="card-link-overlay" href="${href}"${target}${rel} aria-label="${esc(title)}"></a>`,
    `<div class="card-topline">`,
    `<div class="card-toprow">`,
    `<div class="card-logo">${iconMarkup(safe ? faviconOf(safe) : "", ch, "card-logo")}</div>`,
    `<div class="card-titlewrap">`,
    `<div class="card-titlewrap-text">`,
    `<div class="card-name">${esc(title)}</div>`,
    `<div class="card-domain">${esc(dm)}</div>`,
    `</div>`,
    `<span class="card-open-hint" aria-hidden="true">${EXTERNAL_SVG}</span>`,
    `</div>`,
    `</div>`,
    `<div class="card-domain mini-domain">${esc(dm)}</div>`,
    `</div>`,
    `<div class="card-body">`,
    notes ? `<div class="card-notes">${esc(notes)}</div>` : "",
    subSites,
    `<div class="card-preview">${esc(notes || dm || title)}</div>`,
    `</div>`,
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

/** 构建 <body>（分类分享）：主应用外壳 + 分类头（真实分类名/计数）+ 卡片网格（组卡在前 + 散落书签卡）+ 组聚焦画卷。 */
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
  // 计数口径：与网格里实际渲染的书签数一致（组内 + 散落顶层 + 散落子书签，全部计入）
  const count =
    groupCards.reduce((s, e) => s + e.items.length, 0) +
    loose.reduce((s, c) => s + 1 + c.children.length, 0)
  const groupCount = groupCards.length
  const tags = [
    `<span class="meta-tag">${esc(fill(pick(dict, 'catBookmarks', count), { n: count }))}</span>`,
    groupCount
      ? `<span class="meta-tag">${esc(fill(pick(dict, 'catGroups', groupCount), { m: groupCount }))}</span>`
      : "",
  ].join("")
  const cards = [
    ...groupCards.map((e, i) => buildGroupCard(dict, e, i, bmMap)),
    ...loose.map((c) => buildLooseBookmarkCard(dict, c)),
  ]
  const focusPanels = groupCards.map((e) => buildGroupFocusPanel(dict, e, bmMap, name))

  const layoutCls = layout !== 'grid' ? ` ${layout}-view` : ' grid-view'
  const grid = cards.length
    ? `<div class="cat-grid card-grid${layoutCls}" id="cardGrid"><div class="card-list-inner">${cards.join("\n")}</div></div>`
    : `<div class="empty">${esc(dict.emptyCategory)}</div>`
  // CTA 跳 App 的 hash 路由（/app#share/c/<share_id>），直达应用主体完成保存
  const appUrl = `${appOrigin}/app#share/c/${esc(shareId)}`
  // 分类色：白名单校验后作 CSS 变量注入（非法值回落默认 accent，杜绝 CSS 注入）
  const catColor = typeof category.color === "string" ? safeColorValue(category.color.trim()) : ""
  const accentStyle = catColor ? ` style="--cat: ${esc(catColor)}"` : ""
  const heroIcon = heroCustomIconMarkup(category, "cat")
  const inner = [
    `<section class="cat-hero"${accentStyle}>`,
    `<div class="cat-hero-left">`,
    heroIcon,
    `<div class="cat-hero-text">`,
    `<h1 class="cat-hero-name">${name}</h1>`,
    `<div class="cat-hero-meta">${tags}</div>`,
    `</div>`,
    `</div>`,
    `<div class="cat-hero-actions">`,
    buildLayoutSwitch(dict, shareUrl, layout),
    `</div>`,
    `</section>`,
    grid,
    ...focusPanels,
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
    FONT_LINKS,
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
    FONT_LINKS,
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
    FONT_LINKS,
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
const FALLBACK_JS = `(function(){var tb=document.getElementById('themeToggle');if(tb){tb.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');if(!cur){cur=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);document.documentElement.style.colorScheme=next;try{localStorage.setItem('lv_theme',next)}catch(e){}})}var a=document.querySelectorAll('img[data-fb]');function err(e){e.classList.add('img-err','bm-img-err','hero-img-err','bmcard-img-err','bmc-img-err','card-logo-img-err','gic-ic-img-err')}for(var i=0;i<a.length;i++){(function(im){im.addEventListener('error',function(){err(im)});if(im.complete&&im.naturalWidth===0){err(im)}})(a[i])}var t=document.querySelectorAll('li[data-type="taskItem"]');for(var j=0;j<t.length;j++){(function(li){li.style.cursor='pointer';li.addEventListener('click',function(){li.setAttribute('data-checked',li.getAttribute('data-checked')==='true'?'false':'true')})})(t[j])}var l=document.querySelectorAll('.toc-item');if(l.length){var s=[];for(var k=0;k<l.length;k++){var el=document.getElementById(l[k].getAttribute('href').slice(1));if(el)s.push(el)}if(s.length){function onScroll(){var idx=0;for(var m=0;m<s.length;m++){if(s[m].getBoundingClientRect().top>=0){idx=m;break}}if(window.scrollY>=document.documentElement.scrollHeight-window.innerHeight-4){idx=s.length-1}for(var q=0;q<l.length;q++){l[q].classList.toggle('active',q===idx)}}window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});onScroll()}}var si=document.getElementById('bmSearchInput');if(si){si.addEventListener('input',function(){var q=si.value.trim().toLowerCase();var bms=document.querySelectorAll('#bmList .bm');var f=0;for(var n=0;n<bms.length;n++){var sc=bms[n].getAttribute('data-search')||'';var m=!q||sc.indexOf(q)!==-1;bms[n].style.display=m?'':'none';if(m)f++}var em=document.getElementById('bmEmptySearch');if(em){em.style.display=(f===0&&q)?'block':'none'}})}var lb=document.querySelectorAll('.cat-layout-btn');if(lb.length){if(!new URLSearchParams(window.location.search).has('layout')){var isM=window.matchMedia&&window.matchMedia('(max-width: 768px)').matches;if(isM){for(var u=0;u<lb.length;u++){if(lb[u].getAttribute('data-layout')==='list'){lb[u].classList.add('active')}else if(lb[u].getAttribute('data-layout')==='grid'){lb[u].classList.remove('active')}}}}for(var p=0;p<lb.length;p++){(function(b){b.addEventListener('click',function(e){e.preventDefault();document.documentElement.classList.remove('share-mobile-list');var ly=b.getAttribute('data-layout')||'grid';var hf=b.getAttribute('href');for(var u=0;u<lb.length;u++){lb[u].classList.remove('active')}b.classList.add('active');var cg=document.querySelector('.cat-grid');if(cg){cg.classList.remove('list-view','mini-grid-view');if(ly!=='grid'){cg.classList.add(ly+'-view')}}if(window.history&&window.history.replaceState&&hf){window.history.replaceState(null,'',hf)}})})(lb[p])}}function syncFocusHash(){var h=window.location.hash||'';var isF=h.indexOf('#focus-')===0;var cg=document.getElementById('cardGrid');var ch=document.querySelector('.cat-hero');if(cg){cg.style.display=isF?'none':''}if(ch){ch.style.display=isF?'none':''}}window.addEventListener('hashchange',syncFocusHash);syncFocusHash();})()`

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
  --brand-logo-blue: #122E8A;
  --brand-logo-green: #10B981;
  --brand-logo-text: #122E8A;
  --accent-light: rgba(18, 46, 138, 0.07);
  --accent-glow: rgba(18, 46, 138, 0.15);
  --accent-grad: linear-gradient(135deg, #122E8A 0%, #1E40AF 100%);
  --shadow-xs: 0 1px 2px rgba(44, 40, 36, 0.03);
  --shadow-sm: 0 1px 3px rgba(44, 40, 36, 0.04), 0 1px 2px rgba(44, 40, 36, 0.02);
  --shadow-md: 0 4px 16px -2px rgba(44, 40, 36, 0.05), 0 2px 4px rgba(44, 40, 36, 0.02);
  --shadow-lg: 0 12px 32px -4px rgba(44, 40, 36, 0.07), 0 4px 12px rgba(44, 40, 36, 0.025);
  --shadow-card: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, 0 1px 3px rgba(44, 40, 36, 0.04), 0 0 0 1px var(--border-light);
  --shadow-card-hover: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, 0 8px 24px -4px rgba(44, 40, 36, 0.08), 0 2px 6px rgba(44, 40, 36, 0.03);
  --radius-sm: 6px;
  --radius-base: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 999px;
  --font-sans: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --font-display: 'Clash Display', 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --bar-bg: rgba(245, 239, 234, 0.82);
  --bar-border: rgba(229, 221, 211, 0.75);
  --bar-shadow: 0 1px 2px rgba(44, 40, 36, 0.02), 0 4px 16px -4px rgba(44, 40, 36, 0.03);
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
  --brand-logo-blue: #F04A8A;
  --brand-logo-green: #E2E7BF;
  --brand-logo-text: #F04A8A;
  --accent-light: rgba(240, 74, 138, 0.1);
  --accent-glow: rgba(240, 74, 138, 0.22);
  --accent-grad: linear-gradient(135deg, #E6397C 0%, #F43F5E 100%);
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 16px -2px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 12px 32px -4px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-card: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.25);
  --shadow-card-hover: 0 1px 0 0 rgba(255, 255, 255, 0.13) inset, 0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.25);
  --bar-bg: rgba(26, 26, 29, 0.82);
  --bar-border: rgba(255, 255, 255, 0.08);
  --bar-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px -4px rgba(0, 0, 0, 0.4);
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
    --brand-logo-blue: #F04A8A;
    --brand-logo-green: #E2E7BF;
    --brand-logo-text: #F04A8A;
    --accent-light: rgba(240, 74, 138, 0.1);
    --accent-glow: rgba(240, 74, 138, 0.22);
    --accent-grad: linear-gradient(135deg, #E6397C 0%, #F43F5E 100%);
    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
    --shadow-md: 0 4px 16px -2px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.25);
    --shadow-lg: 0 12px 32px -4px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-card: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.25);
    --shadow-card-hover: 0 1px 0 0 rgba(255, 255, 255, 0.13) inset, 0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.25);
    --bar-bg: rgba(26, 26, 29, 0.82);
    --bar-border: rgba(255, 255, 255, 0.08);
    --bar-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px -4px rgba(0, 0, 0, 0.4);
  }
}

/* ==================== BASE ==================== */
* { box-sizing: border-box; margin: 0; padding: 0 }
html {
  -webkit-text-size-adjust: 100%;
  scroll-behavior: smooth;
  overflow-y: scroll;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--border-hover) transparent;
}
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-hover);
  border-radius: 4px;
  border: 1px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
  border: 1px solid transparent;
  background-clip: content-box;
}
body {
  background: radial-gradient(1000px 500px at 50% -80px, var(--accent-light) 0%, transparent 80%), var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
}

body, .share-bar, .group-hero, .cat-hero, .group-notes-card, .bm, .gcard, .bmcard, .share-footer, .share-theme-btn {
  transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;
}

.share-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* LOGO 颜色响应主题切换 (与主站 BrandLogo 同款规范，暗色为粉/绿撞色) */
.brand-logo-blue, .s-b {
  stroke: var(--brand-logo-blue, #122E8A) !important;
  transition: stroke 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.brand-logo-green, .s-g {
  stroke: var(--brand-logo-green, #10B981) !important;
  transition: stroke 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
[data-theme="dark"] .brand-logo-blue, [data-theme="dark"] .s-b { stroke: #F04A8A !important; }
[data-theme="dark"] .brand-logo-green, [data-theme="dark"] .s-g { stroke: #E2E7BF !important; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .brand-logo-blue, :root:not([data-theme="light"]) .s-b { stroke: #F04A8A !important; }
  :root:not([data-theme="light"]) .brand-logo-green, :root:not([data-theme="light"]) .s-g { stroke: #E2E7BF !important; }
}

/* ==================== 顶栏 (对齐主站 AppHeader 极微雕质感) ==================== */
.share-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 56px;
  display: flex;
  align-items: center;
  background: var(--bar-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--bar-border);
  box-shadow: var(--bar-shadow);
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
  transition: opacity 0.15s ease, transform 0.2s var(--ease-out);
}
.share-brand:hover {
  opacity: 0.9;
  transform: translateY(-0.5px);
}
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
  letter-spacing: -0.2px;
  transition: color 0.25s ease;
}
.share-brand:hover .share-brand-title {
  color: var(--brand-logo-text, var(--accent));
}
.share-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
[data-theme="dark"] .share-badge {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
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
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
[data-theme="dark"] .share-theme-btn {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.share-theme-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-sm);
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
  border-radius: var(--radius-full);
  background: var(--accent-grad);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
  text-decoration: none;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.25) inset, 0 3px 10px var(--accent-glow);
  transition: box-shadow 0.2s ease, transform 0.2s var(--ease-out), filter 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}
.cta:hover {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.35) inset, 0 6px 18px var(--accent-glow);
  transform: translateY(-1px);
  filter: brightness(1.04);
}
.cta:active {
  transform: translateY(0) scale(0.98);
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
.bm-icon, .group-hero-icon, .cat-hero-icon, .gcard-icon, .bmcard-icon, .bmcard-child-ic, .card-logo, .gic-ic {
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
.bm-fb, .hero-fb, .bmcard-fb, .bmc-fb, .card-logo-fb, .card-logo-fallback, .gic-ic-fb {
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
.gic-ic-fb {
  font-size: 10px;
}
.bm-icon img, .group-hero-icon img, .cat-hero-icon img, .gcard-icon img, .bmcard-icon img, .bmcard-child-ic img, .card-logo img, .gic-ic img {
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
.bmcard-child-ic img ~ .bmc-fb,
.card-logo img ~ .card-logo-fallback,
.card-logo img ~ .card-logo-fb,
.card-logo img ~ .hero-fb,
.gic-ic img ~ .gic-ic-fb {
  display: none !important;
}
/* 现代浏览器 :has() 双重保险：只要含有未出错的 img，首字母绝对不显示 */
.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .card-logo-fallback,
.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .card-logo-fb,
.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .hero-fb,
.gic-ic:has(img:not(.img-err):not(.gic-ic-img-err)) .gic-ic-fb,
.bm-icon:has(img:not(.img-err):not(.bm-img-err)) .bm-fb {
  display: none !important;
}
/* 图片加载失败时隐藏图片，显示首字母 */
img.img-err, img.bm-img-err, img.hero-img-err, img.bmcard-img-err, img.bmc-img-err, img.card-logo-img-err, img.gic-ic-img-err {
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
.bmcard-child-ic img.bmc-img-err ~ .bmc-fb,
.card-logo img.img-err ~ .card-logo-fallback,
.card-logo img.card-logo-img-err ~ .card-logo-fallback,
.card-logo img.img-err ~ .card-logo-fb,
.card-logo img.card-logo-img-err ~ .card-logo-fb,
.card-logo img.img-err ~ .hero-fb,
.card-logo img.hero-img-err ~ .hero-fb,
.gic-ic img.img-err ~ .gic-ic-fb,
.gic-ic img.gic-ic-img-err ~ .gic-ic-fb {
  display: flex !important;
}

/* ==================== 方案 B：策展级单体画卷 (Group Canvas) ==================== */
.group-canvas {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}
[data-theme="dark"] .group-canvas {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-lg);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .group-canvas {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-lg);
  }
}

/* 一体化 Header */
.group-canvas .group-hero {
  position: relative;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-light);
  padding: 34px 40px 28px;
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}
.group-hero-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
[data-theme="dark"] .group-hero-icon {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
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
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
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
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
  padding: 3px 11px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
[data-theme="dark"] .meta-tag {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
}

/* 一体化画卷主体 */
.group-canvas-body {
  padding: 36px 40px 44px;
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
  background: linear-gradient(90deg, transparent 0%, var(--border-light) 15%, var(--border-light) 85%, transparent 100%);
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
  font-family: var(--font-display);
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
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) inset;
  font-size: 12.5px;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.bm-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
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
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-card);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s var(--ease-out), background-color 0.2s ease;
  position: relative;
  overflow: hidden;
}
[data-theme="dark"] .bm {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .bm {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
  }
}
.bm:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-card-hover);
  transform: translateY(-2px);
}
[data-theme="dark"] .bm:hover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .bm:hover {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
  }
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

/* ==================== 分类分享 HERO (紧凑对齐主站顶栏与 FilterBar 尺度) ==================== */
.cat-hero {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 20px;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
[data-theme="dark"] .cat-hero {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.cat-hero-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.cat-hero-accent {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--accent-grad);
}
.cat-hero-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  color: var(--accent);
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.6) inset;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
[data-theme="dark"] .cat-hero-icon {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
}
.cat-hero-icon img { width: 24px; height: 24px; object-fit: contain }
.cat-hero-icon .hero-fb { font-size: 16px }
.cat-hero-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.cat-hero-name {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.cat-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.cat-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  display: inline-block;
  flex-shrink: 0;
  margin-right: 6px;
}
.cat-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 布局切换器 (三布局按钮，对齐主站 FilterBar) */
.cat-layout-switch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  background: var(--bg-alt);
  border: 1px solid var(--border-light);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) inset;
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
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs);
}
[data-theme="dark"] .cat-layout-btn.active {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs);
}
.cat-layout-btn svg { width: 16px; height: 16px; display: block }
@media (max-width: 768px) { .cat-layout-btn.hide-mobile { display: none } }

/* ==================== CARD GRID (对齐主站 cards.css / layout.css) ==================== */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: start;
}
.card-grid .card-list-inner {
  display: contents;
}

/* 卡片基类 */
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px 16px 10px;
  cursor: pointer;
  transition: box-shadow 0.3s var(--ease-out), border-color 0.2s ease, transform 0.3s var(--ease-out), background-color 0.2s ease;
  overflow: hidden;
  height: 232px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-card);
}
[data-theme="dark"] .card {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .card {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
  }
}
.card:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-card-hover);
  transform: translateY(-3px);
}
[data-theme="dark"] .card:hover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .card:hover {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
  }
}
.card:active {
  transform: translateY(0) scale(0.995);
  transition-duration: 0.08s;
}

/* 点击热区覆盖层：卡片整体点击直达外链或聚焦 */
.card-link-overlay, .card-focus-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  text-decoration: none;
  border-radius: var(--radius-lg);
}

/* 组卡片左边缘光晕竖条 */
.group-card {
  position: relative;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  padding: 16px 16px 10px;
  height: 232px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-card);
}
[data-theme="dark"] .group-card {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .group-card {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(255, 255, 255, 0.04), var(--shadow-card);
  }
}
.group-card:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.9) inset, var(--shadow-card-hover);
  transform: translateY(-3px);
}
[data-theme="dark"] .group-card:hover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .group-card:hover {
    box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset, 0 0 0 1px rgba(255, 255, 255, 0.08), var(--shadow-card-hover);
  }
}
.group-card-accent {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--accent-grad);
  opacity: 0.5;
  border-radius: 0 2px 2px 0;
  transition: opacity 0.2s ease, box-shadow 0.2s ease;
}
.group-card:hover .group-card-accent {
  opacity: 0.8;
  box-shadow: 0 0 8px var(--accent-glow);
}

/* 卡片顶行 */
.card-topline {
  flex-shrink: 0;
  z-index: 1;
  background: var(--surface);
}
.card-toprow, .group-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 5px;
}
.card-logo {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s ease, transform 0.25s var(--ease-out), box-shadow 0.2s ease;
}
.card-logo img {
  width: 28px;
  height: 28px;
  object-fit: contain;
}
.card-logo svg {
  width: 24px;
  height: 24px;
  color: var(--accent);
}
.card-logo-fallback, .hero-fb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
}
.gic-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 2px;
}
.gic-ic img {
  width: 16px;
  height: 16px;
  border-radius: 2px;
  object-fit: contain;
}
.card:hover .card-logo {
  border-color: var(--accent);
  transform: scale(1.08);
  box-shadow: 0 2px 8px var(--accent-glow);
}

.card-titlewrap {
  flex: 1;
  min-width: 0;
  height: 38px;
  overflow: hidden;
  padding: 0 4px;
  margin: 0 -4px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
}
.card-titlewrap-text {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}
.card-name {
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 18px;
  height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  transition: color 0.15s ease;
}
.card:hover .card-name {
  color: var(--accent);
}
.card-domain {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 18px;
  height: 18px;
  margin: 0;
}
.group-domain { display: none }
.mini-domain { display: none }
.card-open-hint {
  flex-shrink: 0;
  display: none;
  width: 14px;
  height: 14px;
  color: var(--accent);
  opacity: 0.85;
}
.card-open-hint svg { width: 14px; height: 14px; display: block }
.card:hover .card-open-hint { display: block }

/* 卡片正文与内容区 */
.card-body {
  position: relative;
  z-index: 3;
  pointer-events: none;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  scrollbar-width: thin;
}
.card-body a,
.card-body .sub-sites {
  pointer-events: auto;
}
.grp-scroll-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.card-scroll-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  scrollbar-width: thin;
}
.card-notes {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.group-body {
  overflow: visible;
  padding: 4px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}
.card-grid:not(.list-view) .grp-scroll-body .group-body {
  -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 70%, transparent 100%);
}
.card-preview { display: none }

/* 散落书签子站点网格 */
.sub-sites {
  position: relative;
  z-index: 4;
  margin-top: 8px;
  border-top: 1px solid var(--border-light);
  padding-top: 6px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 4px;
}
.sub-sites .group-inline-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  text-decoration: none;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.sub-sites .group-inline-card:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
}
.sub-sites .group-inline-card img { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0 }
.sub-sites .group-inline-card .gic-ic { display: flex; align-items: center; }
.sub-sites .group-inline-card .gic-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;
}

/* 卡片底部 */
.card-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light);
  background: var(--surface);
  transition: border-color 0.2s ease;
}
.card:hover .card-foot { border-color: var(--border-hover); }
.card-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: var(--text-muted);
  cursor: default;
}
.card-stat svg { width: 12px; height: 12px }

/* ==================== 布局模式：列表视图 (List View) ==================== */
.card-grid.list-view {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  grid-template-columns: none !important;
  align-items: stretch !important;
  width: 100% !important;
}
.card-grid.list-view .card-list-inner {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  width: 100% !important;
}
.card-grid.list-view .card,
.card-grid.list-view .group-card {
  width: 100% !important;
  box-sizing: border-box !important;
  height: 82px !important;
  min-height: 0 !important;
  padding: 8px 16px !important;
  flex-direction: column !important;
  justify-content: center !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-card) !important;
}
.card-grid.list-view .card:hover,
.card-grid.list-view .group-card:hover {
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-card-hover) !important;
}
.card-grid.list-view .card-topline {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  background: transparent !important;
  width: 100% !important;
}
.card-grid.list-view .card-toprow,
.card-grid.list-view .group-card-head {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  margin: 0 !important;
  flex: 1 !important;
  min-width: 0 !important;
  width: 100% !important;
}
.card-grid.list-view .card-logo { width: 36px !important; height: 36px !important; flex-shrink: 0 !important; }
.card-grid.list-view .card-logo img { width: 22px !important; height: 22px !important; }
.card-grid.list-view .card-logo svg { width: 20px !important; height: 20px !important; }
.card-grid.list-view .card-titlewrap { height: 36px !important; flex: 1 !important; min-width: 0 !important; }
.card-grid.list-view .card-name { font-size: 0.88rem !important; }
.card-grid.list-view .card-domain { font-size: 0.75rem !important; margin-left: 6px !important; }
.card-grid.list-view .card-body {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  width: 100% !important;
}
.card-grid.list-view .card-body .focus-notes,
.card-grid.list-view .card-body .sub-sites {
  display: none !important;
}
.card-grid.list-view .card:has(.sub-sites) {
  height: auto !important;
  min-height: 82px !important;
  padding: 10px 16px !important;
}
.card-grid.list-view .card:has(.sub-sites) .card-body {
  overflow: visible !important;
}
.card-grid.list-view .card:has(.sub-sites) .card-body .sub-sites {
  display: flex !important;
  flex-wrap: wrap !important;
  margin-top: 6px !important;
  padding-top: 6px !important;
}
.card-grid.list-view .card-foot {
  position: absolute !important;
  top: 10px !important;
  right: 14px !important;
  padding: 0 !important;
  border-top: none !important;
  background: transparent !important;
  margin: 0 !important;
  z-index: 3 !important;
}
.card-grid.list-view .card-preview {
  display: block !important;
  font-size: 0.82rem !important;
  color: var(--text-muted) !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  max-width: 85% !important;
  margin-top: 2px !important;
  line-height: 1.4 !important;
}

/* ==================== 移动端默认列表视图 (防首屏宫格闪烁) ==================== */
.share-mobile-list .cat-grid:not(.mini-grid-view) {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  grid-template-columns: none !important;
  align-items: stretch !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-list-inner {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card,
.share-mobile-list .cat-grid:not(.mini-grid-view) .group-card {
  width: 100% !important;
  box-sizing: border-box !important;
  height: 82px !important;
  min-height: 0 !important;
  padding: 8px 16px !important;
  flex-direction: column !important;
  justify-content: center !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-card) !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:hover,
.share-mobile-list .cat-grid:not(.mini-grid-view) .group-card:hover {
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-card-hover) !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-topline {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  background: transparent !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-toprow,
.share-mobile-list .cat-grid:not(.mini-grid-view) .group-card-head {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  margin: 0 !important;
  flex: 1 !important;
  min-width: 0 !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-logo { width: 36px !important; height: 36px !important; flex-shrink: 0 !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-logo img { width: 22px !important; height: 22px !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-logo svg { width: 20px !important; height: 20px !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-titlewrap { height: 36px !important; flex: 1 !important; min-width: 0 !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-name { font-size: 0.88rem !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-domain { font-size: 0.75rem !important; margin-left: 6px !important; }
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-body {
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  width: 100% !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-body .focus-notes,
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-body .sub-sites {
  display: none !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:has(.sub-sites) {
  height: auto !important;
  min-height: 82px !important;
  padding: 10px 16px !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:has(.sub-sites) .card-body {
  overflow: visible !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card:has(.sub-sites) .card-body .sub-sites {
  display: flex !important;
  flex-wrap: wrap !important;
  margin-top: 6px !important;
  padding-top: 6px !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-foot {
  position: absolute !important;
  top: 10px !important;
  right: 14px !important;
  padding: 0 !important;
  border-top: none !important;
  background: transparent !important;
  margin: 0 !important;
  z-index: 3 !important;
}
.share-mobile-list .cat-grid:not(.mini-grid-view) .card-preview {
  display: block !important;
  font-size: 0.82rem !important;
  color: var(--text-muted) !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  max-width: 85% !important;
  margin-top: 2px !important;
  line-height: 1.4 !important;
}
.share-mobile-list .cat-layout-btn.hide-mobile,
.share-mobile-list .cat-layout-btn[data-layout="grid"] {
  display: none !important;
}
.share-mobile-list .cat-layout-btn[data-layout="list"] {
  background: var(--surface) !important;
  color: var(--accent) !important;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-xs) !important;
}
[data-theme="dark"] .share-mobile-list .cat-layout-btn[data-layout="list"] {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, var(--shadow-xs) !important;
}

/* ==================== 布局模式：小宫格视图 (Mini-Grid View) ==================== */
.card-grid.mini-grid-view {
  display: block !important;
  column-gap: 10px !important;
  column-fill: balance !important;
  column-width: clamp(140px, 11vw, 200px) !important;
}
.card-grid.mini-grid-view .card,
.card-grid.mini-grid-view .group-card {
  break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
  display: block !important;
  width: 100% !important;
  height: auto !important;
  margin: 0 0 10px !important;
  padding: 8px 10px !important;
  border-radius: var(--radius-md) !important;
  box-shadow: var(--shadow-card) !important;
}
.card-grid.mini-grid-view .card-toprow,
.card-grid.mini-grid-view .group-card-head {
  gap: 6px !important;
  align-items: center !important;
  margin-bottom: 2px !important;
}
.card-grid.mini-grid-view .card-logo { width: 20px !important; height: 20px !important; border-radius: var(--radius-sm) !important; }
.card-grid.mini-grid-view .card-logo img { width: 16px !important; height: 16px !important; }
.card-grid.mini-grid-view .card-logo-fallback,
.card-grid.mini-grid-view .hero-fb { font-size: 0.7rem !important; width: 16px !important; height: 16px !important; }
.card-grid.mini-grid-view .card-titlewrap { height: 20px !important; }
.card-grid.mini-grid-view .card-name { font-size: 13px !important; height: 20px !important; line-height: 20px !important; }
.card-grid.mini-grid-view .card-titlewrap .card-domain { display: none !important; }
.card-grid.mini-grid-view .mini-domain {
  display: block !important;
  font-size: 10px !important;
  opacity: 0.6 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  margin-top: 2px !important;
  font-family: var(--font-mono) !important;
}
.card-grid.mini-grid-view .card-body {
  display: block !important;
  padding: 0 !important;
  margin-top: 4px !important;
}
.card-grid.mini-grid-view .card-notes,
.card-grid.mini-grid-view .group-body,
.card-grid.mini-grid-view .sub-sites { display: none !important; }
.card-grid.mini-grid-view .card-preview {
  display: -webkit-box !important;
  -webkit-line-clamp: 4 !important;
  line-clamp: 4 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  font-size: 11.5px !important;
  line-height: 1.4 !important;
  color: var(--text-muted) !important;
}
.card-grid.mini-grid-view .card-foot {
  padding: 4px 0 0 !important;
  margin-top: 4px !important;
  border-top: 1px solid var(--border-light) !important;
}
.card-grid.mini-grid-view .card-stat { font-size: 10.5px !important; opacity: 0.8 !important; }

/* ==================== 组聚焦模式 (Focus Mode，100% 对齐主站) ==================== */
.group-focus-panel {
  display: none;
}
.group-focus-panel:target {
  display: flex !important;
  flex-direction: column;
  gap: 14px;
  animation: cardIn 0.28s var(--ease-out);
}
body:has(.group-focus-panel:target) .cat-hero {
  display: none !important;
}
body:has(.group-focus-panel:target) #cardGrid {
  display: none !important;
}

.focus-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 0 6px;
}
.exit-focus-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: all 0.15s ease;
  box-shadow: var(--shadow-xs);
}
.exit-focus-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-light);
}
.exit-focus-btn svg { width: 14px; height: 14px; }
.focus-bar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.focus-bar .panel-count {
  font-size: 12px;
  color: var(--text-muted);
}

.group-card-focus {
  height: auto !important;
  min-height: 200px !important;
  padding: 20px 24px 24px !important;
  cursor: default !important;
  box-shadow: 0 0 0 2px var(--accent-glow), var(--shadow-card-hover) !important;
  border-color: var(--accent) !important;
}
.group-card-focus .group-card-accent {
  opacity: 1 !important;
}
.group-card-focus .card-titlewrap {
  cursor: default !important;
}
.group-card-focus .card-titlewrap:hover {
  background: transparent !important;
}
.group-card-focus .card-titlewrap:hover .card-name {
  color: var(--text) !important;
}
.group-card-focus .card-scroll-wrap {
  overflow: visible !important;
}
.group-card-focus .group-body {
  font-size: 14px !important;
  line-height: 1.7 !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}
.group-bookmarks-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-light);
}
.group-bookmarks-section .section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.group-bookmarks-section .section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.group-bookmarks-section .section-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-alt);
  padding: 1px 7px;
  border-radius: var(--radius-full);
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
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.8) inset, var(--shadow-sm);
  border-radius: 20px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
[data-theme="dark"] .nf-icon {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, var(--shadow-sm);
}
.nf-icon svg { width: 30px; height: 30px }
.nf-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
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
  .bm-grid { grid-template-columns: 1fr }
}
`
