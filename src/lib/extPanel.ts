/**
 * extPanel.ts — 浏览器扩展侧边栏模式（/app?mode=panel）的纯函数协议层
 *
 * 形态：扩展侧边栏页面只放一个 iframe 嵌入主站 /app?mode=panel，主站在 iframe 里完整运行
 * （登录态、IndexedDB、同步锁与普通标签页共享，2026-11-23 P0 实测 Chromium 成立）。
 * 扩展只负责把「当前标签页」的信息推进来；主站回报该页是否已收藏（扩展据此显示角标）。
 *
 * 安全边界（本文件只做判定，不碰 DOM / Store，便于单测锁死）：
 * - 只接受来自 window.parent、且 origin 是浏览器扩展（chrome-extension / moz-extension）的消息；
 * - 消息必须带命名空间与版本，字段逐个白名单校验、截断长度，URL 只放行 http(s)；
 * - 主站发回扩展的消息只发给「已确认的扩展 origin」，绝不用 '*' 发送含网址的数据。
 */

/** 消息命名空间：两端共用，避免与页面里其他 postMessage 串台 */
export const EXT_MSG_NS = 'ulink-ext'
/** 协议版本：不兼容变更时递增，两端各自拒收未知版本 */
export const EXT_MSG_VERSION = 1

/** sessionStorage 键：URL 上的 mode=panel 会被清理，刷新后靠它保持侧栏模式 */
export const PANEL_MODE_SESSION_KEY = 'lv_ext_panel_mode'

const LIMITS = { url: 2048, title: 300, description: 600, selection: 4000, icon: 2048 } as const

/** 扩展推进来的当前标签页信息（均已校验与截断） */
export interface ExtTabInfo {
  url: string
  title: string
  description: string
  selection: string
  icon: string
}

/** 扩展 → 主站 */
export type ExtInboundMessage =
  | { type: 'tab'; tab: ExtTabInfo | null }
  | { type: 'save' }

/** 主站 → 扩展 */
export type ExtOutboundMessage =
  | { type: 'ready' }
  | { type: 'matched'; url: string; saved: boolean }

/** 是否是浏览器扩展页面的 origin（Edge / Chrome / Brave 同为 chrome-extension） */
export function isExtensionOrigin(origin: unknown): origin is string {
  return typeof origin === 'string' && /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin)
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** 只放行 http(s) 绝对地址；其余（javascript:、data:、相对路径……）一律视为空 */
export function safeHttpUrl(v: unknown, max: number = LIMITS.url): string {
  const s = str(v, max)
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''
  } catch {
    return ''
  }
}

/** 校验并规整扩展推来的标签页信息；url 不合法时返回 null（例如 chrome:// 内部页） */
export function parseTabInfo(raw: unknown): ExtTabInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = safeHttpUrl(r.url)
  if (!url) return null
  return {
    url,
    title: str(r.title, LIMITS.title),
    description: str(r.description, LIMITS.description),
    selection: str(r.selection, LIMITS.selection),
    icon: safeHttpUrl(r.icon, LIMITS.icon),
  }
}

/** 解析一条入站消息；不是本协议的消息返回 null（静默忽略，不报错） */
export function parseInboundMessage(data: unknown): ExtInboundMessage | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.ns !== EXT_MSG_NS || d.v !== EXT_MSG_VERSION) return null
  if (d.type === 'tab') return { type: 'tab', tab: parseTabInfo(d.tab) }
  if (d.type === 'save') return { type: 'save' }
  return null
}

/** 组装出站消息（统一带命名空间与版本） */
export function buildOutboundMessage(msg: ExtOutboundMessage): ExtOutboundMessage & { ns: string; v: number } {
  return { ns: EXT_MSG_NS, v: EXT_MSG_VERSION, ...msg }
}

/**
 * 判定是否处于扩展侧栏模式。
 * 必须同时满足：被嵌在 iframe 里（顶层直接打开 ?mode=panel 不算），且 URL 带 mode=panel
 * 或本会话之前已进入过侧栏模式（URL 参数会被清掉，刷新后靠 sessionStorage 延续）。
 */
export function detectPanelMode(opts: {
  search: string
  isFramed: boolean
  sessionFlag: string | null
}): boolean {
  if (!opts.isFramed) return false
  const mode = new URLSearchParams(opts.search).get('mode')
  return mode === 'panel' || opts.sessionFlag === '1'
}

/**
 * 推断父页面（扩展）的 origin：Chromium 提供 location.ancestorOrigins，可在收到任何消息前
 * 就确定目标 origin；Firefox 没有该属性，返回 null，等第一条合法入站消息再确定。
 */
export function guessParentOrigin(ancestorOrigins: ArrayLike<string> | undefined | null): string | null {
  const first = ancestorOrigins && ancestorOrigins.length > 0 ? ancestorOrigins[0] : null
  return isExtensionOrigin(first) ? first : null
}
