/**
 * 账号注销（自助清除）
 *
 * 流程：
 *   1) account 云函数验签 → 删对象存储图片 → 删 PG 内全部数据
 *   2) 本机数据（IndexedDB + localStorage）清空
 *   3) 登出并刷新页面
 *
 * 账号记录本身（CloudBase auth 账号）由运营方人工核验后删除——云函数只有
 * publishable 级 APIKEY，没有管理密钥，无法调用账号删除接口。法律文档已按此口径表述。
 */
import { getApiToken } from '../../lib/authDriver.js'
import { edgeFnUrl, isCloudBaseBackend } from '../../lib/cloudbase.js'
import { clearAllLocalData } from '../../stores/storage.js'
import { useAuthStore } from '../../stores/auth.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useVaultStore } from '../../stores/vault.js'
import { useDataStore } from '../../stores/data.js'

export type AccountDeletionError = 'unauthorized' | 'network' | 'not_configured' | 'failed'

export interface AccountDeletionResult {
  ok: boolean
  error?: AccountDeletionError
  /** 云端数据是否已清除 */
  dataDeleted?: boolean
  /** 待人工删除的账号记录 */
  accountPendingDeletion?: boolean
}

export async function purgeAccount(): Promise<AccountDeletionResult> {
  if (!isCloudBaseBackend()) return { ok: false, error: 'not_configured' }

  const endpoint = edgeFnUrl('account')
  if (!endpoint) return { ok: false, error: 'not_configured' }

  const token = await getApiToken()
  if (!token) return { ok: false, error: 'unauthorized' }

  let result: AccountDeletionResult
  const abortCtrl = new AbortController()
  const timer = setTimeout(() => abortCtrl.abort(), 15000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'purge' }),
      signal: abortCtrl.signal,
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      dataDeleted?: boolean
      accountPendingDeletion?: boolean
    }
    if (res.ok && body.ok === true) {
      result = {
        ok: true,
        dataDeleted: body.dataDeleted === true,
        accountPendingDeletion: body.accountPendingDeletion === true,
      }
    } else if (res.status === 401) {
      result = { ok: false, error: 'unauthorized' }
    } else {
      result = { ok: false, error: 'failed' }
    }
  } catch {
    return { ok: false, error: 'network' }
  } finally {
    clearTimeout(timer)
  }

  if (!result.ok) return result

  // 云端已清 → 本机也清干净，避免下次登录把旧数据拉回来
  try {
    await clearAllLocalData()
  } catch {
    /* 清不干净也要继续登出，下面会重载页面 */
  }
  // 安全加固：立即归零内存中的 E2E/Vault 密钥与数据，杜绝页面重载前内存滞留
  try { useE2EStore().lock() } catch { /* ignore */ }
  try { useVaultStore().lock() } catch { /* ignore */ }
  try {
    const ds = useDataStore()
    ds.bookmarks = []
    ds.siblingGroups = []
    ds.categories = []
    ds.customAttributes = []
    ds._syncMaps()
  } catch { /* ignore */ }
  try {
    await useAuthStore().signOut()
  } catch {
    /* ignore */
  }
  return result
}
