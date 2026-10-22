/**
 * syncPortCore — 同步端口共享契约
 *
 * 单独成文件的目的：让 Supabase 实现与 CloudBase 实现都能引用同一套类型与分页工具，
 * 而 `syncRemotePort.ts` 又要 import CloudBase 实现来做后端选择——若类型与工具留在
 * `syncRemotePort.ts` 就会形成 ESM 循环依赖（syncRemotePort ↔ syncRemotePort.cloudbase）。
 */
import type { OpTable } from '../../stores/storage.js'

export type SyncTable = OpTable

export type SyncPortError = { message: string; code?: string } | null

export type SyncPortResult<T = unknown> = {
  data: T | null
  error: SyncPortError
  /** 受影响行数（仅 update 携带）：不带 count 时为 null，
   *  带 {count:'exact'} 时为实际命中行数；0 = 无匹配行（远端该 id 不存在/已删/RLS 拒绝）。
   *  syncPush 据此区分「成功更新 N 行」与「无匹配 update 静默成功」，后者会丢本地变更。 */
  count?: number | null
}

export interface SyncRemotePort {
  upsert(table: SyncTable, row: Record<string, unknown> | Array<Record<string, unknown>>): Promise<SyncPortResult>
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
  selectAllIds(table: SyncTable, userId: string): Promise<SyncPortResult<Array<{ id: string }>>>
  /**
   * 墓园查询（032 迁移 deleted_item_graveyard）：已被任意端彻底删除（物理 DELETE）
   * 的条目 id。补推判据（_enqueueMissingToCloud）据此把「云端缺 id」中真正属于
   * 「远端已彻底删」的部分排除——存活快照重推会被服务端 032 触发器拦截成静默
   * no-op，客户端预排除可避免每次 initialSync 反复入队注定失败的 op。
   */
  selectGraveyardIds(userId: string): Promise<SyncPortResult<Array<{ table_name: string; item_id: string }>>>
}

/**
 * PostgREST 默认每页最多 1000 行限制；全量 ID 探测、软删查询与墓园对账必须分页遍历，
 * 否则超过 1000 条后数据被静默截断，导致全量对账（reconcile）把本地未返回的存活/已删条目误判误删。
 */
export async function fetchAllPages<T>(
  queryFn: (from: number, to: number) => Promise<{
    data: T[] | null
    error: { message: string; code?: string } | null
    hasRange?: boolean
  }>,
): Promise<SyncPortResult<T[]>> {
  const PAGE_SIZE = 1000
  let from = 0
  const all: T[] = []
  while (true) {
    const res = await queryFn(from, from + PAGE_SIZE - 1)
    if (res.error) {
      return { data: null, error: { message: res.error.message, code: res.error.code } }
    }
    // 首页返回 null 时忠实透传 null（与旧契约中 data || null 一致）
    if (res.data === null && from === 0) {
      return { data: null, error: null }
    }
    if (!res.data || res.data.length === 0) {
      break
    }
    all.push(...res.data)
    if (res.data.length < PAGE_SIZE || !res.hasRange) {
      break
    }
    from += PAGE_SIZE
  }
  return { data: all, error: null }
}
