// background.js — LinkVault Extension

const PWA_URL = 'https://herrhel.github.io'

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
    // P2: 选中文本 → 注入脚本获取选中内容 → 传到 PWA 保存
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
chrome.commands.onCommand.addListener(function (command) {
  if (command === 'save-to-linkvault') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      var tab = tabs[0]
      if (tab) openPwaWithUrl(tab.url, tab.title)
    })
  }
})

/** 新标签页打开 PWA，附带当前页面 URL 和可选的选中文本 */
function openPwaWithUrl(url, title, notes) {
  if (!url) return
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')
      || url.startsWith('file:') || url.startsWith('javascript:') || url.startsWith('data:')
      || url.startsWith('blob:') || url.startsWith('view-source:')) return

  var params = new URLSearchParams({ ext_save_url: url, ext_save_title: title || url })
  if (notes) params.set('ext_save_notes', notes)
  var targetUrl = PWA_URL + '/?ext_save=1&' + params.toString()

  chrome.tabs.query({}, function (tabs) {
    var existing = tabs.find(function (t) {
      return t.url && (t.url.startsWith(PWA_URL) || t.url.includes('localhost:5173'))
    })
    if (existing) {
      chrome.tabs.update(existing.id, { active: true, url: targetUrl })
    } else {
      chrome.tabs.create({ url: targetUrl })
    }
  })
}

// ── 消息路由：side panel ↔ PWA ──
//
// 数据流设计：
//   side panel 的保存操作 → 本 background → 打开 PWA 标签页（走 PWA 的 sync queue）
//   side panel 的删除/编辑备注 → 直接写 Supabase（PWA 通过 Realtime 拉取同步）
//
// 这样确保主要写操作（保存）走 PWA 的 IndexedDB 队列 + 离线同步机制，
// 而删除/编辑备注等低频操作容忍短暂滞后。
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      const tab = tabs[0]
      sendResponse(tab ? { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } : null)
    })
    return true
  }

  // ── Side panel 保存 → 转发到 PWA 标签页 ──
  // side panel 的保存/删除/编辑操作数据流：
  //   - 保存（主要操作）→ SAVE_TO_VAULT → 打开 PWA 标签页 → 走 sync queue
  //   - 删除/编辑备注 → 直接写 Supabase（低频操作，PWA 通过 Realtime 同步获取）
  //   （原因：side panel 保持快速响应，无需等待 PWA 标签页加载）
  if (msg.type === 'SAVE_TO_VAULT') {
    openPwaWithUrl(msg.url, msg.title, msg.notes)
    sendResponse({ ok: true })
    return false
  }
})
