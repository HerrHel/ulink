import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// 同 HistoryPanel.getPreview.test.ts 口径：相对路径 + .js 后缀，esbuild 解析到 .ts
import { formatTime } from '../../components/modals/formatTime.js'

/**
 * C-4 护栏：HistoryPanel.vue 版本历史列表项时间戳相对时间格式化纯函数。
 *
 * 源码（逐字同原内联实现，抽独立模块零行为变化，c1-highlight/c3-getPreview 同口径）：
 *   const d = new Date(iso)
 *   const now = Date.now()
 *   const diff = now - d.getTime()
 *   if (diff < 60000) return '刚刚'
 *   if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
 *   if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
 *   return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
 *
 * 护栏价值：用户可见——版本历史面板每条历史项的「时间」列展示什么相对时间文案（刚刚 / N 分钟前 /
 * N 小时前 / M/D HH:MM 四档）。决定「多条历史版本里用户如何凭时间辨认版本先后、距今多久」这一用户
 * 可见行为。四档阈值边界 + Math.floor 取整 + 月份 +1 + 时分补零此前零直测、靠实现口头维护，任一漂移
 * （如阈值改 `<=`、漏 +1 月份、漏补零、floor 改 ceil/round）会改变历史版本时间展示。
 *
 * 关键隐特性护栏：
 * 1. 四档阈值全用严格 `<`，恰好 60000/3600000/86400000 落到高一档。
 * 2. N 分钟/N 小时用 Math.floor（向下取整），如 diff=119999→1 分钟非 2。
 * 3. M/D HH:MM：月 +1（getTime 返回 0-11）、日原样、时补 2 位 0、分补 2 位 0。
 * 4. time 为未来（diff<0）走「刚刚」分支（负数 < 60000）。
 * 5. 字符串 ISO 经 new Date 解析后取本地时间 getMonth/getDate/getHours/getMinutes（依赖运行时区），
 *    M/D HH:MM 档测试用本地时间构造的 Date 验证而非硬编码 ISO 串对应值，避时区差异 flaky。
 * 6. 纯函数：同入参同 now 出参恒定。
 */

describe('formatTime 历史时间相对格式化护栏 (C-4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // 把「现在」钉死，所有用例从该 now 倒推 iso（iso 在过去 → diff>0）
  const NOW_MS = new Date('2026-07-30T12:00:00').getTime()

  beforeEach(() => {
    vi.setSystemTime(NOW_MS)
  })

  // 辅助：给定相对 now 偏移 ms 的过去时刻，返回 setSystemTime 下 new Date(iso) 的 ISO 串
  function isoAt(offsetMs: number): string {
    return new Date(NOW_MS - offsetMs).toISOString()
  }

  // --- 第一档：刚刚（diff < 60000）---
  it('diff=0（当前时刻）→ 刚刚', () => {
    expect(formatTime(new Date(NOW_MS).toISOString())).toBe('刚刚')
  })

  it('diff=59999（毫秒级，<60000）→ 刚刚', () => {
    expect(formatTime(isoAt(59999))).toBe('刚刚')
  })

  it('diff 为负数（未来时刻，<0 < 60000）→ 刚刚（负数走第一档）', () => {
    expect(formatTime(isoAt(-5000))).toBe('刚刚')
  })

  // --- 第二档：N 分钟前（60000 <= diff < 3600000）---
  it('diff 恰好 60000 → 边界进分钟档，1 分钟前（严格 < 切档语义）', () => {
    expect(formatTime(isoAt(60000))).toBe('1 分钟前')
  })

  it('diff=119999（不到 2 分钟，floor 取整）→ 1 分钟前（非 2 分钟前）', () => {
    expect(formatTime(isoAt(119999))).toBe('1 分钟前')
  })

  it('diff=120000 → 2 分钟前', () => {
    expect(formatTime(isoAt(120000))).toBe('2 分钟前')
  })

  it('diff=3599999（<3600000 边界）→ 59 分钟前（59 min，floor）', () => {
    expect(formatTime(isoAt(3599999))).toBe('59 分钟前')
  })

  // --- 第三档：N 小时前（3600000 <= diff < 86400000）---
  it('diff 恰好 3600000（1h）→ 边界进小时档，1 小时前', () => {
    expect(formatTime(isoAt(3600000))).toBe('1 小时前')
  })

  it('diff=7199999（不到 2 小时，floor）→ 1 小时前', () => {
    expect(formatTime(isoAt(7199999))).toBe('1 小时前')
  })

  it('diff=7200000 → 2 小时前', () => {
    expect(formatTime(isoAt(7200000))).toBe('2 小时前')
  })

  it('diff=86399999（<86400000 边界）→ 23 小时前（23h，floor）', () => {
    expect(formatTime(isoAt(86399999))).toBe('23 小时前')
  })

  // --- 第四档：M/D HH:MM（diff >= 86400000）---
  it('diff 恰好 86400000（1d 边界）→ 进 M/D HH:MM 档', () => {
    expect(formatTime(isoAt(86400000))).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/)
  })

  it('M/D HH:MM：月份 +1、日原样、时补 2 位 0、分补 2 位 0（用本地 0 时 5 分构造）', () => {
    // 构造一个过去整 2 天 + 当地 0:05 的时刻，验 月/日/时补零/分补零 全部契约
    const target = new Date(NOW_MS)
    target.setDate(target.getDate() - 2)
    target.setHours(0, 5, 0, 0)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 00:05`
    expect(formatTime(target.toISOString())).toBe(expected)
  })

  it('M/D HH:MM：时分 < 10 时补 2 位 0（非单字符），验 09:09 形态', () => {
    const target = new Date(NOW_MS)
    target.setDate(target.getDate() - 2)
    target.setHours(9, 9, 0, 0)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 09:09`
    expect(formatTime(target.toISOString())).toBe(expected)
  })

  it('M/D HH:MM：时分 >= 10 时不补零原样（验不误加前导 0）', () => {
    const target = new Date(NOW_MS)
    target.setDate(target.getDate() - 2)
    target.setHours(14, 30, 0, 0)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 14:30`
    expect(formatTime(target.toISOString())).toBe(expected)
  })

  it('M/D HH:MM：9 月（getMonth=8）+1 得 9 而非 8（月份 +1 核心契约直锁）', () => {
    // 构造一个本地 9 月某日时刻（跨数天确保进第四档），独立验月份 +1
    const target = new Date(NOW_MS)
    target.setMonth(8, 15) // 9 月 15 日（getMonth 返回 8）
    target.setHours(14, 30, 0, 0)
    // 确保 target 在过去（早于 NOW）：若构造出的 target 不在过去则倒推使其在过去并保持同月
    if (target.getTime() >= NOW_MS) target.setFullYear(target.getFullYear() - 1)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 14:30`
    expect(formatTime(target.toISOString())).toBe(expected)
    expect(target.getMonth() + 1).toBe(9) // 自证 +1 语义：getMonth=8 但展示 9
  })

  // --- 纯函数性 ---
  it('纯函数：同入参同 now 恒定输出（两次调用一致）', () => {
    const iso = isoAt(1200000) // 20 分钟前
    const a = formatTime(iso)
    const b = formatTime(iso)
    expect(a).toBe(b)
    expect(a).toBe('20 分钟前')
  })

  it('返回恒为 string 类型（每档抽样）', () => {
    expect(typeof formatTime(isoAt(0))).toBe('string')
    expect(typeof formatTime(isoAt(60000))).toBe('string')
    expect(typeof formatTime(isoAt(3600000))).toBe('string')
    expect(typeof formatTime(isoAt(86400000))).toBe('string')
  })
})
