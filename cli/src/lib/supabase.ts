/**
 * Supabase 客户端封装
 * 从配置读取 URL 和 Key，创建客户端实例
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseUrl, getSupabaseKey, getAccessToken, getRefreshToken, isConfigured } from './config.js'

let client: SupabaseClient | null = null

/** 获取 Supabase 客户端（单例） */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client

  if (!isConfigured()) {
    throw new Error(
      'Supabase 未配置。请先运行:\n' +
      '  linkvault config set-url <url>\n' +
      '  linkvault config set-key <key>'
    )
  }

  const url = getSupabaseUrl()!
  const key = getSupabaseKey()!
  const accessToken = getAccessToken()
  const refreshToken = getRefreshToken()

  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  })

  // 如果有 access token，手动设置 session
  if (accessToken && refreshToken) {
    client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
  }

  return client
}

/** 重置客户端（配置变更时调用） */
export function resetClient(): void {
  client = null
}

/** 测试连接 */
export async function testConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('categories').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}
