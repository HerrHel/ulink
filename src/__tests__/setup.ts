import { setActivePinia, createPinia } from 'pinia'
import { vi, beforeEach } from 'vitest'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value.toString() }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// 双语：测试环境锁定 zh-CN（产品为中文优先；jsdom 默认 navigator.language=en-US，会让
// i18n 默认走 en-US，导致大量断言 zh 字串的用例失败）。必须在 i18n 模块首次导入前
// 把 lv_locale 写进 localStorage；i18n.detect() 启动时即读到 zh-CN。
localStorageMock.setItem('lv_locale', 'zh-CN')

beforeEach(() => {
  setActivePinia(createPinia())
  localStorageMock.clear()
  // clear() 不会重置 i18n 模块已缓存的 locale ref（模块级常量），但保险起见重新钉一下，
  // 防止某些测试调 setLocale('en-US') 后下一个测试默认跑到了 en。
  localStorageMock.setItem('lv_locale', 'zh-CN')
  vi.clearAllMocks()
})

export { localStorageMock }
