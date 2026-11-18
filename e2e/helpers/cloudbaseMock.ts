/**
 * CloudBase 网关内存后端（E2E 专用，仅生产构建 / CloudBase 形态）。
 *
 * 线上同步走 CloudBase rdb（PostgREST 风格 HTTP：GET 过滤分页、POST upsert、HEAD 计数、
 * PATCH / DELETE 按过滤条件），此前 E2E 只有 Supabase 形态的同步 mock，线上实际链路零覆盖。
 *
 * 这里在 Node 侧维护一份「云端数据库」，多个浏览器上下文（= 多台设备）共用同一实例，
 * 从而能端到端验证：A 设备写入 → 云端 → B 设备拉取。
 *
 * 忠实复刻服务端约束（cloudbase/migrations 032 / 035）：
 *  - 硬删除写入墓地表 deleted_item_graveyard；
 *  - 墓地中已存在的 (user_id, 表, id) 不允许再 INSERT（防删除复活）；
 *  - UPDATE 不能用不更新的时间戳把软删行复活。
 * 鉴权只模拟登录响应，不校验 token（单用户场景）。
 */
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test'

export type Row = Record<string, unknown>

export interface CbUser {
  sub: string
  email: string
}

export const CB_USER: CbUser = { sub: 'sync-e2e-uid', email: 'sync-e2e@example.com' }

/** 参与同步的业务表（与 src/composables/domain/syncMappingTables.ts 一致） */
const SYNC_TABLES = new Set(['bookmarks', 'sibling_groups', 'categories', 'custom_attributes'])

export interface CbRequestLog {
  /** 发起请求的设备标签（attachCloudBase 传入） */
  device: string
  method: string
  table: string
  query: string
}

export interface CbBackend {
  user: CbUser
  /** 表名 → (user_id|id) → 行 */
  tables: Map<string, Map<string, Row>>
  /** 墓地：user_id|table|id */
  graveyard: Set<string>
  requests: CbRequestLog[]
  /** 置 true 时所有 rdb 请求返回 503（模拟云端故障） */
  down: boolean
  /** 读某表某 id 的当前行（不存在返回 undefined） */
  row(table: string, id: string): Row | undefined
  /** 直接写入云端行（模拟「另一台设备早已同步上来的数据」） */
  seed(table: string, row: Row): void
  /** 云端某表未软删的行 */
  live(table: string): Row[]
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'access-control-expose-headers': 'content-range, content-location, location',
}

const key = (userId: unknown, id: unknown) => `${String(userId)}|${String(id)}`

export function createCloudBaseBackend(user: CbUser = CB_USER): CbBackend {
  const tables = new Map<string, Map<string, Row>>()
  const graveyard = new Set<string>()
  const t = (name: string) => {
    let m = tables.get(name)
    if (!m) tables.set(name, (m = new Map()))
    return m
  }
  return {
    user,
    tables,
    graveyard,
    requests: [],
    down: false,
    row: (table, id) => t(table).get(key(user.sub, id)),
    seed(table, row) {
      t(table).set(key(row.user_id ?? user.sub, row.id), { user_id: user.sub, deleted_at: null, ...row })
    },
    live: (table) => [...t(table).values()].filter((r) => r.user_id === user.sub && r.deleted_at == null),
  }
}

/** 云端书签行（列名与 syncMapping 推送时一致） */
export function bookmarkRow(id: string, title: string, url: string, updatedAt = Date.now()): Row {
  return {
    id,
    user_id: CB_USER.sub,
    title,
    url,
    username: '',
    password: '',
    notes: '',
    icon: '',
    category_id: 'uncategorized',
    parent_id: null,
    order: 0,
    use_count: 0,
    attributes: {},
    created_at_num: updatedAt,
    updated_at_num: updatedAt,
    pinned_at: null,
    deleted_at: null,
  }
}

// ── PostgREST 查询解析 ───────────────────────────────────────────────

type Filter = (r: Row) => boolean

function coerce(v: string): string | number | boolean | null {
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return v
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''))
}

function parseFilter(col: string, expr: string): Filter {
  const neg = expr.startsWith('not.')
  const body = neg ? expr.slice(4) : expr
  const dot = body.indexOf('.')
  const op = body.slice(0, dot)
  const raw = body.slice(dot + 1)
  let f: Filter
  switch (op) {
    case 'eq': f = (r) => String(r[col]) === raw; break
    case 'neq': f = (r) => String(r[col]) !== raw; break
    case 'gt': f = (r) => r[col] != null && cmp(r[col], coerce(raw)) > 0; break
    case 'gte': f = (r) => r[col] != null && cmp(r[col], coerce(raw)) >= 0; break
    case 'lt': f = (r) => r[col] != null && cmp(r[col], coerce(raw)) < 0; break
    case 'lte': f = (r) => r[col] != null && cmp(r[col], coerce(raw)) <= 0; break
    case 'is': f = raw === 'null' ? (r) => r[col] == null : (r) => r[col] === coerce(raw); break
    case 'in': {
      const set = new Set(raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')))
      f = (r) => set.has(String(r[col]))
      break
    }
    default:
      throw new Error(`cloudbaseMock: 未支持的过滤操作 ${col}=${expr}`)
  }
  return neg ? (r) => !f(r) : f
}

const RESERVED = new Set(['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'])

function parseQuery(url: URL) {
  const filters: Filter[] = []
  for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) filters.push(parseFilter(k, v))
  const order = (url.searchParams.get('order') || '')
    .split(',')
    .filter(Boolean)
    .map((s) => {
      const [col, dir] = s.split('.')
      return { col, desc: dir === 'desc' }
    })
  const select = url.searchParams.get('select') || '*'
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity
  return { filters, order, select, offset, limit }
}

function project(r: Row, select: string): Row {
  if (select === '*') return { ...r }
  const out: Row = {}
  for (const c of select.split(',')) out[c.trim()] = r[c.trim()]
  return out
}

function contentRange(offset: number, n: number, total: number) {
  return n > 0 ? `${offset}-${offset + n - 1}/${total}` : `*/${total}`
}

// ── 路由处理 ────────────────────────────────────────────────────────

function reply(route: Route, status: number, body?: unknown, headers: Record<string, string> = {}) {
  return route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json', ...headers },
    body: body === undefined ? '' : JSON.stringify(body),
  })
}

function handleRdb(backend: CbBackend, route: Route, table: string, url: URL, device: string) {
  const req = route.request()
  const method = req.method()
  const store = backend.tables.get(table) ?? new Map<string, Row>()
  backend.tables.set(table, store)
  backend.requests.push({ device, method, table, query: url.search })
  const prefer = req.headers()['prefer'] || ''
  const q = parseQuery(url)
  const match = () => [...store.values()].filter((r) => q.filters.every((f) => f(r)))

  if (method === 'GET' || method === 'HEAD') {
    let rows = match()
    if (q.order.length) {
      rows = rows.sort((a, b) => {
        for (const o of q.order) {
          const d = cmp(a[o.col], b[o.col])
          if (d) return o.desc ? -d : d
        }
        return 0
      })
    }
    const total = rows.length
    const page = rows.slice(q.offset, q.offset + q.limit).map((r) => project(r, q.select))
    const headers = { 'content-range': contentRange(q.offset, page.length, total) }
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...CORS, ...headers } })
    return reply(route, 200, page, headers)
  }

  const payload = req.postDataJSON() as Row | Row[] | null
  const representation = prefer.includes('return=representation')

  if (method === 'POST') {
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : []
    const written: Row[] = []
    for (const incoming of rows) {
      if (!SYNC_TABLES.has(table)) {
        // data_history 等附属表：只记录，不参与同步语义
        store.set(`${store.size}`, { ...incoming })
        written.push(incoming)
        continue
      }
      const k = key(incoming.user_id, incoming.id)
      // 035：墓地中的 id 一律拒绝 INSERT（BEFORE INSERT 返回 NULL → 整行跳过，含 ON CONFLICT 更新）
      if (backend.graveyard.has(`${incoming.user_id}|${table}|${incoming.id}`)) continue
      const old = store.get(k)
      if (old) {
        // 032：不允许用不更新的时间戳把软删行复活
        if (
          incoming.deleted_at == null &&
          old.deleted_at != null &&
          Number(incoming.updated_at_num ?? 0) <= Number(old.updated_at_num ?? 0)
        ) continue
        const next = { ...old, ...incoming }
        store.set(k, next)
        written.push(next)
      } else {
        const next = { deleted_at: null, ...incoming }
        store.set(k, next)
        written.push(next)
      }
    }
    return reply(route, 201, representation ? written : undefined)
  }

  if (method === 'PATCH') {
    const patch = (payload ?? {}) as Row
    const rows = match()
    const written: Row[] = []
    for (const old of rows) {
      if (
        patch.deleted_at === null &&
        old.deleted_at != null &&
        Number(patch.updated_at_num ?? 0) <= Number(old.updated_at_num ?? 0)
      ) {
        written.push(old)
        continue
      }
      const next = { ...old, ...patch }
      store.set(key(old.user_id, old.id), next)
      written.push(next)
    }
    const headers = prefer.includes('count=exact') ? { 'content-range': contentRange(0, written.length, written.length) } : undefined
    return reply(route, representation ? 200 : 204, representation ? written : undefined, headers)
  }

  if (method === 'DELETE') {
    const rows = match()
    for (const r of rows) {
      store.delete(key(r.user_id, r.id))
      // 032 record_permanent_delete：硬删写墓地
      if (SYNC_TABLES.has(table)) backend.graveyard.add(`${r.user_id}|${table}|${r.id}`)
    }
    return reply(route, representation ? 200 : 204, representation ? rows : undefined)
  }

  return reply(route, 405, { message: `cloudbaseMock: 未支持 ${method}` })
}

/** 墓地表是只读视图：由 backend.graveyard 动态生成 */
function graveyardRows(backend: CbBackend): Row[] {
  return [...backend.graveyard].map((g) => {
    const [user_id, table_name, item_id] = g.split('|')
    return { user_id, table_name, item_id }
  })
}

/**
 * 为一个浏览器上下文（= 一台设备）接上共享的云端后端。
 * 用 context.route 而非 page.route：同设备内的页面重载 / 新标签页同样生效。
 */
export async function attachCloudBase(context: BrowserContext, backend: CbBackend, device = 'A') {
  await context.addInitScript(() => {
    localStorage.setItem('lv_setup_done', '1')
    localStorage.setItem('lv_locale', 'zh-CN')
  })
  await context.route((u) => u.hostname.endsWith('tcloudbasegateway.com'), async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const path = url.pathname

    if (path.endsWith('/auth/v1/signin')) {
      return reply(route, 200, {
        token_type: 'Bearer', access_token: 'sync-e2e-at', refresh_token: 'sync-e2e-rt',
        expires_in: 7200, scope: 'user', sub: backend.user.sub,
      })
    }
    if (path.includes('/auth/v1/')) {
      if (path.includes('/user/me')) {
        return reply(route, 200, { sub: backend.user.sub, email: backend.user.email, name: 'sync-e2e', groups: [], created_at: new Date().toISOString() })
      }
      return reply(route, 200, {})
    }

    const m = path.match(/\/rdb\/rest\/(.+)$/)
    if (!m) return reply(route, 404, { message: 'cloudbaseMock: 未知路径 ' + path })
    if (backend.down) return reply(route, 503, { message: 'service unavailable', code: 'E2E_DOWN' })

    const target = decodeURIComponent(m[1])
    if (target.startsWith('rpc/')) {
      const fn = target.slice(4)
      if (fn === 'my_entitlement') {
        return reply(route, 200, { plan_id: 'free', plan_name: '免费版', status: 'active', expires_at: null, features: {} })
      }
      if (fn === 'list_purchase_plans') return reply(route, 200, [])
      return reply(route, 200, null)
    }
    if (target === 'deleted_item_graveyard') {
      const store = new Map(graveyardRows(backend).map((r) => [`${r.table_name}|${r.item_id}`, r]))
      backend.tables.set('deleted_item_graveyard', store)
    }
    if (target === 'user_security') return reply(route, 200, [])
    return handleRdb(backend, route, target, url, device)
  })
  // 同域 HTTP 云函数（元数据提取、favicon 等）：一律 404，保证零真实出站
  await context.route((u) => u.hostname === 'ulink.ren' && !/\.(png|svg|ico|webp|jpg)$/.test(u.pathname), (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : reply(route, 404, { ok: false, error: 'e2e_not_mocked' }),
  )
}

/** 经真实 UI 用密码登录（网关已 mock） */
export async function loginViaUi(page: Page, email = CB_USER.email) {
  const drawer = page.getByTestId('lv-settings-drawer')
  if (!(await drawer.isVisible())) await page.getByTestId('lv-btn-settings').click()
  await drawer.waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  const modal = page.locator('.modal-mask.open')
  await modal.getByText('密码登录').click()
  await modal.locator('input[type=email]:visible').fill(email)
  await modal.locator('input[type=password]:visible').fill('Passw0rd123')
  await modal.locator('button:visible', { hasText: /^登录$/ }).click()
  await expect(page.locator('.modal-mask.open')).toHaveCount(0, { timeout: 15000 })
}
