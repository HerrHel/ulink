/**
 * d1-103：copyToClipboard 深护栏补强。
 * 既有 src/__tests__/utils.test.ts:221 describe('copyToClipboard') 仅 1 用例锁
 * 「navigator.clipboard.writeText 被调一次」happy path——双路径互斥、writeText reject、
 * execCommand 成功/失败、catch 吞错、label 默认文案、空串入参全未锁。此文件戴 d1-101
 * 「逐函数独立护栏文件」口径避编辑既有 utils.test.ts describe 块的 Edit 吞结构风险。
 *
 * 被测源：src/utils.ts:141 copyToClipboard(text, label?)：
 *   A. navigator.clipboard?.writeText 存在 → writeText(text).then(ok->toast(okMsg), fail->toast(failMsg,false))
 *      且 return（不走 fallback textarea 路径）。
 *   B. clipboard 缺 / writeText 缺 → createElement('textarea') + select + execCommand('copy')
 *      + toast(ok? okMsg : failMsg, ok)。
 *   C. textarea/select/execCommand 任一抛 → catch 吞错 + toast(failMsg, false) 不外泄。
 *   okMsg=(label||'')+' 已复制'，failMsg=(label||'内容')+' 复制失败'。
 *
 * 生产消费方：BookmarkCard.vue 复制账户名 (label='账户') / 复制密码 (label='密码') +
 * useDataShare.ts:39 复制分享链接 (label='分享链接')——用户可见的 toast 反馈与剪贴板
 * 成功/失败双路径稳定性契约此前全靠手动 UI 覆盖，无回归断言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { copyToClipboard } from '../utils.js'

// 模块级 mock toast：copyToClipboard 内 import { toast } from './lib/toast.js'
vi.mock('../lib/toast.js', () => ({
  toast: vi.fn(),
}))
import { toast } from '../lib/toast.js'

const _originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const _originalExecCommand = document.execCommand

/** 锁定恢复 navigator.clipboard / document.execCommand，防跨用例污染。 */
function restoreClipboard() {
  if (_originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', _originalClipboard)
  } else {
    // jsdom 默认无 clipboard 描述符，删除测试所定属性还原 undefined 语义
    try { delete (navigator as any).clipboard } catch { /* ignored */ }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.execCommand = _originalExecCommand
})

afterEach(() => {
  restoreClipboard()
  document.execCommand = _originalExecCommand
})

function defineClipboard(value: { writeText?: unknown } | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    writable: true,
    configurable: true,
  })
}

describe('copyToClipboard', () => {
  // ── 路径 A：navigator.clipboard.writeText ──

  it('路径A：writeText resolve → toast(okMsg) ok=true 且入参透传', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    copyToClipboard('hello', '账户')
    // writeText 入参直锁
    expect(writeText).toHaveBeenCalledWith('hello')
    // then 回调异步触发，等微任务
    await Promise.resolve()
    await Promise.resolve()
    expect(toast).toHaveBeenCalledWith('账户 已复制')
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('路径A：writeText reject → toast(failMsg, false) ok=false（reject 不外抛）', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    defineClipboard({ writeText })
    copyToClipboard('hello', '账户')
    await Promise.resolve()
    await Promise.resolve()
    expect(toast).toHaveBeenCalledWith('账户 复制失败', false)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('路径A：label 不传 → okMsg 走默认空 label（" 已复制"），failMsg 走默认"内容"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    copyToClipboard('hello')
    await Promise.resolve()
    await Promise.resolve()
    // okMsg=(label||'')+' 已复制' = ' 已复制'
    expect(toast).toHaveBeenCalledWith(' 已复制')
  })

  it('路径A：label 不传 + reject → failMsg 走默认"内容 复制失败"', async () => {
    const writeText = vi.fn().mockRejectedValue(undefined)
    defineClipboard({ writeText })
    copyToClipboard('hello')
    await Promise.resolve()
    await Promise.resolve()
    // failMsg=(label||'内容')+' 复制失败' = '内容 复制失败'
    expect(toast).toHaveBeenCalledWith('内容 复制失败', false)
  })

  it('路径A：不触发 fallback textarea 路径（createElement 不被用于 copy 路径）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    const ceSpy = vi.spyOn(document, 'createElement')
    copyToClipboard('hello', '账户')
    await Promise.resolve()
    await Promise.resolve()
    // clipboard 路径直接 return，不应走 textarea 路径创建 textarea
    const textareaCalls = ceSpy.mock.calls.filter(([tag]) => tag === 'textarea')
    expect(textareaCalls).toHaveLength(0)
    ceSpy.mockRestore()
  })

  it('路径A：空串 text 入参仍透传给 writeText（不短路空串）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    copyToClipboard('', '内容')
    await Promise.resolve()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('')
    // label='内容' → okMsg='内容 已复制'
    expect(toast).toHaveBeenCalledWith('内容 已复制')
  })

  it('路径A：中文 / 换行 / 特殊字符 text 原样透传 writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    const payload = '第一行\n第二行\t< Weird & "quotes" >'
    copyToClipboard(payload, '片段')
    await Promise.resolve()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith(payload)
  })

  // ── 切换路径 B 的触发条件 ──

  it('navigator.clipboard 不存在 → 走 fallback execCommand 路径', () => {
    delete (navigator as any).clipboard
    const execSpy = vi.fn().mockReturnValue(true)
    document.execCommand = execSpy
    copyToClipboard('hello', '账户')
    expect(execSpy).toHaveBeenCalledWith('copy')
    expect(toast).toHaveBeenCalledWith('账户 已复制', true)
  })

  it('clipboard 存在但 writeText 缺失 → 走 fallback 路径（?. 链短路）', () => {
    defineClipboard({} as { writeText?: unknown })
    const execSpy = vi.fn().mockReturnValue(true)
    document.execCommand = execSpy
    copyToClipboard('hello', '账户')
    expect(execSpy).toHaveBeenCalledWith('copy')
    expect(toast).toHaveBeenCalledWith('账户 已复制', true)
  })

  // ── 路径 B：fallback execCommand ──

  it('路径B：execCommand 返 true → toast(okMsg, true)', () => {
    delete (navigator as any).clipboard
    document.execCommand = vi.fn().mockReturnValue(true)
    copyToClipboard('data', '链接')
    expect(toast).toHaveBeenCalledWith('链接 已复制', true)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('路径B：execCommand 返 false → toast(failMsg, false)', () => {
    delete (navigator as any).clipboard
    document.execCommand = vi.fn().mockReturnValue(false)
    copyToClipboard('data', '链接')
    expect(toast).toHaveBeenCalledWith('链接 复制失败', false)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('路径B：label 不传 + execCommand true → okMsg 默认空 label（" 已复制"）；false → "内容 复制失败"', () => {
    delete (navigator as any).clipboard
    // true 分支
    document.execCommand = vi.fn().mockReturnValue(true)
    copyToClipboard('data')
    expect(toast).toHaveBeenCalledWith(' 已复制', true)
    // false 分支
    vi.clearAllMocks()
    document.execCommand = vi.fn().mockReturnValue(false)
    copyToClipboard('data')
    expect(toast).toHaveBeenCalledWith('内容 复制失败', false)
  })

  it('路径B：fallback 真创建 textarea + 真写入 value=入参（jsdom 验证 DOM 副作用）', () => {
    delete (navigator as any).clipboard
    const ceSpy = vi.spyOn(document, 'createElement')
    document.execCommand = vi.fn().mockReturnValue(true)
    // jsdom appendChild 真挂上 DOM，select() 不抛
    copyToClipboard('payload-value', '文本')
    const taCall = ceSpy.mock.calls.find(([tag]) => tag === 'textarea')
    expect(taCall).toBeTruthy()
    const ta = ceSpy.mock.results.find(r => r.type === 'return' && r.value?.tagName === 'TEXTAREA')?.value as HTMLTextAreaElement | undefined
    expect(ta).toBeTruthy()
    expect(ta!.value).toBe('payload-value')
    // 临时 textarea 被从 body 移除（不残留 DOM）
    expect(document.body.querySelector('textarea')).toBeNull()
    ceSpy.mockRestore()
  })

  it('路径B：execCommand 抛错 → catch 吞错 + toast(failMsg, false) 不外泄', () => {
    delete (navigator as any).clipboard
    document.execCommand = vi.fn(() => { throw new Error('not supported') })
    expect(() => copyToClipboard('data', '链接')).not.toThrow()
    expect(toast).toHaveBeenCalledWith('链接 复制失败', false)
  })

  it('路径B：appendChild / select / removeChild 任一抛 → catch 兜底 toast(failMsg, false)', () => {
    delete (navigator as any).clipboard
    document.execCommand = vi.fn().mockReturnValue(true)
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => { throw new Error('detached') })
    expect(() => copyToClipboard('data', '链接')).not.toThrow()
    expect(toast).toHaveBeenCalledWith('链接 复制失败', false)
    appendSpy.mockRestore()
  })

  it('路径B：空串 text → textarea.value="" + execCommand 仍调（不短路空串）', () => {
    delete (navigator as any).clipboard
    const execSpy = vi.fn().mockReturnValue(true)
    document.execCommand = execSpy
    copyToClipboard('', '空')
    expect(execSpy).toHaveBeenCalledWith('copy')
    expect(toast).toHaveBeenCalledWith('空 已复制', true)
  })

  // ── 路径 A resolve 后不二次走 fallback 互斥性（防双写剪贴板/双 toast） ──

  it('路径A resolve 后 execCommand 零调用（双路径互斥，fallback 仅在 clipboard 缺时触发）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    const execSpy = vi.fn().mockReturnValue(true)
    document.execCommand = execSpy
    copyToClipboard('hello', '账户')
    await Promise.resolve()
    await Promise.resolve()
    expect(execSpy).not.toHaveBeenCalled()
    // 仅 toast 一次（clipboard 路径），不混入 fallback 的 toast
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('路径A 与路径B 连续调用：A 用真 clipboard，B 删 clipboard 后各 toast 各调一次（无跨调用残留）', async () => {
    // 第一次走 A
    const writeText = vi.fn().mockResolvedValue(undefined)
    defineClipboard({ writeText })
    copyToClipboard('a', 'A')
    await Promise.resolve()
    await Promise.resolve()
    expect(toast).toHaveBeenCalledWith('A 已复制')
    // 第二次走 B（删 clipboard）
    vi.clearAllMocks()
    delete (navigator as any).clipboard
    document.execCommand = vi.fn().mockReturnValue(true)
    copyToClipboard('b', 'B')
    expect(toast).toHaveBeenCalledWith('B 已复制', true)
    // clearAllMocks 后 toast 仅被 B 路径调用一次（A 残留被清）
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
