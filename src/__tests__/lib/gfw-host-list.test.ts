/**
 * GFW 已知受限站点名单的契约测试
 *
 * 这份名单只在**探测本身失败**时生效：命中 → 判「被墙」（不算死链）；
 * 未命中 → 判 inconclusive（不落标也不抹标，不冤枉任何链接）。
 *
 * 因此两类错误的代价完全不同：
 *   漏一个   → 只是判不出（可接受）
 *   加错一个 → 正常站点偶发超时被判「被墙」（污染用户链接状态，不可接受）
 *
 * 本测试锁两件事：
 *   ① 名单确实覆盖主流被墙站点（防止因怕出错而把它删空）
 *   ② **可正常访问 / 间歇性的站点绝不能被加进来**
 */
import { describe, it, expect } from 'vitest'
import { isKnownGfwHost, decide, type EdgeEvidence } from '../../lib/deadLinkDecision.js'

describe('GFW 已知受限站点名单', () => {
  describe('应命中：明确被封锁的大众站点', () => {
    const blocked = [
      // Google / YouTube
      'google.com', 'www.google.com', 'maps.google.com',
      'youtube.com', 'm.youtube.com', 'youtu.be', 'i.ytimg.com',
      // Meta
      'facebook.com', 'm.facebook.com', 'fbcdn.net',
      'instagram.com', 'whatsapp.com', 'wa.me',
      // X
      'twitter.com', 'x.com', 't.co', 'pbs.twimg.com',
      // 通讯
      'telegram.org', 't.me', 'discord.com', 'discord.gg',
      // 内容平台
      'reddit.com', 'old.reddit.com',
      'wikipedia.org', 'zh.wikipedia.org', 'wikimedia.org',
      'medium.com', 'pinterest.com', 'tumblr.com',
      // 视频音频
      'twitch.tv', 'vimeo.com', 'soundcloud.com',
      // 新闻
      'nytimes.com', 'bbc.com', 'bbc.co.uk', 'reuters.com', 'wsj.com',
      // 工具
      'archive.org', 'dropbox.com', 'imgur.com', 'flickr.com',
      // AI / 开发者
      'chatgpt.com', 'workers.dev', 'bsky.app',
    ]
    it.each(blocked)('%s 判为已知受限', (h) => {
      expect(isKnownGfwHost(h)).toBe(true)
    })
  })

  describe('⚠️ 绝不能命中：可正常访问或间歇性站点', () => {
    // GreatFire 把这些标为 intermittent（间歇性）或 not blocked。
    // 一旦混进名单，正常站点的偶发超时就会被误判成「被墙」。
    const mustNotMatch = [
      // 开发者平台：GitHub 主站可用（只有 Pages / Workers 受限，已单独列出）
      'github.com', 'api.github.com', 'raw.githubusercontent.com',
      'gitlab.com', 'stackoverflow.com', 'npmjs.com',
      // 云与 CDN：间歇性，不等于封锁
      'cloudflare.com', 'workers.cloudflare.com',
      'amazon.com', 'aws.amazon.com', 'microsoft.com',
      // 正常可用的境外服务
      'apple.com', 'icloud.com', 'bing.com', 'linkedin.com',
      'office.com', 'outlook.com', 'zoom.us',
      'paypal.com', 'slack.com', 'canva.com', 'notion.so',
      'figma.com', 'netflix.com', 'spotify.com', 'wordpress.org',
      // openai.com 是间歇性（chatgpt.com 才是确定封锁）
      'openai.com',
      // 国内站点绝不能误判
      'baidu.com', 'qq.com', 'bilibili.com', 'zhihu.com',
      'weibo.com', 'taobao.com', 'aliyun.com', 'csdn.net',
    ]
    it.each(mustNotMatch)('%s 不判为已知受限', (h) => {
      expect(isKnownGfwHost(h)).toBe(false)
    })
  })

  describe('匹配边界', () => {
    it('只按域名边界匹配，不做子串匹配', () => {
      expect(isKnownGfwHost('notgoogle.com')).toBe(false)
      expect(isKnownGfwHost('google.com.evil.example')).toBe(false)
      expect(isKnownGfwHost('fake-t.co')).toBe(false)
    })

    it('子域正确继承（a.b.google.com 命中，googleusercontent 命中）', () => {
      expect(isKnownGfwHost('a.b.google.com')).toBe(true)
      expect(isKnownGfwHost('lh3.googleusercontent.com')).toBe(true)
    })

    it('大小写不敏感', () => {
      expect(isKnownGfwHost('WWW.GOOGLE.COM')).toBe(true)
    })

    it('容忍端口号', () => {
      expect(isKnownGfwHost('google.com:443')).toBe(true)
    })

    it('空值安全（不抛错）', () => {
      expect(isKnownGfwHost('')).toBe(false)
      expect(isKnownGfwHost(undefined as unknown as string)).toBe(false)
    })
  })
})

/**
 * 名单是**地域性先验**：只在墙内成立。
 * 墙外用户（含开代理者）把 google.com 收进书签时，绝不能因为服务端在上海超时
 * 就被判成「被墙」。这一组用例锁住这条边界。
 */
describe('名单的地域边界（墙内 / 墙外）', () => {
  const edge = (outcome: EdgeEvidence['fetch_outcome'], status = 0): EdgeEvidence => ({
    fetch_outcome: outcome,
    http_status: status,
  })
  const GOOGLE = 'https://www.google.com/'
  const NORMAL = 'https://example.com/'

  it('墙内 + 名单命中 + 双端都不可达 → 判被墙', () => {
    const r = decide(edge('connect_error'), { reachable: false }, 'online', GOOGLE, true)
    expect(r.verdict).toBe('gfw')
    expect(r.persist).toBe(true)
  })

  it('墙外 + 名单命中 + 双端都不可达 → 判死链而不是被墙', () => {
    // 墙外用户遇到 google.com 连不上，是真的连不上，不该归因为「被墙」
    const r = decide(edge('connect_error'), { reachable: false }, 'online', GOOGLE, false)
    expect(r.verdict).toBe('dead')
  })

  it('墙外 + 名单命中 + 超时 + 本机也不可达 → 判不确定而非被墙', () => {
    const r = decide(edge('timeout'), { reachable: false }, 'online', GOOGLE, false)
    expect(r.verdict).toBe('inconclusive')
  })

  it('墙外 + Edge 无响应 + 本机不可达 → 判不确定', () => {
    const r = decide(edge(null), { reachable: false }, 'online', GOOGLE, false)
    expect(r.verdict).toBe('inconclusive')
  })

  it('本机可达时，服务端超时不再判「不确定」，直接判活', () => {
    // 服务端在上海访问境外站必然超时，但用户自己打得开 —— 告诉他「不确定」纯属干扰
    const r = decide(edge('timeout'), { reachable: true }, 'online', NORMAL, true)
    expect(r.verdict).toBe('alive')
    expect(r.persist).toBe(true)
  })

  it('本机可达时，服务端连接失败也判活', () => {
    const r = decide(edge('connect_error'), { reachable: true }, 'online', NORMAL, true)
    expect(r.verdict).toBe('alive')
  })

  it('名单不生效时，普通站点的原有判定不受影响', () => {
    // 回归保护：非名单站点在墙外、双端不可达时仍然是 dead
    const r = decide(edge('connect_error'), { reachable: false }, 'online', NORMAL, false)
    expect(r.verdict).toBe('dead')
  })

  it('默认参数保持原有行为（向后兼容）', () => {
    // 不传第 5 参 → restrictedNetwork 默认 true（墙内）
    const r = decide(edge('connect_error'), { reachable: false }, 'online', GOOGLE)
    expect(r.verdict).toBe('gfw')
  })

  it('本机离线时一切都不落标（不受名单影响）', () => {
    const r = decide(edge('connect_error'), { reachable: false }, 'offline', GOOGLE, true)
    expect(r.verdict).toBe('inconclusive')
    expect(r.persist).toBe(false)
  })
})
