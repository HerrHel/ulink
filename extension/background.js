// background.js — LinkVault Extension Service Worker（侧边栏 + 右键菜单 + 快捷键）

// ── STORAGE ──
const STORAGE_KEY = 'linkvault_ext_bookmarks'

// ── 简单的互斥锁，避免并发写入竞态 ──
let storageLock = Promise.resolve()

/** 串行化 chrome.storage.local 的 read-modify-write 操作 */
async function withStorageLock(fn) {
  let release
  const prev = storageLock
  storageLock = new Promise(function (resolve) { release = resolve })
  await prev // 等待前一个操作完成
  try {
    return await fn()
  } finally {
    release()
  }
}

// ── 安装时设置 ──
chrome.runtime.onInstalled.addListener(function () {
  // 清空旧菜单再创建，避免更新后菜单 ID 冲突
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'save-to-linkvault',
      title: '保存到 LinkVault',
      contexts: ['page', 'link'],
    })
  })

  // 点击图标打开侧边栏
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {})
})

// ── 右键菜单点击 ──
chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'save-to-linkvault') {
    const url = info.linkUrl || tab.url
    const title = info.linkUrl ? url : (tab.title || url)
    saveBookmark({ url: url, title: title, favIconUrl: tab.favIconUrl })
  }
})

// ── 全局快捷键 ──
chrome.commands.onCommand.addListener(function (command) {
  if (command === 'save-to-linkvault') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      const tab = tabs[0]
      if (tab) saveBookmark({ url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl })
    })
  }
})

// ── 保存书签 ──
async function saveBookmark(_a) {
  var url = _a.url, title = _a.title, favIconUrl = _a.favIconUrl
  if (!url) return
  // 全面过滤内部页面
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')
      || url.startsWith('file:') || url.startsWith('javascript:') || url.startsWith('data:')
      || url.startsWith('blob:') || url.startsWith('view-source:')) return

  const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const bookmark = { id: id, title: title || url, url: url, icon: favIconUrl || '', notes: '', use_count: 0 }

  // 原子化 read-modify-write，避免并发竞态
  await withStorageLock(async function () {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const existing = result[STORAGE_KEY] || []
    if (!existing.some(function (b) { return b.url === url })) {
      existing.unshift(bookmark)
      await chrome.storage.local.set({ [STORAGE_KEY]: existing })
    }
  })

  // 通知所有打开的 Side Panel 刷新
  chrome.runtime.sendMessage({ type: 'REFRESH_BOOKMARKS' }).catch(function () {
    // Side Panel 未打开时忽略
  })

  // 系统通知
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'LinkVault',
    message: '已保存到书签',
    contextMessage: title || url,
  })
}

// ── 消息处理 ──
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      const tab = tabs[0]
      sendResponse(tab ? { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } : null)
    })
    return true // 异步 response
  }

  // 集中处理 chrome.storage.local 写入，避免 Side Panel / Popup 并发竞态
  if (msg.type === 'SAVE_BOOKMARKS') {
    withStorageLock(async function () {
      await chrome.storage.local.set({ [STORAGE_KEY]: msg.payload })
    }).then(function () { sendResponse({ ok: true }) })
    return true
  }
})
