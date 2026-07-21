import { safeGetItem, safeSetItem } from './storageSafe.js'

let _autoThemeMedia: MediaQueryList | null = null
let _autoThemeHandler: ((e: MediaQueryListEvent) => void) | null = null

function applySystemTheme(): void {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  safeSetItem('lv_theme', isDark ? 'dark' : 'light')
}

function startAutoTheme(): void {
  if (_autoThemeMedia) return
  applySystemTheme()
  _autoThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  _autoThemeHandler = function (e: MediaQueryListEvent) {
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
    safeSetItem('lv_theme', e.matches ? 'dark' : 'light')
  }
  _autoThemeMedia.addEventListener('change', _autoThemeHandler)
}

function stopAutoTheme(): void {
  if (_autoThemeMedia && _autoThemeHandler) { _autoThemeMedia.removeEventListener('change', _autoThemeHandler) }
  _autoThemeMedia = null; _autoThemeHandler = null
}

function toggleTheme(): void {
  const mode = safeGetItem('lv_themeMode') || 'manual'
  if (mode === 'auto') { stopAutoTheme(); safeSetItem('lv_themeMode', 'manual') }
  const el = document.documentElement
  const next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  el.setAttribute('data-theme', next)
  safeSetItem('lv_theme', next)
}

function setThemeStyle(style: string): void {
  const el = document.documentElement
  if (style === 'comfortable') { el.setAttribute('data-theme-style', 'comfortable') }
  else { el.removeAttribute('data-theme-style') }
  safeSetItem('lv_themeStyle', style)
}

function toggleAutoTheme(): void {
  const mode = safeGetItem('lv_themeMode') || 'manual'
  if (mode === 'auto') {
    stopAutoTheme()
    safeSetItem('lv_themeMode', 'manual')
  } else {
    startAutoTheme()
    safeSetItem('lv_themeMode', 'auto')
  }
}

;(function () {
  const mode = safeGetItem('lv_themeMode') || 'manual'
  if (mode === 'auto') { applySystemTheme(); startAutoTheme() }
  else { const t = safeGetItem('lv_theme'); if (t) document.documentElement.setAttribute('data-theme', t) }
  const s = safeGetItem('lv_themeStyle')
  if (s === 'comfortable') document.documentElement.setAttribute('data-theme-style', 'comfortable')
})()

export { toggleTheme, setThemeStyle, toggleAutoTheme }