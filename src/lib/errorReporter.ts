/**
 * errorReporter.ts — 客户端运行时错误上报
 *
 * 将未捕获的异常、Vue 渲染错误上报到 Supabase error_logs 表。
 * 特性：
 * - 节流（同一错误消息 5s 内不再重复上报）
 * - 静默失败（不因上报错误影响主流程）
 * - 自动附加上下文（URL、UA）
 *
 * SEC-07 权衡：error_logs 表 RLS 允许匿名 INSERT（WITH CHECK true），客户端 5s 节流
 * 可被直打 PostgREST 绕过。SELECT 仅本人；字段有长度 CHECK。当前维持客户端上报 +
 * 库侧 length 限制；若滥用上升再上 Edge 写入 / IP 限流 / 定期 prune。
 */
import { supabase } from './supabase.js'
import { useAuthStore } from '../stores/auth.js'

/** 节流 Map：最近 N 毫秒内已上报的错误消息 */
const _throttled = new Map<string, number>()
const THROTTLE_MS = 5000
const MAX_THROTTLED_KEYS = 100

function _throttleKey(message: string): boolean {
  const now = Date.now()
  const last = _throttled.get(message)
  if (last && now - last < THROTTLE_MS) return true
  if (_throttled.size >= MAX_THROTTLED_KEYS) _throttled.clear()
  _throttled.set(message, now)
  return false
}

export interface ErrorPayload {
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

  const authStore = useAuthStore()
  const userId = authStore.user?.id || null

  const row = {
    user_id: userId,
    message: payload.message.slice(0, 1000),
    stack: payload.stack?.slice(0, 5000) || '',
    component: payload.component?.slice(0, 200) || '',
    url: payload.url || (typeof window !== 'undefined' ? window.location.href : ''),
    user_agent: payload.user_agent || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
  }

  Promise.resolve(supabase.from('error_logs').insert(row)).then(({ error }) => {
    if (error) console.warn('[errorReporter] insert failed:', error)
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
