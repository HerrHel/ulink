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
})
