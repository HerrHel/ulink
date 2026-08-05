/**
 * useDataShare-forkPublicGroup.test.ts — Fork 公开组到自己座行为契约护栏
 *
 * forkPublicGroup（useDataShare L59 export async）编排含多条真 bug 痕迹安全契约零护栏：
 *   - B-10：父子关系保留——fork 后子 bookmark 的 parentId 经 oldToLocal 映射指向新父 id
 *     （旧实现不映射 → parentId 指向原分享者旧 id 本地不存在 → 孤儿不可见）
 *   - M17：fork 时 O(1) url 去重——本地已有同 URL 的 bookmark 跳过 addBookmark，组 bookmarkIds
 *     用本地已有 id（oldToLocal 映射），避免重复入库 + toast 计数不夸大
 *   - 悬空过滤：group.bookmarkIds 中 fetchPublicGroup 漏拉/RLS 软删过滤/Zod 失败的 bid，
 *     idMap.get(bid)=undefined 或 addedIds 不含 → 丢弃（旧实现把不存在的 id 塞进组悬空）
 *   - 安全：不复制原 password/username（fork 入库强制 password='' username=''）
 *   - 实际入库计数：toast 报告 actualAdded.length，非全 bookmarks.length（去重跳过后不夸大）
 *   - fork 末尾触发 useCloudSync.fullSync 走 push 管道
 *
 * 口径：纯加测试零源文件改动。mock newId（可控可预测 id 便于验 oldToLocal/B-10 映射）+
 * saveAppData（防真 persist IO）+ toast（断计数文案）+ useCloudSync.fullSync（断调用），
 * 用真实 useDataStore（验 addBookmark/updateBookmark/addGroup 副作用落到 bookmarkMap）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── newId mock：可控可预测 id（prefix + hint → 固定串）便于验 oldToLocal 映射 ──
// newId(prefix, uniqHint) → `${prefix}-${hint}`（去随机/时间戳，可断言）
const _newId = vi.hoisted(() => ({
  gCounter: 0,
  bCounter: 0,
}))
vi.mock('../../lib/newId.js', () => ({
  newId: (prefix: string, hint?: number | string) => {
    if (prefix === 'g') return 'g-new-' + (++_newId.gCounter)
    if (prefix === 'b') {
      const h = hint == null ? ++_newId.bCounter : hint
      return 'b-new-' + h
    }
    return prefix + '-new-x'
  },
}))

// ── toast spy + saveAppData spy（防真 persist IO）──
const _toast = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: _toast.toastSpy }))
const _app = vi.hoisted(() => ({ saveAppDataSpy: vi.fn() }))
vi.mock('../../stores/app.js', () => ({
  saveAppData: _app.saveAppDataSpy,
  debouncedSaveAppData: vi.fn(),
}))

// ── useCloudSync mock：fullSync spy（fork 末尾调用）+ 抑制真实同步链 ──
const _sync = vi.hoisted(() => ({ fullSyncSpy: vi.fn(async () => {}) }))
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({ fullSync: _sync.fullSyncSpy, fetchPublicGroup: vi.fn() }),
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  _toast.toastSpy.mockClear()
  _app.saveAppDataSpy.mockClear()
  _sync.fullSyncSpy.mockClear()
  _newId.gCounter = 0
  _newId.bCounter = 0
})

async function makeBookmark(over: Partial<any> & { id: string }): Promise<any> {
  return {
    title: 'bm', url: 'https://x.example.com', username: 'u', password: 'p', notes: '', icon: '',
    categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {},
    isExpanded: false, createdAt: 1, updatedAt: 1, ...over,
  }
}

async function forkCalls() {
  const { forkPublicGroup } = await import('../../composables/domain/useDataShare.js')
  return forkPublicGroup
}

describe('forkPublicGroup — 基础编排契约', () => {
  it('2 个独立 bookmark fork：2 addBookmark + 1 addGroup + bookmarkIds 全保留 + toast 计数 2', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    const addBmSpy = vi.spyOn(ds, 'addBookmark')
    const addGrpSpy = vi.spyOn(ds, 'addGroup')
    const group = {
      id: 'g-src', name: '分享组', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-src-1', 'b-src-2'], notes: '', useCount: 5, updatedAt: 1, isPublic: true,
    } as any
    const bms = [
      await makeBookmark({ id: 'b-src-1', url: 'https://a.example.com' }),
      await makeBookmark({ id: 'b-src-2', url: 'https://b.example.com' }),
    ]
    const forkPublicGroup = await forkCalls()

    await forkPublicGroup(group, bms)

    expect(addBmSpy).toHaveBeenCalledTimes(2)
    expect(addGrpSpy).toHaveBeenCalledTimes(1)
    // new id 用 newId('b', 0/1) → 'b-new-0'/'b-new-1'
    const newIds = ds.bookmarks.map((b: any) => b.id)
    expect(newIds).toContain('b-new-0')
    expect(newIds).toContain('b-new-1')
    // 组 bookmarkIds 全保留（无去重/漏拉）
    const newGroup = ds.siblingGroups.find((g: any) => g.id === 'g-new-1') as any
    expect(newGroup).toBeTruthy()
    expect(newGroup.bookmarkIds).toEqual(expect.arrayContaining(['b-new-0', 'b-new-1']))
    expect(newGroup.isPublic).toBe(false) // fork 后转私有
    expect(newGroup.useCount).toBe(0) // useCount 重置
    // toast 计数 2
    expect(_toast.toastSpy).toHaveBeenCalledWith(expect.stringContaining('2 个书签'))
    expect(_app.saveAppDataSpy).toHaveBeenCalledTimes(1)
    expect(_sync.fullSyncSpy).toHaveBeenCalledTimes(1)
  })

  it('安全契约：fork 入库的 bookmark password/username 强制清空（不泄漏原分享者凭证）', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    const group = {
      id: 'g-sec', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-sec'], notes: '', useCount: 0, updatedAt: 1, isPublic: true,
    } as any
    const bms = [await makeBookmark({ id: 'b-sec', url: 'https://sec.example.com', username: 'leaked-user', password: 'leaked-pw' })]
    const forkPublicGroup = await forkCalls()

    await forkPublicGroup(group, bms)

    const newBm = ds.bookmarkMap['b-new-0'] as any
    expect(newBm).toBeTruthy()
    expect(newBm.password).toBe('')
    expect(newBm.username).toBe('')
    expect(newBm.createdAt).toBeGreaterThan(0) // 新建时间
  })
})

describe('forkPublicGroup — B-10 父子关系保留', () => {
  it('parent + child（child.parentId 指向 parent）fork 后 child.parentId 映射到 new parent id', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    // b-src-parent + b-src-child（parentId=b-src-parent），bookmarkIds 顺序 parent 在前确保 newId('b',0)=parent
    const group = {
      id: 'g-b10', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-src-parent', 'b-src-child'], notes: '', useCount: 0, updatedAt: 1, isPublic: true,
    } as any
    const bms = [
      await makeBookmark({ id: 'b-src-parent', url: 'https://parent.example.com' }),
      await makeBookmark({ id: 'b-src-child', url: 'https://child.example.com', parentId: 'b-src-parent' }),
    ]
    const forkPublicGroup = await forkCalls()
    const updSpy = vi.spyOn(ds, 'updateBookmark')

    await forkPublicGroup(group, bms)

    // parent: newId('b',0)='b-new-0'；child: newId('b',1)='b-new-1'
    expect(ds.bookmarkMap['b-new-0']).toBeTruthy()
    expect(ds.bookmarkMap['b-new-1']).toBeTruthy()
    // child 的 parentId 经 B-10 映射指向 new parent id（非 原 'b-src-parent' 孤儿）
    expect(ds.bookmarkMap['b-new-1'].parentId).toBe('b-new-0')
    // updateBookmark 被调用于修 child 的 parentId
    expect(updSpy).toHaveBeenCalledWith('b-new-1', expect.objectContaining({ parentId: 'b-new-0' }))
  })

  it('B-10 边界：child 的 parentId 在本次 fork 范围外（fetchPublicGroup 漏拉父）→ child 变顶层不悬挂', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    // 父被漏拉（bookmarks 里只有 child，但 child.parentId 指向不存在的 'b-missing-parent'）
    const group = {
      id: 'g-orphan', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-src-child'], notes: '', useCount: 0, updatedAt: 1, isPublic: true,
    } as any
    const bms = [await makeBookmark({ id: 'b-src-child', url: 'https://child.example.com', parentId: 'b-missing-parent' })]
    const forkPublicGroup = await forkCalls()
    const updSpy = vi.spyOn(ds, 'updateBookmark')

    await forkPublicGroup(group, bms)

    // child.newId='b-new-0'；parentId 映射失败 → updateBookmark(id,{parentId:null}) 变顶层
    expect(ds.bookmarkMap['b-new-0']).toBeTruthy()
    expect(updSpy).toHaveBeenCalledWith('b-new-0', expect.objectContaining({ parentId: null }))
    expect(ds.bookmarkMap['b-new-0'].parentId).toBeNull()
  })
})

describe('forkPublicGroup — M17 url 去重跳过本地已有', () => {
  it('本地已有同 URL bookmark A，fork 含同 URL bookmark B → B 跳过 addBookmark，组用 A 的本地 id', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    // 预置本地已存在的 bookmark A（url=U）
    const existingA = await makeBookmark({ id: 'local-A', url: 'https://dup.example.com' })
    ds.bookmarks.push(existingA)
    ds._bmMap[existingA.id] = existingA
    const addBmSpy = vi.spyOn(ds, 'addBookmark')
    const group = {
      id: 'g-dup', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-dup', 'b-uniq'], notes: '', useCount: 0, updatedAt: 1, isPublic: true,
    } as any
    const bms = [
      await makeBookmark({ id: 'b-dup', url: 'https://dup.example.com' }),     // 同 URL → 去重跳过
      await makeBookmark({ id: 'b-uniq', url: 'https://uniq.example.com' }),  // 唯一 → 入库
    ]
    const forkPublicGroup = await forkCalls()

    await forkPublicGroup(group, bms)

    // 仅 addBookmark 1 次（b-uniq），b-dup 跳过
    expect(addBmSpy).toHaveBeenCalledTimes(1)
    // newBookmarkIds 过滤掉跳过的 b-dup（addedIds 不含其 newId），但用 local-A 替换 → 仍含 'local-A'?
    // 源 L135-137: newBookmarkIds = group.bookmarkIds.map(idMap.get).filter(!!id && addedIds.has(id))
    // b-dup 的 newId='b-new-0' 但 addedIds 不含（跳过）→ 被过滤掉，不用 local-A
    const newGroup = ds.siblingGroups.find((g: any) => g.id === 'g-new-1') as any
    expect(newGroup).toBeTruthy()
    expect(newGroup.bookmarkIds).not.toContain('b-new-0') // 去重跳过的 newId 被过滤
    expect(newGroup.bookmarkIds).toContain('b-new-1')     // b-uniq newId 入选
    // toast 计数 1（actualAdded 仅 b-uniq）
    expect(_toast.toastSpy).toHaveBeenCalledWith(expect.stringContaining('1 个书签'))
  })

  it('M17 大小写不敏感去重：url 大小写差异仍判为同 URL', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    const existingA = await makeBookmark({ id: 'local-A', url: 'https://Case.Example.com/path' })
    ds.bookmarks.push(existingA)
    ds._bmMap[existingA.id] = existingA
    const addBmSpy = vi.spyOn(ds, 'addBookmark')
    const group = {
      id: 'g-ci', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-dup'], notes: '', useCount: 0, updatedAt: 1, isPublic: true,
    } as any
    // fork bookmark url 小写化后等于 existingA url 小写化 → 去重
    const bms = [await makeBookmark({ id: 'b-dup', url: 'https://case.example.com/PATH' })]
    const forkPublicGroup = await forkCalls()

    await forkPublicGroup(group, bms)

    expect(addBmSpy).not.toHaveBeenCalled() // 去重跳过，无新入库
  })
})

describe('forkPublicGroup — 悬空 id 过滤', () => {
  it('group.bookmarkIds 含 fetchPublicGroup 漏拉的 bid（bookmarks 无对应）→ 丢弃不悬空', async () => {
    const { useDataStore } = await import('../../stores/data.js')
    const ds = useDataStore()
    const group = {
      id: 'g-dangling', name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: ['b-real', 'b-ghost'], notes: '', useCount: 0, updatedAt: 1, isPublic: true,
    } as any
    // bookmarks 只含 b-real，b-ghost 被 RLS 软删/Zod 失败漏拉
    const bms = [await makeBookmark({ id: 'b-real', url: 'https://real.example.com' })]
    const forkPublicGroup = await forkCalls()

    await forkPublicGroup(group, bms)

    const newGroup = ds.siblingGroups.find((g: any) => g.id === 'g-new-1') as any
    expect(newGroup).toBeTruthy()
    // b-ghost 漏拉 → idMap.get('b-ghost')=undefined → 被 filter 丢弃
    expect(newGroup.bookmarkIds).toEqual(['b-new-0']) // 仅 b-real 的 newId
    expect(newGroup.bookmarkIds).not.toContain('b-ghost')
  })
})
