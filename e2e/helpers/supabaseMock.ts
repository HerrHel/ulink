/**
 * L1 Supabase mock — page.route 拦截 auth/REST，无真实出站。
 *
 * 会话：写入 storageKey `linkvault_auth`（与 lib/supabase.ts 一致），
 * auth.init → getSession 从 localStorage 恢复假用户。
 * Realtime WS 不强制 mock（路线图不强制）；同步 REST happy path 足够。
 */
import type { Page, Route } from '@playwright/test'

export const L1_USER_ID = '00000000-0000-4000-8000-0000000000l1'
export const L1_EMAIL = 'l1-sync@example.com'

/** 与 supabase createClient storageKey 对齐的假 session */
export function fakeSession(now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + 60 * 60 * 24
  return {
    access_token: 'l1-mock-access-token',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: expiresAt,
    refresh_token: 'l1-mock-refresh-token',
    user: {
      id: L1_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: L1_EMAIL,
      email_confirmed_at: new Date(now).toISOString(),
      phone: '',
      confirmed_at: new Date(now).toISOString(),
      last_sign_in_at: new Date(now).toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    },
  }
}

export type MockTable =
  | 'bookmarks'
  | 'sibling_groups'
  | 'categories'
  | 'custom_attributes'

export type MockDb = Record<MockTable, Record<string, unknown>[]>

const EMPTY_DB = (): MockDb => ({
  bookmarks: [],
  sibling_groups: [],
  categories: [],
  custom_attributes: [],
})

function tableFromUrl(url: string): MockTable | null {
  const m = url.match(/\/rest\/v1\/(bookmarks|sibling_groups|categories|custom_attributes)/)
  return (m?.[1] as MockTable) || null
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    },
    body: JSON.stringify(body),
  })
}

/**
 * 安装 auth + REST mock，并在导航前注入假 session。
 * @returns 可变 db（测试可预置远端行）与 request 计数
 */
export async function installSupabaseMock(
  page: Page,
  opts?: { db?: Partial<MockDb>; skipSession?: boolean },
) {
  const db: MockDb = { ...EMPTY_DB(), ...opts?.db }
  const stats = {
    restGets: 0,
    restWrites: 0,
    authHits: 0,
  }

  // 假 session 必须在任何脚本读 storage 之前写入
  if (!opts?.skipSession) {
    const session = fakeSession()
    await page.addInitScript((s) => {
      localStorage.setItem('lv_setup_done', '1')
      localStorage.setItem('linkvault_auth', JSON.stringify(s))
    }, session)
  } else {
    await page.addInitScript(() => {
      localStorage.setItem('lv_setup_done', '1')
    })
  }

  // ── Auth ──
  await page.route('**/auth/v1/**', async (route) => {
    stats.authHits++
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
      })
    }
    const url = req.url()
    const session = fakeSession()
    // getUser / getSession / refresh
    if (url.includes('/user')) {
      return json(route, { user: session.user })
    }
    if (url.includes('/token') || url.includes('/session')) {
      return json(route, session)
    }
    // signOut 等
    return json(route, {})
  })

  // ── REST ──
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        },
      })
    }

    const url = req.url()
    const table = tableFromUrl(url)
    if (!table) {
      // rpc / 其它：空成功，避免分享等旁路炸掉
      if (req.method() === 'GET') return json(route, [])
      return json(route, null)
    }

    if (req.method() === 'GET') {
      stats.restGets++
      let rows = [...(db[table] || [])]
      // select=id → 只返回 id（initialSync probe / selectAllIds）
      if (/[?&]select=id(?:&|$)/.test(url) || /select=id%2C/.test(url) === false && /select=id\b/.test(url)) {
        if (/select=id(?:&|$|,)/.test(url) && !/select=\*/.test(url) && !/select=id%2Cupdated/.test(url)) {
          rows = rows.map(r => ({ id: (r as { id: string }).id }))
        }
      }
      // soft-deleted：deleted_at=not.is.null
      if (/deleted_at=not\.is\.null/.test(url) || /deleted_at=not\.is\.null/.test(decodeURIComponent(url))) {
        rows = rows.filter(r => (r as { deleted_at?: unknown }).deleted_at != null)
      } else if (/deleted_at=is\.null/.test(url)) {
        rows = rows.filter(r => (r as { deleted_at?: unknown }).deleted_at == null)
      }
      // updated_at_num=gt.N
      const gt = url.match(/updated_at_num=gt\.(\d+)/)
      if (gt) {
        const since = Number(gt[1])
        rows = rows.filter(r => Number((r as { updated_at_num?: number }).updated_at_num || 0) > since)
      }
      return json(route, rows)
    }

    // upsert / insert / update / delete
    stats.restWrites++
    if (req.method() === 'POST' || req.method() === 'PUT' || req.method() === 'PATCH') {
      try {
        const raw = req.postData()
        const body = raw ? JSON.parse(raw) : null
        const items = Array.isArray(body) ? body : body ? [body] : []
        for (const item of items) {
          if (!item || typeof item !== 'object' || !('id' in item)) continue
          const list = db[table]
          const idx = list.findIndex(r => (r as { id: string }).id === item.id)
          if (idx >= 0) list[idx] = { ...list[idx], ...item }
          else list.push(item)
        }
      } catch {
        /* ignore malformed */
      }
      return json(route, null, 201)
    }

    if (req.method() === 'DELETE') {
      const idMatch = url.match(/id=eq\.([^&]+)/)
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1])
        db[table] = db[table].filter(r => (r as { id: string }).id !== id)
      }
      return json(route, null, 204)
    }

    return json(route, null)
  })

  // Realtime：直接放行失败即可（不强制 mock）；阻止连真机
  await page.route('**/realtime/v1/**', (route) => route.abort())

  return { db, stats }
}

/**
 * DEV 注入冲突条目测 banner UI（需页面已挂载且 window.__LV_E2E__ 可用）
 */
export async function injectConflictViaTestHook(
  page: Page,
  conflict: {
    id: string
    type?: 'bookmark' | 'group' | 'category' | 'attribute'
    local?: unknown
    remote?: unknown
  },
) {
  const ok = await page.evaluate((c) => {
    const api = (window as unknown as { __LV_E2E__?: { addConflict?: (x: unknown) => void } }).__LV_E2E__
    if (!api?.addConflict) return false
    api.addConflict({
      id: c.id,
      type: c.type || 'bookmark',
      local: c.local ?? { title: '本地版' },
      remote: c.remote ?? { title: '云端版' },
    })
    return true
  }, conflict)
  return ok
}
