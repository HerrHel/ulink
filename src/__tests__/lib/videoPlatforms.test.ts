/**
 * videoPlatforms.test.ts — 视频平台域名单一真源的域名判定 + 三份副本漂移守卫
 *
 * 真源：src/config/videoPlatforms.json
 * 派生：scripts/video-worker/video-platforms.json（node scripts/build-fn-assets.mjs 复制）
 *
 * 漂移守卫只在副本存在时断言（构建脚本可能尚未生成的干净 checkout 不报红）。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  VIDEO_PLATFORM_HOSTS,
  VIDEO_SHORT_LINK_HOSTS,
  VIDEO_RESOLVER_SHORT_LINK_HOSTS,
  VIDEO_BROWSER_FIRST_HOSTS,
  isVideoPlatformUrl,
  isVideoShortLink,
  containsVideoPlatformUrl,
  hostOf,
} from '../../lib/ai/videoPlatforms.js'
import platformConfig from '../../config/videoPlatforms.json'

const HOST_RE = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/

describe('videoPlatforms — JSON 结构与单一真源', () => {
  it('四个域名清单均非空、全小写且无协议/路径污染', () => {
    for (const list of [VIDEO_PLATFORM_HOSTS, VIDEO_SHORT_LINK_HOSTS, VIDEO_RESOLVER_SHORT_LINK_HOSTS, VIDEO_BROWSER_FIRST_HOSTS]) {
      expect(Array.isArray(list)).toBe(true)
      expect(list.length).toBeGreaterThan(0)
      for (const host of list) {
        expect(host).toBe(host.toLowerCase())
        expect(host).toMatch(HOST_RE)
        expect(host).not.toContain('/')
        expect(host).not.toContain(':')
      }
    }
  })

  it('短链域与浏览器优先域都是从平台主域可覆盖的（子域或同域）', () => {
    const coveredByPlatform = (host: string): boolean =>
      VIDEO_PLATFORM_HOSTS.some((h) => host === h || host.endsWith('.' + h))
    for (const host of VIDEO_SHORT_LINK_HOSTS) expect(coveredByPlatform(host)).toBe(true)
    for (const host of VIDEO_BROWSER_FIRST_HOSTS) expect(coveredByPlatform(host)).toBe(true)
  })

  it('导出的常量与 JSON 真源逐项一致', () => {
    expect([...VIDEO_PLATFORM_HOSTS]).toEqual(platformConfig.videoHosts)
    expect([...VIDEO_SHORT_LINK_HOSTS]).toEqual(platformConfig.videoShortLinkHosts)
    expect([...VIDEO_RESOLVER_SHORT_LINK_HOSTS]).toEqual(platformConfig.resolverShortLinkHosts)
    expect([...VIDEO_BROWSER_FIRST_HOSTS]).toEqual(platformConfig.browserFirstHosts)
  })

  it('漂移守卫：worker / 云函数副本（若已生成）必须与真源完全一致', () => {
    for (const rel of [
      'scripts/video-worker/video-platforms.json',
      'cloudbase/functions/extract-video/video-platforms.json',
    ]) {
      const copyPath = resolve(process.cwd(), rel)
      if (!existsSync(copyPath)) continue
      const copy = JSON.parse(readFileSync(copyPath, 'utf8')) as Record<string, unknown>
      expect(copy.videoHosts, rel).toEqual(platformConfig.videoHosts)
      expect(copy.videoShortLinkHosts, rel).toEqual(platformConfig.videoShortLinkHosts)
      expect(copy.resolverShortLinkHosts, rel).toEqual(platformConfig.resolverShortLinkHosts)
      expect(copy.browserFirstHosts, rel).toEqual(platformConfig.browserFirstHosts)
    }
  })
})

describe('videoPlatforms — 域名判定', () => {
  it('hostOf：去 www 前缀并小写；非法 URL 返回空串', () => {
    expect(hostOf('https://WWW.Bilibili.com/video/BV1')).toBe('bilibili.com')
    expect(hostOf('https://v.douyin.com/abc/')).toBe('v.douyin.com')
    expect(hostOf('not-a-url')).toBe('')
  })

  it('isVideoPlatformUrl：主站/子域/短链全部命中，普通站点与近名仿冒不误判', () => {
    expect(isVideoPlatformUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true)
    expect(isVideoPlatformUrl('https://m.bilibili.com/video/BV1')).toBe(true)
    expect(isVideoPlatformUrl('https://b23.tv/fuBzhYU')).toBe(true)
    expect(isVideoPlatformUrl('https://v.douyin.com/EMhJLA__J9g/')).toBe(true)
    expect(isVideoPlatformUrl('https://www.tiktok.com/@user/video/7123456789')).toBe(true)
    expect(isVideoPlatformUrl('https://vm.tiktok.com/ZMabcdef/')).toBe(true)
    expect(isVideoPlatformUrl('https://www.xiaohongshu.com/explore/64f123')).toBe(true)
    expect(isVideoPlatformUrl('https://xhslink.com/a1b2c3')).toBe(true)
    expect(isVideoPlatformUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isVideoPlatformUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    // 仿冒域 / 站点外链 / 非 URL
    expect(isVideoPlatformUrl('https://evil-b23.tv.example.com/x')).toBe(false)
    expect(isVideoPlatformUrl('https://bilibili.com.evil.example/x')).toBe(false)
    expect(isVideoPlatformUrl('https://example.com/page')).toBe(false)
    expect(isVideoPlatformUrl('not-a-url')).toBe(false)
    expect(isVideoPlatformUrl('')).toBe(false)
  })

  it('isVideoShortLink：只命中分享短链域，主站与仿冒不命中', () => {
    expect(isVideoShortLink('https://b23.tv/fuBzhYU')).toBe(true)
    expect(isVideoShortLink('https://v.douyin.com/abc/')).toBe(true)
    expect(isVideoShortLink('https://vm.tiktok.com/ZMabcdef/')).toBe(true)
    expect(isVideoShortLink('https://www.bilibili.com/video/BV1')).toBe(false)
    expect(isVideoShortLink('https://evil-b23.tv.example.com/x')).toBe(false)
    expect(isVideoShortLink('not-a-url')).toBe(false)
  })

  it('containsVideoPlatformUrl：从自由文本抽链接（含裸域名）判定，无链接句子不误判', () => {
    expect(containsVideoPlatformUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true)
    expect(containsVideoPlatformUrl('【10月最新教程】 https://b23.tv/fuBzhYU总结视频内出现的网站')).toBe(true)
    expect(containsVideoPlatformUrl('看这个 v.douyin.com/iRNBho6/ 挺好')).toBe(true)
    expect(containsVideoPlatformUrl('B站短链 b23.tv/fuBzhYU 帮我看看')).toBe(true)
    expect(containsVideoPlatformUrl('https://example.com/page')).toBe(false)
    expect(containsVideoPlatformUrl('bilibili上有哪些学编程的视频')).toBe(false)
    expect(containsVideoPlatformUrl('帮我找一些做原型设计的工具')).toBe(false)
    expect(containsVideoPlatformUrl('')).toBe(false)
  })
})
