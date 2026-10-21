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
  { re: /字幕|文稿|台词|transcript|subtitle|速览|大纲|小结|语音/i, source: '字幕' },
  { re: /评论|留言|comment/i, source: '评论区' },
]

// 噪声资源链接（图片/音视频/压缩包/可执行文件/样式脚本），不是可收藏的网站
const ASSET_URL_RE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp4|mp3|wav|avi|mov|mkv|flv|zip|rar|7z|tar|gz|dmg|exe|apk|msi|woff2?|ttf|otf|css|js)([?#]|$)/i

// 平台通用导航底栏/免责条款/全站频道噪声关键词
const NAV_OR_BOILERPLATE_ANCHOR_RE =
  /^(?:首页|主页|番剧|直播|游戏中心|会员购|漫画|赛事|客户端|下载|关于我们|联系我们|加入我们|友情链接|合作伙伴|隐私政策|服务协议|用户协议|版权声明|免责声明|法律声明|侵权申诉|营业执照|增值电信业务|公网安备|备案|Home|About(?:\s+Us)?|Privacy(?:\s+Policy)?|Terms(?:\s+of\s+Service)?|Contact(?:\s+Us)?|Careers|Help|Sign\s+in|Log\s+in|Register|Download(?:\s+App)?)$/i

// 备案与通用应用商店域名
const BOILERPLATE_HOST_RE = /(?:beian\.gov\.cn|miit\.gov\.cn|apple\.com\/(?:app-store|ios)|play\.google\.com)$/i

/** 常见平台分享短链 ⟷ 主站主域族映射 */
export const SHORT_CANONICAL_FAMILY: Record<string, string[]> = {
  'b23.tv': ['bilibili.com', 'b23.tv', 'hdslb.com'],
  'bilibili.com': ['bilibili.com', 'b23.tv', 'hdslb.com'],
  'v.douyin.com': ['douyin.com', 'v.douyin.com', 'iesdouyin.com'],
  'douyin.com': ['douyin.com', 'v.douyin.com', 'iesdouyin.com'],
  'xhslink.com': ['xiaohongshu.com', 'xhslink.com'],
  'xiaohongshu.com': ['xiaohongshu.com', 'xhslink.com'],
  't.co': ['x.com', 'twitter.com', 't.co'],
  'twitter.com': ['x.com', 'twitter.com', 't.co'],
  'x.com': ['x.com', 'twitter.com', 't.co'],
  'youtu.be': ['youtube.com', 'youtu.be'],
  'youtube.com': ['youtube.com', 'youtu.be'],
  'vm.tiktok.com': ['tiktok.com', 'vm.tiktok.com'],
  'tiktok.com': ['tiktok.com', 'vm.tiktok.com'],
}

/** 获取一组 host 对应的全平台主站域族集合 */
export function getCanonicalHostFamily(hosts: Array<string | undefined | null>): Set<string> {
  const result = new Set<string>()
  for (const raw of hosts) {
    if (!raw) continue
    const h = raw.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '')
    result.add(h)
    const family = SHORT_CANONICAL_FAMILY[h]
    if (family) {
      for (const f of family) result.add(f)
    }
  }
  return result
}

/** 站内自链噪声判定（含短链族群与子域，如 space.bilibili.com / live.bilibili.com 对 b23.tv/bilibili.com） */
export function isSameSiteUrl(url: string, hostOrFamily?: string | string[] | Set<string>): boolean {
  if (!hostOrFamily) return false
  const hostSet: Set<string> =
    hostOrFamily instanceof Set
      ? hostOrFamily
      : Array.isArray(hostOrFamily)
        ? getCanonicalHostFamily(hostOrFamily)
        : getCanonicalHostFamily([hostOrFamily])

  if (hostSet.size === 0) return false

  try {
    const h = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
    for (const target of hostSet) {
      if (!target) continue
      if (h === target || h.endsWith('.' + target) || target.endsWith('.' + h)) {
        return true
      }
    }
    return false
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
  options: {
    defaultSource: DeepLinkSource
    targetHost?: string | string[] | Set<string>
    dropSameSite?: boolean
  }
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
      return ' '
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
  const hostFamily = options.targetHost
    ? options.targetHost instanceof Set
      ? options.targetHost
      : getCanonicalHostFamily(Array.isArray(options.targetHost) ? options.targetHost : [options.targetHost])
    : undefined

  return hits.filter(h => {
    if (ASSET_URL_RE.test(h.url)) return false
    if (BOILERPLATE_HOST_RE.test(h.url)) return false
    if (h.anchor && NAV_OR_BOILERPLATE_ANCHOR_RE.test(h.anchor.trim())) return false
    if (options.dropSameSite && hostFamily && isSameSiteUrl(h.url, hostFamily)) return false
    const key = h.url.toLowerCase().replace(/\/+$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
