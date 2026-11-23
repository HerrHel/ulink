// background.js — 与链（ulink）Extension 2.0
//
// 2.0 起侧边栏是主站 iframe 壳（见 sidepanel.js）。后台只负责：
// - 右键菜单 / 快捷键：打开侧边栏并让主站弹出保存（AI 预填与主站一致）；侧边栏打不开时退回「新标签打开主站保存」；
// - 为侧边栏读取当前标签页与现场元数据（activeTab 授权范围内）。

// ── 跨浏览器 API 统一兼容（Chrome, Edge, Firefox, Brave, Arc 等）──
if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') {
  globalThis.chrome = globalThis.browser
}

import { decideOpenPwa } from './pwa-open.js'
import { extractPageMetadataInTab } from './meta-extract.js'
import { buildTabPayload } from './panel-bridge.js'

const PWA_URL = 'https://ulink.ren'
// H10：仅按 PWA / 本地 dev 域名匹配已开标签，无需 tabs 权限遍历全部标签 URL
const PWA_TAB_URL_PATTERNS = [
  PWA_URL + '/*',
  'http://localhost:5173/*',
  'https://localhost:5173/*',
  'http://127.0.0.1:5173/*',
  'http://localhost:4173/*',
  'http://localhost:5174/*',
]
/** 待侧边栏领取的保存请求有效期：侧边栏冷启动加载主站一般在数秒内 */
const PENDING_SAVE_TTL_MS = 60000

// ── 统一网页元数据抓取（现场提取 OpenGraph、SEO 描述、划词与视频字幕）──
async function extractTabMeta(tab) {
  const base = {
    title: (tab && tab.title) || '',
    description: '',
    keywords: '',
    selection: '',
    icon: (tab && tab.favIconUrl) || '',
    videoTime: '',
    currentSubtitle: '',
  }
  if (!tab || !tab.id || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
    return base
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMetadataInTab,
    })
    const r = results && results[0] && results[0].result
    if (r) {
      return {
        title: r.title || tab.title || '',
        description: r.description || '',
        keywords: r.keywords || '',
        selection: r.selection || '',
        icon: r.icon || tab.favIconUrl || '',
        videoTime: r.videoTime || '',
        currentSubtitle: r.currentSubtitle || '',
      }
    }
  } catch (_) {
    // 受限或不可注入页面（无 activeTab 授权、商店页等）静默降级为标签属性
  }
  return base
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

// ── 安装/更新时：点击工具栏图标直接打开侧边栏 ──
chrome.runtime.onInstalled.addListener(function () {
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {})
  }
})

/**
 * 在用户手势内打开侧边栏。必须在监听器里同步调用（先 await 别的会丢失手势）。
 * 返回 Promise<boolean>：是否成功打开。
 */
function openPanel(tab) {
  try {
    if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && tab && tab.windowId !== undefined) {
      return chrome.sidePanel.open({ windowId: tab.windowId }).then(function () { return true }, function () { return false })
    }
    // Firefox：sidebar_action
    if (globalThis.browser && globalThis.browser.sidebarAction && typeof globalThis.browser.sidebarAction.open === 'function') {
      return globalThis.browser.sidebarAction.open().then(function () { return true }, function () { return false })
    }
  } catch (_) {}
  return Promise.resolve(false)
}

/** 等侧边栏领取的保存：{ save: { tabId, tab }, at } */
let pendingSave = null

/**
 * 保存入口（右键菜单 / 快捷键共用）：侧边栏能打开就在侧边栏里保存，否则退回新标签打开主站保存。
 * override：右键链接时保存链接本身；右键划词时用菜单给的划词文字兜底。
 */
function saveViaPanel(tab, override) {
  const opened = openPanel(tab) // 同步发起，保住用户手势
  const o = override || {}
  return extractTabMeta(tab).then(async function (meta) {
    const payload = o.url
      ? buildTabPayload({ url: o.url, title: o.url }, null)
      : buildTabPayload(tab, {
        title: meta.title,
        description: meta.description,
        selection: meta.selection || o.selection || '',
        icon: meta.icon,
        videoTime: meta.videoTime,
        currentSubtitle: meta.currentSubtitle,
      })
    if (!payload) return
    if (!(await opened)) {
      openPwaWithUrl(payload.url, payload.title, payload.selection || payload.description)
      return
    }
    const save = { tabId: tab && tab.id, tab: payload }
    pendingSave = { save, at: Date.now() }
    // 侧边栏已开且主站就绪：直接交付；否则等侧边栏 PANEL_READY 来领
    try {
      const res = await chrome.runtime.sendMessage({ type: 'PANEL_SAVE', save })
      if (res && res.ok) pendingSave = null
    } catch (_) { /* 侧边栏尚未加载完成，留待领取 */ }
  })
}

// ── 右键菜单 ──
chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'save-to-linkvault') {
    saveViaPanel(tab, info.linkUrl ? { url: info.linkUrl } : null)
  } else if (info.menuItemId === 'save-selection-to-linkvault') {
    saveViaPanel(tab, { selection: info.selectionText || '' })
  }
})

// ── 快捷键 Ctrl+Shift+S ──
// activeTab 在命令/用户手势触发时瞬态授权当前标签，无需持久 tabs 权限
chrome.commands.onCommand.addListener(function (command, tab) {
  if (command !== 'save-to-linkvault') return
  if (tab) {
    saveViaPanel(tab)
    return
  }
  // 旧版浏览器 onCommand 不带 tab：查询后已失去手势，侧边栏可能打不开，saveViaPanel 内会自动退回
  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    if (tabs && tabs[0]) saveViaPanel(tabs[0])
  })
})

/** 侧边栏打不开时的退路：新标签页打开主站（已开则复用），由主站 ext_save 参数静默保存 */
function openPwaWithUrl(url, title, notes) {
  return new Promise(function (resolve) {
    // decideOpenPwa 经 ES module import 引入（SW 无 window）。协议拦截+URL 构造在 pwa-open.js 纯函数内，vitest 锁全分支。
    var decision = decideOpenPwa(url, title, notes, PWA_URL)
    if (!decision.shouldOpen) { resolve({ ok: false, reason: decision.reason }); return }

    // H10：按 URL pattern 仅匹配 PWA 标签，不读用户其它标签 URL
    chrome.tabs.query({ url: PWA_TAB_URL_PATTERNS }, function (tabs) {
      if (chrome.runtime.lastError) { resolve({ ok: false, reason: chrome.runtime.lastError.message }); return }
      var existing = tabs && tabs[0]
      if (existing) {
        chrome.tabs.update(existing.id, { active: true, url: decision.targetUrl })
        if (chrome.windows && typeof chrome.windows.update === 'function' && existing.windowId) {
          chrome.windows.update(existing.windowId, { focused: true }).catch(function () {})
        }
      } else {
        chrome.tabs.create({ url: decision.targetUrl })
      }
      resolve({ ok: true })
    })
  })
}

// ── 消息路由：侧边栏 ↔ 后台 ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  // 只接受本扩展自身（侧边栏）发出的消息，拒绝外部页面/其它扩展伪造指令
  if (!sender || sender.id !== chrome.runtime.id || !msg) return
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
        icon: meta.icon,
        favIconUrl: tab.favIconUrl,
        videoTime: meta.videoTime,
        currentSubtitle: meta.currentSubtitle,
      })
    }).catch(function () {
      sendResponse(null)
    })
    return true
  }

  if (msg.type === 'PANEL_READY') {
    const p = pendingSave
    pendingSave = null
    sendResponse({ save: p && Date.now() - p.at < PENDING_SAVE_TTL_MS ? p.save : null })
  }
})
