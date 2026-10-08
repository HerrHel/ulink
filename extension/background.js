// background.js — 与链（ulink）Extension

// ── 跨浏览器 API 统一兼容（Chrome, Edge, Firefox, Brave, Arc 等）──
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser
}

import { decideOpenPwa } from './pwa-open.js'
import { extractPageMetadataInTab } from './meta-extract.js'

const PWA_URL = 'https://ulink.ren'
// H10：仅按 PWA / 本地 dev 域名匹配已开标签，无需 tabs 权限遍历全部标签 URL
const PWA_TAB_URL_PATTERNS = [PWA_URL + '/*', 'http://localhost:5173/*', 'https://localhost:5173/*']

// ── 统一网页元数据抓取（方案二：现场提取 OpenGraph、SEO 描述与划词）──
async function extractTabMeta(tab) {
  if (!tab || !tab.id || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
    return {
      title: (tab && tab.title) || '',
      description: '',
      keywords: '',
      selection: '',
      icon: (tab && tab.favIconUrl) || '',
    }
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMetadataInTab,
    })
    if (results && results[0] && results[0].result) {
      const r = results[0].result
      return {
        title: r.title || tab.title || '',
        description: r.description || '',
        keywords: r.keywords || '',
        selection: r.selection || '',
        icon: r.icon || tab.favIconUrl || '',
      }
    }
  } catch (_) {
    // 受限或不可注入页面静默降级为标签属性
  }
  return {
    title: tab.title || '',
    description: '',
    keywords: '',
    selection: '',
    icon: tab.favIconUrl || '',
  }
}

// ── 初始化：创建右键菜单（每次 worker 启动时执行，以防重启后丢失）──
chrome.contextMenus.removeAll(function () {
  chrome.contextMenus.create({
    id: 'save-to-linkvault',
    title: chrome.i18n.getMessage('menu_save_page'),
    contexts: ['page', 'link'],
  })
  chrome.contextMenus.create({
    id: 'save-selection-to-linkvault',
    title: chrome.i18n.getMessage('menu_save_selection'),
    contexts: ['selection'],
  })
})

// ── 安装/更新时 ──
chrome.runtime.onInstalled.addListener(function () {
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {})
  }
})

// ── 右键菜单 ──
chrome.contextMenus.onClicked.addListener(async function (info, tab) {
  if (info.menuItemId === 'save-to-linkvault') {
    const meta = await extractTabMeta(tab)
    const finalTitle = meta.title || tab.title
    const finalNotes = meta.selection || meta.description || ''
    openPwaWithUrl(info.linkUrl || tab.url, finalTitle, finalNotes)
  } else if (info.menuItemId === 'save-selection-to-linkvault') {
    const meta = await extractTabMeta(tab)
    const selection = meta.selection || info.selectionText || ''
    const finalTitle = meta.title || tab.title
    openPwaWithUrl(info.pageUrl || tab.url, finalTitle, selection)
  }
})

// ── 快捷键 Ctrl+Shift+S ──
// activeTab 在命令/用户手势触发时瞬态授权当前标签，无需持久 tabs 权限
chrome.commands.onCommand.addListener(async function (command) {
  if (command === 'save-to-linkvault') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs && tabs[0]
    if (tab) {
      const meta = await extractTabMeta(tab)
      const finalTitle = meta.title || tab.title
      const finalNotes = meta.selection || meta.description || ''
      openPwaWithUrl(tab.url, finalTitle, finalNotes)
    }
  }
})

/** 新标签页打开 PWA，附带当前页面 URL 和可选的选中文本。B2：返 Promise，调用方 await 后据实响应。 */
function openPwaWithUrl(url, title, notes) {
  return new Promise(function (resolve) {
    // decideOpenPwa 经 ES module import 引入（manifest 已声明 type: module，SW 无 window 故走
    // import 不依赖 window 挂载）。协议拦截+URL 构造在 pwa-open.js 纯函数内，vitest 锁全分支。
    var decision = decideOpenPwa(url, title, notes, PWA_URL)
    if (!decision.shouldOpen) { resolve({ ok: false, reason: decision.reason }); return }

    // H10：按 URL pattern 仅匹配 PWA 标签，不读用户其它标签 URL
    chrome.tabs.query({ url: PWA_TAB_URL_PATTERNS }, function (tabs) {
      if (chrome.runtime.lastError) { resolve({ ok: false, reason: chrome.runtime.lastError.message }); return }
      var existing = tabs && tabs[0]
      if (existing) {
        chrome.tabs.update(existing.id, { active: true, url: decision.targetUrl })
      } else {
        chrome.tabs.create({ url: decision.targetUrl })
      }
      resolve({ ok: true })
    })
  })
}

// ── 消息路由：side panel ↔ PWA ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async function (tabs) {
      const tab = tabs && tabs[0]
      if (!tab) { sendResponse(null); return }
      const meta = await extractTabMeta(tab)
      sendResponse({
        id: tab.id,
        url: tab.url,
        title: meta.title || tab.title,
        description: meta.description,
        keywords: meta.keywords,
        selection: meta.selection,
        favIconUrl: meta.icon || tab.favIconUrl,
      })
    })
    return true
  }

  if (msg.type === 'SAVE_TO_VAULT') {
    openPwaWithUrl(msg.url, msg.title, msg.notes).then(function (r) {
      sendResponse(r)
    })
    return true
  }
})
