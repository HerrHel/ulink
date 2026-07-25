import { safeGetItem, safeSetItem } from './storageSafe.js'

// 主题常量：存储键 / DOM 属性 / 值。集中收敛避免拼写漂移。
// 存储键导出供 ui.ts/SettingsPanel 等跨模块复用，消除裸写字面（单一真相源）。
export const K_THEME = 'lv_theme'
export const K_THEME_MODE = 'lv_themeMode'
export const K_THEME_STYLE = 'lv_themeStyle'
const A_THEME = 'data-theme'
const A_THEME_STYLE = 'data-theme-style'
const V_DARK = 'dark'
const V_LIGHT = 'light'
const V_AUTO = 'auto'
const V_MANUAL = 'manual'
const V_COMFORTABLE = 'comfortable'

let _autoThemeMedia: MediaQueryList | null = null
let _autoThemeHandler: ((e: MediaQueryListEvent) => void) | null = null

function applySystemTheme(): void {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.setAttribute(A_THEME, isDark ? V_DARK : V_LIGHT)
  safeSetItem(K_THEME, isDark ? V_DARK : V_LIGHT)
}

function startAutoTheme(): void {
  if (_autoThemeMedia) return
  applySystemTheme()
  _autoThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  _autoThemeHandler = function (e: MediaQueryListEvent) {
    document.documentElement.setAttribute(A_THEME, e.matches ? V_DARK : V_LIGHT)
    safeSetItem(K_THEME, e.matches ? V_DARK : V_LIGHT)
  }
  _autoThemeMedia.addEventListener('change', _autoThemeHandler)
}

function stopAutoTheme(): void {
  if (_autoThemeMedia && _autoThemeHandler) { _autoThemeMedia.removeEventListener('change', _autoThemeHandler) }
  _autoThemeMedia = null; _autoThemeHandler = null
}

function toggleTheme(): void {
  const mode = safeGetItem(K_THEME_MODE) || V_MANUAL
  if (mode === V_AUTO) { stopAutoTheme(); safeSetItem(K_THEME_MODE, V_MANUAL) }
  const el = document.documentElement
  const next = el.getAttribute(A_THEME) === V_DARK ? V_LIGHT : V_DARK
  el.setAttribute(A_THEME, next)
  safeSetItem(K_THEME, next)
}

function setThemeStyle(style: string): void {
  const el = document.documentElement
  if (style === V_COMFORTABLE) { el.setAttribute(A_THEME_STYLE, V_COMFORTABLE) }
  else { el.removeAttribute(A_THEME_STYLE) }
  safeSetItem(K_THEME_STYLE, style)
}

function toggleAutoTheme(): void {
  const mode = safeGetItem(K_THEME_MODE) || V_MANUAL
  if (mode === V_AUTO) {
    stopAutoTheme()
    safeSetItem(K_THEME_MODE, V_MANUAL)
  } else {
    startAutoTheme()
    safeSetItem(K_THEME_MODE, V_AUTO)
  }
}

;(function () {
  const mode = safeGetItem(K_THEME_MODE) || V_MANUAL
  if (mode === V_AUTO) { applySystemTheme(); startAutoTheme() }
  else { const t = safeGetItem(K_THEME); if (t) document.documentElement.setAttribute(A_THEME, t) }
  const s = safeGetItem(K_THEME_STYLE)
  if (s === V_COMFORTABLE) document.documentElement.setAttribute(A_THEME_STYLE, V_COMFORTABLE)
})()

export { toggleTheme, setThemeStyle, toggleAutoTheme }