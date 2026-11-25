/**
 * share-stats — 分享页访问统计的纯函数（无 I/O，便于单测）。
 *
 * 写库走 RPC public.record_share_event（见 cloudbase/migrations/20261125000001_share_stats.sql）：
 * 只存「分享 × 天 × 事件 × 来源」的聚合计数，不存 IP / UA / cookie。
 */

/** 社交平台 / IM 的链接预览抓取：计为 preview（说明链接被贴到了某处） */
const PREVIEW_UA =
  /facebookexternalhit|facebot|twitterbot|slackbot|discordbot|telegrambot|whatsapp|linkedinbot|skypeuripreview|embedly|redditbot|pinterest|applebot|line\/|kakaotalk-scrap|feishu|lark|dingtalk|bytespider/i
/** 搜索引擎爬虫与脚本工具：不计数（分享页本身 noindex，这些访问不代表真人） */
const IGNORE_UA =
  /bot\b|bot\/|spider|crawl|slurp|curl|wget|python|go-http|okhttp|axios|node-fetch|undici|headless|lighthouse|phantomjs|monitor|uptime|check_http|^$/i

/** 'human' | 'preview' | 'ignore' */
function classifyAgent(ua) {
  const s = String(ua || '')
  if (PREVIEW_UA.test(s)) return 'preview'
  if (IGNORE_UA.test(s)) return 'ignore'
  return 'human'
}

/** 规范化为 [a-z0-9._-]{1,40}，不合规返回 '' */
function normSource(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40)
  return s
}

/** 从 URL 查询参数取显式来源：utm_source > from > ref */
function sourceFromParams(searchParams) {
  for (const k of ['utm_source', 'from', 'ref']) {
    const v = normSource(searchParams.get(k))
    if (v) return v
  }
  return ''
}

/**
 * 访问来源：显式参数 > 外站 Referer 主机名 > App 内置浏览器（微信/QQ/微博，它们不带 Referer）> 'direct'
 * @param {URL} url 当前请求 URL
 * @param {Record<string, string|string[]|undefined>} headers 请求头
 * @param {string} appHost 本站主机名（Referer 是本站时不算外部来源）
 */
function resolveSource(url, headers, appHost) {
  const explicit = sourceFromParams(url.searchParams)
  if (explicit) return explicit

  const ref = String(headers.referer || headers.referrer || '')
  if (ref) {
    try {
      const host = new URL(ref).hostname.toLowerCase()
      if (host && host !== appHost && !host.endsWith('.' + appHost)) {
        const v = normSource(host)
        if (v) return v
      }
    } catch {
      /* 非法 Referer 忽略 */
    }
  }

  const ua = String(headers['user-agent'] || '')
  if (/micromessenger/i.test(ua)) return 'wechat'
  if (/\bqq\//i.test(ua)) return 'qq'
  if (/weibo/i.test(ua)) return 'weibo'
  return 'direct'
}

/**
 * /go 跳转的来源：访客从分享页点出来，Referer 是分享页本身，
 * 只能从分享页 URL 上的 utm_source/from/ref 继承显式来源，否则记 'direct'。
 */
function resolveGoSource(headers) {
  const ref = String(headers.referer || headers.referrer || '')
  if (!ref) return 'direct'
  try {
    return sourceFromParams(new URL(ref).searchParams) || 'direct'
  } catch {
    return 'direct'
  }
}

/**
 * /go 跳转目标（白名单，绝不接受外部 URL）。
 * @param {'g'|'c'} kind
 * @param {string} id 已校验过格式的分享 id
 * @param {string|null} to 'save' | 'start'（其它值按 save 处理）
 * @param {string} origin 应用源，如 https://ulink.ren
 * @returns {{ event: 'cta'|'start', location: string }}
 */
function goTarget(kind, id, to, origin) {
  if (to === 'start') return { event: 'start', location: `${origin}/?from=share` }
  const enc = encodeURIComponent(id)
  return {
    event: 'cta',
    location: kind === 'c' ? `${origin}/app#share/c/${enc}` : `${origin}/app#share/${enc}`,
  }
}

module.exports = { classifyAgent, normSource, resolveSource, resolveGoSource, goTarget }
