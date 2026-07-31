import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// 同 HistoryPanel.formatTime.test.ts (C-4) 口径：相对路径 + .js 后缀，esbuild 解析到 .ts
import { formatTime } from '../../components/modals/formatTimeEpoch.js'
// 一致性断言用 C-4 已抽出的 ISO 版 formatTime，锁两份重复实现同时间点输出一致防漂移
import { formatTime as formatTimeISO } from '../../components/modals/formatTime.js'

/**
 * C-5 护栏：TrashPanel.vue 回收站列表项时间戳相对时间格式化纯函数。
 *
 * 源码（逐字同原内联实现，抽独立模块零行为变化，c1-highlight/c3-getPreview/c4-HistoryPanel.formatTime 同口径）：
 *   if (!ts) return ''                 // ← C-5 独有：falsy 短路返空串
 *   const d = new Date(ts)
 *   const now = Date.now()
 *   const diff = now - ts              // ← C-5 独有：直减入参 ts 而非 d.getTime()（ts 同 d.getTime() 等价）
 *   if (diff < 60000) return '刚刚'
 *   if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
 *   if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
 *   return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
 *
 * 与 src/components/modals/formatTime.ts（HistoryPanel C-4 版，入参 ISO 字符串 + diff = now - d.getTime()）
 * 同形但不同实现：本版入参是 ms 时间戳，且 `if (!ts) return ''` falsy 短路是 C-5 独有契约
 * （C-4 入参是 ISO 字符串无此分支；TrashPanel 列表的 deletedAt 可能缺失，需返空串而非渲染 Invalid Date）。
 *
 * 护栏价值：用户可见——回收站列表每条回收项（书签/组）的「时间」列展示什么相对时间文案。
 * 决定「用户在回收站凭时间辨认哪个回收项距今多久、可否还原」这一用户可见行为。四档阈值 + Math.floor
 * 取整 + 月份 +1 + 时分补零 + **falsy 返空串**（deletedAt 缺失时 UI 不显示乱码时间）此前零直测、靠实现口头维护，
 * 任一漂移（阈值改 `<=`、漏 +1 月份、漏补零、floor 改 ceil、删除 `if (!ts) return ''` 让缺失 deletedAt 渲染
 * `NaN/NaN NaN:NaN` 或 Invalid Date 乱码）会改变回收站时间展示且无测试告警。
 *
 * 关键隐特性护栏：
 * 1. C-5 独有：falsy 入参（0/undefined/null/NaN）返回空串 ''，不渲染乱码 / 不抛错。
 * 2. 四档阈值全用严格 `<`，恰好 60000/3600000/86400000 落到高一档。
 * 3. N 分钟/N 小时用 Math.floor（向下取整），如 diff=119999→1 分钟非 2。
 * 4. M/D HH:MM：月 +1（getMonth 返回 0-11）、日原样、时补 2 位 0、分补 2 位 0。
 * 5. 时间为未来（diff<0）走「刚刚」分支（负数 < 60000）。
 * 6. 入参是 ms 时间戳：diff = now - ts（ts 本身即毫秒时间戳，与 d.getTime() 等价）。
 * 7. 纯函数：同入参同 now 出参恒定，返回恒 string（或 ''，仍是 string）。
 * 8. 与 C-4 ISO 版一致性：对同时间点，ms 版与 ISO 版对四档各代表值输出一致，锁两份重复实现防漂移。
 */

describe('formatTime 回收站时间相对格式化护栏 (C-5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // 把「现在」钉死在本地 2026-07-30 12:00:00，所有用例从该 now 倒推 ts（ts 在过去 → diff>0）
  const NOW_MS = new Date('2026-07-30T12:00:00').getTime()

  beforeEach(() => {
    vi.setSystemTime(NOW_MS)
  })

  // 辅助：给定相对 now 偏移 ms 的过去时间戳（C-5 入参是 ms 时间戳，直传）
  function tsAt(offsetMs: number): number {
    return NOW_MS - offsetMs
  }

  // --- C-5 独有：falsy 短路返空串 ---
  it('入参 0 → 返回空串（falsy 短路，0 deletedAt 不渲染乱码时间）', () => {
    expect(formatTime(0)).toBe('')
  })

  it('入参 undefined → 返回空串（deletedAt 缺失场景）', () => {
    expect(formatTime(undefined)).toBe('')
  })

  it('入参 null → 返回空串（Number(null) 走 !ts 短路）', () => {
    expect(formatTime(null as unknown as undefined)).toBe('')
  })

  it('入参 NaN → 返回空串（NaN 是 falsy，!NaN===true）', () => {
    expect(formatTime(NaN)).toBe('')
  })

  it('falsy 短路返回恒为 string 类型（空串而非 undefined/null）', () => {
    expect(typeof formatTime(0)).toBe('string')
    expect(typeof formatTime(undefined)).toBe('string')
    expect(typeof formatTime(NaN)).toBe('string')
  })

  // --- 第一档：刚刚（diff < 60000）---
  it('diff=0（当前时刻 ms）→ 刚刚', () => {
    expect(formatTime(NOW_MS)).toBe('刚刚')
  })

  it('diff=59999（毫秒级，<60000）→ 刚刚', () => {
    expect(formatTime(tsAt(59999))).toBe('刚刚')
  })

  it('diff 为负数（未来时刻 ms，<0 < 60000）→ 刚刚（负数走第一档）', () => {
    expect(formatTime(tsAt(-5000))).toBe('刚刚')
  })

  // --- 第二档：N 分钟前（60000 <= diff < 3600000）---
  it('diff 恰好 60000 → 边界进分钟档，1 分钟前（严格 < 切档语义）', () => {
    expect(formatTime(tsAt(60000))).toBe('1 分钟前')
  })

  it('diff=119999（不到 2 分钟，floor 取整）→ 1 分钟前（非 2 分钟前）', () => {
    expect(formatTime(tsAt(119999))).toBe('1 分钟前')
  })

  it('diff=120000 → 2 分钟前', () => {
    expect(formatTime(tsAt(120000))).toBe('2 分钟前')
  })

  it('diff=3599999（<3600000 边界）→ 59 分钟前（59 min，floor）', () => {
    expect(formatTime(tsAt(3599999))).toBe('59 分钟前')
  })

  // --- 第三档：N 小时前（3600000 <= diff < 86400000）---
  it('diff 恰好 3600000（1h）→ 边界进小时档，1 小时前', () => {
    expect(formatTime(tsAt(3600000))).toBe('1 小时前')
  })

  it('diff=7199999（不到 2 小时，floor）→ 1 小时前', () => {
    expect(formatTime(tsAt(7199999))).toBe('1 小时前')
  })

  it('diff=7200000 → 2 小时前', () => {
    expect(formatTime(tsAt(7200000))).toBe('2 小时前')
  })

  it('diff=86399999（<86400000 边界）→ 23 小时前（23h，floor）', () => {
    expect(formatTime(tsAt(86399999))).toBe('23 小时前')
  })

  // --- 第四档：M/D HH:MM（diff >= 86400000）---
  it('diff 恰好 86400000（1d 边界）→ 进 M/D HH:MM 档', () => {
    expect(formatTime(tsAt(86400000))).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/)
  })

  it('M/D HH:MM：月份 +1、日原样、时补 2 位 0、分补 2 位 0（用本地 0 时 5 分构造）', () => {
    // 构造一个过去整 2 天 + 当地 0:05 的时刻，验 月/日/时补零/分补零 全部契约
    const target = new Date(NOW_MS)
    target.setDate(target.getDate() - 2)
    target.setHours(0, 5, 0, 0)
    const ts = target.getTime()
    const expected = `${target.getMonth() + 1}/${target.getDate()} 00:05`
    expect(formatTime(ts)).toBe(expected)
  })

  it('M/D HH:MM：时分 < 10 时补 2 位 0（非单字符），验 09:09 形态', () => {
    const target = new Date(NOW_MS)
    target.setDate(target.getDate() - 2)
    target.setHours(9, 9, 0, 0)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 09:09`
    expect(formatTime(target.getTime())).toBe(expected)
  })

  it('M/D HH:MM：时分 >= 10 时不补零原样（验不误加前导 0）', () => {
    const target = new Date(NOW_MS)
    target.setDate(target.getDate() - 2)
    target.setHours(14, 30, 0, 0)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 14:30`
    expect(formatTime(target.getTime())).toBe(expected)
  })

  it('M/D HH:MM：9 月（getMonth=8）+1 得 9 而非 8（月份 +1 核心契约直锁）', () => {
    // 构造一个本地 9 月某日时刻（跨数天确保进第四档），独立验月份 +1
    const target = new Date(NOW_MS)
    target.setMonth(8, 15) // 9 月 15 日（getMonth 返回 8）
    target.setHours(14, 30, 0, 0)
    // 确保 target 在过去（早于 NOW）：若构造出的 target 不在过去则倒推使其在过去并保持同月
    if (target.getTime() >= NOW_MS) target.setFullYear(target.getFullYear() - 1)
    const expected = `${target.getMonth() + 1}/${target.getDate()} 14:30`
    expect(formatTime(target.getTime())).toBe(expected)
    expect(target.getMonth() + 1).toBe(9) // 自证 +1 语义：getMonth=8 但展示 9
  })

  // --- 纯函数性 ---
  it('纯函数：同入参同 now 恒定输出（两次调用一致）', () => {
    const ts = tsAt(1200000) // 20 分钟前
    const a = formatTime(ts)
    const b = formatTime(ts)
    expect(a).toBe(b)
    expect(a).toBe('20 分钟前')
  })

  it('返回恒为 string 类型（每档抽样 + falsy 抽样）', () => {
    expect(typeof formatTime(NOW_MS)).toBe('string')
    expect(typeof formatTime(tsAt(60000))).toBe('string')
    expect(typeof formatTime(tsAt(3600000))).toBe('string')
    expect(typeof formatTime(tsAt(86400000))).toBe('string')
    expect(typeof formatTime(0)).toBe('string')
  })

  // --- 与 C-4 ISO 版一致性（锁两份重复实现防漂移）---
  it('一致性：ms 版与 ISO 版对四档各代表时间点输出相同（防两份重复实现漂移）', () => {
    // 对同一时间点：ms 版入参 ts（ms 数字），ISO 版入参 new Date(ts).toISOString()
    // 两版对「四档阈值代表值 + 严格 < 切档 + Math.floor 取整 + 月份+1 + 补零」应输出完全相同
    const offsets = [
      0, // 刚刚
      59999, // 刚刚边界
      60000, // 1 分钟（切档）
      120000, // 2 分钟
      3599999, // 59 分钟
      3600000, // 1 小时（切档）
      7200000, // 2 小时
      86399999, // 23 小时
      86400000, // M/D HH:MM（切档）
      172800000, // 整 2 天 → M/D HH:MM
    ]
    for (const off of offsets) {
      const ts = tsAt(off)
      const fromMS = formatTime(ts)
      const fromISO = formatTimeISO(new Date(ts).toISOString())
      // 第四档输出含本地日期，两版用同一 ts 构造 Date 故 getMonth/getDate/getHours/getMinutes 一致
      expect(fromMS).toBe(fromISO)
    }
  })
})
