/**
 * useSyncHistory-restoreFromHistory-silent.test.ts — G1-003 守门回归测（restoreFromHistory）
 *
 * 复现 bug：restoreFromHistory 调 TipTap plain `ed.commands.setContent(notes)`（行 156）未经
 * EditorManager.silentSetContent 包裹。TipTap v3 setContent 默认 emitUpdate=true → 同步 fire
 * onUpdate → GroupEditor onUpdate:188 的 isSilentSetContent() 返回 false（restoreFromHistory
 * 没递增 _silentContentDepth）→ 不短路 syncToStore → ds.updateGroup(id,{notes,bookmarkIds})
 * 二次调用，复用第 1 次 updateGroup 调度的 _saveLocalHistory 防抖 timer，但
 * data.ts:467 `_histDebounceData.set(id, data)` 无条件覆盖：第 1 次存 pre-restore 快照，
 * 第 2 次（state 已是 restore 后版本）覆盖为 post-restore → timer fire 落盘的「变更前快照」
 * 实为 restore 后版本（= 当前值）。
 *
 * 真实现象：HistoryPanel 多一条指向「当前版本」的伪历史记录，pre-restore 被覆盖丢失 →
 * 用户失去回退到恢复前状态的能力（数据完整性 bug，可观察）。
 *
 * 修复：restoreFromHistory 行 156 改用 EditorManager.silentSetContent(itemId, html)——
 * 同 useUndo.restoreSnapshot（第十七轮）/ useSyncRealtime 远端 notes 写回口径（editor.ts:75-88
 * 递增 _silentContentDepth 包 setContent，让 GroupEditor onUpdate:188 isSilentSetContent()=true
 * 短路）。silent 短路 onUpdate → syncToStore 不触发 → 第 2 次 updateGroup 不发生 →
 * _saveLocalHistory 只被 restoreFromHistory 自己的 updateGroup 调一次（记 pre-restore 即真正
 * 有意义的「变更前快照」）。
 *
 * 测试策略：jsdom 不便起真 TipTap，mock EditorManager + 伪 editor，忠实复刻三件产品语义：
 *   ① editor.ts silent 语义：silentSetContent 递增 depth 包 setContent + depth--，
 *      isSilentSetContent() 读 depth > 0（与真实实现逐字一致）。
 *   ② TipTap setContent 默认 emitUpdate=true：setContent 在 isSilentSetContent()===false 时同步
 *      触发注册的 onUpdate 回调；silent 路径不触发（模拟 TipTap preventUpdate meta）。
 *   ③ GroupEditor.vue:186-191 onUpdate body：if (isSilentSetContent()) return;
 *      pushUndo(groupId); syncToStore(ed)——syncToStore 核心即 ds.updateGroup(gid,
 *      {notes: ed.getHTML(), bookmarkIds: ids})（GroupEditor.vue:151）。
 * 用 fake timer 推进 500ms 看 localStorage 落盘 —— 直接锁定「伪历史记录」用户可见现象。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useAuth：本地版本命中即返，不查云端（HIST-1 + 测焦点在 silent 副作用链）
const _authState = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ get user() { return _authState.user } }),
}))

// useE2E：关闭，histData 透传原文（焦点在 silent，不在加密链）
vi.mock('../../composables/domain/useE2E.js', () => ({
  useE2E: () => ({
    isE2EEnabled: { get value() { return false } },
    isUnlocked: { get value() { return false } },
    decryptItem: vi.fn(async (_t: string, item: Record<string, unknown>) => item),
  }),
}))

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), order: vi.fn(() => ({ limit: vi.fn() })) })),
    })),
  },
}))

vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn() }))

// ── 忠实复刻 editor.ts 的 silent 语义 + 伪 editor 模拟 TipTap setContent→onUpdate 同步触发 ──
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

import { restoreFromHistory } from '../../composables/domain/useSyncHistory.js'
import { useDataStore } from '../../stores/data.js'

function setLocalHistory(itemId: string, versions: Array<{ id: number; data: Record<string, unknown>; created_at: string }>) {
  localStorage.setItem(`lv_hist:${itemId}`, JSON.stringify(versions))
}
function makeGroup(id: string, notes = '') {
  const ds = useDataStore()
  // 用 addGroup 正确进索引（ds._grpMap）；直接赋 siblingGroups 会绕过 _grpMap 致
  // updateGroup:546 _indexOfById 返回 -1 走空，restore 副作用根本不生效（测盲区）。
  ds.addGroup({
    id, name: id, categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes, updatedAt: 1, useCount: 0,
    isPublic: false, pinnedAt: undefined,
  })
}

/** 模拟 GroupEditor.vue onMounted 给某组挂载 TipTap editor：注册伪 editor + 注入 onUpdate 回调。 */
function mountEditor(gid: string) {
  _editors[gid] = {
    commands: {
      // emitUpdate=true 默认：非 silent 时同步 fire onUpdate
      setContent: (html: string) => {
        _htmlStore[gid] = html
        if (_silentDepth === 0 && _onUpdateCB) _onUpdateCB(_editors[gid])
      },
    },
    getHTML: () => _htmlStore[gid] || '',
    state: { doc: { descendants: () => {} } },
  }
  // onUpdate body 复刻 GroupEditor.vue:186-191：silent 时短路；否则 syncToStore→updateGroup
  _onUpdateCB = (ed: any) => {
    if (_silentDepth > 0) return // G1-003 短路
    const ds = useDataStore()
    ds.updateGroup(gid, { notes: ed.getHTML(), bookmarkIds: [] })
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  _silentDepth = 0
  _onUpdateCB = null
  for (const k of Object.keys(_editors)) delete _editors[k]
  for (const k of Object.keys(_htmlStore)) delete _htmlStore[k]
  _authState.user = null
  localStorage.clear()
})

describe('restoreFromHistory G1-003 silent 守门', () => {
  it('★修复后：editor 挂载时 onUpdate 不二次调用 updateGroup（silent 短路切 echo 链）→ restore 写入的 notes 不被覆盖', async () => {
    _authState.user = { id: 'u1' }
    const ds = useDataStore()
    makeGroup('g1', '<p>旧版本</p>') // restore 前 state
    setLocalHistory('g1', [{ id: 7, created_at: '2026-01-01T00:00:00.000Z', data: { name: 'g1', bookmarkIds: [], notes: '<p>历史版本</p>' } }])
    mountEditor('g1')
    const updateGroupSpy = vi.spyOn(ds, 'updateGroup')

    const ok = await restoreFromHistory(7, 'g1', 'group')
    expect(ok).toBe(true)

    // 修复后：silentSetContent 让 onUpdate 短路 syncToStore；updateGroup 仅被 restoreFromHistory
    // 自己显式调用 1 次（restoreFromHistory:140-147），不被 onUpdate→syncToStore 二次调用。
    expect(updateGroupSpy).toHaveBeenCalledTimes(1)
    // restore 写入的 notes（updateGroup:550 显式赋）保持为历史版本，不被 echo 覆盖。
    expect(ds.groupMap['g1'].notes).toBe('<p>历史版本</p>')
  })

  it('★修复前回退（stash 源码）应 fail：plain setContent fire onUpdate→syncToStore→updateGroup 二次调用', async () => {
    // 红绿门：stash src/composables/domain/useSyncHistory.ts 后跑此测应 fail
    // （plain setContent 触 onUpdate 不短路 → syncToStore→updateGroup 二次调用，spy=2 次，测 fail）。
    _authState.user = { id: 'u1' }
    const ds = useDataStore()
    makeGroup('g1', '<p>旧版本</p>')
    setLocalHistory('g1', [{ id: 7, created_at: '2026-01-01T00:00:00.000Z', data: { name: 'g1', bookmarkIds: [], notes: '<p>历史版本</p>' } }])
    mountEditor('g1')
    const updateGroupSpy = vi.spyOn(ds, 'updateGroup')

    const ok = await restoreFromHistory(7, 'g1', 'group')
    expect(ok).toBe(true)

    // 修复后断言：updateGroup 仅 1 次（修复前 echo 链 → 2 次，测 fail）
    expect(updateGroupSpy).toHaveBeenCalledTimes(1)
  })

  it('修复后：未挂载 editor 时（组不可见）silentSetContent 返回 false 无副作用', async () => {
    _authState.user = { id: 'u1' }
    const ds = useDataStore()
    makeGroup('g1', '<p>旧版本</p>')
    setLocalHistory('g1', [{ id: 7, created_at: '2026-01-01T00:00:00.000Z', data: { name: 'g1', bookmarkIds: [], notes: '<p>历史版本</p>' } }])
    // 不挂载 editor（_editors 空）→ silentSetContent 返回 false，editor setContent 跳过 → 无 onUpdate
    const updateGroupSpy = vi.spyOn(ds, 'updateGroup')

    const ok = await restoreFromHistory(7, 'g1', 'group')
    expect(ok).toBe(true)
    // 仍被 restoreFromHistory 显式调 1 次（无 onUpdate 二次增调）
    expect(updateGroupSpy).toHaveBeenCalledTimes(1)
  })
})
