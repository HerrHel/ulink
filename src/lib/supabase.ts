import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function createNullClient(): SupabaseClient {
  const nullError = new Error('Supabase 未配置')
  const nullResult = { data: null, error: nullError }

  /** 创建 thenable 的查询构造器 Proxy，支持无限链式调用后 await */
  function createNullQuery(): any {
    return new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: typeof nullResult) => void) => resolve(nullResult)
        }
        return () => createNullQuery()
      },
      apply() {
        return Promise.resolve(nullResult)
      },
    })
  }

  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      if (prop === 'then') return undefined
      if (prop === 'from' || prop === 'rpc') return () => createNullQuery()
      if (prop === 'auth') {
        return {
          getUser: () => Promise.resolve(nullResult),
          signInWithOtp: () => Promise.resolve(nullResult),
          signOut: () => Promise.resolve(nullResult),
          getSession: () => Promise.resolve(nullResult),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        }
      }
      return () => Promise.resolve(nullResult)
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
