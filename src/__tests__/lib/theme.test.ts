/**
 * theme.test.ts — src/lib/theme.ts 三件套（toggleTheme/setThemeStyle/toggleAutoTheme）护栏
 * 用户可见「主题深浅色切换 + 自动跟随系统 + 主题样式（舒适）」唯一承载逻辑，此前零直接测试。
 * 对照同域 head.test.ts jsdom 断 document 头部 attr 参照口径，补 matchMedia stub（jsdom 默认无）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { localStorageMock } from '../setup.js'

const A_THEME = 'data-theme'
const A_THEME_STYLE = 'data-theme-style'
const K_THEME = 'lv_theme'
const K_THEME_MODE = 'lv_themeMode'
const K_THEME_STYLE = 'lv_themeStyle'

/**
 * matchMedia stub 工厂：返回可控 matches 的 MediaQueryList。
 * theme.ts startAutoTheme 调 matchMedia 两次（applySystemTheme 一次 + 注册 change 监听一次），
 * toggleAutoTheme→manual→auto 切换依赖 stopAutoTheme 把 _autoThemeMedia 清 null（否则后续 start
 * 因 `if (_autoThemeMedia) return` 早退不再重新注册监听，handler 不更新——防 listener 泄漏 + 状态僵死）。
 * 故每用例须 vi.resetModules() 让模块级 _autoThemeMedia/_autoThemeHandler 单例生命周期随 stub 复位。
 */
function stubMatchMedia(matches: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = []
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_t: string, h: (e: { matches: boolean }) => void) => { listeners.push(h) },
    removeEventListener: (_t: string, h: (e: { matches: boolean }) => void) => {
      const i = listeners.indexOf(h)
      if (i >= 0) listeners.splice(i, 1)
    },
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }
  const spy = vi.fn(() => mql)
  vi.stubGlobal('matchMedia', spy)
  return { mql, spy, listeners, emitChange: (newMatches: boolean) => {
    mql.matches = newMatches
    for (const h of listeners) h({ matches: newMatches })
  } }
}

async function importTheme() {
  vi.resetModules()
  return await import('../../lib/theme.js')
}

describe('theme.ts 三件套护栏', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(A_THEME)
    document.documentElement.removeAttribute(A_THEME_STYLE)
    localStorageMock.clear()
    vi.clearAllMocks()
    // 全局 stub 一个 matchMedia(matches=false)；个别用例需 matches=true 或自行重新 stub
    stubMatchMedia(false)
  })

  afterEach(() => {
    document.documentElement.removeAttribute(A_THEME)
    document.documentElement.removeAttribute(A_THEME_STYLE)
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  // ---------- toggleTheme ----------

  it('manual dark → 翻 light：data-theme=light + K_THEME 持久化', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'manual')
    document.documentElement.setAttribute(A_THEME, 'dark')
    const { toggleTheme } = await importTheme()
    toggleTheme()
    expect(document.documentElement.getAttribute(A_THEME)).toBe('light')
    expect(localStorageMock.getItem(K_THEME)).toBe('light')
  })

  it('manual light → 翻 dark：当前 dark 否则翻 dark（light/null 都翻 dark）', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'manual')
    document.documentElement.setAttribute(A_THEME, 'light')
    const { toggleTheme } = await importTheme()
    toggleTheme()
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark')
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  it('manual 当前无 data-theme(null) → getAttribute !== dark 故翻 dark（非 dark 即翻 dark 真实隐特性）', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'manual')
    // 模块 IIFE 此前未设 attr，停留 null
    const { toggleTheme } = await importTheme()
    toggleTheme()
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark')
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  it('auto 模式调 toggleTheme：先 stopAutoTheme + K_THEME_MODE 写 manual，再翻转 data-theme', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'auto')
    // 触发 IIFE auto 分支：applySystemTheme(matchMedia=false light) + startAutoTheme(mql 匹配 false)
    const { toggleTheme } = await importTheme()
    expect(document.documentElement.getAttribute(A_THEME)).toBe('light') // IIFE applySystemTheme 写 light
    toggleTheme()
    // auto→manual：K_THEME_MODE=manual；当前 data-theme=light 故翻 dark
    expect(localStorageMock.getItem(K_THEME_MODE)).toBe('manual')
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark')
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  it('K_THEME_MODE 缺 → || manual 兜底按 manual 翻转（不进 auto 分支，且 manual 下 toggleTheme 不写 K_THEME_MODE——真实隐特性）', async () => {
    // K_THEME_MODE 未设，IIFE 走 manual 分支读 K_THEME（空则不设 attr，停留 null）
    const { toggleTheme } = await importTheme()
    toggleTheme()
    // toggleTheme 仅 auto→manual 切换时写 K_THEME_MODE；manual 下不写 → 仍 null
    expect(localStorageMock.getItem(K_THEME_MODE)).toBeNull()
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark') // null → dark
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  // ---------- setThemeStyle ----------

  it('comfortable → 设 data-theme-style=comfortable + K_THEME_STYLE 持久化 comfortable', async () => {
    const { setThemeStyle } = await importTheme()
    setThemeStyle('comfortable')
    expect(document.documentElement.getAttribute(A_THEME_STYLE)).toBe('comfortable')
    expect(localStorageMock.getItem(K_THEME_STYLE)).toBe('comfortable')
  })

  it('非 comfortable（如 compact）→ removeAttribute data-theme-style（不识别的值一律移除）', async () => {
    document.documentElement.setAttribute(A_THEME_STYLE, 'comfortable')
    const { setThemeStyle } = await importTheme()
    setThemeStyle('compact')
    expect(document.documentElement.hasAttribute(A_THEME_STYLE)).toBe(false)
  })

  it('非 comfortable 仍把入参原值写 K_THEME_STYLE（即使移除属性也存原值——真实隐特性防误以为应清 localStorage）', async () => {
    const { setThemeStyle } = await importTheme()
    setThemeStyle('compact')
    expect(document.documentElement.hasAttribute(A_THEME_STYLE)).toBe(false)
    expect(localStorageMock.getItem(K_THEME_STYLE)).toBe('compact') // 入参原值原样存
  })

  it('空串入参 → removeAttribute + K_THEME_STYLE 不保留 comfortable（非 comfortable 走移除分支，存入参空值覆盖旧 comfortable）', async () => {
    // 先设 comfortable，再 setThemeStyle('') 走移除属性分支
    const { setThemeStyle } = await importTheme()
    setThemeStyle('comfortable')
    expect(localStorageMock.getItem(K_THEME_STYLE)).toBe('comfortable')
    setThemeStyle('')
    expect(document.documentElement.hasAttribute(A_THEME_STYLE)).toBe(false)
    // safeSetItem(K_THEME_STYLE, '') 写入参空值覆盖旧 comfortable；
    // 注：setup localStorageMock getItem 用 `store[key] || null` 让空串读出 null，
    // 与生产 localStorage（空串应读取 '') 行为不同，故此处不强断 '' 仅断「comfortable 已被覆盖不残留」。
    expect(localStorageMock.getItem(K_THEME_STYLE)).not.toBe('comfortable')
  })

  // ---------- toggleAutoTheme ----------

  it('manual → auto：startAutoTheme + K_THEME_MODE 写 auto + applySystemTheme(matchMedia=false) 写 data-theme=light', async () => {
    // IIFE manual（K_THEME_MODE 空）+ toggleAutoTheme 进 startAutoTheme
    const { toggleAutoTheme } = await importTheme()
    expect(localStorageMock.getItem(K_THEME_MODE)).toBe(null) // IIFE 未写 mode（manual 是 || 兜底）
    toggleAutoTheme()
    expect(localStorageMock.getItem(K_THEME_MODE)).toBe('auto')
    expect(document.documentElement.getAttribute(A_THEME)).toBe('light') // matchMedia.matches=false → light
    expect(localStorageMock.getItem(K_THEME)).toBe('light')
  })

  it('manual → auto：matchMedia.matches=true 时 applySystemTheme 写 data-theme=dark', async () => {
    vi.unstubAllGlobals()
    const ctx = stubMatchMedia(true) // matches=true → dark
    void ctx
    const { toggleAutoTheme } = await importTheme()
    toggleAutoTheme()
    expect(localStorageMock.getItem(K_THEME_MODE)).toBe('auto')
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark')
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  it('auto → manual：stopAutoTheme + K_THEME_MODE 写 manual（注册的 change 监听被移除防泄漏）', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'auto')
    const ctx = stubMatchMedia(false)
    // IIFE auto 分支：applySystemTheme + startAutoTheme（addEventListener 注册 handler）
    const { toggleAutoTheme } = await importTheme()
    toggleAutoTheme()
    expect(localStorageMock.getItem(K_THEME_MODE)).toBe('manual')
    // change 事件不再触发 handler（removeEventListener 已移除）
    const before = document.documentElement.getAttribute(A_THEME)
    ctx.emitChange(true)
    expect(document.documentElement.getAttribute(A_THEME)).toBe(before) // 不变证 handler 已摘
  })

  it('startAutoTheme 注册 matchMedia change 监听：emit change 触发 handler 写 data-theme + K_THEME 据系统色', async () => {
    const ctx = stubMatchMedia(false)
    const { toggleAutoTheme } = await importTheme()
    toggleAutoTheme() // manual→auto
    expect(document.documentElement.getAttribute(A_THEME)).toBe('light')
    ctx.emitChange(true) // 系统切 dark
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark')
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  it('toggleAutoTheme auto→manual→auto 两次：第二次 start 真重新注册监听（stopAutoTheme 清 _autoThemeMedia let 后续 start 不被早退）', async () => {
    const ctx = stubMatchMedia(false)
    const { toggleAutoTheme } = await importTheme()
    toggleAutoTheme() // → auto，注册监听
    toggleAutoTheme() // → manual，removeEventListener 移除监听
    toggleAutoTheme() // → auto 第二次，须重新注册监听
    expect(localStorageMock.getItem(K_THEME_MODE)).toBe('auto')
    expect(document.documentElement.getAttribute(A_THEME)).toBe('light')
    ctx.emitChange(true)
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark') // 重新注册的 handler 真响应
    expect(localStorageMock.getItem(K_THEME)).toBe('dark')
  })

  // ---------- 跨函数独立 + 通用 ----------

  it('setThemeStyle 与 toggleTheme 独立：舒适 style 不影响 data-theme 翻转', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'manual')
    document.documentElement.setAttribute(A_THEME, 'light')
    const { toggleTheme, setThemeStyle } = await importTheme()
    setThemeStyle('comfortable')
    toggleTheme()
    expect(document.documentElement.getAttribute(A_THEME_STYLE)).toBe('comfortable')
    expect(document.documentElement.getAttribute(A_THEME)).toBe('dark') // light→dark
  })

  it('三函数返回 void（纯 DOM/localStorage/matchMedia 副作用无返回值）', async () => {
    localStorageMock.setItem(K_THEME_MODE, 'manual')
    const { toggleTheme, setThemeStyle, toggleAutoTheme } = await importTheme()
    expect(toggleTheme()).toBeUndefined()
    expect(setThemeStyle('comfortable')).toBeUndefined()
    expect(toggleAutoTheme()).toBeUndefined()
  })
})
