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
import { isKnownGfwHost } from '../../lib/deadLinkDecision.js'

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
