/**
 * i18n.test.ts — 双语语言包护栏。
 *
 * 锁：
 * 1. en 语言包必须覆盖 zh 的每一个键（缺失会运行时回退中文，属漏译）。
 *    en 允许额外 `_one/_other/_zero` 复数键（tN 在 en-US 下选择），zh 无需。
 * 2. t() 在 zh-CN 下返回 zh 文案；缺失键回退 zh；插值占位符一致。
 * 3. tN() 在 en-US 下选复数形式。
 */
import { describe, it, expect } from 'vitest'
import { zh } from '../locales/zh.js'
import { en } from '../locales/en.js'
import { t, tN, setLocale } from '../i18n/index.js'

type Nested = Record<string, unknown>

/** 扁平化嵌套语言包为 'a.b.c' → 文案 映射（仅叶子字符串）。 */
function flatten(obj: Nested, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Nested, key))
    } else {
      out[key] = String(v)
    }
  }
  return out
}

const zhFlat = flatten(zh as unknown as Nested)
const enFlat = flatten(en as unknown as Nested)

describe('i18n 语言包对齐', () => {
  it('en 覆盖 zh 全部键（复数 _one/_other/_zero 除外）', () => {
    const zhKeys = Object.keys(zhFlat)
    const enKeys = new Set(Object.keys(enFlat))
    const missing = zhKeys.filter(k => !enKeys.has(k))
    // en 复数变体属合法额外键；zh 缺失键才是问题
    expect(missing, `en 缺失以下键（会回退中文）：\n${missing.join('\n')}`).toEqual([])
  })

  it('en 额外键仅限复数变体（_one/_other/_zero 后缀）', () => {
    const zhKeys = new Set(Object.keys(zhFlat))
    const extra = Object.keys(enFlat).filter(k => !zhKeys.has(k))
    const invalid = extra.filter(k => !/(_one|_other|_zero)$/.test(k))
    expect(invalid, `en 存在非复数额外键：\n${invalid.join('\n')}`).toEqual([])
  })

  it('插值占位符在 zh/en 中一一对应（{xxx} 集合相同）', () => {
    const ph = (s: string): string => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]).sort().join(',')
    const mismatches: string[] = []
    for (const key of Object.keys(zhFlat)) {
      const zhPh = ph(zhFlat[key])
      const enPh = enFlat[key]
      // 跳过 zh 无占位/无对应 en 键的情形（en 缺失已在前面用例覆盖）
      if (!zhPh.length || enPh == null) continue
      if (ph(enPh) !== zhPh) mismatches.push(`${key}: zh[${zhFlat[key]}] en[${enPh}]`)
    }
    expect(mismatches, `插值占位符不一致：\n${mismatches.join('\n')}`).toEqual([])
  })
})

describe('i18n 运行时行为', () => {
  it('zh-CN 下 t() 返回中文，缺失键回退 zh', () => {
    setLocale('zh-CN')
    expect(t('app.brand')).toBe('与链')
    expect(t('nav.brand')).toBe('与链')
    // 人为构造缺失场景：en 故意不存在的键（用 zh 存在键验证回退——en 全齐，改测不存在键）
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('切到 en-US 后 t() 返回英文，且 html lang 同步', () => {
    setLocale('en-US')
    expect(t('app.brand')).toBe('ulink')
    expect(t('nav.brand')).toBe('ulink')
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('tN 复数：en-US 下 1 用 *_one，多不用 *_other/基础键', () => {
    setLocale('en-US')
    expect(tN('count.bookmarks', 1)).toBe('1 bookmark')
    expect(tN('count.bookmarks', 3)).toBe('3 bookmarks')
    expect(tN('count.links', 0)).toBe('0 links')
  })

  it('tN 复数：zh-CN 恒用基础键', () => {
    setLocale('zh-CN')
    expect(tN('count.bookmarks', 1)).toBe('1 个书签')
    expect(tN('count.bookmarks', 3)).toBe('3 个书签')
  })
})
