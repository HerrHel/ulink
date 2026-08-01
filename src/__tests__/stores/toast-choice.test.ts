/**
 * stores/toast-choice.test.ts — Toast Store 的 Choice Dialog 模态多选项 Promise 编排护栏
 *
 * 锁 showChoice / resolveChoice / onChoiceOpenChange 三函数的纯 Promise 编排契约：
 * - showChoice 挂起新 Promise + 设 choiceOpen=true + choiceDialog 透传
 * - 新 showChoice 中止旧挂起（先 resolve(旧, null) 再设新 resolve）
 * - resolveChoice(id) 解析挂起 + choiceOpen=false + 清 _choiceResolve
 * - onChoiceOpenChange(false) 兜底：有挂起则 resolve(null) + 清；无挂起不抛
 *
 * 既有 toast.test.ts 仅测 show/showWithUndo/confirm，未覆盖 Choice 三函数；
 * useBookmark.test.ts:102 将 showChoice 整个 vi.mock 桩掉从未直测原函数——
 * 此处新建独立护栏文件直锁真实编排契约（d1-91/d1-94/d1-104/d1-105/d1-106 教训延续：
 * 新建独立文件避 Edit 既有 toast.test.ts describe 块吞结构风险）。
 *
 * 时序范式：showChoice 返回若挂起 Promise、resolveChoice/onChoiceOpenChange 同步触发内部
 * _choiceResolve 调用，消费者 .then 回调进微任务队列。用 async function + 多级
 * `await Promise.resolve()` flush 微任务让消费者执行后再断言（vitest 单层 .then 偶尔
 * 不足以让所有链上消费者执行完毕，await 多次是稳妥范式）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from '../../stores/toast.js'

/** flush 足够微任务让所有挂起 Promise 消费者执行完毕 */
async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('ToastStore choice dialog 编排', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('showChoice 返回挂起的 Promise 且打开模态框并写入 choiceDialog', () => {
    const store = useToastStore()
    const opts = [{ id: 'a', label: '选项A' }, { id: 'b', label: '选项B' }]
    let resolved = false
    store.showChoice('请选择', opts).then(() => { resolved = true })

    expect(store.choiceOpen).toBe(true)
    expect(store.choiceDialog).toEqual({ message: '请选择', options: opts, cancelLabel: '取消' })
    expect(resolved).toBe(false)
  })

  it('showChoice cancelLabel 入参覆盖默认"取消"', () => {
    const store = useToastStore()
    store.showChoice('m', [{ id: 'x', label: 'X' }], '返回')
    expect(store.choiceDialog?.cancelLabel).toBe('返回')
  })

  it('showChoice options 透传空数组也接受', () => {
    const store = useToastStore()
    store.showChoice('m', [])
    expect(store.choiceDialog?.options).toEqual([])
    expect(store.choiceOpen).toBe(true)
  })

  it('showChoice message 透传空串原值', () => {
    const store = useToastStore()
    store.showChoice('', [{ id: 'a', label: 'A' }])
    expect(store.choiceDialog?.message).toBe('')
  })

  it('resolveChoice(optionId) 解析挂起 Promise 为 optionId 并关闭模态框', async () => {
    const store = useToastStore()
    let result: string | null | undefined = 'unset'
    store.showChoice('m', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]).then((r) => { result = r })

    store.resolveChoice('b')
    await flush()

    expect(result).toBe('b')
    expect(store.choiceOpen).toBe(false)
  })

  it('resolveChoice(null) 解析挂起为 null（取消语义）', async () => {
    const store = useToastStore()
    let result: string | null | undefined = 'unset'
    store.showChoice('m', [{ id: 'a', label: 'A' }]).then((r) => { result = r })

    store.resolveChoice(null)
    await flush()

    expect(result).toBe(null)
    expect(store.choiceOpen).toBe(false)
  })

  it('resolveChoice 在无挂起时（_choiceResolve=null）不抛，仅设 choiceOpen=false', () => {
    const store = useToastStore()
    expect(() => store.resolveChoice('a')).not.toThrow()
    expect(store.choiceOpen).toBe(false)
  })

  it('新 showChoice 中止旧挂起：旧 Promise resolve(null)，新 Promise 仍挂起', async () => {
    const store = useToastStore()
    let oldResult: string | null | undefined = 'unset'
    let newResult: string | null | undefined = 'unset'
    store.showChoice('first', [{ id: 'a', label: 'A' }]).then((r) => { oldResult = r })
    store.showChoice('second', [{ id: 'b', label: 'B' }]).then((r) => { newResult = r })

    expect(store.choiceDialog?.message).toBe('second')
    expect(store.choiceOpen).toBe(true)
    await flush()

    expect(oldResult).toBe(null)
    expect(newResult).toBe('unset')
  })

  it('新 showChoice 中止旧挂起后旧 resolve 被置 null：再 resolveChoice 解析的是新 Promise', async () => {
    const store = useToastStore()
    let oldResult: string | null | undefined = 'unset'
    let newResult: string | null | undefined = 'unset'
    store.showChoice('first', [{ id: 'a', label: 'A' }]).then((r) => { oldResult = r })
    store.showChoice('second', [{ id: 'b', label: 'B' }]).then((r) => { newResult = r })

    store.resolveChoice('b')
    await flush()

    expect(oldResult).toBe(null)
    expect(newResult).toBe('b')
    expect(store.choiceOpen).toBe(false)
  })

  it('onChoiceOpenChange(false) 兜底：有挂起时 resolve(null) 并清状态关闭模态框', async () => {
    const store = useToastStore()
    let result: string | null | undefined = 'unset'
    store.showChoice('m', [{ id: 'a', label: 'A' }]).then((r) => { result = r })

    store.onChoiceOpenChange(false)
    await flush()

    expect(result).toBe(null)
    expect(store.choiceOpen).toBe(false)
  })

  it('onChoiceOpenChange(true) 仅设 choiceOpen=true 不触碰挂起 resolve', async () => {
    const store = useToastStore()
    let result: string | null | undefined = 'unset'
    store.showChoice('m', [{ id: 'a', label: 'A' }]).then((r) => { result = r })

    store.onChoiceOpenChange(true)
    expect(store.choiceOpen).toBe(true)
    expect(result).toBe('unset')

    store.resolveChoice('a')
    await flush()

    expect(result).toBe('a')
  })

  it('onChoiceOpenChange(false) 在无挂起时不抛', () => {
    const store = useToastStore()
    expect(() => store.onChoiceOpenChange(false)).not.toThrow()
    expect(store.choiceOpen).toBe(false)
  })

  it('resolveChoice 后清状态：后续 resolveChoice 不影响已 resolve 的旧 Promise（幂等清状态）', async () => {
    const store = useToastStore()
    let result: string | null | undefined = 'unset'
    store.showChoice('m', [{ id: 'a', label: 'A' }]).then((r) => { result = r })

    store.resolveChoice('a')
    await flush()
    expect(result).toBe('a')

    // 再次调用 resolveChoice 不应抛，且不影响已 resolve 的 result
    store.resolveChoice('a')
    await flush()

    expect(result).toBe('a')
    expect(store.choiceOpen).toBe(false)
  })

  it('showChoice 多次挂起链：每次新挂起中止前一次，最终 resolveChoice 只解析最新一次', async () => {
    const store = useToastStore()
    const results: (string | null)[] = []
    store.showChoice('m1', [{ id: 'a', label: 'A' }]).then((r) => { results[0] = r })
    store.showChoice('m2', [{ id: 'b', label: 'B' }]).then((r) => { results[1] = r })
    store.showChoice('m3', [{ id: 'c', label: 'C' }]).then((r) => { results[2] = r })

    store.resolveChoice('c')
    await flush()

    // 前两次被 abort resolve(null)，最后一次 resolve('c')
    expect(results).toEqual([null, null, 'c'])
  })

  it('ChoiceDialog 字段集恰好 3 键 message/options/cancelLabel 无多余键', () => {
    const store = useToastStore()
    store.showChoice('m', [{ id: 'a', label: 'A' }])
    const keys = Object.keys(store.choiceDialog ?? {}).sort()
    expect(keys).toEqual(['cancelLabel', 'message', 'options'])
  })
})
