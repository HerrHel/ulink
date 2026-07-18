import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function createNullClient(): SupabaseClient {
  const nullError = new Error('Supabase 未配置')
  // D1-002：与官方 SDK 空结果形状对齐，避免 data.session 读 null 崩溃
  const emptySession = { data: { session: null }, error: nullError }
  const emptyUser = { data: { user: null }, error: nullError }
  const emptyAuth = { data: { user: null, session: null }, error: nullError }
  const nullQueryResult = { data: null, error: nullError, count: null, status: 0, statusText: '' }

  /** 创建 thenable 的查询构造器 Proxy，支持无限链式调用后 await */
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
