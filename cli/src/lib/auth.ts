/**
 * 认证模块
 * 支持 Email OTP 登录
 */
import { getSupabaseClient } from './supabase.js'
import { setConfig, getAccessToken, clearConfig } from './config.js'
import * as format from './format.js'

/** 使用 Email OTP 发送验证码 */
export async function sendOtp(email: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.signInWithOtp({ email })
  if (error) throw error
}

/** 验证 OTP 并登录 */
export async function verifyOtp(email: string, token: string): Promise<{ userId: string }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  if (error) throw error
  if (!data.session) throw new Error('登录失败：未获取到 session')

  // 保存 token
  setConfig('accessToken', data.session.access_token)
  setConfig('refreshToken', data.session.refresh_token)

  return { userId: data.user?.id || '' }
}

/** 登出 */
export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  clearTokens()
}

/** 清除 token（不清除 URL 和 Key） */
function clearTokens(): void {
  setConfig('accessToken', '')
  setConfig('refreshToken', '')
}

/** 获取当前用户 */
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  const accessToken = getAccessToken()
  if (!accessToken) return null

  try {
    const supabase = getSupabaseClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) {
      // Token 可能无效或过期
      return null
    }
    if (!user) return null
    return { id: user.id, email: user.email || '' }
  } catch {
    return null
  }
}

/** 检查是否已登录 */
export function hasTokens(): boolean {
  return Boolean(getAccessToken())
}
