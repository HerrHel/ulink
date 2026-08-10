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
  /** 受影响行数（仅 update 携带）：Supabase update 不带 count 时为 null，
   *  带 {count:'exact'} 时为实际命中行数；0 = 无匹配行（远端该 id 不存在/已删/RLS 拒绝）。
   *  syncPush 据此区分「成功更新 N 行」与「无匹配 update 静默成功」，后者会丢本地变更。 */
  count?: number | null
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
      // 带 count:'exact' 区分无匹配更新（count=0）与成功更新（count>=1）。
      // Supabase update 不命中时返 { data: null, error: null }，与成功同形——
      // 仅靠 error 无法识别静默失败，必须靠 count 透传，否则 syncPush 会误判成功永久出队丢本地变更。
      const r = await supabase
        .from(table)
        .update(patch as any, { count: 'exact' })
        .eq('id', id)
        .eq('user_id', userId)
      return {
        data: r.data,
        error: r.error ? { message: r.error.message, code: r.error.code } : null,
        count: r.count,
      }
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
  /** update 受影响行数：默认 1（命中）；传 0 模拟「无匹配 update」（远端行已删/不存在/RLS 拒绝） */
  updateCount?: () => number | null
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
      // 默认 count=1（命中）；测试可注入 updateCount()=0 模拟无匹配 update
      const count = opts?.updateCount ? opts.updateCount() : 1
      return { data: null, error: err, count }
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
