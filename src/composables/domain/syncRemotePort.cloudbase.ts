/**
 * syncRemotePort.cloudbase — SyncRemotePort 的 CloudBase PG 实现
 *
 * 与 Supabase 实现的语义必须完全一致（syncPush 依赖 update 的 count 区分
 * 「更新成功」与「无匹配行静默失败」，误判会永久出队丢掉本地变更）。
 *
 * 实测差异与应对：
 * 1. **upsert 冲突目标**：显式传 `onConflict: 'user_id,id'`。CloudBase 目标库是
 *    全新库，主键从建表起就是 027 迁移定下的复合主键 `(user_id, id)`，不存在
 *    Supabase 那边「主键 DDL 与前端资源无法原子切换」的历史包袱，因此可以写死。
 * 2. **update 的影响行数**：CloudBase 若原生返回 `count` 就直接用；否则补一次
 *    `select('*', { count:'exact', head:true })` 取命中行数。多一次往返，
 *    但保住了「count=0 即无匹配」这一关键判据。
 * 3. **分页**：沿用 `fetchAllPages`，PostgREST/CloudBase 都有单页行数上限，
 *    全量对账必须分页，否则超限后静默截断会把未返回条目误判为已删。
 */
import {
  fetchAllPages,
  type SyncPortError,
  type SyncRemotePort,
  type SyncTable,
} from './syncPortCore.js'
import { getCbDb, type RdbClient } from '../../lib/cloudbase.js'

/** 同步表主键：027_per_user_id_composite_pk 起为复合主键 */
const ON_CONFLICT = 'user_id,id'

function toPortError(e: { message: string; code?: string } | null): SyncPortError {
  return e ? { message: e.message, code: e.code } : null
}

/**
 * update 影响行数解析：
 * - 原生带 count（r.count !== undefined && !== null）→ 直接用
 * - 否则补 head count 查询
 */
async function resolveUpdateCount(
  db: RdbClient,
  table: SyncTable,
  id: string,
  userId: string,
  nativeCount: number | null | undefined,
): Promise<number | null> {
  if (typeof nativeCount === 'number') return nativeCount
  const c = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('id', id)
    .eq('user_id', userId)
  if (c.error) return null
  return typeof c.count === 'number' ? c.count : null
}

export function createCloudBaseSyncPort(db: RdbClient = getCbDb()): SyncRemotePort {
  return {
    async upsert(table, row) {
      const r = await db.from(table).upsert(row, { onConflict: ON_CONFLICT })
      return { data: r.data, error: toPortError(r.error) }
    },

    async update(table, id, userId, patch) {
      const r = await db
        .from(table)
        .update(patch, { count: 'exact' })
        .eq('id', id)
        .eq('user_id', userId)
      const error = toPortError(r.error)
      if (error) return { data: null, error }
      const count = await resolveUpdateCount(db, table, id, userId, r.count)
      return { data: r.data, error: null, count }
    },

    async delete(table, id, userId) {
      const r = await db.from(table).delete().eq('id', id).eq('user_id', userId)
      return { data: r.data, error: toPortError(r.error) }
    },

    async selectSince(table, userId, since) {
      return fetchAllPages<unknown>(async (from, to) => {
        let q: any = db.from(table).select('*').eq('user_id', userId).gt('updated_at_num', since)
        if (typeof q.order === 'function') {
          q = q.order('updated_at_num', { ascending: true }).order('id', { ascending: true })
        }
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as unknown[]) || null,
          error: toPortError(r.error),
          hasRange,
        }
      })
    },

    async selectSoftDeleted(table, userId, since) {
      return fetchAllPages<{ id: string; updated_at_num?: number }>(async (from, to) => {
        let q: any = db
          .from(table)
          .select('id, updated_at_num')
          .eq('user_id', userId)
          .not('deleted_at', 'is', null)
          .gt('updated_at_num', since)
        if (typeof q.order === 'function') {
          q = q.order('updated_at_num', { ascending: true }).order('id', { ascending: true })
        }
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as Array<{ id: string; updated_at_num?: number }>) || null,
          error: toPortError(r.error),
          hasRange,
        }
      })
    },

    async selectAllIds(table, userId) {
      return fetchAllPages<{ id: string }>(async (from, to) => {
        let q: any = db.from(table).select('id').eq('user_id', userId)
        if (typeof q.order === 'function') q = q.order('id', { ascending: true })
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as Array<{ id: string }>) || null,
          error: toPortError(r.error),
          hasRange,
        }
      })
    },

    async selectGraveyardIds(userId) {
      return fetchAllPages<{ table_name: string; item_id: string }>(async (from, to) => {
        let q: any = db
          .from('deleted_item_graveyard')
          .select('table_name, item_id')
          .eq('user_id', userId)
        if (typeof q.order === 'function') {
          q = q.order('table_name', { ascending: true }).order('item_id', { ascending: true })
        }
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as Array<{ table_name: string; item_id: string }>) || null,
          error: toPortError(r.error),
          hasRange,
        }
      })
    },
  }
}
