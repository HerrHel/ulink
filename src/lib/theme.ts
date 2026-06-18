let _autoThemeMedia: MediaQueryList | null = null
let _autoThemeHandler: ((e: MediaQueryListEvent) => void) | null = null

function _safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch (_) { /* private browsing */ }
}

function applySystemTheme(): void {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  _safeSetItem('lv_theme', isDark ? 'dark' : 'light')
}

function startAutoTheme(): void {
  if (_autoThemeMedia) return
  applySystemTheme()
  _autoThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  _autoThemeHandler = function (e: MediaQueryListEvent) {
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light')
    _safeSetItem('lv_theme', e.matches ? 'dark' : 'light')
  }
  _autoThemeMedia.addEventListener('change', _autoThemeHandler)
}

function stopAutoTheme(): void {
  if (_autoThemeMedia && _autoThemeHandler) { _autoThemeMedia.removeEventListener('change', _autoThemeHandler) }
  _autoThemeMedia = null; _autoThemeHandler = null
}

function toggleTheme(): void {
  const mode = localStorage.getItem('lv_themeMode') || 'manual'
  if (mode === 'auto') { stopAutoTheme(); _safeSetItem('lv_themeMode', 'manual') }
  const el = document.documentElement
  const next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  el.setAttribute('data-theme', next)
  _safeSetItem('lv_theme', next)
}

function setThemeStyle(style: string): void {
  const el = document.documentElement
  if (style === 'comfortable') { el.setAttribute('data-theme-style', 'comfortable') }
  else { el.removeAttribute('data-theme-style') }
  _safeSetItem('lv_themeStyle', style)
}

function toggleAutoTheme(): void {
  const mode = localStorage.getItem('lv_themeMode') || 'manual'
  if (mode === 'auto') {
    stopAutoTheme()
    _safeSetItem('lv_themeMode', 'manual')
  } else {
    startAutoTheme()
    _safeSetItem('lv_themeMode', 'auto')
  }
}

;(function () {
  try {
    const mode = localStorage.getItem('lv_themeMode') || 'manual'
    if (mode === 'auto') { applySystemTheme(); startAutoTheme() }
    else { const t = localStorage.getItem('lv_theme'); if (t) document.documentElement.setAttribute('data-theme', t) }
    const s = localStorage.getItem('lv_themeStyle')
    if (s === 'comfortable') document.documentElement.setAttribute('data-theme-style', 'comfortable')
  } catch (_) { /* localStorage 不可用时静默 */ }
})()

export { toggleTheme, setThemeStyle, toggleAutoTheme }