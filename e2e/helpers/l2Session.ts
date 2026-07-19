/**
 * L2 真后端会话注入 — 不经 OTP UI。
 *
 * 启用门闩：LV_E2E_L2=1
 * 会话来源（二选一）：
 * 1. LV_E2E_L2_SESSION_JSON — 完整 supabase session JSON（推荐：从已登录浏览器
 *    localStorage `linkvault_auth` 复制）
 * 2. LV_E2E_L2_ACCESS_TOKEN + LV_E2E_L2_REFRESH_TOKEN
 *    + LV_E2E_L2_USER_ID + LV_E2E_L2_EMAIL（拼最小 session）
 *
 * 真项目密钥仍走 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（.env 或 shell）。
 * 默认 CI 不设 LV_E2E_L2，本 helper 不会被调用。
 */
import type { Page } from '@playwright/test'

export type L2Session = {
  access_token: string
  refresh_token: string
  token_type?: string
  expires_in?: number
  expires_at?: number
  user: {
    id: string
    email?: string
    aud?: string
    role?: string
    [k: string]: unknown
  }
  [k: string]: unknown
}

export type L2Ready = {
  ok: true
  session: L2Session
  email: string
  reason?: undefined
}

export type L2NotReady = {
  ok: false
  session?: undefined
  email?: undefined
  reason: string
}

/** 解析 env，判断 L2 真会话是否可跑 */
export function resolveL2Session(): L2Ready | L2NotReady {
  if (!process.env.LV_E2E_L2) {
    return { ok: false, reason: '未设 LV_E2E_L2=1' }
  }

  const hasRealSupabase =
    !!process.env.VITE_SUPABASE_URL &&
    !!process.env.VITE_SUPABASE_ANON_KEY &&
    !String(process.env.VITE_SUPABASE_URL).includes('l1mock')
  // 允许仅靠 Vite 读 .env：webServer 在 L2 模式不注入 mock；此处若 shell 无 URL
  // 则仍可继续（dev server 侧有 .env），但缺 session 必 skip。
  void hasRealSupabase

  const raw = process.env.LV_E2E_L2_SESSION_JSON?.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as L2Session
      if (!parsed?.access_token || !parsed?.refresh_token || !parsed?.user?.id) {
        return {
          ok: false,
          reason: 'LV_E2E_L2_SESSION_JSON 缺 access_token / refresh_token / user.id',
        }
      }
      return {
        ok: true,
        session: normalizeSession(parsed),
        email: String(parsed.user.email || process.env.LV_E2E_L2_EMAIL || ''),
      }
    } catch {
      return { ok: false, reason: 'LV_E2E_L2_SESSION_JSON 不是合法 JSON' }
    }
  }

  const access = process.env.LV_E2E_L2_ACCESS_TOKEN?.trim()
  const refresh = process.env.LV_E2E_L2_REFRESH_TOKEN?.trim()
  const userId = process.env.LV_E2E_L2_USER_ID?.trim()
  const email = process.env.LV_E2E_L2_EMAIL?.trim() || ''
  if (access && refresh && userId) {
    const now = Date.now()
    return {
      ok: true,
      session: normalizeSession({
        access_token: access,
        refresh_token: refresh,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(now / 1000) + 3600,
        user: {
          id: userId,
          email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
        },
      }),
      email,
    }
  }

  return {
    ok: false,
    reason:
      'L2 已开但无会话：设 LV_E2E_L2_SESSION_JSON，或 ACCESS/REFRESH/USER_ID（+EMAIL）',
  }
}

function normalizeSession(s: L2Session): L2Session {
  const now = Date.now()
  return {
    ...s,
    token_type: s.token_type || 'bearer',
    expires_in: s.expires_in ?? 3600,
    expires_at: s.expires_at ?? Math.floor(now / 1000) + 3600,
    user: { ...s.user },
  }
}

/**
 * 导航前注入：setup 完成标记 + linkvault_auth session。
 * 与 L1 mock 一致走 localStorage，供 supabase-js getSession 恢复。
 */
export async function injectL2Session(page: Page, session: L2Session) {
  await page.addInitScript((s) => {
    localStorage.setItem('lv_setup_done', '1')
    localStorage.setItem('linkvault_auth', JSON.stringify(s))
  }, session)
}

/** 命令面板触发「同步到云端」（手动 fullSync，避 debounce） */
export async function triggerManualFullSync(page: Page) {
  await page.keyboard.press('Control+k')
  const cmdInput = page.getByTestId('lv-cmd-input')
  await cmdInput.waitFor({ state: 'visible', timeout: 8000 })
  await cmdInput.fill('同步')
  await page.keyboard.press('Enter')
}
