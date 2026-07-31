/**
 * syncMergeCore — decideRemoteApply 表驱动矩阵（≥12 场景）
 * 纯决策、无 store / supabase 副作用。
 */
import { describe, it, expect } from 'vitest'
import { decideRemoteApply } from '../../composables/domain/syncMergeCore.js'

const base = { id: 'x-1', updatedAt: 1000 }
const remoteNewer = { id: 'x-1', updatedAt: 9000 }
const remoteOlder = { id: 'x-1', updatedAt: 500 }
const remoteSoft = { id: 'x-1', updatedAt: 9000, deletedAt: 9000 }
const localSoft = { id: 'x-1', updatedAt: 1000, deletedAt: 5000 }

describe('decideRemoteApply 矩阵', () => {
  it.each([
    {
      name: '1 本地无 + 远端活 → insert',
      input: {
        localItem: null,
        remoteItem: remoteNewer,
        isDirty: false,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'insert',
    },
    {
      name: '2 本地无 + 远端软删 → insert（回收站）',
      input: {
        localItem: null,
        remoteItem: remoteSoft,
        isDirty: false,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'insert',
    },
    {
      name: '3 dirty + remoteNewer + lastSyncAt>0 → conflict',
      input: {
        localItem: base,
        remoteItem: remoteNewer,
        isDirty: true,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'conflict',
    },
    {
      name: '4 dirty + remote 更旧 → skip',
      input: {
        localItem: base,
        remoteItem: remoteOlder,
        isDirty: true,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'skip',
    },
    {
      name: '5 pending + remoteNewer → conflict（H3）',
      input: {
        localItem: base,
        remoteItem: remoteNewer,
        isDirty: false,
        isPending: true,
        lastSyncAt: 1,
      },
      expected: 'conflict',
    },
    {
      name: '6 远端软删本地活 → soft-delete',
      input: {
        localItem: base,
        remoteItem: remoteSoft,
        isDirty: false,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'soft-delete',
    },
    {
      name: '7 远端复活 → revive-assign',
      input: {
        localItem: localSoft,
        remoteItem: remoteNewer,
        isDirty: false,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'revive-assign',
    },
    {
      name: '8 remoteNewer 普通 → assign',
      input: {
        localItem: base,
        remoteItem: remoteNewer,
        isDirty: false,
        isPending: false,
        lastSyncAt: 1,
      },
      expected: 'assign',
    },
    {
      name: '9 full + 远端无 + 非 dirty + lastSyncAt>0 → full-absent-delete',
      input: {
        localItem: base,
        remoteItem: null,
        isDirty: false,
        isPending: false,
        lastSyncAt: 1,
        full: true,
      },
      expected: 'full-absent-delete',
    },
    {
      name: '10 full + dirty → skip（不删）',
      input: {
        localItem: base,
        remoteItem: null,
        isDirty: true,
        isPending: false,
        lastSyncAt: 1,
        full: true,
      },
      expected: 'skip',
    },
    {
      name: '11 full + pending → skip（不删）',
      input: {
        localItem: base,
        remoteItem: null,
        isDirty: false,
        isPending: true,
        lastSyncAt: 1,
        full: true,
      },
      expected: 'skip',
    },
    {
      name: '12 lastSyncAt=0 dirty+remoteNewer → skip（不登记 conflict）',
      input: {
        localItem: base,
        remoteItem: remoteNewer,
        isDirty: true,
        isPending: false,
        lastSyncAt: 0,
      },
      expected: 'skip',
    },
  ])('$name', ({ input, expected }) => {
    expect(decideRemoteApply(input).action).toBe(expected)
  })

  it('remote 不 newer → skip', () => {
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteOlder,
      isDirty: false,
      isPending: false,
      lastSyncAt: 1,
    }).action).toBe('skip')
  })

  it('lastSyncAt=0 full absent → skip', () => {
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: null,
      isDirty: false,
      isPending: false,
      lastSyncAt: 0,
      full: true,
    }).action).toBe('skip')
  })

  // ===== D1-29 边界护栏：顺序敏感与守卫半边 =====
  // 锁定源码判定顺序：remoteItem==null(full 守卫) → 本地无 insert → dirty → pending → !remoteNewer → soft-delete/revive → assign；
  // isRemoteNewer 的 ||0 兜底与严格 >；以及 dirty/pending 优先于 soft-delete 这条最易被误改的顺序敏感核心
  // （误判会把本地未推送 dirty/in-flight 编辑被远端软删静默覆盖）。

  it('D1-29a 非 full 模式 + 远端无项 → skip（full 守卫核心）', () => {
    // full=false（默认）时 remoteItem=null 必走 skip 而非 full-absent-delete；
    // 易被误改为「任何远端无项都删」会静默删本地存活项
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: null,
      isDirty: false,
      isPending: false,
      lastSyncAt: 1,
      full: false,
    }).action).toBe('skip')
  })

  it('D1-29b full 模式 + 本地无项 + 远端无项 → skip', () => {
    // full=true 但 localItem=null：`full && localItem` 失败 → skip（无本地项可删）
    expect(decideRemoteApply({
      localItem: null,
      remoteItem: null,
      isDirty: false,
      isPending: false,
      lastSyncAt: 1,
      full: true,
    }).action).toBe('skip')
  })

  it('D1-29c pending + 远端不 newer + lastSyncAt>0 → skip（pending 分支 skip 半边）', () => {
    // 现有场景5仅测 pending+remoteNewer→conflict 半边，pending+!remoteNewer→skip 半边零直测
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteOlder,
      isDirty: false,
      isPending: true,
      lastSyncAt: 1,
    }).action).toBe('skip')
  })

  it('D1-29d pending + remoteNewer + lastSyncAt=0 → skip（pending 的 lastSyncAt 守卫）', () => {
    // pending 分支同样有 lastSyncAt>0 守卫前置，未同步过不登记 conflict（与 dirty 场景12 对称）
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteNewer,
      isDirty: false,
      isPending: true,
      lastSyncAt: 0,
    }).action).toBe('skip')
  })

  it('D1-29e remote 与 local updatedAt 相等 → 不算 newer（严格 >）→ 普通 skip', () => {
    // isRemoteNewer 用严格 `>`：相等不 newer → skip
    const localEq = { id: 'x-1', updatedAt: 9000 }
    const remoteEq = { id: 'x-1', updatedAt: 9000 }
    expect(decideRemoteApply({
      localItem: localEq,
      remoteItem: remoteEq,
      isDirty: false,
      isPending: false,
      lastSyncAt: 1,
    }).action).toBe('skip')
  })

  it('D1-29f remote updatedAt 缺失 → ||0 兜底 → 不 newer → skip', () => {
    // remote 无 updatedAt → (undefined||0)=0 vs local 1000 → 0>1000 false → 不 newer → skip
    const remoteNoTs = { id: 'x-1' } as { id: string; updatedAt?: number }
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteNoTs,
      isDirty: false,
      isPending: false,
      lastSyncAt: 1,
    }).action).toBe('skip')
  })

  it('D1-29g dirty 优先于 soft-delete：dirty + 远端软删且 newer + lastSyncAt>0 → conflict（非 soft-delete）', () => {
    // 顺序敏感核心：dirty 判定在 soft-delete 之前。本地有未推送编辑时即便远端 newer 且是软删，
    // 仍应登记 conflict 供用户裁决而非静默软删覆盖本地编辑。
    // 若未来误把 soft-delete 判断提到 dirty 之前，会把本地未推送编辑被远端软删静默覆盖。
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteSoft,
      isDirty: true,
      isPending: false,
      lastSyncAt: 1,
    }).action).toBe('conflict')
  })

  it('D1-29h pending 优先于 soft-delete：pending + 远端软删且 newer + lastSyncAt>0 → conflict（非 soft-delete）', () => {
    // 同 D1-29g：pending 判定也在 soft-delete 之前，in-flight 待推编辑遇到远端软删应 conflict 不静默覆盖
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteSoft,
      isDirty: false,
      isPending: true,
      lastSyncAt: 1,
    }).action).toBe('conflict')
  })

  it('D1-29i dirty + 远端软删但不 newer + lastSyncAt>0 → skip（dirty 分支 skip 半边）', () => {
    // 远端虽软删但 updatedAt 比 local 旧 → remoteNewer=false → dirty 走 `否则 skip` 半边
    const remoteSoftOlder = { id: 'x-1', updatedAt: 500, deletedAt: 500 }
    expect(decideRemoteApply({
      localItem: base,
      remoteItem: remoteSoftOlder,
      isDirty: true,
      isPending: false,
      lastSyncAt: 1,
    }).action).toBe('skip')
  })
})
