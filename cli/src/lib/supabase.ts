/**
 * Supabase 客户端封装
 * 从配置读取 URL 和 Key，创建客户端实例
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseUrl, getSupabaseKey, getAccessToken, getRefreshToken, isConfigured, setConfig } from './config.js'

let client: SupabaseClient | null = null
let _ready: Promise<void> | null = null

/** 等待客户端完成 session 初始化 */
async function _ensureSession(c: SupabaseClient, accessToken: string, refreshToken: string): Promise<void> {
  await c.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
}

/** 获取 Supabase 客户端（单例），自动等待 session 就绪 */
export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (client) {
    if (_ready) await _ready
    return client
  }

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
      autoRefreshToken: true,
      persistSession: false,
    },
  })

  client.auth.onAuthStateChange((event, session) => {
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
      setConfig('accessToken', session.access_token)
      setConfig('refreshToken', session.refresh_token || '')
    }
    if (event === 'SIGNED_OUT') {
      setConfig('accessToken', '')
      setConfig('refreshToken', '')
    }
  })

  if (accessToken && refreshToken) {
    _ready = _ensureSession(client, accessToken, refreshToken)
    await _ready
  }

  return client
}

/** 重置客户端（配置变更时调用） */
export function resetClient(): void {
  client = null
  _ready = null
}

/** 测试连接 */
export async function testConnection(): Promise<boolean> {
  try {
    const supabase = await getSupabaseClient()
    const { error } = await supabase.from('categories').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}
