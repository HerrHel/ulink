/**
 * lib/crossInstance.ts — 多实例落盘通知
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  INSTANCE_ID,
  __resetCrossInstanceForTest,
  isDataSavedMessage,
  notifyDataSaved,
  onOtherInstanceSaved,
} from '../../lib/crossInstance'

const flush = () => new Promise((r) => setTimeout(r, 20))

afterEach(() => __resetCrossInstanceForTest())

describe('isDataSavedMessage', () => {
  it('校验消息形状', () => {
    expect(isDataSavedMessage({ type: 'saved', space: 'main', from: 'x', at: 1 })).toBe(true)
    expect(isDataSavedMessage({ type: 'saved', space: 'other', from: 'x', at: 1 })).toBe(false)
    expect(isDataSavedMessage({ type: 'saved', space: 'main', from: 1, at: 1 })).toBe(false)
    expect(isDataSavedMessage(null)).toBe(false)
  })
})

describe('notifyDataSaved / onOtherInstanceSaved', () => {
  it('其他实例（另一个通道端点）落盘时收到通知', async () => {
    const cb = vi.fn()
    const off = onOtherInstanceSaved(cb)
    // 模拟另一个实例：独立的 BroadcastChannel 端点，带不同实例 ID
    const other = new BroadcastChannel('linkvault-data')
    other.postMessage({ type: 'saved', space: 'main', from: 'other-instance', at: Date.now() })
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    other.close()
  })

  it('自己发出的、私密空间的、格式不对的消息都不触发', async () => {
    const cb = vi.fn()
    const off = onOtherInstanceSaved(cb)
    const other = new BroadcastChannel('linkvault-data')
    other.postMessage({ type: 'saved', space: 'main', from: INSTANCE_ID, at: 1 })
    other.postMessage({ type: 'saved', space: 'vault', from: 'other', at: 1 })
    other.postMessage({ hello: 'world' })
    await flush()
    expect(cb).not.toHaveBeenCalled()
    off()
    other.close()
  })

  it('只广播主页空间，私密空间落盘不外发', async () => {
    const listener = new BroadcastChannel('linkvault-data')
    const got: unknown[] = []
    listener.onmessage = (e) => got.push(e.data)
    notifyDataSaved('vault')
    notifyDataSaved('main')
    await flush()
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ type: 'saved', space: 'main', from: INSTANCE_ID })
    listener.close()
  })
})
