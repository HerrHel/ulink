// extension/panel-bridge.js — 侧边栏壳与主站 iframe 之间的协议纯函数（无 chrome.* / DOM 依赖，vitest 可测）
//
// 2.0 起侧边栏不再自带书签客户端：sidepanel.html 只放一个 iframe 嵌入主站 /app?mode=panel，
// 登录、读写、加密、同步、AI 预填全部由主站完成。本文件只负责「扩展 → 主站」推当前标签页、
// 「主站 → 扩展」回报是否已收藏的消息格式与校验，协议须与主站 src/lib/extPanel.ts 保持一致。

/** 生产主站 origin */
export const APP_ORIGIN = 'https://ulink.ren'
/** 与主站 src/lib/extPanel.ts 的 EXT_MSG_NS / EXT_MSG_VERSION 一致 */
export const MSG_NS = 'ulink-ext'
export const MSG_VERSION = 1

/** 本地调试允许的主站 origin（加载未打包扩展时用 sidepanel.html?app=<origin> 覆盖） */
const DEV_APP_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]

/** 解析主站 origin：只允许覆盖为本地调试地址，其余一律回落生产 */
export function resolveAppOrigin(search) {
  try {
    var o = new URLSearchParams(search || '').get('app')
    if (o && DEV_APP_ORIGINS.indexOf(o) !== -1) return o
  } catch (_) {}
  return APP_ORIGIN
}

/** iframe 地址 */
export function appPanelUrl(origin) {
  return origin + '/app?mode=panel'
}

function isHttpUrl(u) {
  if (!u || typeof u !== 'string') return false
  try {
    var p = new URL(u).protocol
    return p === 'http:' || p === 'https:'
  } catch (_) {
    return false
  }
}

/**
 * 由标签页 + 现场提取的元数据组装推给主站的当前页信息。
 * 内部页 / 拿不到网址（无 activeTab 授权）时返回 null，主站据此隐藏「当前页」卡片。
 * 备注候选：用户划选的文字 > 视频当前字幕（带时间点）。
 */
export function buildTabPayload(tab, meta) {
  if (!tab || !isHttpUrl(tab.url)) return null
  var m = meta || {}
  var videoNote = m.currentSubtitle && m.videoTime ? '【' + m.videoTime + '】' + m.currentSubtitle : ''
  return {
    url: tab.url,
    title: (m.title || tab.title || '').trim(),
    description: (m.description || '').trim(),
    selection: (m.selection || videoNote || '').trim(),
    icon: isHttpUrl(m.icon) ? m.icon : (isHttpUrl(tab.favIconUrl) ? tab.favIconUrl : ''),
  }
}

/** 组装发给主站的消息 */
export function toAppMessage(type, extra) {
  var msg = { ns: MSG_NS, v: MSG_VERSION, type: type }
  if (extra) for (var k in extra) msg[k] = extra[k]
  return msg
}

/**
 * 校验主站发来的消息：origin 必须是当前 iframe 的主站 origin，且命名空间 / 版本 / 类型匹配。
 * 返回 { type: 'ready' } | { type: 'matched', url, saved } | null
 */
export function parseAppMessage(origin, data, appOrigin) {
  if (origin !== appOrigin || !data || typeof data !== 'object') return null
  if (data.ns !== MSG_NS || data.v !== MSG_VERSION) return null
  if (data.type === 'ready') return { type: 'ready' }
  if (data.type === 'matched' && typeof data.url === 'string') {
    return { type: 'matched', url: data.url, saved: data.saved === true }
  }
  return null
}

/** 主站回报的网址是否就是当前推过去的那一页（主站会把网址规整成 URL.href，这里同样规整再比） */
export function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href
  } catch (_) {
    return false
  }
}
