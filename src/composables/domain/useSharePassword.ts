/**
 * 分享访问密码：设置 / 清除
 *
 * 为什么不在前端算摘要：摘要（scrypt）如果由客户端生成再直传数据库，它就变成了
 * 「可直接复用的凭证」——库一旦泄露即可绕过密码。因此前端只传明文，摘要由
 * share-admin 云函数在服务端计算，并经 cb-auth 验签确认「这组属于你」后写库。
 */
import { supabase } from '../../lib/supabase.js'
import { edgeFnUrl, isCloudBaseBackend } from '../../lib/cloudbase.js'

export type SharePasswordError =
  | 'unauthorized'
  | 'forbidden'
  | 'weak_password'
  | 'rate_limited'
  | 'network'
  | 'not_configured'

export interface SetSharePasswordResult {
  ok: boolean
  hasPassword?: boolean
  error?: SharePasswordError
}

/** 与服务端保持一致的密码策略（前端先拦一遍，服务端仍会再校验） */
export const SHARE_PASSWORD_MIN = 4
export const SHARE_PASSWORD_MAX = 128

export function isSharePasswordAcceptable(pw: string): boolean {
  return pw.length >= SHARE_PASSWORD_MIN && pw.length <= SHARE_PASSWORD_MAX
}

/** 取当前账号的会话令牌；无登录态返回空串 */
async function currentToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession()
    return (data as { session?: { access_token?: string } } | null)?.session?.access_token || ''
  } catch {
    return ''
  }
}

/** 查询某分享是否已设密码（只回布尔） */
export async function getSharePasswordState(
  gid: string,
): Promise<{ ok: boolean; hasPassword?: boolean; error?: SharePasswordError }> {
  if (!isCloudBaseBackend()) return { ok: false, error: 'not_configured' }
  const endpoint = edgeFnUrl('share-admin')
  if (!endpoint) return { ok: false, error: 'not_configured' }

  const token = await currentToken()
  if (!token) return { ok: false, error: 'unauthorized' }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ gid, action: 'get' }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; has_password?: boolean }
    if (res.ok && body.ok === true) return { ok: true, hasPassword: body.has_password === true }
    if (res.status === 401) return { ok: false, error: 'unauthorized' }
    if (res.status === 404) return { ok: true, hasPassword: false }
    return { ok: false, error: 'network' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

/**
 * 设置或清除某分享的访问密码。
 * @param gid 分享组 id
 * @param password 明文密码；传 null 或空串表示清除
 */
export async function setSharePassword(
  gid: string,
  password: string | null,
): Promise<SetSharePasswordResult> {
  if (!isCloudBaseBackend()) return { ok: false, error: 'not_configured' }

  const endpoint = edgeFnUrl('share-admin')
  if (!endpoint) return { ok: false, error: 'not_configured' }

  let token = ''
  try {
    const { data } = await supabase.auth.getSession()
    token = (data as { session?: { access_token?: string } } | null)?.session?.access_token || ''
  } catch {
    token = ''
  }
  if (!token) return { ok: false, error: 'unauthorized' }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gid, password }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      has_password?: boolean
    }
    if (res.ok && body.ok === true) {
      return { ok: true, hasPassword: body.has_password === true }
    }
    if (res.status === 401) return { ok: false, error: 'unauthorized' }
    if (res.status === 403) return { ok: false, error: 'forbidden' }
    if (res.status === 429) return { ok: false, error: 'rate_limited' }
    if (res.status === 400) return { ok: false, error: 'weak_password' }
    return { ok: false, error: 'network' }
  } catch {
    return { ok: false, error: 'network' }
  }
}
