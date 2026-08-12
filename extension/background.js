// background.js — LinkVault Extension

const PWA_URL = 'https://herrhel.github.io'
// H10：仅按 PWA / 本地 dev 域名匹配已开标签，无需 tabs 权限遍历全部标签 URL
const PWA_TAB_URL_PATTERNS = [PWA_URL + '/*', 'http://localhost:5173/*', 'https://localhost:5173/*']

// ── 初始化：创建右键菜单（每次 worker 启动时执行，以防重启后丢失）──
chrome.contextMenus.removeAll(function () {
  chrome.contextMenus.create({
    id: 'save-to-linkvault',
    title: '保存到 LinkVault',
    contexts: ['page', 'link'],
  })
  chrome.contextMenus.create({
    id: 'save-selection-to-linkvault',
    title: '保存选中文本到 LinkVault',
    contexts: ['selection'],
  })
})

// ── 安装/更新时 ──
chrome.runtime.onInstalled.addListener(function () {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {})
})

// ── 右键菜单 ──
chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'save-to-linkvault') {
    openPwaWithUrl(info.linkUrl || tab.url, tab.title)
  } else if (info.menuItemId === 'save-selection-to-linkvault') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() || '',
    }).then(function (results) {
      const selectedText = (results && results[0] && results[0].result) || ''
      openPwaWithUrl(info.pageUrl || tab.url, tab.title, selectedText)
    }).catch(function () {
      openPwaWithUrl(info.pageUrl || tab.url, tab.title)
    })
  }
})

// ── 快捷键 Ctrl+Shift+S ──
// activeTab 在命令/用户手势触发时瞬态授权当前标签，无需持久 tabs 权限
chrome.commands.onCommand.addListener(function (command) {
  if (command === 'save-to-linkvault') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      var tab = tabs[0]
      if (tab) openPwaWithUrl(tab.url, tab.title)
    })
  }
})

/** 新标签页打开 PWA，附带当前页面 URL 和可选的选中文本。B2：返 Promise，调用方 await 后据实响应。 */
function openPwaWithUrl(url, title, notes) {
  return new Promise(function (resolve) {
    // 决策抽到 pwa-open.js 纯函数（vitest 锁契约）
    var decision = window.LinkVaultPwaOpen
      ? window.LinkVaultPwaOpen.decideOpenPwa(url, title, notes, PWA_URL)
      : { shouldOpen: !!url, reason: null, targetUrl: url ? PWA_URL + '/?ext_save=1&' + new URLSearchParams({ ext_save_url: url, ext_save_title: title || url }).toString() : null }
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
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      const tab = tabs[0]
      sendResponse(tab ? { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } : null)
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
