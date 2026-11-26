/**
 * useAccountStash — 「不明归属」本地分仓的用户决策
 *
 * 换仓（lib/dataOwner.ts）从不静默上传别的账号的数据。只有两类分仓无法在本地判定
 * 是否属于当前用户，交给用户选：
 * - 升级迁移时旧版「刚切换账号」标记仍挂着（本地数据混有上一个账号的存量）
 * - Supabase 时代的旧身份 uuid（与 CloudBase 登录 id 对不上，可能是同一个人）
 *
 * 合并：只补入当前账号本地没有的 id（不覆盖），标记为新建 + 待同步，随后正常上云。
 * 保持分开：分仓原样保留，不再提示。取消：下次登录再问。
 */
import { useAuth } from './useAuth.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'
import { runMigrations } from '../../stores/migrations.js'
import { AppDataSchema } from '../../schemas.js'
import { cloneDeep } from '../../lib/clone.js'
import { showChoice, toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'
import { acknowledgeStash, ambiguousStashes, isSyncAllowedFor, readStash } from '../../lib/dataOwner.js'
import type { AppData } from '../../types.js'

let _prompting = false

/** 把分仓主数据里当前本地没有的条目并入，返回并入条数 */
export function mergeStashMain(rawMain: unknown): number {
  if (!rawMain || typeof rawMain !== 'object') return 0
  const d = cloneDeep(rawMain) as Partial<AppData>
  if (!Array.isArray(d.bookmarks) || !Array.isArray(d.siblingGroups)) return 0
  if (!Array.isArray(d.categories)) d.categories = []
  if (!Array.isArray(d.customAttributes)) d.customAttributes = []
  runMigrations(d, d as AppData)
  const parsed = AppDataSchema.safeParse(d)
  if (!parsed.success) {
    console.warn('[stash] 分仓数据校验失败，放弃合并:', parsed.error.issues.slice(0, 3))
    return 0
  }
  const src = parsed.data
  const ds = useDataStore()
  let n = 0
  const take = <T extends { id: string }>(from: T[], into: T[]) => {
    const have = new Set(into.map(x => x.id))
    for (const item of from) {
      if (have.has(item.id)) continue
      into.push(item)
      ds._markDirty(item.id)
      ds._newIds.add(item.id)
      n++
    }
  }
  take(src.customAttributes, ds.customAttributes)
  take(src.categories, ds.categories)
  take(src.siblingGroups, ds.siblingGroups)
  take(src.bookmarks, ds.bookmarks)
  if (n) ds._syncMaps()
  return n
}

/** 登录同步完成后调用：逐个询问不明归属的分仓 */
export async function promptAmbiguousStashes(): Promise<void> {
  if (_prompting) return
  const userId = useAuth().user?.id
  if (!userId || !isSyncAllowedFor(userId)) return
  const list = ambiguousStashes(userId)
  if (!list.length) return
  _prompting = true
  try {
    for (const entry of list) {
      const choice = await showChoice(t('sync.stashAskTitle', { n: entry.count }), [
        { id: 'merge', label: t('sync.stashMerge'), description: t('sync.stashMergeDesc') },
        { id: 'keep', label: t('sync.stashKeep'), description: t('sync.stashKeepDesc') },
      ], t('common.cancel'))
      if (choice === 'keep') {
        acknowledgeStash(entry.owner)
      } else if (choice === 'merge') {
        // 询问期间可能已换号：再确认一次总闸
        if (!isSyncAllowedFor(useAuth().user?.id)) return
        const stash = await readStash(entry.owner)
        const n = mergeStashMain(stash?.main)
        // 分仓本身保留（含私密空间等无法自动合并的部分），只是不再提示
        acknowledgeStash(entry.owner)
        if (n) {
          await saveAppData()
          try {
            const { useCloudSync } = await import('./useCloudSync.js')
            await useCloudSync().syncImmediate()
          } catch { /* 同步失败不影响本地合并，后续常规同步会补推 */ }
          toast(t('sync.stashMerged', { n }))
        }
      }
    }
  } finally {
    _prompting = false
  }
}
