/**
 * errorReporter.ts — 客户端运行时错误上报
 *
 * 将未捕获的异常、Vue 渲染错误上报到 Supabase error_logs 表。
 * 特性：
 * - 节流（同一错误消息 5s 内不再重复上报）
 * - 静默失败（不因上报错误影响主流程）
 * - URL 脱敏（只报 origin+pathname，丢弃 search/hash）
 * - 含密模式本地 console 不入库
 *
 * SEC-07 权衡：error_logs 表 RLS 允许匿名 INSERT（user_id IS NULL OR = auth.uid()，
 * 见 migration 019），客户端节流可被直打 PostgREST 绕过。SELECT 仅本人；字段有长度 CHECK。
 * 若滥用上升再上 Edge 写入 / IP 限流 / 定期 prune。
 */
import { supabase } from './supabase.js'
import { useAuthStore } from '../stores/auth.js'

/** 节流 Map：最近 N 毫秒内已上报的错误消息 */
const _throttled = new Map<string, number>()
const THROTTLE_MS = 5000
const MAX_THROTTLED_KEYS = 100
/** insert 超时：避免慢网挂死 fire-and-forget 链 */
const INSERT_TIMEOUT_MS = 8000

/**
 * H8：URL 脱敏 — 只保留 origin + pathname，丢弃 search/hash。
 * 扩展保存/Web Share Target 入口会在 query 携带书签 URL/标题/笔记，
 * 若原样上报，error_logs 会泄漏用户书签内容。
 */
export function sanitizeReportUrl(raw: string): string {
  if (!raw) return ''
  try {
    // 绝对 URL
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw)
      return u.origin + u.pathname
    }
  } catch { /* fall through */ }
  // 相对路径或异常：手动 strip ?/#
  return raw.split('#')[0].split('?')[0].slice(0, 2048)
}

/**
 * H9：命中已知含密模式时只本地 console，不入库。
 * 覆盖 JWT/API key/password 赋值等常见泄漏串；避免 error message 把密钥带进云端。
 */
const _SECRET_RE = /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|password\s*[:=]\s*\S+|apikey\s*[:=]\s*\S+)/i

export function looksLikeSecret(text: string): boolean {
  if (!text) return false
  return _SECRET_RE.test(text)
}

function _throttleKey(message: string): boolean {
  const now = Date.now()
  const last = _throttled.get(message)
  if (last && now - last < THROTTLE_MS) return true
  if (_throttled.size >= MAX_THROTTLED_KEYS) _throttled.clear()
  _throttled.set(message, now)
  return false
}

interface ErrorPayload {
  message: string
  stack?: string
  component?: string
  url?: string
  user_agent?: string
}

/**
 * 上报错误到 Supabase error_logs 表
 * 非阻塞（fire-and-forget），静默失败
 */
export function reportError(payload: ErrorPayload): void {
  if (_throttleKey(payload.message)) return

  // H9：含密模式不入库
  const rawMsg = payload.message || ''
  const rawStack = payload.stack || ''
  if (looksLikeSecret(rawMsg) || looksLikeSecret(rawStack)) {
    console.warn('[errorReporter] suppressed report containing secret-like content')
    return
  }

  let userId: string | null = null
  try {
    const authStore = useAuthStore()
    userId = authStore.user?.id || null
  } catch {
    userId = null
  }

  const href = typeof window !== 'undefined' ? window.location.href : ''
  const row = {
    user_id: userId,
    message: rawMsg.slice(0, 1000),
    stack: rawStack.slice(0, 5000) || '',
    component: payload.component?.slice(0, 200) || '',
    // H8：脱敏 URL
    url: sanitizeReportUrl(payload.url || href).slice(0, 2048),
    user_agent: (payload.user_agent || (typeof navigator !== 'undefined' ? navigator.userAgent : '')).slice(0, 1024),
  }

  // H9：insert 包超时，避免慢网挂死
  const insertP = Promise.resolve(supabase.from('error_logs').insert(row))
  const timeoutP = new Promise<{ error: { message: string } }>((resolve) => {
    setTimeout(() => resolve({ error: { message: 'timeout' } }), INSERT_TIMEOUT_MS)
  })
  Promise.race([insertP, timeoutP]).then((res: any) => {
    if (res?.error && res.error.message !== 'timeout') {
      console.warn('[errorReporter] insert failed:', res.error)
    }
  }).catch(() => {
    // 完全静默
  })
}

/**
 * Vue 错误处理器的包装
 * 用于 app.config.errorHandler
 */
export function vueErrorHandler(
  err: unknown,
  instance: any,
  info: string,
): void {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  const componentName = instance?.$options?.name
    || instance?.$?.type?.name
    || instance?.$options?._componentTag
    || 'unknown'

  reportError({
    message,
    stack,
    component: `${componentName} [${info}]`,
  })

  // 保留控制台输出方便开发调试
  console.error('[LinkVault] Vue error:', err)
  console.error('[LinkVault] Component:', componentName)
  console.error('[LinkVault] Info:', info)
}

/**
 * 全局 unhandledrejection 监听器
 */
export function unhandledRejectionHandler(event: PromiseRejectionEvent): void {
  const reason = event.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined

  reportError({
    message: `[UnhandledRejection] ${message}`,
    stack,
    component: 'global',
  })
}
