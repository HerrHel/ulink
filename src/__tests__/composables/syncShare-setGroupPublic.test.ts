/**
 * syncShare-setGroupPublic.test.ts — 公开分享 RLS 写编排 setGroupPublic 行为契约护栏
 *
 * setGroupPublic（syncShare L17 export async）直接经 supabase 写 sibling_groups.is_public
 * （不经 SyncRemotePort，与队列同步解耦），49 行编排含多条真契约零护栏：
 *   - _getUserId 未登录 return false（不 updateGroup 不 saveAppData 不碰 Supabase）
 *   - group 不存在（groupMap 无 gid）return false（不 updateGroup 不 saveAppData 不碰 Supabase）
 *   - 成功路径：updateGroup({isPublic}) 本地态先改 + saveAppData 落盘 + supabase
 *     update().eq(id).eq(user_id) RLS 双校验 → 成功 return true
 *   - supabase error 时 return false（本地态已被 updateGroup 改 + saveAppData 已调——编排现状，
 *     远端失败本地仍改，护栏锁定此顺序不回归）
 *
 * 口径：纯加测试零源文件改动。直接 import setGroupPublic（已 export）；
 * 真实 useDataStore（验 updateGroup 副作用落到 groupMap.isPublic）；
 * mock 仅桩：useAuth（可控 user.id 供 _getUserId）+ saveAppData（防真 persist IO + spy 断言）+
 * supabase.from().update().eq().eq()（可控 success/error 链）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── useAuth mock：可控 user.id 供 _getUserId（未登录 / 已登录双态）──
const _auth = vi.hoisted(() => ({
  user: { id: 'user-abc' } as { id: string } | null,
}))
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ user: _auth.user, isLoggedIn: _auth.user != null }),
}))

// ── saveAppData spy（防真 persist 写盘 IO + 捕落盘断言）────────────────
const _app = vi.hoisted(() => ({
  saveAppDataSpy: vi.fn(),
}))
vi.mock('../../stores/app.js', () => ({
  saveAppData: _app.saveAppDataSpy,
  debouncedSaveAppData: vi.fn(),
}))

// ── supabase mock：from().update().eq().eq() 链可控 success/error ──
// 源 L25-26：`await supabase.from('sibling_groups').update({is_public}).eq('id',gid).eq('user_id',uid)`，
// 两条 eq 串联后 await 取 {error}。用 thenable chain：每个 eq 累录入参并返回自身（带 .eq + .then），
// 末尾 await 触发 .then 返回 setReturn。
const _supa = vi.hoisted(() => ({
  updateSpy: vi.fn(),
  eqCalls: [] as Array<{ col: string; val: unknown }>,
  setReturn: { error: null } as { error: unknown },
  fromTable: '',
  buildChain: function () {
    const self: any = {
      eq: (col: string, val: unknown) => {
        _supa.eqCalls.push({ col, val })
        return self
      },
      then: (res: any, rej: any) => Promise.resolve(_supa.setReturn).then(res, rej),
    }
    return self
  },
}))
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: (t: string) => {
      _supa.fromTable = t
      return {
        update: (setObj: Record<string, unknown>) => {
          _supa.updateSpy(setObj)
          return _supa.buildChain()
        },
      }
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  _auth.user = { id: 'user-abc' }
  _app.saveAppDataSpy.mockClear()
  _supa.updateSpy.mockClear()
  _supa.eqCalls = []
  _supa.setReturn = { error: null }
  _supa.fromTable = ''
})

async function seedGroup(gid: string, isPublic = false) {
  const { useDataStore } = await import('../../stores/data.js')
  const ds = useDataStore()
  ds.siblingGroups.push({
    id: gid, name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1, isPublic,
  } as any)
  ds._grpMap[gid] = ds.siblingGroups[ds.siblingGroups.length - 1] as any
  return ds
}

describe('setGroupPublic 行为契约护栏', () => {
  it('未登录（_getUserId=null）→ return false，不 updateGroup 不 saveAppData 不碰 supabase', async () => {
    _auth.user = null
    const ds = await seedGroup('g-anon', false)
    const updateSpy = vi.spyOn(ds, 'updateGroup')
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')

    const ok = await setGroupPublic('g-anon', true)

    expect(ok).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(_app.saveAppDataSpy).not.toHaveBeenCalled()
    expect(_supa.updateSpy).not.toHaveBeenCalled() // 未登录不发起远端写
  })

  it('group 不存在（groupMap 无 gid）→ return false，不 updateGroup 不 saveAppData 不碰 supabase', async () => {
    const ds = await seedGroup('g-exists', false)
    const updateSpy = vi.spyOn(ds, 'updateGroup')
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')

    const ok = await setGroupPublic('g-missing', true)

    expect(ok).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(_app.saveAppDataSpy).not.toHaveBeenCalled()
    expect(_supa.updateSpy).not.toHaveBeenCalled()
  })

  it('成功路径：updateGroup({isPublic:true}) 本地先改 + saveAppData 落盘 + supabase 写 sibling_groups + return true', async () => {
    const ds = await seedGroup('g-pub', false)
    const updateSpy = vi.spyOn(ds, 'updateGroup')
    _supa.setReturn = { error: null }
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')

    const ok = await setGroupPublic('g-pub', true)

    expect(ok).toBe(true)
    // 本地态先改（updateGroup 入参 {isPublic:true}）
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith('g-pub', expect.objectContaining({ isPublic: true }))
    expect(ds.groupMap['g-pub'].isPublic).toBe(true)
    // 落盘
    expect(_app.saveAppDataSpy).toHaveBeenCalledTimes(1)
    // 远端写：from('sibling_groups').update({is_public:true}).eq('id',gid).eq('user_id',uid)
    expect(_supa.fromTable).toBe('sibling_groups')
    expect(_supa.updateSpy).toHaveBeenCalledWith({ is_public: true })
    // 两级 eq：列名 'id' + 'user_id'，值分别为 gid + 当前 userId
    expect(_supa.eqCalls).toContainEqual({ col: 'id', val: 'g-pub' })
    expect(_supa.eqCalls.find(e => e.col === 'user_id')?.val).toBe('user-abc')
  })

  it('supabase error 时 return false（本地已改 + saveAppData 已调——编排顺序锁定现状防回归）', async () => {
    const ds = await seedGroup('g-err', false)
    const updateSpy = vi.spyOn(ds, 'updateGroup')
    _supa.setReturn = { error: { message: 'rls denied' } } as any
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')

    const ok = await setGroupPublic('g-err', true)

    expect(ok).toBe(false)
    // 本地态已先被 updateGroup 改了（编排按"本地先改 → 落盘 → 远端写"顺序，远端失败不回滚本地）
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(ds.groupMap['g-err'].isPublic).toBe(true)
    expect(_app.saveAppDataSpy).toHaveBeenCalledTimes(1) // 落盘已发生
    expect(warnSpy).toHaveBeenCalled() // error 走 console.warn 分支
    warnSpy.mockRestore()
  })

  it('isPublic=false 关闭公开：updateGroup({isPublic:false}) + supabase update({is_public:false})', async () => {
    const ds = await seedGroup('g-close', true)
    const updateSpy = vi.spyOn(ds, 'updateGroup')
    _supa.setReturn = { error: null }
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')

    const ok = await setGroupPublic('g-close', false)

    expect(ok).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith('g-close', expect.objectContaining({ isPublic: false }))
    expect(ds.groupMap['g-close'].isPublic).toBe(false)
    expect(_supa.updateSpy).toHaveBeenCalledWith({ is_public: false })
  })

  it('supabase update 链以 gid + userId 双 eq RLS 校验（防他人组被误改）', async () => {
    _auth.user = { id: 'user-xyz' }
    await seedGroup('g-rls', false)
    _supa.setReturn = { error: null }
    const { setGroupPublic } = await import('../../composables/domain/syncShare.js')

    await setGroupPublic('g-rls', true)

    // 两条 eq：列名 'id' + 'user_id'，值各为 gid + 当前 userId
    const eqCalls = _supa.eqCalls
    expect(eqCalls.map(c => c.col)).toContain('id')
    expect(eqCalls.map(c => c.col)).toContain('user_id')
    expect(eqCalls.find(c => c.col === 'user_id')?.val).toBe('user-xyz')
  })
})
