/**
 * parseBackup 纯函数测（BG-9 复现回归测）。
 *
 * 锁 parseBackup 容错语义：解析成功返回 { ok:true, data }，
 * 失败返回 { ok:false, error } 且不抛错。覆盖正常备份 / 空文件 /
 * 半截 JSON（写一半被 kill 留下的损坏文件）/ 非对象根 / array 根。
 *
 * 另测「backup list 多含一损坏」场景的 list 路径消费语义：
 * 用 parseBackup 对 5 个备份内容（含 1 个半截）跑出 5 行，
 * 损坏行走 ok:false 给出 corrupt 标记、其余 4 行 ok:true 正常产出，
 * 验证修复后单损坏文件不再让整表全断（与旧实现 JSON.parse 全抛对比）。
 */
import { describe, it, expect } from 'vitest'
import { parseBackup } from '../lib/backupParse.js'

describe('parseBackup — BG-9 容错语义', () => {
  it('正常备份 JSON 解析返回 ok:true + data', () => {
    const content = JSON.stringify({
      version: '1.0.0',
      createdAt: '2026-08-11T00:00:00.000Z',
      userId: 'u1',
      bookmarks: [{ id: 'b1' }, { id: 'b2' }],
      siblingGroups: [{ id: 'g1' }],
      categories: [{ id: 'c1' }],
    })
    const r = parseBackup(content)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.bookmarks?.length).toBe(2)
      expect(r.data.siblingGroups?.length).toBe(1)
      expect(r.data.createdAt).toBe('2026-08-11T00:00:00.000Z')
    }
  })

  it('空文件返回 ok:false 不抛错', () => {
    const r = parseBackup('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('空文件')
  })

  it('半截 JSON（写一半被 kill 致损坏）返回 ok:false 不抛错', () => {
    // 模拟 fs.writeFileSync 在写 categories 数组中途被 kill 留下的半截 JSON
    const half = '{"version":"1.0.0","createdAt":"2026-08-11T00:00:00.000Z","bookmarks":[{"id":"b1","title":"部'
    const r = parseBackup(half)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('开头片段')
  })

  it('非法 JSON（裸文本非 JSON）返回 ok:false 不抛错', () => {
    const r = parseBackup('这不是 JSON')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
  })

  it('根节点非对象（裸 number）拒绝', () => {
    const r = parseBackup('42')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是 JSON 对象')
  })

  it('根节点非对象（array）拒绝', () => {
    const r = parseBackup('[1,2,3]')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是 JSON 对象')
  })

  it('根节点 null 拒绝', () => {
    const r = parseBackup('null')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是 JSON 对象')
  })

  it('最小备份对象（仅 version）解析返回 ok:true', () => {
    const r = parseBackup('{"version":"1.0.0"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.version).toBe('1.0.0')
  })
})

describe('parseBackup — BG-9 list 路径消费（多备份含一损坏不全断）', () => {
  it('5 个备份含 1 个半截损坏：4 行正常列 + 1 行标 corrupt，整表不全断', () => {
    const contents = [
      JSON.stringify({ createdAt: '2026-08-01T00:00:00Z', bookmarks: [{ id: 'b1' }, { id: 'b2' }], siblingGroups: [] }),
      JSON.stringify({ createdAt: '2026-08-02T00:00:00Z', bookmarks: [{ id: 'b3' }], siblingGroups: [] }),
      '{"version":"1.0.0","createdAt":"2026-08-03T00:00:00Z","bookmarks":[{"id":"b4","title":"部', // 半截损坏
      JSON.stringify({ createdAt: '2026-08-04T00:00:00Z', bookmarks: [], siblingGroups: [{ id: 'g1' }] }),
      JSON.stringify({ createdAt: '2026-08-05T00:00:00Z', bookmarks: [{ id: 'b5' }], siblingGroups: [] }),
    ]
    const results = contents.map((c) => parseBackup(c))
    // 旧实现 5 个 JSON.parse 串行抛错致整表全断；新实现容错 5 行全产出
    expect(results).toHaveLength(5)
    const ok = results.filter((r) => r.ok)
    const bad = results.filter((r) => !r.ok)
    expect(ok).toHaveLength(4)
    expect(bad).toHaveLength(1)
    if (!bad[0].ok) expect(bad[0].error).toContain('开头片段')
    // 正常行的 bookmarks 各自长度正确（未被损坏文件影响）
    if (ok[0].ok) expect(ok[0].data.bookmarks?.length).toBe(2)
    if (ok[1].ok) expect(ok[1].data.bookmarks?.length).toBe(1)
    if (ok[2].ok) expect(ok[2].data.siblingGroups?.length).toBe(1)
    if (ok[3].ok) expect(ok[3].data.bookmarks?.length).toBe(1)
  })

  it('全部 5 个损坏：整表标 5 行 corrupt 不抛错退出', () => {
    const contents = ['', 'xxx', '{半截', '42', 'null']
    const results = contents.map((c) => parseBackup(c))
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(results).toHaveLength(5)
  })
})
