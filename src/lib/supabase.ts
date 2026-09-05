import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** 是否已配置 Supabase（未配置时为 null client，storage/auth 均为空实现） */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

function createNullClient(): SupabaseClient {
  const nullError = new Error('Supabase 未配置')
  // D1-002：与官方 SDK 空结果形状对齐，避免 data.session 读 null 崩溃
  const emptySession = { data: { session: null }, error: nullError }
  const emptyUser = { data: { user: null }, error: nullError }
  const emptyAuth = { data: { user: null, session: null }, error: nullError }
  const nullQueryResult = { data: null, error: nullError, count: null, status: 0, statusText: '' }

  /** 创建 thenable 的查询构造器 Proxy，支持无限链式调用后 await。
   *  返回值刻意为 any：此空对象需在类型层冒充任意 supabase 链式调用终点
   *  （.select().eq().single()… / auth / rpc 的各返参形状），非 any 无以表达
   *  「与真实 builder 同形」这一运行时承诺；真实客户端未配置时才启用。 */
  function createNullQuery(): any {
    return new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: typeof nullQueryResult) => void) => resolve(nullQueryResult)
        }
        return () => createNullQuery()
      },
      apply() {
        return Promise.resolve(nullQueryResult)
      },
    })
  }

  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      if (prop === 'then') return undefined
      if (prop === 'from' || prop === 'rpc') return () => createNullQuery()
      if (prop === 'auth') {
        return {
          getUser: () => Promise.resolve(emptyUser),
          getSession: () => Promise.resolve(emptySession),
          signInWithOtp: () => Promise.resolve(emptyAuth),
          verifyOtp: () => Promise.resolve(emptyAuth),
          signOut: () => Promise.resolve(emptyAuth),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        }
      }
      return () => Promise.resolve(nullQueryResult)
    },
  })
}

export const supabase: SupabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: localStorage,
        storageKey: 'linkvault_auth',
      },
    })
  : createNullClient()
