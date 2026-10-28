/**
 * syncDedup — 离线重复创建项的内容级同步去重
 *
 * 事故场景：设备在线保存「腾讯云」（已上云，行 X）→ 断网期间又保存了一次（本地
 * 新 ID，行 Y，dirty/new）→ 恢复登录后 initialSync 先 pull 后 push：pull 侧
 * _mergeIntoLocal 按 ID 匹配不到 Y，把远端 X 当新项 insert；push 侧又把 Y 上云。
 * 结果云端与本地各留两张同内容卡片。
 *
 * 根因：合并决策（syncMergeCore.decideRemoteApply）只按 ID 对账，没有任何内容键
 * 语义；「同内容不同 ID」在离线重创建场景下必然双写。
 *
 * 修复口径（本模块只做纯判定，副作用由调用方执行）：
 * - 内容键：bookmark = 规整化 URL；group = 分类 ID + 组名（trim）。category /
 *   attribute 不参与（命名碰撞太常见，误杀风险高）。
 * - 只对「本地未上云」的存活项去重：本地项是否真的从未上云以云端全量 ID 探测为准
 *   （pull 路径），不能用 dirty/new 快判——应用刷新后内存 dirty 标记会丢失，而
 *   IDB 里的数据还在。本地项已在云端时，远端同键 insert 是用户在多端各存一份的
 *   合法重复，绝不能去重（否则 fresh 设备首拉会误删合法第二条）。
 * - 判定重复后：跳过远端行 insert，把远端行以软删墓碑 upsert 入队（其余设备拉到
 *   墓碑后把它们的副本送进回收站），本地留存项推上去后全设备收敛为一份。
 */

import type { EntityType } from '../../types.js'
import type { SyncOp } from '../../stores/storage.js'
import { entityTypeToTable } from './syncMappingTables.js'

/**
 * 规整化 URL 作为书签去重键：
 * - host 小写、去 pathname 尾部斜杠（`cloud.tencent.com` 与 `cloud.tencent.com/` 同键）；
 * - protocol / port / search / hash 保留（不同协议或带查询参数视为不同键，保守不误杀）；
 * - 非法 URL（无协议等）小写 + 去尾斜杠兜底；空 URL 返回空串（调用方跳过）。
 */
export function normalizeSyncUrl(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}${u.hash}`
  } catch {
    return s.toLowerCase().replace(/\/+$/, '')
  }
}

/** 实体的内容去重键；不参与去重的类型 / 无键项返回 null */
export function _dupKeyOf(
  type: EntityType,
  item: { url?: string; name?: string; categoryId?: string },
): string | null {
  if (type === 'bookmark') {
    const n = normalizeSyncUrl(item.url || '')
    return n ? `bm:${n}` : null
  }
  if (type === 'group') {
    const name = (item.name || '').trim()
    if (!name) return null
    return `grp:${item.categoryId || ''}|${name}`
  }
  return null
}

/** 远端候选重复：remote 行应跳过 insert，用 localId 指向的本地项存活 */
export type RemoteDuplicateCandidate<T> = { remote: T; localId: string }

/**
 * 把远端批次拆成「无碰撞 clean」与「与本地存活项同键的候选重复 candidates」。
 * 纯判定：候选不按 dirty 预筛（应用刷新后内存 dirty 会丢失，而数据还在）——
 * 「本地项是否真的从未上云」由调用方以云端全量 ID 探测复核（权威判据）；
 * 本地项已在云端时远端同键 insert 是多端各存一份的合法重复，探测会放行。
 */
export function _partitionRemoteDuplicates<T extends { id: string; deletedAt?: number }>(
  local: T[],
  remotes: T[],
  type: EntityType,
): { clean: T[]; candidates: Array<RemoteDuplicateCandidate<T>> } {
  const clean: T[] = []
  const candidates: Array<RemoteDuplicateCandidate<T>> = []
  if (type !== 'bookmark' && type !== 'group') return { clean: [...remotes], candidates }

  // 本地存活项按内容键索引（软删项不参与；同键多项时取第一个）
  const localByKey = new Map<string, T[]>()
  for (const l of local) {
    if (l.deletedAt) continue
    const key = _dupKeyOf(type, l as unknown as { url?: string; name?: string; categoryId?: string })
    if (!key) continue
    const list = localByKey.get(key)
    if (list) list.push(l)
    else localByKey.set(key, [l])
  }
  if (localByKey.size === 0) return { clean: [...remotes], candidates }

  for (const r of remotes) {
    if (r.deletedAt) { clean.push(r); continue }
    const key = _dupKeyOf(type, r as unknown as { url?: string; name?: string; categoryId?: string })
    const list = key ? localByKey.get(key) : null
    const dup = list?.find(l => l.id !== r.id)
    if (dup) candidates.push({ remote: r, localId: dup.id })
    else clean.push(r)
  }
  return { clean, candidates }
}

/**
 * realtime 单行快判：远端行与某个「本地未上云」存活项内容同键 → 返回该本地项。
 * 只做 dirty/new/pending 快判不做云端探测（realtime 无全量 ID 上下文，且能收到的
 * 同键 insert 主要来自对端离线重建后补推，快判已覆盖主场景）。
 */
export function _findContentDuplicate<T extends { id: string; deletedAt?: number }>(
  type: EntityType,
  remoteItem: { id: string; url?: string; name?: string; categoryId?: string; deletedAt?: number },
  locals: T[],
  isUnsynced: (item: T) => boolean,
): T | null {
  if (type !== 'bookmark' && type !== 'group') return null
  if (remoteItem.deletedAt) return null
  const key = _dupKeyOf(type, remoteItem)
  if (!key) return null
  for (const l of locals) {
    if (l.deletedAt || l.id === remoteItem.id) continue
    if (!isUnsynced(l)) continue
    if (_dupKeyOf(type, l as unknown as { url?: string; name?: string; categoryId?: string }) === key) return l
  }
  return null
}

/**
 * 远端行软删墓碑 op：跳过 insert 的同时把远端行以「携 deleted_at 的全量 upsert」
 * 入队，其余设备拉到墓碑后把各自副本软删进回收站，全设备收敛为一份。
 * op.data 是本地形态（camelCase，push 侧 toRemoteRow 统一转远端行）。
 */
export function _remoteTombstoneOps<T extends { id: string }>(
  candidates: Array<RemoteDuplicateCandidate<T>>,
  type: EntityType,
  userId: string,
  now = Date.now(),
): Array<Omit<SyncOp, 'id' | 'retries'>> {
  return candidates.map(({ remote }) => ({
    action: 'upsert' as const,
    table: entityTypeToTable[type],
    itemId: remote.id,
    data: { ...(remote as unknown as Record<string, unknown>), deletedAt: now, updatedAt: now, _userId: userId },
    ts: now,
  }))
}
