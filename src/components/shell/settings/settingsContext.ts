/**
 * settingsContext — 设置面板父子组件共享上下文（provide / inject）
 *
 * 为什么不让各标签页自己调用 useCloudSync / useDeadLinkChecker 等：这些组合式函数
 * **每次调用都会新建一套响应式状态与 watch**（非单例），多个子组件各调一次会产生重复监听、
 * 状态分裂。因此由父组件 SettingsPanel 各创建一次，经本上下文下发给 7 个标签页。
 *
 * Pinia store（useUIStore / useDataStore / useAppStore）与 useI18n 是全局单例，
 * 子组件直接调用即可，不经本上下文。
 */
import { inject, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { useAuth } from '../../../composables/domain/useAuth.js'
import type { useCloudSync } from '../../../composables/domain/useCloudSync.js'
import type { useSyncState } from '../../../composables/ui/useSyncStatus.js'
import type { useDeadLinkChecker } from '../../../composables/domain/useDeadLinkChecker.js'
import type { useE2E } from '../../../composables/domain/useE2E.js'
import type { useEntitlement } from '../../../composables/domain/useEntitlement.js'
import type { useTransactions } from '../../../composables/domain/useTransactions.js'

/** 会员并入 account、维护并入 data（旧 id 由 SettingsPanel.normalizeTab 兼容） */
export type SettingsTab = 'account' | 'appearance' | 'ai' | 'data' | 'about'

/** 公开分享条目（分组 / 分类），维护页列表与导航角标共用 */
export interface PublicShareItem {
  type: 'group' | 'category'
  id: string
  shareId?: string
  title: string
  icon?: string
  color?: string
  url: string
}

type Tx = ReturnType<typeof useTransactions>
type Ent = ReturnType<typeof useEntitlement>

export interface SettingsContext {
  // 账号 / 同步 / 加密
  auth: ReturnType<typeof useAuth>
  sync: ReturnType<typeof useCloudSync>
  syncState: ReturnType<typeof useSyncState>
  e2e: ReturnType<typeof useE2E>
  userInitial: ComputedRef<string>
  userDisplay: ComputedRef<string>
  // 会员权益 / 购买
  entService: Ent
  entitlement: Ent['entitlement']
  refreshEntitlement: () => Promise<void>
  showPurchase: Ref<boolean>
  aiQuota: Ref<{ used: number; limit: number } | null>
  // 交易明细（useTransactions 的字段，沿用面板内的别名）
  transactions: Tx['transactions']
  loadingTx: Tx['loading']
  totalTx: Tx['total']
  txPage: Tx['page']
  txPageSize: Tx['pageSize']
  hasPrevTx: Tx['hasPrev']
  hasNextTx: Tx['hasNext']
  fetchTransactions: Tx['fetchTransactions']
  nextTxPage: Tx['nextPage']
  prevTxPage: Tx['prevPage']
  formatTxTime: Tx['formatTxTime']
  // 死链检测（导航角标与维护页共用）
  dl: ReturnType<typeof useDeadLinkChecker>
  deadCount: ComputedRef<number>
  blockedCount: ComputedRef<number>
  // 公开分享（导航角标与维护页共用）
  userCategoryShares: Ref<Array<{ id: string; category_id: string }>>
  loadingCategoryShares: Ref<boolean>
  loadUserCategoryShares: () => Promise<void>
  publicGroupItems: ComputedRef<PublicShareItem[]>
  publicCategoryItems: ComputedRef<PublicShareItem[]>
  allPublicShares: ComputedRef<PublicShareItem[]>
  // 面板级操作
  onOpenShortcutHelp: () => void
}

const SETTINGS_CONTEXT: InjectionKey<SettingsContext> = Symbol('settings-context')

export function provideSettingsContext(ctx: SettingsContext): void {
  provide(SETTINGS_CONTEXT, ctx)
}

export function useSettingsContext(): SettingsContext {
  const ctx = inject(SETTINGS_CONTEXT)
  if (!ctx) throw new Error('useSettingsContext() 只能在 SettingsPanel 的子组件中使用')
  return ctx
}
