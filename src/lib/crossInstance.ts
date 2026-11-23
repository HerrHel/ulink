/**
 * crossInstance.ts — 同一浏览器内多个主站实例之间的「数据已落盘」通知
 *
 * 背景：IndexedDB 是权威存储、每次保存写整份快照（后写者为准）。同时开着两个实例
 * （两个标签页，或标签页 + 扩展侧边栏 iframe）时，各自内存里是旧数据，任何一方保存都会
 * 把另一方刚写的内容覆盖掉。登录用户靠云端 realtime 最终对齐，未登录用户则会真丢数据。
 * 扩展侧边栏让「两个实例同时开着」成为常态，因此这里补一条本地通道：一方落盘后广播，
 * 其他实例空闲时从 IndexedDB 重新载入。
 *
 * 只广播主页空间：私密空间（vault）的数据不在实例间通告，也不在锁定态被动重载。
 */
import type { Space } from '../stores/ui.js'

const CHANNEL_NAME = 'linkvault-data'

export interface DataSavedMessage {
  type: 'saved'
  space: Space
  /** 发送方实例 ID：同一实例自己发的消息不处理（BroadcastChannel 本就不回送，这里双保险） */
  from: string
  at: number
}

/** 本实例 ID（每次页面加载随机） */
export const INSTANCE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36)

let _channel: BroadcastChannel | null | undefined

function channel(): BroadcastChannel | null {
  if (_channel !== undefined) return _channel
  try {
    _channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null
  } catch {
    _channel = null
  }
  return _channel
}

export function isDataSavedMessage(data: unknown): data is DataSavedMessage {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'saved' && (d.space === 'main' || d.space === 'vault') && typeof d.from === 'string' && typeof d.at === 'number'
}

/** 本实例落盘成功后调用 */
export function notifyDataSaved(space: Space): void {
  if (space !== 'main') return
  const ch = channel()
  if (!ch) return
  const msg: DataSavedMessage = { type: 'saved', space, from: INSTANCE_ID, at: Date.now() }
  try { ch.postMessage(msg) } catch { /* 通道已关闭 */ }
}

/** 订阅其他实例的落盘通知；返回取消订阅函数 */
export function onOtherInstanceSaved(cb: (msg: DataSavedMessage) => void): () => void {
  const ch = channel()
  if (!ch) return () => {}
  const handler = (e: MessageEvent) => {
    if (!isDataSavedMessage(e.data) || e.data.from === INSTANCE_ID || e.data.space !== 'main') return
    cb(e.data)
  }
  ch.addEventListener('message', handler)
  return () => ch.removeEventListener('message', handler)
}

/** 仅测试用 */
export function __resetCrossInstanceForTest(): void {
  try { _channel?.close() } catch { /* ignore */ }
  _channel = undefined
}
