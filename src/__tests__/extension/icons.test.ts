/**
 * extension/icons.js 纯函数与 SVG 图标库测试
 */
import { describe, it, expect } from 'vitest'
import '../../../extension/icons.js'

function getWindowIcons() {
  const api = window.LinkVaultIcons
  expect(api, 'extension/icons.js 应挂载 window.LinkVaultIcons').toBeDefined()
  return api!
}

describe('extension/icons.js — Icons 图标库', () => {
  const expectedIcons = [
    'sun',
    'moon',
    'refresh',
    'folder',
    'tag',
    'star',
    'code',
    'tool',
    'note',
    'edit',
    'trash',
    'link',
    'copy',
    'search',
    'close',
    'lock',
    'password',
    'eye',
    'history',
    'check',
    'zap',
    'bookmark',
    'emptyBookmark',
    'sync',
  ] as const

  it('包含所有扩展所需的 SVG 图标键名', () => {
    const icons = getWindowIcons()
    for (const key of expectedIcons) {
      expect(icons[key], `Icons.${key} 应当存在`).toBeDefined()
      expect(typeof icons[key]).toBe('string')
      expect(icons[key].startsWith('<svg')).toBe(true)
      expect(icons[key].endsWith('</svg>')).toBe(true)
      expect(icons[key].includes('viewBox="0 0 24 24"')).toBe(true)
    }
  })

  it('所有 SVG 均包含 .svg-icon 样式类且使用 currentColor 动态继承颜色', () => {
    const icons = getWindowIcons()
    for (const key of expectedIcons) {
      const svg = icons[key]
      expect(svg.includes('class="svg-icon"')).toBe(true)
      expect(svg.includes('currentColor')).toBe(true)
    }
  })

  it('window.LinkVaultIcons 正确挂载', () => {
    const winIcons = getWindowIcons()
    expect(winIcons.folder).toBeDefined()
    expect(typeof winIcons.getCategoryIcon).toBe('function')
  })
})

describe('extension/icons.js — getCategoryIcon', () => {
  it('命中已知分类图标时返回对应 SVG', () => {
    const winIcons = getWindowIcons()
    expect(winIcons.getCategoryIcon('tag')).toBe(winIcons.tag)
    expect(winIcons.getCategoryIcon('star')).toBe(winIcons.star)
    expect(winIcons.getCategoryIcon('code')).toBe(winIcons.code)
    expect(winIcons.getCategoryIcon('tool')).toBe(winIcons.tool)
    expect(winIcons.getCategoryIcon('folder')).toBe(winIcons.folder)
  })

  it('未知图标或空值时安全回退至 folder 图标', () => {
    const winIcons = getWindowIcons()
    expect(winIcons.getCategoryIcon('')).toBe(winIcons.folder)
    expect(winIcons.getCategoryIcon(undefined)).toBe(winIcons.folder)
    expect(winIcons.getCategoryIcon('nonexistent_icon_key')).toBe(winIcons.folder)
  })

  it('防御原型链属性注入', () => {
    const winIcons = getWindowIcons()
    expect(winIcons.getCategoryIcon('toString')).toBe(winIcons.folder)
    expect(winIcons.getCategoryIcon('__proto__')).toBe(winIcons.folder)
    expect(winIcons.getCategoryIcon('constructor')).toBe(winIcons.folder)
  })
})
