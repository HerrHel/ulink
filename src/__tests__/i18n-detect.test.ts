/**
 * 初始语言推断单测（i18n.detect）
 *
 * 为什么值得锁：线上曾出现「本地中文、线上全英文」——根因不是缺翻译
 * （130 个 settings.* key 在 zh 里齐全），而是首次访问无 localStorage 时
 * 只看 `navigator.language`，而国内常见「英文系统/英文浏览器 + 中文使用习惯」。
 *
 * 现在的优先级：localStorage（用户意志）> 浏览器语言 zh* > **中国时区** > 英文。
 * 本测试覆盖每条分支，尤其「英文浏览器 + 中国时区 → 中文」这条兜底。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** 每次重新加载模块，让顶层 `ref(detect())` 重新执行 */
async function freshDetect() {
  vi.resetModules()
  const mod = await import('../i18n/index.js')
  return mod.detect
}

describe('i18n 初始语言推断', () => {
  let storage: Storage

  beforeEach(() => {
    storage = window.localStorage
    storage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function setBrowser(language: string, timeZone: string) {
    vi.stubGlobal('navigator', { language })
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone,
    } as Intl.ResolvedDateTimeFormatOptions)
  }

  it('localStorage 里的显式选择优先级最高（中文）', async () => {
    storage.setItem('lv_locale', 'zh-CN')
    setBrowser('en-US', 'America/New_York')
    const detect = await freshDetect()
    expect(detect()).toBe('zh-CN')
  })

  it('localStorage 显式选英文时，不被中国时区覆盖（尊重用户意志）', async () => {
    storage.setItem('lv_locale', 'en-US')
    setBrowser('zh-CN', 'Asia/Shanghai')
    const detect = await freshDetect()
    expect(detect()).toBe('en-US')
  })

  it('无记录 + 浏览器语言中文 → 中文', async () => {
    setBrowser('zh-CN', 'America/New_York')
    const detect = await freshDetect()
    expect(detect()).toBe('zh-CN')
  })

  it('无记录 + 浏览器语言中文（zh-TW）→ 中文', async () => {
    setBrowser('zh-TW', 'Asia/Taipei')
    const detect = await freshDetect()
    expect(detect()).toBe('zh-CN')
  })

  it('⭐ 无记录 + 英文浏览器 + 中国时区 → 中文（本次修复的核心场景）', async () => {
    setBrowser('en-US', 'Asia/Shanghai')
    const detect = await freshDetect()
    expect(detect()).toBe('zh-CN')
  })

  it('无记录 + 英文浏览器 + 中国其他时区 → 中文', async () => {
    for (const tz of ['Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi']) {
      setBrowser('en-US', tz)
      const detect = await freshDetect()
      expect(detect()).toBe('zh-CN')
    }
  })

  it('无记录 + 英文浏览器 + 境外时区 → 英文（不误伤海外用户）', async () => {
    setBrowser('en-US', 'America/New_York')
    const detect = await freshDetect()
    expect(detect()).toBe('en-US')
  })

  it('无记录 + 日文浏览器 + 境外时区 → 英文', async () => {
    setBrowser('ja-JP', 'Asia/Tokyo')
    const detect = await freshDetect()
    expect(detect()).toBe('en-US')
  })

  it('Intl 不可用时不抛错，退回英文', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('Intl unavailable')
    })
    const detect = await freshDetect()
    expect(() => detect()).not.toThrow()
    expect(detect()).toBe('en-US')
  })
})
