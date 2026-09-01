/**
 * 主应用 SPA 资源注入（Cloudflare Pages Functions 共享模块）。
 *
 * 分享页 SSR 输出的 HTML 若不含主应用 bundle，页面就是纯静态的——用户只能手动点
 * CTA 跳 hash 路由才进入 SPA（这正是「分享链接显示老界面」的根因）。本模块负责从
 * 主应用 index.html 提取 SPA 资源标签（stylesheet / modulepreload / module script），
 * 供 SSR 注入 head，使 SPA 启动即识别 /s/<gid> path 路由自动接管为只读态。
 *
 * 健壮性要点：
 *  - **只做正缓存**：读取失败绝不写入缓存，否则一次瞬时失败会污染整个 isolate 生命周期。
 *  - **多策略回退**：优先 ASSETS binding（零网络开销），失败再退回同源自取。
 *  - **绝对路径**：ASSETS.fetch 传完整 URL，避免相对路径解析不到资源。
 */
import { extractAppAssets } from "./share-render.js"

/** 模块级缓存：仅缓存成功结果（bundle 名含构建 hash，同部署内稳定）。 */
let _cache: string | null = null

export interface AppAssetsEnv {
  /** Cloudflare Pages ASSETS binding */
  ASSETS?: { fetch: (input: Request | string | URL) => Promise<Response> }
  /** 站点源（回退策略用），例如 https://ulink.ren */
  APP_ORIGIN?: string
}

/**
 * 读取主应用 index.html → 提取 SPA 资源标签。
 * 全部策略失败时返回空串（页面退化为静态骨架，仍可读、CTA 仍可用）。
 */
export async function getAppAssets(env: AppAssetsEnv, requestUrl: string): Promise<string> {
  if (_cache) return _cache

  let origin = (env.APP_ORIGIN || "").replace(/\/+$/, "")
  if (!origin) {
    try {
      origin = new URL(requestUrl).origin
    } catch {
      origin = ""
    }
  }

  // 策略 1：ASSETS binding 直读静态资源（同 isolate，无外部网络往返）
  // 策略 2：同源自取（ASSETS 不可用或相对路径解析失败时的兜底）
  const strategies: Array<() => Promise<Response>> = []
  if (env.ASSETS) {
    const assets = env.ASSETS
    strategies.push(async () => {
      const abs = new URL("/index.html", requestUrl).toString()
      return assets.fetch(new Request(abs))
    })
  }
  if (origin) {
    strategies.push(async () => {
      const abs = new URL("/index.html", origin).toString()
      return fetch(abs)
    })
  }

  let lastErr = ""
  for (let i = 0; i < strategies.length; i++) {
    try {
      const res = await strategies[i]()
      if (!res.ok) {
        lastErr = `strategy${i} HTTP ${res.status}`
        continue
      }
      const assets = extractAppAssets(await res.text())
      if (assets) {
        _cache = assets
        return assets
      }
      lastErr = `strategy${i} extract empty`
    } catch (e) {
      lastErr = `strategy${i} threw: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  if (lastErr) console.warn(`[app-assets] 提取失败（降级为静态骨架）: ${lastErr}`)
  return ""
}
