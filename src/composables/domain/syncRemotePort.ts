/**
 * syncRemotePort — 同步远端 IO 端口
 *
 * push/pull/initialSync id probe 经此接口访问表数据；
 * 分享 RPC / setGroupPublic 可暂留直接 supabase。
 * 单测注入 fake port，避免 mock 整棵 supabase 客户端。
 */
import { supabase } from '../../lib/supabase.js'
import { isCloudBaseBackend } from '../../lib/cloudbase.js'
import { createCloudBaseSyncPort } from './syncRemotePort.cloudbase.js'
import {
  fetchAllPages,
  type SyncPortError,
  type SyncPortResult,
  type SyncRemotePort,
  type SyncTable,
} from './syncPortCore.js'

// 契约与分页工具仍从本模块导出，保持既有调用方与测试的导入路径不变
export type { SyncPortError, SyncPortResult, SyncRemotePort, SyncTable }
export { fetchAllPages }

/** 默认 Supabase 实现 */
export function createSupabaseSyncPort(): SyncRemotePort {
  return {
    async upsert(table, row) {
      // 刻意不指定 onConflict：让 PostgREST 以「表当前主键」为冲突目标。
      //
      // 历史 bug：原先写死 { onConflict: 'id' }，而同步表主键一度是单列
      // `id TEXT PRIMARY KEY`（**全局唯一，而非 per-user 唯一**）。首装种子数据用的
      // 是全局固定 id（bookmarks: b1~b5/sb1/sb2；categories: all/uncategorized/email/
      // tools/ai/social/game；attributes: requires-login/ai/is-group，共 15 项推送项），
      // 于是第一个把种子推上云的用户会占住这些 id；此后**每一个**新账户 upsert 都撞
      // 这些行 → ON CONFLICT DO UPDATE → 触发 UPDATE 策略的 USING (auth.uid()=user_id)
      // → 行属于别人，USING 为假 → `new row violates row-level security policy
      // (USING expression)`，整批推送失败。
      //
      // 修复见迁移 027_per_user_id_composite_pk.sql：主键改为 (user_id, id) 复合主键。
      // 但主键是 DDL、代码是前端资源，两者无法原子切换——若写死 onConflict，
      // 迁移前后必有一段时间与库内主键不匹配（onConflict 指定的列组必须存在对应唯一
      // 约束，否则 PostgREST 报 "no unique or exclusion constraint matching"）。
      // 交给 PostgREST 读当前主键即可两个阶段都正确：迁移前 (id)、迁移后 (user_id, id)。
      // 前提：row 必须携带全部主键列——toRemoteRow 已输出 id 与 user_id，满足。
      const r = await supabase.from(table).upsert(row)
      return { data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null }
    },
    async update(table, id, userId, patch) {
      // 带 count:'exact' 区分无匹配更新（count=0）与成功更新（count>=1）。
      // Supabase update 不命中时返 { data: null, error: null }，与成功同形——
      // 仅靠 error 无法识别静默失败，必须靠 count 透传，否则 syncPush 会误判成功永久出队丢本地变更。
      const r = await supabase
        .from(table)
        .update(patch, { count: 'exact' })
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
      return fetchAllPages<unknown>(async (from, to) => {
        let q: any = supabase.from(table).select('*').eq('user_id', userId).gt('updated_at_num', since)
        if (typeof q.order === 'function') q = q.order('updated_at_num', { ascending: true }).order('id', { ascending: true })
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as unknown[]) || null,
          error: r.error ? { message: r.error.message, code: r.error.code } : null,
          hasRange,
        }
      })
    },
    async selectSoftDeleted(table, userId, since) {
      return fetchAllPages<{ id: string; updated_at_num?: number }>(async (from, to) => {
        let q: any = supabase
          .from(table)
          .select('id, updated_at_num')
          .eq('user_id', userId)
          .not('deleted_at', 'is', null)
          .gt('updated_at_num', since)
        if (typeof q.order === 'function') q = q.order('updated_at_num', { ascending: true }).order('id', { ascending: true })
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as Array<{ id: string; updated_at_num?: number }>) || null,
          error: r.error ? { message: r.error.message, code: r.error.code } : null,
          hasRange,
        }
      })
    },
    async selectAllIds(table, userId) {
      return fetchAllPages<{ id: string }>(async (from, to) => {
        let q: any = supabase.from(table).select('id').eq('user_id', userId)
        if (typeof q.order === 'function') q = q.order('id', { ascending: true })
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as Array<{ id: string }>) || null,
          error: r.error ? { message: r.error.message, code: r.error.code } : null,
          hasRange,
        }
      })
    },
    async selectGraveyardIds(userId) {
      return fetchAllPages<{ table_name: string; item_id: string }>(async (from, to) => {
        let q: any = supabase
          .from('deleted_item_graveyard')
          .select('table_name, item_id')
          .eq('user_id', userId)
        if (typeof q.order === 'function') q = q.order('table_name', { ascending: true }).order('item_id', { ascending: true })
        const hasRange = typeof q.range === 'function'
        if (hasRange) q = q.range(from, to)
        const r = await q
        return {
          data: (r.data as Array<{ table_name: string; item_id: string }>) || null,
          error: r.error ? { message: r.error.message, code: r.error.code } : null,
          hasRange,
        }
      })
    },
  }
}

let _injected: SyncRemotePort | null = null
let _default: SyncRemotePort | null = null

/**
 * 默认端口按后端开关惰性创建：
 * - `VITE_BACKEND=cloudbase` → CloudBase PG 驱动
 * - 其余（含未设置）→ 现有 Supabase 驱动
 *
 * 惰性而非模块顶层求值，是为了让 `setSyncRemotePort` 注入在任何调用顺序下都优先，
 * 同时避免 import 阶段就碰 CloudBase 单例初始化。
 */
function defaultPort(): SyncRemotePort {
  if (!_default) {
    _default = isCloudBaseBackend() ? createCloudBaseSyncPort() : createSupabaseSyncPort()
  }
  return _default
}

/** 生产与默认：按后端开关选择 port；测试可 setSyncRemotePort 注入 */
export function getSyncRemotePort(): SyncRemotePort {
  return _injected ?? defaultPort()
}

/** 测试专用：注入 fake port；传 null 恢复默认 */
export function setSyncRemotePort(port: SyncRemotePort | null): void {
  _injected = port
}

/** 测试专用：清空惰性默认 port，便于切换后端开关后重新求值 */
export function __resetDefaultSyncPortForTest(): void {
  _default = null
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
  /** 032 墓园行：补推排除判据（_enqueueMissingToCloud） */
  graveyard?: Array<{ table_name: string; item_id: string }>
  graveyardError?: SyncPortError
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
      if (Array.isArray(row)) {
        for (const r of row) {
          const err = opts?.upsertError?.(table, r) ?? null
          if (!err) upserts.push({ table, row: r })
          if (err) return { data: null, error: err }
        }
        return { data: null, error: null }
      }
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
    async selectGraveyardIds() {
      if (opts?.graveyardError) return { data: null, error: opts.graveyardError }
      return { data: opts?.graveyard ?? [], error: null }
    },
  }
}
