/**
 * iconAnalyzer.ts — 智能自适应 Favicon 像素视觉特征分析引擎
 *
 * 职责：
 * 彻底取代维护成本高昂的硬编码域名白名单。
 * 基于浏览器 Canvas 256 像素极速采样（<0.1ms），自主感知图标物理特征：
 * 1. 彩度判定：只要包含彩色像素（如 Supabase 翠绿、Raycast 绯红、YouTube 亮红），绝对不反色；
 * 2. 剪影判定：高透明度背景 + 近零彩度（纯黑/深灰）的剪影标（如 GitHub、Apple、Vercel），深色模式自动高反差反色；
 * 3. 安全降级：跨域受限（Tainted Canvas）或分析异常时一律静默兜底为不反色，由 Micro-Halo 微光轮廓承托；
 * 4. 本地持久化：分析结果写入内存 LRU 与 localStorage，同一图标全生命周期只测一次。
 */

const STORAGE_KEY = 'lv_icon_invert_cache'
const MAX_CACHE_ENTRIES = 500

const GITHUB_SVG_PATH =
  'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'

export const GITHUB_LIGHT_ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2324292e'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='${GITHUB_SVG_PATH}'/%3E%3C/svg%3E`

export const GITHUB_DARK_ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ffffff'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='${GITHUB_SVG_PATH}'/%3E%3C/svg%3E`

/**
 * 现代知名网站官方原生深色模式 Favicon 资源映射（方案一：源头官方矢量双模）
 * 深色模式下直接以官方高清原画呈现，100% 官方原汁原味，零反色失真。
 */
export const OFFICIAL_DARK_ICONS: Record<string, string> = {
  'github.com': GITHUB_DARK_ICON,
  'github.io': GITHUB_DARK_ICON,
}

/**
 * 获取指定网址匹配的官方原生深色模式图标（方案一：源头官方原画）
 */
export function getOfficialDarkIcon(url?: string | null): string | undefined {
  if (!url) return undefined
  try {
    const raw = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
    for (const [domain, icon] of Object.entries(OFFICIAL_DARK_ICONS)) {
      if (host === domain || host.endsWith('.' + domain)) {
        return icon
      }
    }
  } catch {
    // 忽略非标准 URL
  }
  return undefined
}

/** 内存高速缓存：iconUrl -> 是否需要反色 */
const memoryCache = new Map<string, boolean>()

/** 初始化：从 localStorage 恢复已有缓存 */
function initCacheFromStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') memoryCache.set(k, v)
      }
    }
  } catch {
    // 忽略存储读取异常
  }
}

/** 持久化：防抖写入 localStorage */
let _persistTimer: ReturnType<typeof setTimeout> | null = null
function persistCacheToStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    try {
      // 保持条目上限，超出时剔除最早插入的条目
      if (memoryCache.size > MAX_CACHE_ENTRIES) {
        const keys = Array.from(memoryCache.keys())
        const removeCount = keys.length - MAX_CACHE_ENTRIES
        for (let i = 0; i < removeCount; i++) memoryCache.delete(keys[i])
      }
      const obj: Record<string, boolean> = {}
      for (const [k, v] of memoryCache.entries()) obj[k] = v
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // 忽略存储写入配额超限等异常
    }
  }, 1000)
}

initCacheFromStorage()

/**
 * 核心像素分析纯函数：
 * @param width 画布宽度
 * @param height 画布高度
 * @param data RGBA 像素一维数组
 * @returns true 表示为深色纯黑透明剪影，需要在深色模式下反色为象牙白
 */
export function analyzePixelData(width: number, height: number, data: Uint8ClampedArray | number[]): boolean {
  const totalPixels = width * height
  if (totalPixels === 0 || data.length < totalPixels * 4) return false

  let transparentPixels = 0
  let visiblePixels = 0
  let totalLuminance = 0
  let totalChroma = 0
  let coloredPixels = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]

    // 视为透明像素
    if (a < 30) {
      transparentPixels++
      continue
    }

    visiblePixels++
    // 相对明度公式 (Perceived Luminance)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    totalLuminance += lum

    // 彩度 (Chroma: max - min)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    totalChroma += chroma

    if (chroma > 25) {
      coloredPixels++
    }
  }

  // 无可见像素或全透明
  if (visiblePixels === 0) return false

  const transRatio = transparentPixels / totalPixels
  const coloredRatio = coloredPixels / visiblePixels
  const avgChroma = totalChroma / visiblePixels
  const avgLuminance = totalLuminance / visiblePixels

  // 1. 如果存在明显的彩色像素（如 Supabase 翠绿、Raycast 绯红、YouTube 红、Twitter 蓝鸟），
  //    判定为彩色品牌 Logo，绝对禁止反色！
  if (coloredRatio > 0.04 || avgChroma > 14) {
    return false
  }

  // 2. 如果是黑白/灰度图标：
  // 必须具有透明背景（透明占比 >= 15%）且可见剪影为暗黑低明度（平均亮度 < 90，如 GitHub 猫、Apple 标、Vercel 三角），
  // 才判定为「需在深色模式反色」的黑标剪影。
  if (transRatio >= 0.15 && avgLuminance < 90) {
    return true
  }

  // 实底方块、浅色白标或彩色标均保持原样
  return false
}

/** 共享的 16x16 离屏采样画布（单例复用，极度轻量） */
let _canvas: HTMLCanvasElement | OffscreenCanvas | null = null
let _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null

function getSampleContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (_ctx) return _ctx
  if (typeof window === 'undefined') return null

  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      _canvas = new OffscreenCanvas(16, 16)
      _ctx = _canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
      return _ctx
    }
  } catch {
    // 降级使用普通 DOM canvas
  }

  try {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = 16
      c.height = 16
      _canvas = c
      _ctx = c.getContext('2d', { willReadFrequently: true })
      return _ctx
    }
  } catch {
    // 环境不支持 canvas
  }

  return null
}

/**
 * 分析已完成加载的 HTMLImageElement 元素
 * 成功后自动回填缓存并回调
 */
export function analyzeImageElement(img: HTMLImageElement, onResult?: (shouldInvert: boolean) => void): boolean {
  if (!img) return false
  const src = img.currentSrc || img.src
  if (!src) return false

  // 1. 命中缓存直接返回
  if (memoryCache.has(src)) {
    const res = memoryCache.get(src)!
    if (onResult) onResult(res)
    return res
  }

  // 2. 图像未完成加载，等待加载
  if (!img.complete || img.naturalWidth === 0) {
    return false
  }

  const ctx = getSampleContext()
  if (!ctx) return false

  try {
    ctx.clearRect(0, 0, 16, 16)
    ctx.drawImage(img, 0, 0, 16, 16)
    const imgData = ctx.getImageData(0, 0, 16, 16)
    const shouldInvert = analyzePixelData(16, 16, imgData.data)

    memoryCache.set(src, shouldInvert)
    persistCacheToStorage()

    if (onResult) onResult(shouldInvert)
    return shouldInvert
  } catch {
    // 跨域 CORS 阻断 (SecurityError) 或其他图像解码异常：安全降级为不反色
    memoryCache.set(src, false)
    persistCacheToStorage()
    if (onResult) onResult(false)
    return false
  }
}

/**
 * 同步检查指定图标 URL 是否已知需要反色（从高速缓存读取）
 */
export function getCachedIconInvert(url?: string | null): boolean | undefined {
  if (!url) return undefined
  return memoryCache.get(url)
}

/**
 * 设置图标反色缓存（供测试或预加载使用）
 */
export function setCachedIconInvert(url: string, shouldInvert: boolean): void {
  memoryCache.set(url, shouldInvert)
}

/**
 * 异步感知指定图标 URL（若未缓存则在后台创建静默 Image 进行测定）
 */
export function requestIconAnalysis(iconUrl: string, callback?: (shouldInvert: boolean) => void): void {
  if (!iconUrl || typeof window === 'undefined') return
  if (memoryCache.has(iconUrl)) {
    if (callback) callback(memoryCache.get(iconUrl)!)
    return
  }

  const tempImg = new Image()
  tempImg.crossOrigin = 'anonymous'
  tempImg.onload = () => {
    analyzeImageElement(tempImg, callback)
  }
  tempImg.onerror = () => {
    memoryCache.set(iconUrl, false)
    if (callback) callback(false)
  }
  tempImg.src = iconUrl
}
