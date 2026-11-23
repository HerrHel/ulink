/**
 * useExtPanel — 扩展侧边栏模式的消息收发与保存编排
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../../composables/domain/useBookmark.js', () => {
  const bmForm = { url: '', title: '', notes: '', _autoTitle: '', _userEditedNotes: false }
  return {
    bmForm,
    openBmModal: vi.fn(async () => {}),
    autoFetchFromUrl: vi.fn(),
    findDuplicateBookmarks: vi.fn(() => ({ exact: null, suffix: null })),
  }
})

import { useExtPanel, openPanelSave, __resetExtPanelForTest } from '../../composables/useExtPanel'
import { useExtPanelStore } from '../../stores/extPanel'
import { EXT_MSG_NS, EXT_MSG_VERSION } from '../../lib/extPanel'
import { __testMarkDataReady, __testResetDataReady } from '../../lib/dataReady'
import * as bm from '../../composables/domain/useBookmark.js'

const EXT = 'chrome-extension://abcdefghijklmnop'
const flush = async () => { await nextTick(); await new Promise((r) => setTimeout(r, 0)) }

function send(data: unknown, origin = EXT, source: MessageEventSource | null = window) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
}
const tabMsg = (tab: Record<string, unknown>) => ({ ns: EXT_MSG_NS, v: EXT_MSG_VERSION, type: 'tab', tab })

let postSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetExtPanelForTest()
  __testMarkDataReady()
  sessionStorage.clear()
  Object.assign(bm.bmForm, { url: '', title: '', notes: '', _autoTitle: '', _userEditedNotes: false })
  vi.mocked(bm.findDuplicateBookmarks).mockReturnValue({ exact: null, suffix: null })
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
})

afterEach(() => {
  postSpy.mockRestore()
  __testResetDataReady()
})

describe('useExtPanel 模式判定', () => {
  it('未被嵌入时不启用，也不监听消息', () => {
    expect(useExtPanel({ framed: false })).toBe(false)
    expect(useExtPanelStore().active).toBe(false)
    send(tabMsg({ url: 'https://a.com' }))
    expect(useExtPanelStore().tab).toBeNull()
  })

  it('嵌入 + mode=panel 时启用并写会话标记', () => {
    window.history.replaceState(null, '', '/app?mode=panel')
    expect(useExtPanel({ framed: true, ancestorOrigins: [EXT] })).toBe(true)
    expect(useExtPanelStore().active).toBe(true)
    expect(sessionStorage.getItem('lv_ext_panel_mode')).toBe('1')
    window.history.replaceState(null, '', '/')
  })
})

describe('useExtPanel 消息处理', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/app?mode=panel')
    useExtPanel({ framed: true, ancestorOrigins: [EXT] })
    window.history.replaceState(null, '', '/')
  })

  it('握手 ready 只发给已确认的扩展 origin', () => {
    expect(postSpy).toHaveBeenCalledWith({ ns: EXT_MSG_NS, v: EXT_MSG_VERSION, type: 'ready' }, EXT)
  })

  it('接收当前页并回报是否已收藏', async () => {
    vi.mocked(bm.findDuplicateBookmarks).mockReturnValue({ exact: { id: 'b1' } as never, suffix: null })
    send(tabMsg({ url: 'https://a.com', title: 'A' }))
    await flush()
    const store = useExtPanelStore()
    expect(store.tab?.url).toBe('https://a.com/')
    expect(store.matchedId).toBe('b1')
    expect(postSpy).toHaveBeenCalledWith(
      { ns: EXT_MSG_NS, v: EXT_MSG_VERSION, type: 'matched', url: 'https://a.com/', saved: true }, EXT,
    )
  })

  it('拒收非扩展 origin、非父窗口、其他扩展的消息', async () => {
    send(tabMsg({ url: 'https://a.com' }), 'https://evil.example')
    send(tabMsg({ url: 'https://a.com' }), EXT, null)
    send(tabMsg({ url: 'https://a.com' }), 'chrome-extension://zzzzzzzzzzzzzzzz')
    await flush()
    expect(useExtPanelStore().tab).toBeNull()
  })

  it('save 消息：新页面打开新增弹窗并预填，划选文字作为用户备注保留', async () => {
    send(tabMsg({ url: 'https://a.com/x', title: '页面标题', selection: '我划的重点' }))
    await flush()
    send({ ns: EXT_MSG_NS, v: EXT_MSG_VERSION, type: 'save' })
    await flush()
    expect(bm.openBmModal).toHaveBeenCalledWith()
    expect(bm.bmForm.url).toBe('https://a.com/x')
    expect(bm.bmForm.title).toBe('页面标题')
    expect(bm.bmForm._autoTitle).toBe('页面标题')
    // 本地路径猜测不得覆盖真实标题，但 AI 仍可替换（title === _autoTitle）
    expect((bm.bmForm as unknown as { _userEditedTitle: boolean })._userEditedTitle).toBe(true)
    expect(bm.bmForm.notes).toBe('我划的重点')
    expect(bm.bmForm._userEditedNotes).toBe(true)
    expect(bm.autoFetchFromUrl).toHaveBeenCalled()
  })
})

describe('openPanelSave', () => {
  it('已收藏的页面直接打开编辑', async () => {
    useExtPanelStore().tab = { url: 'https://a.com/', title: 'A', description: '', selection: '', icon: '' }
    vi.mocked(bm.findDuplicateBookmarks).mockReturnValue({ exact: { id: 'b9' } as never, suffix: null })
    await openPanelSave()
    expect(bm.openBmModal).toHaveBeenCalledWith('b9')
    expect(bm.autoFetchFromUrl).not.toHaveBeenCalled()
  })

  it('没有当前页时什么都不做', async () => {
    await openPanelSave()
    expect(bm.openBmModal).not.toHaveBeenCalled()
  })
})

describe('标题清洗与回报去重', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/app?mode=panel')
    useExtPanel({ framed: true, ancestorOrigins: [EXT] })
    window.history.replaceState(null, '', '/')
  })

  it('去掉站点品牌尾巴', async () => {
    send(tabMsg({ url: 'https://zhuanlan.zhihu.com/p/1', title: '如何读论文 - 知乎' }))
    await flush()
    await openPanelSave()
    expect(bm.bmForm.title).toBe('如何读论文')
  })

  it('同一网址、同一收藏状态只回报一次', async () => {
    send(tabMsg({ url: 'https://a.com', title: 'A' }))
    await flush()
    send(tabMsg({ url: 'https://a.com', title: 'A 改了标题' }))
    await flush()
    const matched = postSpy.mock.calls.filter((c: unknown[]) => (c[0] as { type?: string }).type === 'matched')
    expect(matched).toHaveLength(1)
  })
})
