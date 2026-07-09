// background.js — LinkVault Extension

const PWA_URL = 'https://herrh.github.io'

// ── 安装时 ──
chrome.runtime.onInstalled.addListener(function () {
  // 侧边栏：点击图标即打开
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {})
  // 右键菜单
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'save-to-linkvault',
      title: '保存到 LinkVault',
      contexts: ['page', 'link'],
    })
  })
})

// ── 右键菜单 ──
chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'save-to-linkvault') {
    openPwaWithUrl(info.linkUrl || tab.url, tab.title)
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

/** 新标签页打开 PWA，附带当前页面 URL */
function openPwaWithUrl(url, title) {
  if (!url) return
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')
      || url.startsWith('file:') || url.startsWith('javascript:') || url.startsWith('data:')
      || url.startsWith('blob:') || url.startsWith('view-source:')) return

  var params = new URLSearchParams({ ext_save_url: url, ext_save_title: title || url })
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

// ── 消息：Side Panel 获取当前标签页 ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      const tab = tabs[0]
      sendResponse(tab ? { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } : null)
    })
    return true
  }
})
