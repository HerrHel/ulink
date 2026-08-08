import { describe, it, expect, vi } from 'vitest'
import { esc, domain, fixUrl, cleanZeroWidth, isMobile, favicon, gid, copyToClipboard, getTagNames, safeIconUrl, isValidShareGroupId } from '../utils.js'
import { safeAtob } from '../crypto.js'

describe('utils', () => {
  describe('esc', () => {
    it('should escape HTML entities', () => {
      expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })
    it('should pass through normal text and empty string (透传/空串边界)', () => {
      expect(esc('hello world')).toBe('hello world')
      expect(esc('')).toBe('')
    })
    it('should escape double quotes (S1: attribute-context safe)', () => {
      expect(esc('"hello"')).toBe('&quot;hello&quot;')
    })
    it('should escape single quotes (S1: attribute-context safe)', () => {
      expect(esc("'hello'")).toBe('&#39;hello&#39;')
    })
    it('should escape an attribute-injection XSS payload (S1)', () => {
      // payload 意在闭合 src="..." 后注入 onerror；esc 必须转义 " 使其无法闭合属性
      const payload = 'x" onerror="alert(1)'
      const out = esc(payload)
      expect(out).toBe('x&quot; onerror=&quot;alert(1)')
      expect(out).not.toContain('"')
    })
    it('should escape angle brackets and ampersand together', () => {
      expect(esc('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;')
    })
  })

  describe('domain', () => {
    it('should extract domain from URL', () => {
      expect(domain('https://www.example.com/path')).toBe('example.com')
    })
    it('should handle URLs without www', () => {
      expect(domain('https://example.com')).toBe('example.com')
    })
    it('should return original string for invalid URLs', () => {
      expect(domain('not-a-url')).toBe('not-a-url')
    })
  })

  describe('fixUrl', () => {
    it('should add https:// if missing', () => {
      expect(fixUrl('example.com')).toBe('https://example.com')
    })
    it('should not modify URLs with http:// or https:// (startsWith 对称守卫)', () => {
      expect(fixUrl('http://example.com')).toBe('http://example.com')
      expect(fixUrl('https://example.com')).toBe('https://example.com')
    })
    it('should handle empty string', () => {
      expect(fixUrl('')).toBe('')
    })
    it('should trim whitespace', () => {
      expect(fixUrl('  example.com  ')).toBe('https://example.com')
    })
    // S1：危险 scheme 一律返回空串，杜绝 javascript:alert(1) 等跨用户 XSS
    it('should reject javascript: scheme (S1)', () => {
      expect(fixUrl('javascript:alert(1)')).toBe('')
    })
    it('should reject data: scheme (S1)', () => {
      expect(fixUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    })
    it('should reject vbscript: scheme (S1)', () => {
      expect(fixUrl('vbscript:msgbox(1)')).toBe('')
    })
    it('should reject mixed-case JAVASCRIPT: scheme (S1)', () => {
      expect(fixUrl('JaVaScRiPt:alert(1)')).toBe('')
    })
    it('should reject scheme with leading whitespace (S1)', () => {
      expect(fixUrl('  javascript:alert(1)  ')).toBe('')
    })
  })

  describe('safeAtob', () => {
    it('should decode base64', () => {
      expect(safeAtob(btoa('hello'))).toBe('hello')
    })
    it('should return original string for invalid base64', () => {
      expect(safeAtob('not-base64!@#')).toBe('not-base64!@#')
    })
  })

  describe('cleanZeroWidth', () => {
    it('should remove consecutive zero-width characters', () => {
      const input = 'hello\u200B\u200Bworld'
      const result = cleanZeroWidth(input)
      expect(result).toBe('hello\u200Bworld')
    })
    it('should not modify text without zero-width chars', () => {
      expect(cleanZeroWidth('hello world')).toBe('hello world')
    })
  })

  describe('favicon', () => {
    it('should return custom icon if provided', () => {
      expect(favicon('https://example.com', 'custom.png')).toBe('custom.png')
    })
    it('should return favicon URL for valid domain', () => {
      const result = favicon('https://example.com')
      expect(result).toContain('example.com')
    })
    it('should handle empty URL', () => {
      const result = favicon('')
      expect(result).toBe('')
    })
  })

  // A5-006：自定义 icon 白名单——锁住 javascript:/data:/vbscript: 等 XSS scheme 拒绝回归
  describe('safeIconUrl', () => {
    it('放行 http(s) 绝对 URL（保留原值）', () => {
      expect(safeIconUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
      expect(safeIconUrl('http://example.com/a.png')).toBe('http://example.com/a.png')
    })
    it('放行大小写混合的 http(s) scheme', () => {
      expect(safeIconUrl('HTTPS://example.com/a.png')).toBe('HTTPS://example.com/a.png')
      expect(safeIconUrl('HtTpS://x.io/i.svg')).toBe('HtTpS://x.io/i.svg')
    })
    it('放行相对路径：/path、./x、../x', () => {
      expect(safeIconUrl('/icons/a.svg')).toBe('/icons/a.svg')
      expect(safeIconUrl('./custom.png')).toBe('./custom.png')
      expect(safeIconUrl('../img/x.svg')).toBe('../img/x.svg')
    })
    it('放行无 scheme 的相对资源名（custom.png、icons/a.svg）', () => {
      expect(safeIconUrl('custom.png')).toBe('custom.png')
      expect(safeIconUrl('icons/a.svg')).toBe('icons/a.svg')
    })
    it('拒绝 javascript: scheme（XSS 防御核心）', () => {
      expect(safeIconUrl('javascript:alert(1)')).toBe('')
      expect(safeIconUrl('JavaScript:alert(1)')).toBe('')
      expect(safeIconUrl(' javascript:alert(1)')).toBe('')
    })
    it('拒绝 data: / vbscript: scheme', () => {
      expect(safeIconUrl('data:image/svg+xml,<svg/onload=alert(1)>')).toBe('')
      expect(safeIconUrl('vbscript:msgbox(1)')).toBe('')
    })
    it('拒绝其它带 scheme 的形态（file:、blob: 等）', () => {
      expect(safeIconUrl('file:///etc/passwd')).toBe('')
      expect(safeIconUrl('blob:http://x/abc')).toBe('')
    })
    it('空 / 纯空白 / null / undefined 返回空串', () => {
      expect(safeIconUrl('')).toBe('')
      expect(safeIconUrl('   ')).toBe('')
      expect(safeIconUrl(null as unknown as undefined)).toBe('')
      expect(safeIconUrl(undefined)).toBe('')
    })
    it('trim 后判定（前后空白不影响 scheme 识别）', () => {
      expect(safeIconUrl('  /icons/a.svg  ')).toBe('/icons/a.svg')
      expect(safeIconUrl('  https://example.com/a.png  ')).toBe('https://example.com/a.png')
      expect(safeIconUrl('  javascript:alert(1)  ')).toBe('')
    })
  })

  // 分享组 id 白名单：[A-Za-z0-9_-] 长度 2–64
  describe('isValidShareGroupId', () => {
    it('合法：字母数字下划线短横、长度 2–64', () => {
      expect(isValidShareGroupId('sg_welcome')).toBe(true)
      expect(isValidShareGroupId('g' + 'x'.repeat(10))).toBe(true)
      expect(isValidShareGroupId('ab')).toBe(true)
      expect(isValidShareGroupId('A-B_C.')).toBe(false) // 点非法
      expect(isValidShareGroupId('_-ok')).toBe(true)
    })
    it('长度边界 1 拒绝（最小 2）', () => {
      expect(isValidShareGroupId('a')).toBe(false)
    })
    it('长度边界 64 合法、65 拒绝', () => {
      const s64 = 'a'.repeat(64)
      expect(isValidShareGroupId(s64)).toBe(true)
      expect(isValidShareGroupId(s64 + 'a')).toBe(false)
    })
    it('空串拒绝', () => {
      expect(isValidShareGroupId('')).toBe(false)
    })
    it('null / undefined 拒绝（类型守卫）', () => {
      expect(isValidShareGroupId(null)).toBe(false)
      expect(isValidShareGroupId(undefined)).toBe(false)
    })
    it('非法字符拒绝：空格 / 点 / 斜杠 / 中文', () => {
      expect(isValidShareGroupId('ab cd')).toBe(false)
      expect(isValidShareGroupId('ab.cd')).toBe(false)
      expect(isValidShareGroupId('ab/cd')).toBe(false)
      expect(isValidShareGroupId('分组abc')).toBe(false)
    })
  })

  describe('gid', () => {
    it('should generate a string ID', () => {
      const id = gid()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })
    it('should generate unique IDs', () => {
      const id1 = gid()
      const id2 = gid()
      expect(id1).not.toBe(id2)
    })
  })

  describe('isMobile', () => {
    it('should return boolean', () => {
      const result = isMobile()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('copyToClipboard', () => {
    it('should call navigator.clipboard.writeText', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
      })
      copyToClipboard('test text', 'Label')
      expect(writeText).toHaveBeenCalledWith('test text')
    })
  })

  describe('getTagNames', () => {
    const attrs = [
      { id: 't1', name: '标签一', type: 'boolean' as const },
      { id: 't2', name: '标签二', type: 'boolean' as const },
      { id: 'is-group', name: '内置组', type: 'boolean' as const },
      { id: 't3', name: '已软删', type: 'boolean' as const, deletedAt: 1 },
    ]
    it('仅收集属性为 true 且非内置组、未软删的名字', () => {
      const item = { attributes: { t1: true, t2: false, 'is-group': true, t3: true } } as any
      expect(getTagNames(item, attrs as any)).toEqual(['标签一'])
    })
    it('无 attributes 返回空数组', () => {
      expect(getTagNames({ attributes: null } as any, attrs as any)).toEqual([])
    })
    // 以下护栏拆单分支断言：现有两个 it 把 !deletedAt / id!==ATTR_IS_GROUP / attributes[id] truthy
    // 三 filter 条件短路复合进单断言且全用 boolean true/false，若误把收取条件改成 ===true
    // 对现有 toEqual 静默通过，但运行时 attributes 经 sync/import 流入 number/string/对象 truthy
    // 会被新逻辑误漏且无护栏告警——补测逐分支锁真实隐式 truthy 收取语义。
    it('ATTR_IS_GROUP 内置组单独排除（不被 truthy 收取分支误代）', () => {
      const item = { attributes: { 'is-group': true, t1: true } } as any
      expect(getTagNames(item, attrs as any)).toEqual(['标签一'])
    })
    it('软删属性单独排除（不被内置组排除分支误代）', () => {
      const item = { attributes: { t3: true, t1: true } } as any
      expect(getTagNames(item, attrs as any)).toEqual(['标签一'])
    })
    it('attributes 值隐式 truthy 即收取（非严格 ===true）— number/string/对象均收', () => {
      const item = {
        attributes: { t1: 1, t2: 'any-string', 'is-group': 'group-on', t3: true },
      } as any
      // t3 软删与 is-group 内置组仍被排除，仅 t1(number 1)/t2(string) truthy 收取
      expect(getTagNames(item, attrs as any)).toEqual(['标签一', '标签二'])
    })
    it('attributes 值 falsy 不收取 — 0/false/空串/null/undefined', () => {
      const item = {
        attributes: { t1: 0, t2: false, 'is-group': true, t3: true },
      } as any
      // t1(0)/t2(false) falsy 不收；is-group 排除；t3 软删排除 → 空
      expect(getTagNames(item, attrs as any)).toEqual([])
    })
    it('attributes 为空对象返回空数组；customAttributes 为空数组返回空数组', () => {
      expect(getTagNames({ attributes: {} } as any, attrs as any)).toEqual([])
      expect(getTagNames({ attributes: { t1: true } } as any, [] as any)).toEqual([])
    })
    it('属性缺 name 时 map 返回 undefined（直锁真实行为，防未来误改为跳过缺 name）', () => {
      const attrsNoName = [
        { id: 't1', type: 'boolean' as const },
        { id: 't2', name: '标签二', type: 'boolean' as const },
      ] as any
      const item = { attributes: { t1: true, t2: true } } as any
      // 源码 .map(a => a.name) 不跳过缺 name，t1 无 name→undefined 进数组
      expect(getTagNames(item, attrsNoName)).toEqual([undefined, '标签二'])
    })
  })
})
