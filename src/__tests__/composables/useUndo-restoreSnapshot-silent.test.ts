/**
 * useUndo-restoreSnapshot-silent.test.ts — G1-003 守门回归测
 *
 * 复现 bug：useUndo.restoreSnapshot 调 TipTap plain `ed.commands.setContent(html)` 未传
 * emitUpdate:false（也未经 EditorManager.silentSetContent 包裹）。TipTap v3 setContent 默认
 * emitUpdate=true → 同步 fire onUpdate → GroupEditor onUpdate:188 的 isSilentSetContent()
 * 返回 false（restoreSnapshot 没递增 _silentContentDepth）→ 不短路，执行 pushUndo（被
 * useUndo 模块级 _restoring 挡）+ syncToStore（不被挡）→ ds.updateGroup(gid,{notes,bookmarkIds})
 * → data.ts updateGroup:547-549 调 _saveLocalHistory(id,{...sg}) + _trackChange('notes')
 *   + _trackChange('bookmarkIds')
 * → 机器恢复态被写进本地版本历史（HistoryPanel 出现伪版本）+ 字段标脏（syncPush 回推云端），
 *   完整绕过 restoreSnapshot 行 L4 注释「机器恢复态不进版本历史与字段脏追踪」的设计意图。
 *
 * 修复：restoreSnapshot 改用 EditorManager.silentSetContent(gid, html)——同库 useSyncRealtime
 * 远端 notes 写回口径（editor.ts:75-86 递增 _silentContentDepth 包 setContent，让
 * GroupEditor onUpdate:188 isSilentSetContent()=true 短路）。
 *
 * 测试策略：jsdom 不便起真 TipTap，故 mock EditorManager + 伪 editor，忠实复刻三件产品语义：
 *   ① editor.ts silent 语义：silentSetContent 递增 depth 包 setContent + depth--，
 *      isSilentSetContent() 读 depth > 0（与真实实现逐字一致）。
 *   ② TipTap setContent 默认 emitUpdate=true：setContent 在 isSilentSetContent()===false 时
 *      同步触发注册的 onUpdate 回调；silent 路径不触发（模拟 TipTap preventUpdate meta）。
 *   ③ GroupEditor.vue:186-191 onUpdate body：if (isSilentSetContent()) return;
 *      pushUndo(groupId); syncToStore(ed)——其中 syncToStore 核心即 ds.updateGroup(gid,
 *      {notes: ed.getHTML(), bookmarkIds: ids})（GroupEditor.vue:151）。
 * 如此测的是 silent 短路是否阻止 updateGroup 的污染副作用，stash 修复后 silentSetContent
 * 退回 plain setContent → onUpdate fire → updateGroup 被调 → 断言 fail。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 同 useUndo.test.ts：缩小常量便于栈/驱逐测，但不影响本测核心
vi.mock('../../config/constants.js', async (orig) => {
  const real = await orig() as Record<string, unknown>
  return { ...real, MAX_UNDO_BYTES: 1024, MAX_UNDO: 50, UNDO_WINDOW: 50 }
})
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn() }))
vi.mock('../../stores/app.js', () => ({
  debouncedSaveAppData: vi.fn(),
  saveAppData: vi.fn(),
  debouncedSaveAppDataNotes: vi.fn(),
}))

// 忠实复刻 editor.ts 的 silent 语义 + 伪 editor 模拟 TipTap setContent→onUpdate 触发
let _silentDepth = 0
let _onUpdateCB: ((ed: any) => void) | null = null
const _editors: Record<string, any> = {}
const _htmlStore: Record<string, string> = {}

vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: (gid: string) => _editors[gid] || null,
    getContentHTML: (gid: string) => (gid in _editors ? _htmlStore[gid] : null),
    silentSetContent: (gid: string, html: string): boolean => {
      const ed = _editors[gid]
      if (!ed) return false
      _silentDepth++
      try { ed.commands.setContent(html) } finally { _silentDepth-- }
      return true
    },
    isSilentSetContent: (): boolean => _silentDepth > 0,
  },
}))

import { pushUndo, performUndo } from '../../composables/domain/useUndo.js'
import { useDataStore } from '../../stores/data.js'

function makeGroup(id: string, notes = '') {
  const ds = useDataStore()
  ds.addGroup({
    id, name: id, categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes, updatedAt: 1, useCount: 0,
  })
}

/** 模拟 GroupEditor.vue onMounted 给某组挂载 TipTap editor：
 *  注册伪 editor 到 _editors，注入 onUpdate 回调（复刻 GroupEditor.vue:186-191 body）。 */
function mountEditor(gid: string) {
  // 伪 editor：setContent 在非 silent 时同步 fire onUpdate（模拟 TipTap emitUpdate=true 默认）
  _editors[gid] = {
    commands: {
      setContent: (html: string) => {
        _htmlStore[gid] = html
        // 模拟 TipTap：emitUpdate=true 且非 preventUpdate 时同步触发 onUpdate
        if (_silentDepth === 0 && _onUpdateCB) _onUpdateCB(_editors[gid])
      },
    },
    getHTML: () => _htmlStore[gid] || '',
    state: { doc: { descendants: () => {} } },
  }
  // onUpdate body 复刻 GroupEditor.vue:186-191：silent 时短路；否则 pushUndo + syncToStore
  _onUpdateCB = (ed: any) => {
    // G1-003：silent 短路（EditorManager.isSilentSetContent 与 _silentDepth 一致）
    if (_silentDepth > 0) return
    // GroupEditor.vue:189 pushUndo —— _restoring 模块级 flag 在 useUndo 内挡
    pushUndo(gid)
    // GroupEditor.vue:190 syncToStore —— 核心即 ds.updateGroup(gid, {notes, bookmarkIds})
    const ds = useDataStore()
    ds.updateGroup(gid, { notes: ed.getHTML(), bookmarkIds: [] })
  }
}

const tick = () => new Promise(r => setTimeout(r, 60))

describe('useUndo.restoreSnapshot G1-003 silent 守门', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _silentDepth = 0
    _onUpdateCB = null
    for (const k of Object.keys(_editors)) delete _editors[k]
    for (const k of Object.keys(_htmlStore)) delete _htmlStore[k]
  })

  it('★修复后：editor 挂载时 restoreSnapshot 走 silentSetContent，onUpdate 短路 → 不调 updateGroup 不标脏不进版本历史', async () => {
    const ds = useDataStore()
    makeGroup('g1', 'v0')
    pushUndo('g1')
    await tick()
    ds.updateGroup('g1', { notes: 'v1' })
    pushUndo('g1')
    await tick()

    // 挂载伪 editor（模拟聚焦态组 TipTap 已 onMounted）
    mountEditor('g1')
    // 预备态的 pushUndo/updateGroup 已标脏 _changedFields/_dirtyIds（notes 等来自预备 updateGroup）；
    // 清掉拿净基线，只观测 restoreSnapshot 在 editor 挂载路径上是否新增脏——差分判定 bug。
    ds._changedFields.clear()
    ds._dirtyIds.clear()
    const updateGroupSpy = vi.spyOn(ds, 'updateGroup')

    // perform undo → restoreSnapshot(snap) → silentSetContent 让 onUpdate 短路
    expect(performUndo('g1')).toBe(true)

    // 修复后：syncToStore→updateGroup 在 onUpdate 短路内未执行，updateGroup spy 未被调
    expect(updateGroupSpy).not.toHaveBeenCalled()
    // _changedFields 不含 restoreSnapshot 写的 notes/bookmarkIds（机器恢复态不进字段脏追踪）
    const changed = ds._changedFields.get('g1')
    expect(changed?.has('notes')).toBeFalsy()
    expect(changed?.has('bookmarkIds')).toBeFalsy()
    // _saveLocalHistory 是 debounced（_histDebounceTimers），restore 路径不应布置 timer
    // （只能间接证：updateGroup 未被调即不会布置；上面 spy 已断言）
  })

  it('★修复前回退（stash 源码）应 fail：plain setContent fire onUpdate→syncToStore→updateGroup→_trackChange 标脏', async () => {
    // 此测红绿门：stash src/composables/domain/useUndo.ts 后跑应 fail（updateGroup 被调、脏旗被标）。
    // 不挂载 editor 时 plain setContent 路径根本不走（ed=null）—— 故必须挂载才能复现。
    const ds = useDataStore()
    makeGroup('g1', 'v0')
    pushUndo('g1')
    await tick()
    ds.updateGroup('g1', { notes: 'v1' })
    pushUndo('g1')
    await tick()

    mountEditor('g1')
    ds._changedFields.clear()
    ds._dirtyIds.clear()
    const updateGroupSpy = vi.spyOn(ds, 'updateGroup')

    expect(performUndo('g1')).toBe(true)

    // 修复后断言：updateGroup spy 未被调（plain setContent 修复前会被调，本测 fail）
    expect(updateGroupSpy).not.toHaveBeenCalled()
    const changed = ds._changedFields.get('g1')
    expect(changed?.has('notes')).toBeFalsy()
  })

  it('修复后：未挂载 editor 时（组不可见）restoreSnapshot 仅写 store 数组，silentSetContent 返回 false 无副作用', async () => {
    const ds = useDataStore()
    makeGroup('g1', 'v0')
    pushUndo('g1')
    await tick()
    ds.updateGroup('g1', { notes: 'v1' })
    pushUndo('g1')
    await tick()

    // 不挂载 editor（_editors 空且 _onUpdateCB=null）→ silentSetContent 返回 false，editor 跳过
    ds._changedFields.clear()
    ds._dirtyIds.clear()
    const updateGroupSpy = vi.spyOn(ds, 'updateGroup')
    expect(performUndo('g1')).toBe(true)
    expect(updateGroupSpy).not.toHaveBeenCalled()
    // sg.notes 应被 restoreSnapshot 手动写为新快照值（v0，pop 出的第一条 push 时刻）
    expect(typeof ds.groupMap['g1'].notes).toBe('string')
  })
})
