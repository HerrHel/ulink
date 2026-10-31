/**
 * cloudbase — CloudBase（腾讯云开发）客户端边界
 *
 * 设计要点：
 * 1. **惰性单例**：不在模块顶层 init。jsdom 测试环境无 window/document 依赖时不会炸，
 *    也避免未配置环境时白白初始化。
 * 2. **未配置降级**：未提供 envId / publishable key 时返回 null client，形状与真实
 *    客户端一致（builder 可无限链式调用、await 得 `{data:null,error}`），调用方无需
 *    null 判断——与 `lib/supabase.ts` 的 null client 策略保持一致。
 * 3. **后端开关**：`VITE_BACKEND=cloudbase` 才启用；默认仍是 Supabase 链路，
 *    切换前不影响线上。
 *
 * CloudBase PG 与 Supabase 的关键差异（均对目标环境实测确认）：
 * - `auth.uid()` 返回 **text**（JWT `sub`），不是 uuid → owner 列一律 TEXT
 * - `app.rdb()` 是 postgrest 风格，但方法名与 supabase-js 不同：
 *   `.where()→.match()`、`.orderBy()→.order()`、`.offset()→.range()`
 * - 计数走 `select('*', { count: 'exact' })`，不是 `.count()`
 */
import cloudbase from '@cloudbase/js-sdk'

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID as string | undefined
const publishableKey = import.meta.env.VITE_PUBLISHABLE_KEY as string | undefined

/** 是否已配置 CloudBase（envId + publishable key 均存在） */
export const isCloudBaseConfigured = Boolean(envId && publishableKey)

/** 后端开关：只有显式设为 'cloudbase' 才切走 Supabase */
export function isCloudBaseBackend(): boolean {
  return (import.meta.env.VITE_BACKEND as string | undefined) === 'cloudbase'
}

/**
 * Edge Function 完整 URL（供 fetch 直调——SSE 流式等场景不能走 invokeCbFunction）：
 * Supabase 为 `<url>/functions/v1/<name>`，CloudBase 为 `<base>/<name>`。
 * 未配置返回空串，调用方按「未配置」降级。
 */
export function edgeFnUrl(name: string): string {
  if (isCloudBaseBackend()) {
    const base = getCbFnBase()
    return base ? `${base}/${name}` : ''
  }
  const base = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').replace(/\/+$/, '')
  return base ? `${base}/functions/v1/${name}` : ''
}

// ── 最小结构化类型：只声明本项目用到的表面，避免依赖 SDK 内部类型 ──

export interface RdbError {
  message: string
  code?: string
}

export interface RdbResult<T = unknown> {
  data: T | null
  error: RdbError | null
  count?: number | null
}

/** 查询构造器：链接式 + thenable */
export interface RdbBuilder<T = unknown> extends PromiseLike<RdbResult<T>> {
  select(columns?: string, opts?: { count?: 'exact'; head?: boolean }): RdbBuilder<T>
  insert(values: unknown): RdbBuilder<T>
  upsert(values: unknown, opts?: { onConflict?: string }): RdbBuilder<T>
  update(values: unknown, opts?: { count?: 'exact' }): RdbBuilder<T>
  delete(): RdbBuilder<T>
  eq(column: string, value: unknown): RdbBuilder<T>
  neq(column: string, value: unknown): RdbBuilder<T>
  gt(column: string, value: unknown): RdbBuilder<T>
  gte(column: string, value: unknown): RdbBuilder<T>
  lt(column: string, value: unknown): RdbBuilder<T>
  lte(column: string, value: unknown): RdbBuilder<T>
  like(column: string, pattern: string): RdbBuilder<T>
  ilike(column: string, pattern: string): RdbBuilder<T>
  in(column: string, values: unknown[]): RdbBuilder<T>
  is(column: string, value: unknown): RdbBuilder<T>
  not(column: string, operator: string, value: unknown): RdbBuilder<T>
  or(filter: string): RdbBuilder<T>
  match(conditions: Record<string, unknown>): RdbBuilder<T>
  order(column: string, opts?: { ascending?: boolean }): RdbBuilder<T>
  limit(count: number): RdbBuilder<T>
  range(from: number, to: number): RdbBuilder<T>
  single(): RdbBuilder<T>
  maybeSingle(): RdbBuilder<T>
}

/** PG 数据端口 */
export interface RdbClient {
  from<T = unknown>(table: string): RdbBuilder<T>
  rpc<T = unknown>(name: string, args?: Record<string, unknown>): RdbBuilder<T>
}

function createNullResult(): RdbResult<never> {
  return { data: null, error: { message: 'CloudBase 未配置' }, count: null }
}

/** 与 supabase.ts 同策略：Proxy 伪装任意链式调用，await 得统一空结果 */
function createNullBuilder(): RdbBuilder<never> {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: RdbResult<never>) => void) => resolve(createNullResult())
        }
        return () => builder
      },
    },
  )
  return builder as RdbBuilder<never>
}

const nullDb: RdbClient = {
  from: () => createNullBuilder(),
  rpc: () => createNullBuilder(),
}

let _app: ReturnType<typeof cloudbase.init> | null = null
let _db: RdbClient | null = null

function initApp(): ReturnType<typeof cloudbase.init> | null {
  if (!isCloudBaseConfigured) return null
  if (!_app) {
    _app = cloudbase.init({
      env: envId as string,
      accessKey: publishableKey as string,
      auth: { detectSessionInUrl: true },
    })
  }
  return _app
}

/** 取 PG 数据客户端；未配置时返回 null client（永不抛错） */
export function getCbDb(): RdbClient {
  if (!isCloudBaseConfigured) return nullDb
  if (!_db) {
    const app = initApp()
    // SDK 的 rdb() 不在早期版本上存在（v3 才有）；缺失时降级为 null client 而非崩溃
    const rdb = (app as unknown as { rdb?: () => unknown } | null)?.rdb
    _db = typeof rdb === 'function' ? ((app as unknown as { rdb: () => RdbClient }).rdb()) : nullDb
  }
  return _db
}

/** 取 Auth（下一阶段接登录时使用）；未配置返回 null */
export function getCbAuth(): unknown {
  const app = initApp()
  return app ? (app as unknown as { auth?: unknown }).auth : null
}

/** 取 Storage bucket 句柄（下一阶段接图片上传时使用）；未配置返回 null */
export function getCbStorage(bucket: string): unknown {
  const app = initApp()
  const storage = (app as unknown as { storage?: { from?: (b: string) => unknown } } | null)?.storage
  return typeof storage?.from === 'function' ? storage.from(bucket) : null
}

/**
 * HTTP 云函数的访问基址（形如 https://<env>.service.tcloudbase.com）。
 * 未配置时返回空串，调用方应据此降级而不是发无效请求。
 */
export function getCbFnBase(): string {
  return ((import.meta.env.VITE_CLOUDBASE_FN_BASE as string | undefined) || '').replace(/\/+$/, '')
}

/**
 * 调 HTTP 云函数（POST JSON）。返回形状刻意对齐 supabase.functions.invoke
 * 的 `{ error }`，让上层超时/重试逻辑可以不分支直接复用。
 */
export async function invokeCbFunction(
  name: string,
  body: unknown,
  signal?: AbortSignal,
  options?: { token?: string | null },
): Promise<{ error: { message: string; code?: string } | null; data?: unknown }> {
  const base = getCbFnBase()
  if (!base) return { error: { message: 'CloudBase 函数未配置' } }
  try {
    const res = await fetch(`${base}/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal,
    })
    // 非 2xx 也要读 body：死链检测对「安全拒绝」返回 400 + {fetch_outcome:'ssrf_reject'}，
    // 客户端要靠 body 里的 evidence 判定，不能只拿到一个 http_400。
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* 非 JSON 响应不阻断 */
    }
    if (!res.ok) return { error: { message: `http_${res.status}`, code: String(res.status) }, data }
    return { error: null, data }
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : 'network_error' } }
  }
}

/** 测试专用：清空惰性单例，便于在用例间切换配置 */
export function __resetCloudBaseForTest(): void {
  _app = null
  _db = null
}
