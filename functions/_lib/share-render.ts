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

import { CSS } from './share-render-styles.js'
import { FALLBACK_JS } from './share-render-client.js'

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
    ctaN: '保存这 {n} 个链接',
    startTitle: '这份清单由与链整理',
    startBody: '你也可以 30 秒建一份自己的书签清单：多设备同步，随时分享。',
    startBtn: '免费开始',
    tocTitle: '目录',
    bookmarksTitle: '收录的书签',
    searchBookmarks: '搜索书签...',
    jumpToNotes: '导读笔记',
    jumpToBookmarks: '收录书签',
    noBookmarksMatch: '未找到匹配的书签',
    copyAllLinks: '复制全部链接',
    copiedLinks: '已复制 {n} 个链接',
    copyFailed: '复制失败，请手动复制',
    footerBrand: '与链 · ulink',
    footerSlogan: '收藏 · 整理 · 分享',
    // 违法与不良信息举报入口（《网络安全法》第 47 条、《网络信息内容生态治理规定》）：
    // 分享页是公网可读的 UGC，必须提供对外的投诉/举报通道，不能只留站内反馈。
    reportLink: '举报 / 侵权投诉',
    reportSubject: '举报分享内容 · 与链 ulink',
    reportBody: '请粘贴你要举报的分享链接，并简要说明理由（如违法信息、侵权内容）。我们会在收到后及时核实处理：',
    themeToggle: '切换深浅色主题',
    // ── 访问密码门 ──
    passTitle: '需要访问密码 - 与链',
    passHeading: '此分享已加密',
    passBody: '请输入分享者提供的访问密码',
    passLabel: '访问密码',
    passPlaceholder: '访问密码',
    passSubmit: '查看内容',
    passError: '密码不正确，请重试',
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
    ctaN: 'Save these {n} links',
    ctaN_one: 'Save this link',
    startTitle: 'Made with ulink',
    startBody: 'Build your own bookmark list in 30 seconds — synced across devices, easy to share.',
    startBtn: 'Start free',
    tocTitle: 'Contents',
    bookmarksTitle: 'Bookmarks in this note',
    searchBookmarks: 'Search bookmarks...',
    jumpToNotes: 'Notes',
    jumpToBookmarks: 'Bookmarks',
    noBookmarksMatch: 'No matching bookmarks found',
    copyAllLinks: 'Copy all links',
    copiedLinks: 'Copied {n} links',
    copyFailed: 'Copy failed, please copy manually',
    footerBrand: 'ulink',
    footerSlogan: 'Collect · Organize · Share',
    reportLink: 'Report / DMCA',
    reportSubject: 'Report shared content · ulink',
    reportBody: 'Paste the share link and briefly explain the issue (illegal content, infringement):',
    themeToggle: 'Toggle light/dark theme',
    // ── password gate ──
    passTitle: 'Password required - ulink',
    passHeading: 'This share is protected',
    passBody: 'Enter the access password provided by the owner',
    passLabel: 'Access password',
    passPlaceholder: 'Access password',
    passSubmit: 'View content',
    passError: 'Incorrect password, please try again',
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
        // 错误降级不写内联 onerror（分享页 CSP 为 script-src-attr 'none'）：
        // FALLBACK_JS 统一监听 img[data-fb] 的 error 事件并补 .img-err
        if (hasSrc) {
          attrs.push('data-fb')
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

/**
 * 高级排版字体栈（对齐主站与落地页：Satoshi / Clash Display / Noto Sans SC / JetBrains Mono）。
 * 全部同域自托管：/fonts/gf.css 由 scripts/selfhost-google-fonts.mjs 生成（unicode-range 切片按需加载）。
 * 分享页同在 ulink.ren 下，不再阻塞于 Google Fonts。
 */
const FONT_LINKS = [
  `<link href="/fonts/fonts.css" rel="stylesheet">`,
  `<link href="/fonts/gf.css" rel="stylesheet">`,
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
    // 私有分享：显式禁止收录。分享是"知道链接才能访问"的私有通道，
    // 不应进入搜索引擎索引（定性依据见 docs/BILLING_DESIGN.md §8.5）。
    // 注意不要配合 robots.txt Disallow —— 爬虫读不到 noindex 反而删不掉已收录页。
    `<meta name="robots" content="noindex, nofollow">`,
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
 *  - img 加载失败（FALLBACK_JS 监听 error 后加 .img-err）→ 隐藏 img，露出首字母。
 */
function iconMarkup(imgSrc: string, letter: string, cls: string): string {
  // 错误降级交给 FALLBACK_JS（监听 img[data-fb] 的 error）：
  // 分享页 CSP 为 script-src-attr 'none'，不允许内联事件处理器。
  const img = imgSrc
    ? `<img src="${esc(imgSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb>`
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
  kids: PublicBookmark[] = [],
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
  const kidLinks = kids.map((k) => buildKidLink(dict, k))
  // 搜索串带上子书签的标题与域名：搜子站时父卡片一起留下
  const searchStr = esc([title, dm, ...kidLinks.map((k) => k.search)].join(' ').toLowerCase())
  const inner = [
    `<div class="bm-main">`,
    `<span class="bm-icon">${iconMarkup(safe ? faviconOf(safe) : "", ch, "bm")}</span>`,
    `<div class="bm-info">`,
    `<span class="bm-title">${esc(title)}</span>`,
    dm ? `<span class="bm-url">${esc(dm)}</span>` : `<span class="bm-url">&nbsp;</span>`,
    `</div>`,
    `<span class="bm-arrow" aria-hidden="true">${ARROW_SVG}</span>`,
    `</div>`,
    notes ? `<p class="bm-notes">${esc(notes)}</p>` : '',
  ].join("")
  if (!kidLinks.length) {
    return `<a class="bm" href="${href}"${target}${rel} data-search="${searchStr}">${inner}</a>`
  }
  // 有子书签：<a> 不能嵌套 <a>，卡片改为 div + 全卡点击热区（.bm-hit），
  // 子书签以小胶囊排在卡片底部（.sub-sites 层级高于热区，可单独点击）
  return [
    `<div class="bm has-kids" data-search="${searchStr}">`,
    `<a class="bm-hit" href="${href}"${target}${rel} aria-label="${esc(title)}"></a>`,
    inner,
    `<div class="sub-sites">${kidLinks.map((k) => k.html).join("")}</div>`,
    `</div>`,
  ].join("")
}

/** 子书签胶囊（复用分类页 .sub-sites .group-inline-card 样式） */
function buildKidLink(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  k: PublicBookmark,
): { html: string; search: string } {
  const safe = isCipherText(k.url) ? "" : fixUrl(k.url)
  const dm = safe ? domainOf(safe) : ""
  const title = deCipherText(dict, k.title).trim() || dm || "?"
  const ch = title.charAt(0).toUpperCase()
  const attrs = safe ? ` href="${esc(safe)}" target="_blank" rel="noopener nofollow"` : ' href="#"'
  return {
    html:
      `<a class="group-inline-card"${attrs} title="${esc(title)}">` +
      `<span class="gic-ic">${iconMarkup(safe ? faviconOf(safe) : "", ch, "gic-ic")}</span>` +
      `<span class="gic-name">${esc(title)}</span>` +
      `</a>`,
    search: `${title} ${dm}`,
  }
}

/**
 * 把层级有序列表（orderBookmarksHierarchically 的输出：子孙紧跟在根之后）
 * 折成「根书签 + 全部子孙」的家族；孙书签也平铺进根卡片，不再逐级缩进。
 */
function groupBookmarkFamilies(bms: PublicBookmark[]): Array<{ root: PublicBookmark; kids: PublicBookmark[] }> {
  const ids = new Set((bms || []).map((b) => String(b && b.id)))
  const families: Array<{ root: PublicBookmark; kids: PublicBookmark[] }> = []
  for (const b of orderBookmarksHierarchically(bms)) {
    const pid = typeof b.parent_id === 'string' ? b.parent_id.trim() : ''
    const last = families[families.length - 1]
    if (pid && ids.has(pid) && last) last.kids.push(b)
    else families.push({ root: b, kids: [] })
  }
  return families
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
 * 组/分类头部图标：若设置了自定义图标（http(s) 或安全相对路径），显示设置的图标；
 * 组若未设置自定义图标，则显示初始的 SVG 图像（NOTE_SVG）。
 */
function heroCustomIconMarkup(entity: Record<string, unknown>, prefix: "group" | "cat"): string {
  const icon = typeof entity.icon === "string" ? entity.icon.trim() : ""
  if (/^https?:\/\//i.test(icon) || /^\/(?!\/)/.test(icon)) {
    return `<span class="${prefix}-hero-icon"><img src="${esc(icon)}" alt="" data-fb="1" /><span class="hero-fb" aria-hidden="true">${prefix === "group" ? NOTE_SVG : ""}</span></span>`
  }
  if (prefix === "group") {
    return `<span class="${prefix}-hero-icon">${NOTE_SVG}</span>`
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
/**
 * 分享页出站跳转（/s/<gid>/go、/s/c/<sid>/go）：share-ssr 计一次 cta/start 再 302 到应用。
 * 跳转目标由服务端按 to=save|start 白名单决定，不接受任意 URL（防开放重定向）。
 */
export function shareGoUrl(appOrigin: string, kind: 'g' | 'c', id: string): string {
  const enc = encodeURIComponent(id)
  return kind === 'g' ? `${appOrigin}/s/${enc}/go` : `${appOrigin}/s/c/${enc}/go`
}

/** 文末转化卡片：访客看完清单、意愿最高的时刻，给一个轻量的「你也来建一份」入口 */
function buildStartCard(dict: typeof T['zh-CN'] | typeof T['en-US'], startUrl: string): string {
  return [
    `<aside class="share-start">`,
    `<span class="share-start-logo" aria-hidden="true">${LOGO_SVG}</span>`,
    `<div class="share-start-text">`,
    `<p class="share-start-title">${esc(dict.startTitle)}</p>`,
    `<p class="share-start-body">${esc(dict.startBody)}</p>`,
    `</div>`,
    `<a class="share-start-btn" href="${esc(startUrl)}">${esc(dict.startBtn)}</a>`,
    `</aside>`,
  ].join("\n")
}

function buildAppShell(
  dict: typeof T['zh-CN'] | typeof T['en-US'],
  appOrigin: string,
  opts: { hdrMeta: string; ctaUrl: string; inner: string; hideCta?: boolean; ctaText?: string; startUrl?: string },
): string {
  const year = new Date().getUTCFullYear()
  const isZh = dict.lang === 'zh-CN'
  const slogan = isZh ? '个人书签与知识库 · 随时随地整理分享' : 'Personal bookmarks & knowledge vault'
  // 页脚给「还没决定用不用」的访客：指向宣传页 /about；顶栏「保存至我的库」是动作，仍直达应用
  const ctaFoot = isZh ? '了解与链 ulink →' : 'Learn about ulink →'
  const reportHref = `mailto:herr@ulink.ren?subject=${encodeURIComponent(dict.reportSubject)}&amp;body=${encodeURIComponent(dict.reportBody)}`
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
    // 密码门等「访客还看不到内容」的页面不出「保存至我的库」，避免点进去无物可存
    opts.hideCta ? '' : `<a class="cta" href="${esc(opts.ctaUrl)}">${esc(opts.ctaText || dict.cta)}</a>`,
    `</div>`,
    `</div>`,
    `</header>`,
    `<main class="share-container">`,
    opts.inner,
    opts.startUrl ? buildStartCard(dict, opts.startUrl) : '',
    `</main>`,
    `<footer class="share-footer">`,
    `<div class="share-footer-inner">`,
    `<div class="share-footer-brand">`,
    `<span class="footer-logo">${LOGO_SVG}</span>`,
    `<span class="footer-name">${esc(dict.footerBrand)}</span>`,
    `</div>`,
    `<p class="share-footer-slogan">${slogan}</p>`,
    `<a class="share-footer-cta" href="${esc(appOrigin)}/about">${ctaFoot}</a>`,
    `<span class="share-footer-copy">© ${year} ulink · ${esc(appOrigin.replace(/^https?:\/\//, ""))}</span>`,
    `<a class="share-footer-report" href="${reportHref}">${esc(dict.reportLink)}</a>`,
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
    // 「复制全部链接」：访客把整份清单带走（脚本见 share-render-client.ts，无 JS 时按钮隐藏）
    const copyAll = count >= 2
      ? `<button type="button" class="bm-copy-all" id="bmCopyAll" hidden data-done="${esc(dict.copiedLinks)}" data-fail="${esc(dict.copyFailed)}">${esc(dict.copyAllLinks)}</button>`
      : ''
    const tools = copyAll || searchBar ? `<div class="section-tools">${copyAll}${searchBar}</div>` : ''
    sections.push(
      `<section class="group-bookmarks-section" id="section-bookmarks">`,
      `<div class="section-header">`,
      `<div class="section-title-wrap">`,
      `<span class="section-title-icon">${BOOKMARK_SVG}</span>`,
      `<h2 class="section-title">${esc(dict.bookmarksTitle)}</h2>`,
      `<span class="section-count">${count}</span>`,
      `</div>`,
      tools,
      `</div>`,
      `<div class="bm-grid" id="bmList">`,
      groupBookmarkFamilies(bookmarks).map((f) => buildBookmarkItem(dict, f.root, f.kids)).join("\n"),
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

  const go = shareGoUrl(appOrigin, 'g', group.id)
  return buildAppShell(dict, appOrigin, {
    hdrMeta: "",
    ctaUrl: count > 0 ? `${go}?to=save` : appUrl,
    ctaText: count > 0 ? fill(pick(dict, 'ctaN', count), { n: count }) : undefined,
    startUrl: `${go}?to=start`,
    inner,
  })
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
    ? groupBookmarkFamilies(entry.items).map((f) => buildBookmarkItem(dict, f.root, f.kids)).join("")
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
  const go = shareGoUrl(appOrigin, 'c', shareId)
  const total = bookmarks.length
  return buildAppShell(dict, appOrigin, {
    hdrMeta: "",
    ctaUrl: total > 0 ? `${go}?to=save` : appUrl,
    ctaText: total > 0 ? fill(pick(dict, 'ctaN', total), { n: total }) : undefined,
    startUrl: `${go}?to=start`,
    inner,
  })
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
    // 私有分享：显式禁止收录。分享是"知道链接才能访问"的私有通道，
    // 不应进入搜索引擎索引（定性依据见 docs/BILLING_DESIGN.md §8.5）。
    // 注意不要配合 robots.txt Disallow —— 爬虫读不到 noindex 反而删不掉已收录页。
    `<meta name="robots" content="noindex, nofollow">`,
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
/** 密码门页面追加样式（复用主 CSS 的设计令牌，不引外部依赖） */
const PASS_CSS = `
.pw-icon{display:flex;justify-content:center;margin-bottom:16px}
.pw-form{display:flex;flex-direction:column;gap:10px;margin-top:20px;width:100%;max-width:280px;margin-left:auto;margin-right:auto}
.pw-input{width:100%;box-sizing:border-box;padding:11px 14px;font:inherit;font-size:15px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:10px;outline:none;transition:border-color .15s}
.pw-input:focus{border-color:var(--accent)}
.pw-submit{padding:11px 14px;font:inherit;font-size:14px;font-weight:500;color:#fff;background:var(--accent);border:0;border-radius:10px;cursor:pointer;transition:opacity .15s}
.pw-submit:hover{opacity:.9}
.pw-error{margin:0;font-size:13px;color:#C0392B;text-align:center}
`

/** 锁图标（用 currentColor 之外的 accent，暗色下同样可读） */
const LOCK_SVG = `<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.3" fill="var(--accent)" stroke="none"/></svg>`

/**
 * 访问密码门。
 *
 * 安全约束（改动时务必保持）：
 * - **绝不含任何分享内容**：本页只输出表单，内容由云函数在验密通过后才去 RPC 取；
 * - 强制 `noindex, nofollow`：密码门不该进索引；
 * - 表单不写 action，提交到当前 URL（避免被构造成外部地址）；
 * - required + minlength 仅作 UX 提示，真正的长度与强度校验在服务端。
 */
export function renderPasswordGate(
  locale: ShareLocale = 'zh-CN',
  opts: { error?: boolean } = {},
): string {
  const d = T[locale]
  const origin = 'https://ulink.ren'
  return [
    `<!DOCTYPE html>`,
    `<html lang="${d.lang}">`,
    `<head>`,
    THEME_SCRIPT,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<meta name="robots" content="noindex, nofollow">`,
    `<title>${esc(d.passTitle)}</title>`,
    FONT_LINKS,
    `</head>`,
    `<style>${CSS}${PASS_CSS}</style>`,
    `<body>`,
    buildAppShell(d, origin, {
      hdrMeta: "",
      ctaUrl: `${origin}/`,
      hideCta: true,
      inner: [
        `<div class="nf">`,
        `<div class="pw-icon">${LOCK_SVG}</div>`,
        `<h1 class="nf-title">${esc(d.passHeading)}</h1>`,
        `<p class="nf-body">${esc(d.passBody)}</p>`,
        `<form class="pw-form" method="POST" autocomplete="off">`,
        `<input class="pw-input" type="password" name="password" placeholder="${esc(d.passPlaceholder)}" aria-label="${esc(d.passLabel)}" required maxlength="128" autocomplete="current-password" autofocus>`,
        `<button class="pw-submit" type="submit">${esc(d.passSubmit)}</button>`,
        opts.error ? `<p class="pw-error" role="alert">${esc(d.passError)}</p>` : '',
        `</form>`,
        `</div>`,
      ].join("\n"),
    }),
    `</body>`,
    `</html>`,
  ].join("\n")
}

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

