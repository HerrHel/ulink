/**
 * syncMergeCore — 远端 → 本地 merge 的纯决策核心
 *
 * 无 supabase / decrypt / editor 依赖；副作用由调用方执行。
 * pull（_mergeIntoLocal）与 Realtime（_handleRealtimeChange）共用同一决策，
 * 避免 conflict / soft-delete / pending 规则双份。
 */

export type MergeEntity = {
  id: string
  updatedAt?: number
  deletedAt?: number
}

export type MergeDecisionAction =
  | 'insert'
  | 'skip'
  | 'conflict'
  | 'soft-delete'
  | 'revive-assign'
  | 'assign'
  | 'full-absent-delete'

export type MergeDecision = { action: MergeDecisionAction }

export type DecideRemoteApplyInput = {
  /** 本地项；full 对账缺远端时仍传 local，remoteItem 为 null */
  localItem: MergeEntity | null
  /** 远端项；full 对账「远端无此 id」时为 null */
  remoteItem: MergeEntity | null
  isDirty: boolean
  isPending: boolean
  lastSyncAt: number
  /** 全量对账模式：仅在 remoteItem===null 时消费 full 分支 */
  full?: boolean
}

function isRemoteNewer(remote: MergeEntity, local: MergeEntity): boolean {
  return (remote.updatedAt || 0) > (local.updatedAt || 0)
}

/**
 * 决定远端变更相对本地应采取的动作。
 * 不读 store、不改数据；调用方按 action 执行副作用。
 */
export function decideRemoteApply(input: DecideRemoteApplyInput): MergeDecision {
  const { localItem, remoteItem, isDirty, isPending, lastSyncAt, full = false } = input

  // full 对账：远端集合中无此 id
  if (remoteItem == null) {
    if (
      full &&
      localItem &&
      !isDirty &&
      !isPending &&
      lastSyncAt > 0
    ) {
      return { action: 'full-absent-delete' }
    }
    return { action: 'skip' }
  }

  // 本地无 → 插入（含软删项供回收站）
  if (!localItem) {
    return { action: 'insert' }
  }

  const remoteNewer = isRemoteNewer(remoteItem, localItem)

  // dirty 优先：远端更新更晚且已同步过 → conflict；否则跳过（保护未推送编辑）
  if (isDirty) {
    if (remoteNewer && lastSyncAt > 0) return { action: 'conflict' }
    return { action: 'skip' }
  }

  // H3：in-flight pending（已 drain 待推）+ 远端 newer → conflict，勿静默覆盖
  if (isPending) {
    if (remoteNewer && lastSyncAt > 0) return { action: 'conflict' }
    return { action: 'skip' }
  }

  if (!remoteNewer) return { action: 'skip' }

  // RE-3：远端软删本地存活 → 走 delete* 副作用，禁止 Object.assign 跳过
  if (remoteItem.deletedAt && !localItem.deletedAt) {
    return { action: 'soft-delete' }
  }
  // 远端复活
  if (!remoteItem.deletedAt && localItem.deletedAt) {
    return { action: 'revive-assign' }
  }
  return { action: 'assign' }
}
