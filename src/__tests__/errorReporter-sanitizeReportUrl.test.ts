import { describe, it, expect } from 'vitest'
import { sanitizeReportUrl } from '../lib/errorReporter.js'

/**
 * D1-102 锚定 sanitizeReportUrl（errorReporter.ts，H8 入云 error_logs 唯一 URL 脱敏点）的
 * 「既有 4 用例漏测的真实分支」为可回归断言。
 *
 * 源逻辑逐字回顾（errorReporter.ts:31-44）：
 *   if (!raw) return ''                       // falsy 短路
 *   try {
 *     if (/^https?:\/\//i.test(raw)) {         // 大小写不敏感 http(s):// 前缀
 *       const u = new URL(raw)
 *       return u.origin + u.pathname            // 只留 origin+pathname，丢弃 search/hash
 *     }
 *   } catch { fall-through }                   // new URL 抛（裸 catch 体仅注释）→ 走兜底
 *   return raw.split('#')[0].split('?')[0].slice(0, 2048)  // 兜底：先 # 再 ? 再截 2048
 *
 * 既有 4 用例（errorReporter.test.ts:4-20）只覆盖：①绝对 URL 去 query+hash（1 例）
 *   ②相对路径去 query（/index.html 1 例）③空串 ④无 query 绝对 URL 透传。
 * 本护栏补的是 7 条此前零直测、最易被未来重构误改的真实隐特性：
 *   - 非 http 协议（ftp/ws/data）不进 try，走兜底 split 去 ?# 但保留协议
 *   - 大写 HTTP 前缀命中（/i）且 new URL 规整 origin/hostname 小写、pathname 大小写保留
 *   - catch fall-through：new URL 抛（非法 IPv6 方括号未闭合）时走兜底 split 不抛
 *   - 兜底 split 顺序：split('#') 先于 split('?')（# 在 ? 后时先截短去含 ? 整段）
 *   - slice(0,2048) 兜底截断：超长相对/catch 路径截到 2048；恰好 2049 截 2048
 *   - 绝对 URL 走 new URL 不截断（pathname 无长度上界，slice 只在兜底）
 *   - 纯函数无副作用、返回恒 string、'0' 非空串不短路
 */

describe('sanitizeReportUrl (D1-102 深挖断言浅护栏)', () => {
  it('非 http 协议(ftp)走兜底 split：strip ?# 但保留协议前缀', () => {
    // regex /^https?:\/\// 不匹配 ftp://，故不进 try，走 split 兜底
    expect(sanitizeReportUrl('ftp://host/path?q#f')).toBe('ftp://host/path')
  })

  it('非 http 协议(ws)走兜底 split：strip ?# 保留协议', () => {
    expect(sanitizeReportUrl('ws://host/p?z')).toBe('ws://host/p')
  })

  it('data: 协议走兜底 split：含 <> 的非 URL 串被透传去 ?#', () => {
    // data:text/html,<x> 无 # 无 ?，兜底 split 后原样截 2048
    expect(sanitizeReportUrl('data:text/html,<x>')).toBe('data:text/html,<x>')
  })

  it('大写 HTTP 前缀命中(/i)：new URL 规整 origin 小写 + 去 query/hash', () => {
    // regex /i 大小写不敏感命中 'HTTP://'，new URL 把 origin 规整成小写 http://
    expect(sanitizeReportUrl('HTTP://x.com/a?b#c')).toBe('http://x.com/a')
  })

  it('大写主机名：new URL 规整 hostname 小写但 pathname 大小写保留', () => {
    // origin 的 hostname 被规整为小写 example.com，但 pathname /A 大小写保留
    expect(sanitizeReportUrl('http://EXAMPLE.com/A')).toBe('http://example.com/A')
  })

  it('绝对 URL 含端口：origin 保留端口 + 去 query', () => {
    expect(sanitizeReportUrl('http://x.com:8080/p?z')).toBe('http://x.com:8080/p')
  })

  it('绝对 URL 无 pathname：URL 规整补尾斜杠为 /', () => {
    // http://x.com → origin http://x.com + pathname / → http://x.com/
    expect(sanitizeReportUrl('http://x.com')).toBe('http://x.com/')
  })

  it('绝对 URL 仅 host 无尾斜杠(https)：origin + pathname=/ 规整', () => {
    expect(sanitizeReportUrl('https://x')).toBe('https://x/')
  })

  it('catch fall-through：非法 IPv6 方括号未闭合让 new URL 抛 → 走兜底 split 不抛', () => {
    // https://[invalid 让 new URL 抛 TypeError，catch 捕获后走兜底
    // 兜底 split('#')[0]=原文无#、split('?')[0]=原文无?，slice(0,2048) 原样
    expect(sanitizeReportUrl('https://[invalid')).toBe('https://[invalid')
  })

  it('兜底 split 顺序敏感：# 在 ? 后时先 split(#) 去含 ? 整段再 split(?)', () => {
    // rel?inQ#inHash → split('#')[0]='rel?inQ' → split('?')[0]='rel'
    // 证 # 先于 ? split，先截短使后续 split('?') 摸不到 # 后的 ?
    expect(sanitizeReportUrl('rel?inQ#inHash')).toBe('rel')
  })

  it('兜底 split 顺序敏感：# 在 ? 前时先 split(#) 去整段再 split(?) 验同序', () => {
    // rel#inHash?inQ → split('#')[0]='rel' → split('?')[0]='rel'
    // 与上一用例对照：两种顺序都得 'rel'，但中间路径不同（# 永远先 split）
    expect(sanitizeReportUrl('rel#inHash?inQ')).toBe('rel')
  })

  it('兜底 slice(0,2048) 截断超长相对路径到 2048', () => {
    const long = 'x'.repeat(3000)
    expect(sanitizeReportUrl(long)).toHaveLength(2048)
    // 恰好 2048 不截
    expect(sanitizeReportUrl('y'.repeat(2048))).toHaveLength(2048)
    // 2049 截到 2048（严格 slice 上界开区间）
    expect(sanitizeReportUrl('z'.repeat(2049))).toHaveLength(2048)
  })

  it('绝对 URL 走 new URL 不经 slice 截断：超长 pathname 原样不截 2048', () => {
    // http://x.com/ + 3000p + ?q → new URL 成功，origin+pathname 不经 slice
    // 隐特性：slice(0,2048) 只在兜底分支，绝对 URL pathname 无长度上界
    const out = sanitizeReportUrl('http://x.com/' + 'p'.repeat(3000) + '?q')
    // 'http://x.com'(12) + '/'(1) + 3000p = 3013，证不截断到 2048
    expect(out).toHaveLength(3013)
    // 直接断不含 ? 且超 2048（证未截断）
    expect(out.length).toBeGreaterThan(2048)
    expect(out).not.toContain('?')
  })

  it('纯函数无副作用：同入参恒定 + 返回恒 string + 非空字符串不短路', () => {
    // '0' 是非空字符串，!('0') 为 false 不短路，走 split 兜底返回 '0'
    expect(sanitizeReportUrl('0')).toBe('0')
    // 两次调用同结果（无内部状态 mutate）
    expect(sanitizeReportUrl('https://a.io/p?q#x')).toBe(sanitizeReportUrl('https://a.io/p?q#x'))
    // 返回类型恒 string（对各类入参）
    expect(typeof sanitizeReportUrl('')).toBe('string')
    expect(typeof sanitizeReportUrl('http://a/b')).toBe('string')
    expect(typeof sanitizeReportUrl('ftp://c/d')).toBe('string')
  })
})
