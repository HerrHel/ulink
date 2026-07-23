/**
 * 认证模块
 * 支持 Email OTP 登录 + 自动 token 刷新
 */
import { getSupabaseClient, resetClient } from './supabase.js'
import { setConfig, getAccessToken, getRefreshToken } from './config.js'
import * as format from './format.js'

/** 使用 Email OTP 发送验证码 */
export async function sendOtp(email: string): Promise<void> {
  const supabase = await getSupabaseClient()
  const { error } = await supabase.auth.signInWithOtp({ email })
  if (error) throw error
}

/** 验证 OTP 并登录 */
export async function verifyOtp(email: string, token: string): Promise<{ userId: string }> {
  const supabase = await getSupabaseClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  if (error) throw error
  if (!data.session) throw new Error('登录失败：未获取到 session')

  setConfig('accessToken', data.session.access_token)
  setConfig('refreshToken', data.session.refresh_token)

  return { userId: data.user?.id || '' }
}

/** 尝试用 refresh token 刷新 session */
async function tryRefreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  try {
    const supabase = await getSupabaseClient()
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.session) return false

    setConfig('accessToken', data.session.access_token)
    setConfig('refreshToken', data.session.refresh_token || '')
    resetClient()
    return true
  } catch {
    return false
  }
}

/** 登出 */
export async function signOut(): Promise<void> {
  const supabase = await getSupabaseClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  clearTokens()
}

/** 清除 token（不清除 URL 和 Key） */
function clearTokens(): void {
  setConfig('accessToken', '')
  setConfig('refreshToken', '')
}

/** 获取当前用户（token 过期时自动尝试刷新） */
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  const accessToken = getAccessToken()
  if (!accessToken) return null

  try {
    const supabase = await getSupabaseClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (!error && user) return { id: user.id, email: user.email || '' }

    const refreshed = await tryRefreshSession()
    if (!refreshed) return null

    const supabase2 = await getSupabaseClient()
    const { data: { user: user2 }, error: error2 } = await supabase2.auth.getUser()
    if (error2 || !user2) return null
    return { id: user2.id, email: user2.email || '' }
  } catch {
    const refreshed = await tryRefreshSession()
    if (!refreshed) return null

    try {
      const supabase2 = await getSupabaseClient()
      const { data: { user }, error } = await supabase2.auth.getUser()
      if (error || !user) return null
      return { id: user.id, email: user.email || '' }
    } catch {
      return null
    }
  }
}

/** 检查是否已登录 */
export function hasTokens(): boolean {
  return Boolean(getAccessToken())
}
