import { describe, it, expect } from 'vitest'
import { extractHostname } from '../../components/overlays/extractHostname.js'
import { domain } from '../../utils.js'

/**
 * CommandPalette.extractHostname 护栏：命令面板书签项右侧灰字 hint 展示什么 hostname 的承载逻辑。
 * 真纯函数（仅依赖入参，new URL 是 Web API 纯解析），抽自 CommandPalette.vue `filtered` computed 内 IIFE（逐字保留零行为变化）。
 * 锁定「无 scheme 补 https / 成功去 www / 失败或空入参返空串」契约，并直锁与 utils.domain() 的真实行为差异防误改。
 */

describe('extractHostname — 命令面板书签 hint hostname', () => {
  describe('有 scheme 正路径', () => {
    it('http(s) url 直接取 hostname 去 www', () => {
      expect(extractHostname('https://www.example.com/path?q=1')).toBe('example.com')
    })
    it('http url 同样取 hostname 去 www', () => {
      expect(extractHostname('http://www.example.com')).toBe('example.com')
    })
    it('已无 www 前缀原样保留 hostname', () => {
      expect(extractHostname('https://example.com/x')).toBe('example.com')
    })
    it('仅去单个 www 前缀不去其它子域', () => {
      expect(extractHostname('https://api.www.example.com')).toBe('api.www.example.com')
    })
    it('端口号不进 hostname（WHATWG URL 把端口放进 .port 而非 .hostname）', () => {
      expect(extractHostname('https://localhost:3000/x')).toBe('localhost')
    })
    it('带密码/查询/锚点的 url 只取 hostname', () => {
      expect(extractHostname('https://user:pass@host.io/a?b=c#d')).toBe('host.io')
    })
  })

  describe('无 scheme 补 https:// 前缀分支', () => {
    it('无 scheme 纯域名补前缀解析成功', () => {
      expect(extractHostname('example.com')).toBe('example.com')
    })
    it('无 scheme 带 path 补前缀取 hostname', () => {
      expect(extractHostname('example.com/a/b')).toBe('example.com')
    })
    it('无 scheme 带端口 补前缀解析端口保留', () => {
      // localhost:3000 在 domain() 抛错返原串，本函数补 https 后返 hostname「localhost」——真实差异
      expect(extractHostname('localhost:3000/x')).toBe('localhost')
    })
    it('无 scheme 以非 http 大写开头仍补 https', () => {
      // startsWith('http') 区分大小写，大写 HTTP 不被识别所以补 https://
      expect(extractHostname('EXAMPLE.com')).toBe('example.com')
    })
  })

  describe('失败/边界入参返空串', () => {
    it('空串入参返空串', () => {
      expect(extractHostname('')).toBe('')
    })
    it('null 入参返空串', () => {
      expect(extractHostname(null)).toBe('')
    })
    it('undefined 入参返空串', () => {
      expect(extractHostname(undefined)).toBe('')
    })
    it('纯空格 url 不补 scheme 解析失败返空串', () => {
      // ' '_startsWith('http')=false → 'https://' + ' '；new URL('https:// ') 空格非法抛错 → catch 返 ''
      expect(extractHostname(' ')).toBe('')
    })
    it('仅 scheme 无 host 解析失败返空串', () => {
      expect(extractHostname('https://')).toBe('')
    })
    it('无法构成合法 URL 的串返空串', () => {
      // '://x' startsWith('http') false → 'https://://x' new URL 抛错 → ''
      expect(extractHostname('://x')).toBe('')
    })
  })

  describe('纯函数无副作用', () => {
    it('同入参多次调用结果一致', () => {
      const a = extractHostname('https://www.example.com/a')
      const b = extractHostname('https://www.example.com/a')
      expect(a).toBe(b)
    })
    it('返回值恒为 string 类型', () => {
      const cases = ['https://x', 'x', '', null, undefined, '://bad', 'localhost:80/y']
      cases.forEach((c) => {
        expect(typeof extractHostname(c as string)).toBe('string')
      })
    })
  })

  describe('与 utils.domain() 的真实行为差异（防误改互替换）', () => {
    it('带端口无 scheme url：WHATWG 把 localhost 当 scheme 解析成功 hostname 空，domain 返空串；本函数补前缀后 localhost 当 host 返 hostname', () => {
      // 实测真实行为：new URL('localhost:3000/x') 不抛错而是 hostname='' → domain 走 try 返 ''
      // 本函数补 'https://' 后 new URL('https://localhost:3000/x').hostname = 'localhost'
      expect(domain('localhost:3000/x')).toBe('')
      expect(extractHostname('localhost:3000/x')).toBe('localhost')
      expect(extractHostname('localhost:3000/x')).not.toBe(domain('localhost:3000/x'))
    })
    it('带端口无 scheme 且无 path：差异同上（localhost:3000 → 本函数 localhost，domain 空串）', () => {
      expect(domain('localhost:3000')).toBe('')
      expect(extractHostname('localhost:3000')).toBe('localhost')
    })
    it('纯无 : 域名（无 scheme）：domain 抛错走 catch 返原串，本函数补前缀返 hostname（碰巧同串但路径不同）', () => {
      expect(domain('example.com')).toBe('example.com')
      expect(extractHostname('example.com')).toBe('example.com')
    })
    it('纯无 : 主机名：domain 抛错返原串，本函数补前缀解析返 hostname（碰巧同串路径不同）', () => {
      expect(domain('localhost')).toBe('localhost')
      expect(extractHostname('localhost')).toBe('localhost')
    })
    it('无 www 的 https url：两者结果一致', () => {
      expect(domain('https://example.com/x')).toBe('example.com')
      expect(extractHostname('https://example.com/x')).toBe('example.com')
    })
    it('看似 scheme 的伪串（foo:bar）：domain 解析成功 hostname 空返空串，本函数补前缀后取 hostname', () => {
      // new URL('foo:bar') 解析成功 hostname='' → domain 返 ''; 本函数补 https → 'https://foo:bar' 抛错 → ''
      expect(domain('foo:bar')).toBe('')
      expect(extractHostname('foo:bar')).toBe('')
    })
  })
})
