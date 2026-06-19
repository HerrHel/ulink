import { ref, computed } from 'vue'
import { supabase } from '../../lib/supabase.js'
import type { User, Session } from '@supabase/supabase-js'

const user = ref<User | null>(null)
const session = ref<Session | null>(null)
const loading = ref(true)
const authError = ref<string | null>(null)
const authModalOpen = ref(false)

export function useAuth() {
  const isLoggedIn = computed(() => !!user.value)
  const userEmail = computed(() => user.value?.email || '')

  async function init() {
    loading.value = true
    const { data } = await supabase.auth.getSession()
    session.value = data.session
    user.value = data.session?.user ?? null
    loading.value = false

    supabase.auth.onAuthStateChange((_event, s) => {
      session.value = s
      user.value = s?.user ?? null
    })
  }

  async function sendOtp(email: string): Promise<boolean> {
    authError.value = null
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) {
      authError.value = error.message
      return false
    }
    return true
  }

  async function verifyOtp(email: string, token: string): Promise<boolean> {
    authError.value = null
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    if (error) {
      authError.value = error.message
      return false
    }
    return true
  }

  async function signOut() {
    authError.value = null
    const { error } = await supabase.auth.signOut()
    if (error) {
      authError.value = error.message
      return false
    }
    return true
  }

  return {
    user, session, loading, authError, authModalOpen,
    isLoggedIn, userEmail,
    init, sendOtp, verifyOtp, signOut,
  }
}
