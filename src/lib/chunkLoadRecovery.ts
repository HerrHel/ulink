/**
 * chunkLoadRecovery — 「旧 HTML 指向已清理的构建产物」导致白屏时的自愈。
 *
 * 场景：导航请求走 NetworkFirst，离线/弱网时回退到缓存里的旧 HTML；那份 HTML 引用的
 * `assets/app-<旧hash>.js` 已被新构建清理（部署只保留当前版本 + `--safe` 备份），
 * 于是脚本 404 → 页面白屏，用户只能手动清缓存。
 *
 * 处理：监听资源加载失败（capture 阶段，资源错误不冒泡）与 Vite 的
 * `vite:preloadError`；确认是本站 `/assets/` 产物后，清掉 Workbox 缓存并整页刷新一次。
 * 60 秒内只自愈一次，避免「资源真的缺失 → 无限刷新」把页面刷成死循环。
 *
 * 依赖注入是为了能在单测里跑：不碰真实 location / caches / sessionStorage。
 */

const GUARD_KEY = 'ulink_chunk_recovery_at'
const GUARD_MS = 60_000
/** 只认本站构建产物：/assets/<name>-<hash>.js|css */
const ASSET_RE = /\/assets\/[^/]+\.(?:js|css)(?:$|\?)/

export interface ChunkRecoveryDeps {
  /** 事件挂载目标（默认全局 window；测试可注入假对象，null 表示无宿主） */
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
  now?: () => number
  reload?: () => void
  /** 清缓存（默认删掉 workbox-* 缓存，不动同源其它缓存） */
  clearCaches?: () => Promise<void>
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** 诊断输出（默认 console.warn） */
  warn?: (message: string) => void
}

/** 只清 Workbox 自己的缓存，避免误删同源其它 Cache Storage 数据 */
async function clearWorkboxCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  const names = await caches.keys()
  await Promise.all(names.filter((n) => n.startsWith('workbox-')).map((n) => caches.delete(n)))
}

function safeSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * 安装自愈监听，返回卸载函数。
 * @returns 取消监听的 disposer（便于测试与热重载清理）
 */
export function installChunkLoadRecovery(deps: ChunkRecoveryDeps = {}): () => void {
  const host = deps.window === undefined
    ? (typeof window === 'undefined' ? null : window)
    : deps.window
  if (!host) return () => {}

  const now = deps.now ?? (() => Date.now())
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage
  const warn = deps.warn ?? ((m: string) => console.warn(m))
  const clearCaches = deps.clearCaches ?? clearWorkboxCaches
  const reload = deps.reload ?? (() => { if (typeof window !== 'undefined') window.location.reload() })

  let recovering = false

  function recover(reason: string): void {
    if (recovering) return
    recovering = true
    // 60s 内只救一次：资源真缺失时反复刷新会把页面锁死在刷新循环里
    const last = Number(storage?.getItem(GUARD_KEY) || 0)
    if (Number.isFinite(last) && now() - last < GUARD_MS) {
      warn(`[chunkRecovery] 已在 ${GUARD_MS / 1000}s 内自愈过，跳过（${reason}）`)
      recovering = false
      return
    }
    try {
      storage?.setItem(GUARD_KEY, String(now()))
    } catch { /* 隐私模式写不进去也不影响自愈 */ }
    warn(`[chunkRecovery] 检测到旧构建产物加载失败，清理缓存后刷新：${reason}`)
    void clearCaches()
      .catch(() => { /* 清缓存失败仍尝试刷新 */ })
      .then(() => {
        reload()
        // 真实场景这里页面已经卸载；只有「刷新被浏览器拦住 / 单测」时才会继续往下走，
        // 此时放开重入标记，交给上面的 60s 时间窗兜底防循环。
        recovering = false
      })
  }

  // 资源加载失败（SCRIPT/LINK）不冒泡，必须 capture
  const onError = (event: Event): void => {
    const target = event.target as (HTMLElement & { src?: string; href?: string }) | null
    const tag = target?.tagName
    if (tag !== 'SCRIPT' && tag !== 'LINK') return
    const url = String(target?.src || target?.href || '')
    if (!ASSET_RE.test(url)) return
    recover(`${tag} ${url}`)
  }

  // Vite 动态 import 预加载失败专用事件：occurrence 时 chunk 已经拿不到
  const onPreloadError = (event: Event): void => {
    event.preventDefault?.()
    recover('vite:preloadError')
  }

  host.addEventListener('error', onError as EventListener, true)
  host.addEventListener('vite:preloadError', onPreloadError as EventListener)

  return () => {
    host.removeEventListener('error', onError as EventListener, true)
    host.removeEventListener('vite:preloadError', onPreloadError as EventListener)
  }
}
