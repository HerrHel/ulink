/**
 * useUndo.test.ts — 撤销/重做系统回归测试
 *
 * 重点覆盖 R2-5：字节超限驱逐的语义正确性。
 *   旧 bug ① evictOldestUndo 用 gid 字典序选「最老」组，但 gid 含 random 段，
 *            字典序与 push 时间序不等价，会误驱逐时间较新但字典序较小的组。
 *   旧 bug ② pushUndo while 守卫 `stack.undo.length > 1` 用的是当前 push 组栈深度，
 *            但 evict 驱逐的是全局最老组——当前组仅 1 条 undo 时即便全局超限也不驱逐。
 *   旧 bug ③ 模块级 `_totalUndoBytes` 缓存在 clearStack 时不减（已删组字节永久泄漏）、
 *            测试间残留上轮值——改为每次实算后消除。
 *
 * 时序说明：GroupEditor 实际 onUpdate 是「pushUndo; syncToStore」——pushUndo 读到的是
 * 「改之前」的 sg.notes。测试里手动模拟需反过来：先 updateGroup 再 pushUndo 会读到改后值。
 * 故驱逐测试只断言 stack 深度/存在性（不依赖 snapshot 内容精确语义）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 把字节上限 + 防抖窗口都调小：字节上限以便测试体量触发驱逐，
// UNDO_WINDOW 调小以使间隔 >60ms 的连续 push 都各自进入 else 真正建撤销点。
vi.mock('../../config/constants.js', async (orig) => {
  // 注意：real 模块含 DEFAULTS（其 bookmark.portalpassword 为字面 { encrypted: true, ... }），
  // 与 types.ts 的 EncryptedPassword 联合后，TS 判定模块对象类型不可整体 spread。
  // cast as any 绕过 spread 类型检查（构造型 mock 常见做法，不影响运行时）。
  const real = await orig() as Record<string, unknown>
  return { ...real, MAX_UNDO_BYTES: 1024, MAX_UNDO: 50, UNDO_WINDOW: 50 }
})

vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))
vi.mock('../../stores/app.js', () => ({
  debouncedSaveAppData: vi.fn(),
  saveAppData: vi.fn(),
}))
// EditorManager 不挂载可见编辑器 → get 返回 null 走 updateGroup 路径
vi.mock('../../lib/editor.js', () => ({
  EditorManager: { get: () => null, getContentHTML: () => null },
}))

import { pushUndo, performUndo, performRedo } from '../../composables/domain/useUndo.js'
import { useDataStore } from '../../stores/data.js'
import { useUndoStore } from '../../stores/undo.js'

function makeGroup(id: string, notes = '') {
  const ds = useDataStore()
  ds.addGroup({
    id, name: id, categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes, updatedAt: 1, useCount: 0,
  })
}

// 等过 UNDO_WINDOW，确保下一次 pushUndo 进入 else 分支真正建撤销点
const tick = () => new Promise(r => setTimeout(r, 60))

describe('useUndo R2-5 字节驱逐语义', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('pushUndo 建立撤销点栈，performUndo/performRedo 可往返', async () => {
    const ds = useDataStore()
    makeGroup('g1', '原始笔记')
    pushUndo('g1')
    await tick()
    ds.updateGroup('g1', { notes: '改后笔记' })
    pushUndo('g1')

    const undo = useUndoStore()
    expect(undo.stacks['g1'].undo.length).toBe(2)

    expect(performUndo('g1')).toBe(true)
    // undo 后已恢复到栈顶 snapshot（pop 出的是最近 push 时刻的 notes）
    expect(typeof ds.groupMap['g1'].notes).toBe('string')
    expect(undo.stacks['g1'].redo.length).toBe(1)

    expect(performRedo('g1')).toBe(true)
    expect(undo.stacks['g1'].undo.length).toBe(2)
  })

  it('R2-5①: 超限时按时间最久驱逐，不按 gid 字典序', async () => {
    // 故意让字典序大的组先 push（时间更老）、字典序小的组后 push（时间更新）。
    // 旧实现按 gid<? 选字典序最小（gA）驱逐——错。应驱逐 pushedAt 最早（gZ 的 undo[0]）。
    const ds = useDataStore()
    makeGroup('gZ', 'Z'.repeat(200)) // 字典序最大
    pushUndo('gZ') // pushedAt 最早
    await tick()
    makeGroup('gA', 'A'.repeat(200)) // 字典序最小
    pushUndo('gA') // pushedAt 较晚
    const undo = useUndoStore()
    // 两组各 1 条 undo，字节约 2*(200*2)=800 < 1024，未超限
    expect(undo.stacks['gZ'].undo.length).toBe(1)
    expect(undo.stacks['gA'].undo.length).toBe(1)

    // 给 gA 再 push 一条更大 snap 把总字节推过 1024 上限
    await tick()
    ds.updateGroup('gA', { notes: 'A'.repeat(300) })
    pushUndo('gA') // 第二条 push 触发字节驱逐判断

    // 驱逐对象应是 gZ 的最老 undo（pushedAt 最早）。evict 空该组 undo 且 redo 也空 → delete stack。
    // 旧 bug：按字典序会选 gA（'gA' < 'gZ'）shift，丢掉最近 push 的 gA 第一条。
    expect(undo.stacks['gZ']).toBeUndefined()
    // gA 保留其撤销历史
    expect(undo.stacks['gA'].undo.length).toBeGreaterThanOrEqual(1)
  })

  it('R2-5②: 当前组仅 1 条 undo 时全局字节超限仍驱逐（守卫不再用当前组栈深）', async () => {
    // 场景：B 组已 push 到字节接近上限，A 组首次 push（undo 仅 1 条）。
    // 旧实现 while 守卫 stack.undo.length>1 对 A 组（=1）为 false → 不驱逐，超限不修复。
    makeGroup('gB', 'B'.repeat(500)) // 单条 ~1000B，接近 1024 上限
    pushUndo('gB')
    await tick()
    // 此时字节已接近上限。造 A 组首条 push（+~600B → 总字节省超 1024）。
    makeGroup('gA', 'A'.repeat(300))
    pushUndo('gA')
    const undo = useUndoStore()
    // 应驱逐（gB 的最老，因 pushedAt 更早），而不是因 A 组 undo 仅 1 条就跳过。
    expect(undo.stacks['gB']).toBeUndefined()
    expect(undo.stacks['gA'].undo.length).toBe(1)
  })

  it('R2-5③: clearStack 后无模块级字节缓存泄漏', async () => {
    makeGroup('g1', 'X'.repeat(300))
    pushUndo('g1')
    const undo = useUndoStore()
    undo.clearStack('g1')
    // clearStack 后 stacks 已空；新实算 totalUndoBytes 自然为 0（非旧缓存残留）。
    // 间接验证：再 push 一个新组触发的驱逐不应误清任何东西（无「幽灵超限」）。
    makeGroup('g2', 'Y'.repeat(200))
    pushUndo('g2')
    expect(undo.stacks['g2'].undo.length).toBe(1)
  })

  it('M7: undo 后窗口内再 push 必建栈并清 redo（timer 被清）', async () => {
    // 旧 bug：pushUndo 设 50ms timer 后 performUndo 不清 timer，
    // 窗口内再次 push 走 if 分支只续 timer → 不建栈、不清 redo → 新编辑无撤销点。
    const ds = useDataStore()
    makeGroup('g1', 'v0')
    pushUndo('g1') // 建点1，启动 timer
    await tick()
    ds.updateGroup('g1', { notes: 'v1' })
    pushUndo('g1') // 建点2，启动 timer
    const undo = useUndoStore()
    expect(undo.stacks['g1'].undo.length).toBe(2)
    expect(undo.timers['g1']).toBeTruthy()

    // 窗口内 undo（不等 tick）——应清 timer
    expect(performUndo('g1')).toBe(true)
    expect(undo.timers['g1']).toBeUndefined()
    expect(undo.stacks['g1'].redo.length).toBe(1)

    // 立刻再编辑并 push：必走 else 真正建栈 + 清 redo
    ds.updateGroup('g1', { notes: 'v2-after-undo' })
    pushUndo('g1')
    expect(undo.stacks['g1'].undo.length).toBeGreaterThanOrEqual(2)
    expect(undo.stacks['g1'].redo.length).toBe(0)
  })
})
