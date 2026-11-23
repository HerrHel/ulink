/**
 * useExtPanel — 扩展侧边栏模式的消息收发与保存编排
 *
 * 只在 /app?mode=panel 且被扩展 iframe 嵌入时启用（判定见 lib/extPanel.ts）：
 * - 收：扩展推送当前标签页（切换 / 刷新标签时），以及快捷键触发的「保存当前页」；
 * - 发：ready（握手）与 matched（当前页是否已收藏，扩展据此显示角标）；
 * - 保存：复用主站的新增书签弹窗，所以 AI 预填、个性化、查重、加密、同步全部与主站一致，
 *   扩展侧不再有任何写库逻辑。
 */
import { watch } from 'vue'
import { useExtPanelStore } from '../stores/extPanel.js'
import { useDataStore } from '../stores/data.js'
import {
  PANEL_MODE_SESSION_KEY,
  buildOutboundMessage,
  detectPanelMode,
  guessParentOrigin,
  isExtensionOrigin,
  parseInboundMessage,
  type ExtOutboundMessage,
} from '../lib/extPanel.js'
import { findDuplicateBookmarks, openBmModal, bmForm, autoFetchFromUrl } from './domain/useBookmark.js'
import { whenDataReady } from '../lib/dataReady.js'
import { cleanWebTitle } from '../lib/ai/smartIntake.js'

let _installed = false
/** 已确认的扩展 origin：只向它发送含网址的消息 */
let _parentOrigin: string | null = null
/** 上次回报给扩展的「网址|是否已收藏」，相同则不重复发送 */
let _lastMatchedKey = ''

function readSessionFlag(): string | null {
  try { return sessionStorage.getItem(PANEL_MODE_SESSION_KEY) } catch { return null }
}

function isFramed(): boolean {
  try { return window.self !== window.top } catch { return true }
}

function post(msg: ExtOutboundMessage, allowWildcard = false): void {
  const target = _parentOrigin || (allowWildcard ? '*' : null)
  if (!target) return
  try { window.parent.postMessage(buildOutboundMessage(msg), target) } catch { /* 父页面已关闭 */ }
}

/** 打开新增书签弹窗并预填当前页；已收藏则直接打开编辑 */
export async function openPanelSave(): Promise<void> {
  const store = useExtPanelStore()
  const tab = store.tab
  if (!tab) return
  await whenDataReady()
  const exact = findDuplicateBookmarks(tab.url).exact
  if (exact) {
    await openBmModal(exact.id)
    return
  }
  await openBmModal()
  bmForm.url = tab.url
  // 标题用浏览器给的真实网页标题（去掉站点品牌尾巴）。
  // _userEditedTitle=true：本地「按网址路径猜标题」的预填不得覆盖它（猜的比真标题差）；
  // _autoTitle 同值：AI 提炼出更好的标题时仍可替换（AI 只在 title === _autoTitle 时覆盖），
  // 用户一旦手改，title 与 _autoTitle 不再相等，AI 也不会再动。
  const title = cleanWebTitle(tab.title, tab.url) || tab.title
  bmForm.title = title
  bmForm._autoTitle = title
  bmForm._userEditedTitle = !!title
  // 用户划选的文字是用户意图，作为备注保留，不让 AI 覆盖
  if (tab.selection) {
    bmForm.notes = tab.selection
    bmForm._userEditedNotes = true
  }
  autoFetchFromUrl()
}

/**
 * 在 App 根组件 setup 中尽早调用；返回是否处于侧栏模式。
 * env 仅供单测注入（jsdom 里无法真的被 iframe 嵌入）。
 */
export function useExtPanel(env: { framed?: boolean; ancestorOrigins?: ArrayLike<string> } = {}): boolean {
  const store = useExtPanelStore()
  if (_installed) return store.active
  _installed = true

  const active = detectPanelMode({
    search: window.location.search,
    isFramed: env.framed ?? isFramed(),
    sessionFlag: readSessionFlag(),
  })
  store.active = active
  if (!active) return false

  try { sessionStorage.setItem(PANEL_MODE_SESSION_KEY, '1') } catch { /* 存储受限时仅本次有效 */ }
  _parentOrigin = guessParentOrigin(env.ancestorOrigins ?? window.location.ancestorOrigins)

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent || !isExtensionOrigin(e.origin)) return
    // 首条合法消息确定父 origin；之后只认同一个
    if (_parentOrigin && e.origin !== _parentOrigin) return
    const msg = parseInboundMessage(e.data)
    if (!msg) return
    _parentOrigin = e.origin
    if (msg.type === 'tab') store.tab = msg.tab
    else if (msg.type === 'save') void openPanelSave()
  })

  // 当前页 ↔ 书签库任一变化都重新判定「是否已收藏」，并回报扩展
  const ds = useDataStore()
  // 不 deep 监听整个书签数组（几千条时代价高）：数组引用变化覆盖跨实例重载，条数覆盖增删，
  // _saveCount 覆盖编辑 / 恢复 / 同步落盘
  watch(
    () => [store.tab?.url, ds.bookmarks, ds.bookmarks.length, ds._saveCount] as const,
    async () => {
      await whenDataReady()
      const url = store.tab?.url
      const exact = url ? findDuplicateBookmarks(url).exact : null
      store.matchedId = exact ? exact.id : null
      const key = url ? url + '|' + (exact ? '1' : '0') : ''
      if (url && key !== _lastMatchedKey) {
        _lastMatchedKey = key
        post({ type: 'matched', url, saved: !!exact })
      }
    },
    { immediate: true },
  )

  // 握手不含任何数据，Firefox 无 ancestorOrigins 时允许广播，扩展收到后再推标签页
  post({ type: 'ready' }, true)
  return true
}

/** 仅测试用：重置模块级状态 */
export function __resetExtPanelForTest(): void {
  _installed = false
  _parentOrigin = null
  _lastMatchedKey = ''
}
