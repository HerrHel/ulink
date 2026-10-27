/**
 * i18n — 轻量双语方案（零第三方依赖）。
 *
 * - 语言包：src/locales/zh.ts（中文，键全集基准）/ src/locales/en.ts（英文）
 * - 键：嵌套对象源码 + flatten 为 'a.b.c' 扁平键；模板与程序化消息（toast/confirm/error）共用
 * - 插值：{name} 占位符（t 的 params 参数）
 * - 复数：tN('count.bookmarks', n) — en 下按 n 选择 key_one / key_other / key_zero，zh 恒用基础键
 * - 缺失键：运行时回退到中文；键对齐由单测 src/__tests__/i18n.test.ts 保障
 * - 持久化：localStorage 'lv_locale'；默认跟随浏览器语言（zh* → zh-CN，其余 en-US）
 */
import { ref, computed } from 'vue'
import { zh } from '../locales/zh.js'
import { en } from '../locales/en.js'

export type Locale = 'zh-CN' | 'en-US'

export const LOCALE_KEY = 'lv_locale'

const ALLOWED: readonly Locale[] = ['zh-CN', 'en-US']

/**
 * 推断初始语言。优先级：
 *   1. localStorage 里用户手动选过的值（最高，用户意志优先）
 *   2. 浏览器语言以 zh 开头 → 中文
 *   3. **设备处于中国时区 → 中文**（浏览器语言兜底）
 *      —— 国内常见「英文系统/英文浏览器 + 中文使用习惯」。若只看 navigator.language，
 *      这类用户首次访问（无 localStorage）会看到满屏英文，且很难意识到能切换。
 *      ulink 主体面向国内用户（已备案 / 微信支付），故时区优先于英文兜底。
 *   4. 其余 → 英文
 *
 * 导出仅为可单测（`src/__tests__/i18n-detect.test.ts` 会伪造 navigator / Intl）。
 */
export function detect(): Locale {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(LOCALE_KEY)
      if (saved === 'zh-CN' || saved === 'en-US') return saved
    } catch { /* storage 不可用时按浏览器语言 */ }

    const lang = (navigator.language || '').toLowerCase()
    if (lang.startsWith('zh')) return 'zh-CN'

    // 浏览器语言不是中文，再给中国时区一次机会
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      if (/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Kashgar)$/.test(tz)) return 'zh-CN'
    } catch { /* Intl 不可用时忽略，落到英文 */ }
  }
  return 'en-US'
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key))
    } else {
      out[key] = String(v)
    }
  }
  return out
}

const locale = ref<Locale>(detect())

const dicts: Record<Locale, Record<string, string>> = {
  'zh-CN': flatten(zh),
  'en-US': flatten(en),
}

/** 取翻译；缺失回退中文，仍缺回退键名本身（便于发现漏键）。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[locale.value][key]
  if (s == null) s = dicts['zh-CN'][key]
  if (s == null) return key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}

/** 复数感知翻译：en 按 count 选择 key_one / key_other（0 时优先 key_zero），zh 恒用基础键。 */
export function tN(key: string, count: number, params?: Record<string, string | number>): string {
  const p: Record<string, string | number> = { ...(params || {}), n: count }
  if (locale.value === 'en-US') {
    if (count === 1 && dicts['en-US'][`${key}_one`] != null) return t(`${key}_one`, p)
    if (count === 0 && dicts['en-US'][`${key}_zero`] != null) return t(`${key}_zero`, p)
    if (dicts['en-US'][`${key}_other`] != null) return t(`${key}_other`, p)
  }
  return t(key, p)
}

export function isLocale(v: string | null | undefined): v is Locale {
  return !!v && (ALLOWED as readonly string[]).includes(v)
}

export function setLocale(l: Locale): void {
  locale.value = l
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(LOCALE_KEY, l) } catch { /* 忽略 */ }
  }
  applyToDocument()
}

/** 把语言应用到 <html lang> 与默认文档标题（应用内其它标题逻辑可随后覆盖）。 */
export function applyToDocument(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale.value
  if (!document.querySelector('[data-lv-title-owner]')) {
    document.title = t('app.title')
  }
}

export function getLocale(): Locale {
  return locale.value
}

export const isZh = computed(() => locale.value === 'zh-CN')

/** 组件内用法：const { t, tN, locale, setLocale } = useI18n()（t 在模板渲染期读取 ref，语言切换会触发重渲染）。 */
export function useI18n() {
  return {
    t,
    tN,
    locale: computed(() => locale.value),
    setLocale,
  }
}

// 启动即同步一次文档语言/标题（浏览器语言推断）
if (typeof window !== 'undefined') {
  applyToDocument()
}
