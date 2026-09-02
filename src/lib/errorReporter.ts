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
 * P1-4 方案 B（2026-09-02）：写入通道从「直插 error_logs 表」改为调
 * Edge Function report-error（迁移 030 已撤匿名直插策略，函数是唯一
 * 写入入口）。函数侧按 IP 计数限流（1min/30）+ 028 全局熔断兜底；
 * supabase.functions.invoke 自动携带 apikey 与登录态 Authorization，
 * 函数据此解析真实 user_id（客户端传入的一律忽略，防伪造）。
 */
import { supabase } from './supabase.js'

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
  // 表满时回收：先清掉已过期槽位（now - last >= THROTTLE_MS），仍满则仅淘汰最旧一项，
  // 绝不全表 .clear()——全清会把 5s 窗口内已上报的其他错误记录一起清零，致使紧随其后的
  // 同 message 重复错误 get 命中 undefined 绕过节流，在最该节流的风暴场景反而失效。
  // 修审计：实现与文件头注释/test 编排声明的「LRU 100 上限」intent 对齐，附带修过期槽位
  // 永不主动回收的泄漏（满前 Map 只增不减）。
  if (_throttled.size >= MAX_THROTTLED_KEYS) {
    let oldestKey: string | undefined
    let oldestTs = Infinity
    for (const [k, ts] of _throttled) {
      if (now - ts >= THROTTLE_MS) {
        _throttled.delete(k)
      } else if (ts < oldestTs) {
        oldestKey = k
        oldestTs = ts
      }
    }
    // 清完过期仍超上限（即所有现存条目均在 5s 窗口内），删最旧一项腾槽给当前 message
    if (_throttled.size >= MAX_THROTTLED_KEYS && oldestKey) {
      _throttled.delete(oldestKey)
    }
  }
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

  // user_id 不在此组装：supabase.functions.invoke 自动携带登录态
  // Authorization，report-error 函数据此解析真实 user_id（防伪造）。
  const href = typeof window !== 'undefined' ? window.location.href : ''
  const body = {
    message: rawMsg.slice(0, 1000),
    stack: rawStack.slice(0, 5000) || '',
    component: payload.component?.slice(0, 200) || '',
    // H8：脱敏 URL
    url: sanitizeReportUrl(payload.url || href).slice(0, 2048),
    user_agent: (payload.user_agent || (typeof navigator !== 'undefined' ? navigator.userAgent : '')).slice(0, 1024),
  }

  // H9：invoke 包超时，避免慢网挂死。审计 R28：timeoutP 的 setTimeout 在 invoke 早
  // settle 时仍挂事件循环 8s，无人 clearTimeout 致每次成功上报泄漏一个 timer 句柄。
  // 在 invokeP settle 后清理 timer，保留超时兜底语义同时消除孤儿 timer。
  let timer: ReturnType<typeof setTimeout> | undefined
  const invokeP = Promise.resolve(
    supabase.functions.invoke('report-error', { body }),
  )
  const timeoutP = new Promise<{ error: { message: string } }>((resolve) => {
    timer = setTimeout(() => resolve({ error: { message: 'timeout' } }), INSERT_TIMEOUT_MS)
  })
  invokeP.finally(() => {
    if (timer) clearTimeout(timer)
  })
  Promise.race([invokeP, timeoutP]).then((res: { error?: { message?: string } | null }) => {
    if (res?.error && res.error.message !== 'timeout') {
      console.warn('[errorReporter] invoke failed:', res.error)
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
  instance: unknown,
  info: string,
): void {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  const inst = instance as { $options?: { name?: string; _componentTag?: string }; $?: { type?: { name?: string } } } | null | undefined
  const componentName = inst?.$options?.name
    || inst?.$?.type?.name
    || inst?.$options?._componentTag
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
