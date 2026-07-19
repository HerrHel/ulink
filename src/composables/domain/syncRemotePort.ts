/**
 * syncRemotePort — 同步远端 IO 端口
 *
 * push/pull/initialSync id probe 经此接口访问表数据；
 * 分享 RPC / setGroupPublic 可暂留直接 supabase。
 * 单测注入 fake port，避免 mock 整棵 supabase 客户端。
 */
import { supabase } from '../../lib/supabase.js'
import type { OpTable } from '../../stores/storage.js'

export type SyncTable = OpTable

export type SyncPortError = { message: string; code?: string } | null

export type SyncPortResult<T = unknown> = {
  data: T | null
  error: SyncPortError
}

export interface SyncRemotePort {
  upsert(table: SyncTable, row: Record<string, unknown>): Promise<SyncPortResult>
  update(
    table: SyncTable,
    id: string,
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<SyncPortResult>
  delete(table: SyncTable, id: string, userId: string): Promise<SyncPortResult>
  selectSince(table: SyncTable, userId: string, since: number): Promise<SyncPortResult<unknown[]>>
  selectSoftDeleted(
    table: SyncTable,
    userId: string,
    since: number,
  ): Promise<SyncPortResult<Array<{ id: string; updated_at_num?: number }>>>
  selectAllIds(
    table: SyncTable,
    userId: string,
  ): Promise<SyncPortResult<Array<{ id: string }>>>
}

/** 默认 Supabase 实现 */
export function createSupabaseSyncPort(): SyncRemotePort {
  return {
    async upsert(table, row) {
      const r = await supabase.from(table).upsert(row as any, { onConflict: 'id' })
      return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null }
    },
    async update(table, id, userId, patch) {
      const r = await supabase.from(table).update(patch as any).eq('id', id).eq('user_id', userId)
      return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null }
    },
    async delete(table, id, userId) {
      const r = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
      return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null }
    },
    async selectSince(table, userId, since) {
      const r = await supabase.from(table).select('*').eq('user_id', userId).gt('updated_at_num', since)
      return {
        data: (r.data as unknown[]) || null,
        error: r.error ? { message: r.error.message, code: r.error.code } : null,
      }
    },
    async selectSoftDeleted(table, userId, since) {
      const r = await supabase
        .from(table)
        .select('id, updated_at_num')
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)
        .gt('updated_at_num', since)
      return {
        data: (r.data as Array<{ id: string; updated_at_num?: number }>) || null,
        error: r.error ? { message: r.error.message, code: r.error.code } : null,
      }
    },
    async selectAllIds(table, userId) {
      const r = await supabase.from(table).select('id').eq('user_id', userId)
      return {
        data: (r.data as Array<{ id: string }>) || null,
        error: r.error ? { message: r.error.message, code: r.error.code } : null,
      }
    },
  }
}

let _injected: SyncRemotePort | null = null
const _default = createSupabaseSyncPort()

/** 生产与默认：Supabase port；测试可 setSyncRemotePort 注入 */
export function getSyncRemotePort(): SyncRemotePort {
  return _injected ?? _default
}

/** 测试专用：注入 fake port；传 null 恢复默认 */
export function setSyncRemotePort(port: SyncRemotePort | null): void {
  _injected = port
}

/** 内存 fake：单测推演 per-op / 死信 / pull / reconcile */
export function createMemorySyncPort(opts?: {
  upsertError?: (table: SyncTable, row: Record<string, unknown>) => SyncPortError
  updateError?: () => SyncPortError
  deleteError?: () => SyncPortError
  sinceRows?: Partial<Record<SyncTable, unknown[]>>
  softDeleted?: Partial<Record<SyncTable, Array<{ id: string; updated_at_num?: number }>>>
  allIds?: Partial<Record<SyncTable, Array<{ id: string }>>>
  allIdsError?: Partial<Record<SyncTable, SyncPortError>>
  selectSinceError?: SyncPortError
}): SyncRemotePort & {
  upserts: Array<{ table: SyncTable; row: Record<string, unknown> }>
  updates: Array<{ table: SyncTable; id: string; patch: Record<string, unknown> }>
  deletes: Array<{ table: SyncTable; id: string }>
} {
  const upserts: Array<{ table: SyncTable; row: Record<string, unknown> }> = []
  const updates: Array<{ table: SyncTable; id: string; patch: Record<string, unknown> }> = []
  const deletes: Array<{ table: SyncTable; id: string }> = []

  return {
    upserts,
    updates,
    deletes,
    async upsert(table, row) {
      const err = opts?.upsertError?.(table, row) ?? null
      if (!err) upserts.push({ table, row })
      return { data: null, error: err }
    },
    async update(table, id, _userId, patch) {
      const err = opts?.updateError?.() ?? null
      if (!err) updates.push({ table, id, patch })
      return { data: null, error: err }
    },
    async delete(table, id) {
      const err = opts?.deleteError?.() ?? null
      if (!err) deletes.push({ table, id })
      return { data: null, error: err }
    },
    async selectSince(table) {
      if (opts?.selectSinceError) return { data: null, error: opts.selectSinceError }
      return { data: opts?.sinceRows?.[table] ?? [], error: null }
    },
    async selectSoftDeleted(table) {
      return { data: opts?.softDeleted?.[table] ?? [], error: null }
    },
    async selectAllIds(table) {
      const err = opts?.allIdsError?.[table] ?? null
      if (err) return { data: null, error: err }
      return { data: opts?.allIds?.[table] ?? [], error: null }
    },
  }
}
