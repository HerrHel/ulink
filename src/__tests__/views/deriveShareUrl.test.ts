/**
 * R10 — ShareView.shareUrl 推导纯函数护栏（抽 deriveShareUrl 后直测）。
 *
 * bug 背景（R10 真 bug）：旧实现 `_applyShareHead` 内联正则 `/\/[^/]*$/` 只剥
 * location.pathname 末段。但 ShareView 子路由活跃时 pathname 形如「<部署前缀>/s/<gid>」，
 * 旧正则只剥 `<gid>` 残留「<部署前缀>/s/」，再拼一遍 `s/<gid>` 产生
 * 「<部署前缀>/s/s/<gid>」双段错误 URL，污染 canonical/og:url/twitter:url/JSON-LD url
 * 全部指向不存在的路径。修复：抽 deriveShareUrl 先剥整段 `/s/<gid>` 再拼回。
 */
import { describe, it, expect } from 'vitest'
import { deriveShareUrl } from '../../views/deriveShareUrl.js'

describe('deriveShareUrl — ShareView shareUrl 推导（锁不产双 /s/）', () => {
  describe('子路由态（pathname 含 /s/<gid>）——剥整段 /s/<gid> 而非仅末段', () => {
    it('单段部署前缀剥整段 /s/<gid> 得正确 URL（bug 回归主场景）', () => {
      // 旧正则 `/\/[^/]*$/` 只剥 `<gid>` → 残留 `/linkvault/s/` → 拼 `/linkvault/s/s/g123` 双 s 错
      expect(deriveShareUrl('/linkvault/s/g123', 'https://example.com', 'g123')).toBe(
        'https://example.com/linkvault/s/g123#share/g123',
      )
    })

    it('多段部署前缀同样只剥 /s/<gid> 整段', () => {
      expect(deriveShareUrl('/a/b/s/g123', 'https://example.com', 'g123')).toBe(
        'https://example.com/a/b/s/g123#share/g123',
      )
    })

    it('部署前缀含尾斜杠时拼回不叠斜杠', () => {
      expect(deriveShareUrl('/linkvault/s/g123', 'https://example.com', 'g123')).toBe(
        'https://example.com/linkvault/s/g123#share/g123',
      )
    })

    it('origin 带端口时透传', () => {
      expect(deriveShareUrl('/s/g123', 'https://example.com:8080', 'g123')).toBe(
        'https://example.com:8080/s/g123#share/g123',
      )
    })
  })

  describe('根部署 / 异常 pathname 兜底', () => {
    it('根部署剥成根斜杠 / 再拼回', () => {
      expect(deriveShareUrl('/s/g123', 'https://example.com', 'g123')).toBe(
        'https://example.com/s/g123#share/g123',
      )
    })

    it('pathname 不含 /s/ 段时原样作为前缀拼回（异常态兜底）', () => {
      expect(deriveShareUrl('/', 'https://example.com', 'g123')).toBe(
        'https://example.com/s/g123#share/g123',
      )
    })

    it('空 pathname 经 || "/" 兜底成根路径', () => {
      expect(deriveShareUrl('', 'https://example.com', 'g123')).toBe(
        'https://example.com/s/g123#share/g123',
      )
    })
  })

  describe('回归锁：绝不产双 /s/（bug 本体直锁）', () => {
    const CASES: Array<[string, string, string]> = [
      ['/linkvault/s/g123', 'https://example.com', 'g123'],
      ['/a/b/s/g123', 'https://example.com', 'g123'],
      ['/s/g123', 'https://example.com', 'g123'],
      ['/', 'https://example.com', 'g123'],
    ]

    for (const [pathname, origin, gid] of CASES) {
      it(`pathname="${pathname}" 结果不含 /s/s/ 双段`, () => {
        const url = deriveShareUrl(pathname, origin, gid)
        expect(url).not.toContain('/s/s/')
        expect(url).toContain(`/s/${gid}#share/${gid}`)
      })
    }

    it('结果以正确的 #share/<gid> 锚结尾', () => {
      const url = deriveShareUrl('/linkvault/s/g123', 'https://example.com', 'g123')
      expect(url.endsWith('#share/g123')).toBe(true)
    })
  })

  describe('纯函数不变量', () => {
    it('同入参多次调用返回值恒等（无隐状态）', () => {
      const a = deriveShareUrl('/linkvault/s/g123', 'https://example.com', 'g123')
      const b = deriveShareUrl('/linkvault/s/g123', 'https://example.com', 'g123')
      const c = deriveShareUrl('/linkvault/s/g123', 'https://example.com', 'g123')
      expect(a).toBe(b)
      expect(b).toBe(c)
    })
  })
})
