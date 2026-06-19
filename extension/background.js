// background.js — LinkVault Extension Service Worker

const LINKVAULT_URLS = ['http://localhost:5173/*', 'https://*.linkvault.app/*']

// ── 右键菜单：保存当前页面到 LinkVault ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-linkvault',
    title: '保存到 LinkVault',
    contexts: ['page', 'link']
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-linkvault') {
    const url = info.linkUrl || info.pageUrl
    const title = info.linkText || tab?.title || url
    await saveBookmark({ url, title, sourceTab: tab })
  }
})

// ── 快捷键命令 ──
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === 'save-current-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.url) {
      await saveBookmark({ url: tab.url, title: tab.title || tab.url, sourceTab: tab })
    }
  }
})

// ── 保存书签到 LinkVault ──
async function saveBookmark({ url, title, sourceTab }) {
  // 尝试通过 LinkVault 页面的 content script 写入
  const lvTabs = await chrome.tabs.query({ url: LINKVAULT_URLS })
  for (const tab of lvTabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'LINKVAULT_SAVE_BOOKMARK',
        data: { url, title }
      })
      if (response?.success) {
        showNotification('已保存', `"${title}" 已添加到 LinkVault`)
        return
      }
    } catch (e) { continue }
  }

  // Fallback: 保存到 extension storage，等 LinkVault 页面打开时同步
  const pending = await getFromStorage('pendingBookmarks') || []
  pending.push({ url, title, savedAt: Date.now() })
  await chrome.storage.local.set({ pendingBookmarks: pending })
  showNotification('已暂存', `"${title}" 将在打开 LinkVault 时同步`)
}

// ── 从 LinkVault 搜索书签（供 popup 调用）──
async function searchBookmarks(query) {
  const lvTabs = await chrome.tabs.query({ url: LINKVAULT_URLS })
  for (const tab of lvTabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'LINKVAULT_SEARCH',
        data: { query }
      })
      if (response?.results) return response.results
    } catch (e) { continue }
  }

  // Fallback: 从 extension storage 搜索缓存
  const cached = await getFromStorage('bookmarksCache') || []
  if (!query) return cached.slice(0, 20)
  const q = query.toLowerCase()
  return cached.filter(b =>
    b.title?.toLowerCase().includes(q) ||
    b.url?.toLowerCase().includes(q)
  ).slice(0, 20)
}

// ── 获取全部书签（供 popup 显示）──
async function getAllBookmarks() {
  const lvTabs = await chrome.tabs.query({ url: LINKVAULT_URLS })
  for (const tab of lvTabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'LINKVAULT_GET_ALL'
      })
      if (response?.bookmarks) {
        await chrome.storage.local.set({ bookmarksCache: response.bookmarks })
        return response.bookmarks
      }
    } catch (e) { continue }
  }

  return await getFromStorage('bookmarksCache') || []
}

// ── 同步待保存的书签到 LinkVault 页面 ──
async function syncPendingBookmarks() {
  const pending = await getFromStorage('pendingBookmarks') || []
  if (pending.length === 0) return

  const lvTabs = await chrome.tabs.query({ url: LINKVAULT_URLS })
  for (const tab of lvTabs) {
    try {
      for (const bm of pending) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'LINKVAULT_SAVE_BOOKMARK',
          data: bm
        })
      }
      // 清空待保存队列
      await chrome.storage.local.set({ pendingBookmarks: [] })
      return
    } catch (e) { continue }
  }
}

// ── 消息处理 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SEARCH_BOOKMARKS') {
    searchBookmarks(msg.query).then(results => sendResponse({ results }))
    return true
  }
  if (msg.type === 'GET_ALL_BOOKMARKS') {
    getAllBookmarks().then(bookmarks => sendResponse({ bookmarks }))
    return true
  }
  if (msg.type === 'SAVE_BOOKMARK') {
    saveBookmark({ url: msg.data.url, title: msg.data.title }).then(() => sendResponse({ success: true }))
    return true
  }
  if (msg.type === 'GET_LINKVAULT_TAB') {
    chrome.tabs.query({ url: LINKVAULT_URLS }).then(tabs => {
      sendResponse({ found: tabs.length > 0, tabId: tabs[0]?.id })
    })
    return true
  }
  if (msg.type === 'SYNC_CACHE') {
    // content script 同步缓存到 extension storage
    chrome.storage.local.set({ bookmarksCache: msg.bookmarks })
    return
  }
})

// ── 监听 LinkVault 页面打开，自动同步待保存书签 ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.match(/localhost:5173|linkvault\.app/)) {
    syncPendingBookmarks()
  }
})

// ── 工具函数 ──
function getFromStorage(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, result => resolve(result[key]))
  })
}

function showNotification(title, message) {
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  })?.catch?.(() => {})
}
