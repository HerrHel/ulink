/**
 * deepLinkExtract.ts — 文本深挖链接纯函数层（自 cloudAiClient.ts 拆出）
 * 职责：从一段文本中提取可收藏网站链接（Markdown 锚链接/完整 URL/裸域名），
 * 按行识别简介/字幕/评论区等来源分区并标注，过滤资源噪声与站内自链。
 * 纯函数无副作用，供视频/分享内容收割（videoHarvest.ts）复用。
 */

/** 视频/分享内容深挖链接的来源分区（用于标注链接出处） */
export type DeepLinkSource = '输入文本' | '简介' | '字幕' | '评论区' | '正文' | '文本提及'

export interface DeepLinkHit {
  url: string
  source: DeepLinkSource
  anchor?: string
}

// 分区标题关键词：按行识别简介/字幕/评论区等正文分区
const SECTION_HEADING_PATTERNS: Array<{ re: RegExp; source: DeepLinkSource }> = [
  { re: /简介|介绍|描述|description|about/i, source: '简介' },
  { re: /字幕|文稿|台词|transcript|subtitle/i, source: '字幕' },
  { re: /评论|留言|comment/i, source: '评论区' },
]

// 噪声资源链接（图片/音视频/压缩包/可执行文件/样式脚本），不是可收藏的网站
const ASSET_URL_RE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp4|mp3|wav|avi|mov|mkv|flv|zip|rar|7z|tar|gz|dmg|exe|apk|msi|woff2?|ttf|otf|css|js)([?#]|$)/i

/** 站内自链噪声判定（含子域，如 space.bilibili.com 对 bilibili.com） */
function isSameSiteUrl(url: string, host: string): boolean {
  if (!host) return false
  try {
    const h = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    return h === host || h.endsWith('.' + host) || host.endsWith('.' + h)
  } catch {
    return false
  }
}

/**
 * 从一段文本深挖链接（Markdown 锚链接、完整 URL、裸域名），并按行标注来源分区。
 * 纯函数无副作用，供视频/分享内容的简介、字幕、评论区链接提取复用。
 */
export function extractDeepLinksFromText(
  text: string,
  options: { defaultSource: DeepLinkSource; targetHost?: string; dropSameSite?: boolean }
): DeepLinkHit[] {
  const hits: DeepLinkHit[] = []
  if (!text) return hits

  let currentSource = options.defaultSource
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // 标题行（# 标题 / **加粗** / 短行含关键词）切换当前分区
    const isHeadingLike = /^#{1,6}\s+/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line) || line.length < 40
    if (isHeadingLike) {
      for (const p of SECTION_HEADING_PATTERNS) {
        if (p.re.test(line)) {
          currentSource = p.source
          break
        }
      }
    }

    // Markdown 锚链接 [文本](url)：锚文本可直接当候选标题
    // URL 段用 ASCII 白名单：URL 后紧贴的中文是叙述文字，不得吞进地址（否则 404）
    let workLine = line
    workLine = workLine.replace(/\[([^\]]{1,80})\]\((https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+)\)/g, (_m, anchor: string, u: string) => {
      hits.push({ url: u, source: currentSource, anchor: anchor.trim() })
      return ` ${u} `
    })

    // 带协议的完整链接（同上：遇 CJK 等非 ASCII 截止，再清尾随标点）
    for (const m of workLine.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]*/gi)) {
      const u = m[0].replace(/[，。！？,.!?:;；]+$/, '')
      if (u) hits.push({ url: u, source: currentSource })
    }

    // 裸域名如 v0.dev, jsdesign.com, mockplus.cn
    // 左右界均含 CJK/全角字符：中文叙述常无空格紧贴域名（「上v0.dev生成页面」），仍应识别
    for (const m of workLine.matchAll(/(?:^|[\s,，、\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])([a-zA-Z0-9-]+\.(?:com|dev|cn|io|app|net|org|co))(?=[\s,，、。!?\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]|$)/gi)) {
      hits.push({ url: `https://${m[1].toLowerCase()}`, source: currentSource })
    }
  }

  // 噪声过滤 + 去重（保留首个命中，Markdown 锚链接排最前因此锚文本得以保留）
  const seen = new Set<string>()
  return hits.filter(h => {
    if (ASSET_URL_RE.test(h.url)) return false
    if (options.dropSameSite && isSameSiteUrl(h.url, options.targetHost || '')) return false
    const key = h.url.toLowerCase().replace(/\/+$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
