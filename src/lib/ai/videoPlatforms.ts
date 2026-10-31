/**
 * videoPlatforms.ts — 视频/图文平台域名的单一真源（客户端）
 *
 * 真源文件：src/config/videoPlatforms.json。
 * 云函数（经 scripts/build-fn-assets.mjs 内联/复制）与 worker
 * （scripts/video-worker/video-platforms.json）都从同一份 JSON 派生，
 * 禁止在客户端再手写第三份域名清单（历史漂移根源）。
 *
 * 判定口径（与云函数/worker 保持一致）：
 * - 主站与任意子域命中 videoHosts/videoShortLinkHosts 即算视频平台；
 * - 短链域名单独提供 isVideoShortLink（供需要区分「需先解析跳转」的调用方）；
 * - 从自由文本中判定时先抽 URL（含裸域名），再按主机名匹配，避免把
 *   「bilibili上有哪些教程」这类不含链接的句子误判成视频。
 */
import platformConfig from '../../config/videoPlatforms.json'

/** JSON 结构（含 _comment 说明字段，不参与判定） */
interface VideoPlatformConfig {
  videoHosts: string[]
  videoShortLinkHosts: string[]
  resolverShortLinkHosts: string[]
  browserFirstHosts: string[]
}

const config = platformConfig as VideoPlatformConfig

/** 视频/图文平台主域（含任意子域） */
export const VIDEO_PLATFORM_HOSTS: readonly string[] = config.videoHosts
/** 客户端可见的分享短链域（与平台主域一起参与 isVideoPlatformUrl 判定） */
export const VIDEO_SHORT_LINK_HOSTS: readonly string[] = config.videoShortLinkHosts
/** 服务端/worker 需要先做重定向解析的短链域（多含 t.cn 等通用短链） */
export const VIDEO_RESOLVER_SHORT_LINK_HOSTS: readonly string[] = config.resolverShortLinkHosts
/** 优先走浏览器渲染（风控强、纯 HTTP 抓不到内容）的平台域 */
export const VIDEO_BROWSER_FIRST_HOSTS: readonly string[] = config.browserFirstHosts

/** 提取 URL 的主机名（去 www. 前缀、小写）；非法 URL 返回空串 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 主机名是否命中域名清单（精确或子域） */
function hostMatches(host: string, hosts: readonly string[]): boolean {
  if (!host) return false
  return hosts.some((h) => host === h || host.endsWith('.' + h))
}

/** 是否是视频/图文笔记平台链接（含分享短链） */
export function isVideoPlatformUrl(url: string): boolean {
  return hostMatches(hostOf(url), [...VIDEO_PLATFORM_HOSTS, ...VIDEO_SHORT_LINK_HOSTS])
}

/** 是否是分享短链域（需要先解析重定向才能拿到真实视频页） */
export function isVideoShortLink(url: string): boolean {
  return hostMatches(hostOf(url), VIDEO_SHORT_LINK_HOSTS)
}

/** 自由文本中的 http(s) 链接（与 videoHarvest 的 URL 字符白名单同口径） */
const URL_IN_TEXT_RE = /https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&*+,;=%]+/gi
/**
 * 自由文本中的裸域名链接（如 `v.douyin.com/abc`、`b23.tv/xyz`）。
 * 只接受「域名 + 至少两字母 TLD」，且前面必须是行首/空白/常见中文标点，
 * 避免把英文句子里的缩写误判成域名。
 */
const BARE_HOST_IN_TEXT_RE = /(?:^|[\s，。；：、！？（）()【】「」<>"'])((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#][^\s，。；：、！？（）()【】「」<>"']*)?/gi

/**
 * 文本中是否含有视频平台链接。
 * 用于 AI 输入分流：命中即走视频解析链路（而不是普通网页或纯自然语言）。
 */
export function containsVideoPlatformUrl(text: string): boolean {
  const source = String(text || '')
  if (!source) return false

  for (const match of source.matchAll(URL_IN_TEXT_RE)) {
    if (isVideoPlatformUrl(match[0])) return true
  }
  for (const match of source.matchAll(BARE_HOST_IN_TEXT_RE)) {
    const candidate = `${match[1]}${match[2] || ''}`
    if (isVideoPlatformUrl(`https://${candidate}`)) return true
  }
  return false
}
