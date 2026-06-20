// content.js — 注入到页面，读取 LinkVault 的 localStorage/IDB 数据

(function () {
  'use strict'

  const STORAGE_KEY = 'linkvault_v2'
  const IDB_DB = 'linkvault'
  const IDB_STORE = 'data' // Dexie store name

  // ── 从 localStorage 读取书签 ──
  function getBookmarksFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const data = JSON.parse(raw)
      return (data.bookmarks || []).map(b => ({
        id: b.id,
        title: b.title,
        url: b.url,
        icon: b.icon || '',
        categoryId: b.categoryId || 'uncategorized',
        notes: b.notes || ''
      }))
    } catch (e) { return [] }
  }

  // ── 从 IndexedDB 读取书签 ──
  async function getBookmarksFromIDB() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(IDB_DB)
        request.onerror = () => resolve([])
        request.onsuccess = (event) => {
          const db = event.target.result
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            resolve([])
            return
          }
          const tx = db.transaction(IDB_STORE, 'readonly')
          const store = tx.objectStore(IDB_STORE)
          const getReq = store.get(STORAGE_KEY)
          getReq.onsuccess = () => {
            // Dexie stores as { key, value, updatedAt }
            const row = getReq.result
            const data = row?.value || row
            if (data && data.bookmarks) {
              resolve(data.bookmarks.map(b => ({
                id: b.id,
                title: b.title,
                url: b.url,
                icon: b.icon || '',
                categoryId: b.categoryId || 'uncategorized',
                notes: b.notes || ''
              })))
            } else {
              resolve([])
            }
          }
          getReq.onerror = () => resolve([])
        }
      } catch (e) { resolve([]) }
    })
  }

  // ── 写入书签到 localStorage ──
  function saveBookmarkToLocalStorage(bookmark) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      if (!data.bookmarks) data.bookmarks = []

      // 检查是否已存在
      const exists = data.bookmarks.some(b => b.url === bookmark.url)
      if (exists) return false

      const newBm = {
        id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: bookmark.title || '',
        url: bookmark.url || '',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'uncategorized',
        parentId: null,
        order: 0,
        useCount: 0,
        attributes: {},
        isExpanded: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      data.bookmarks.push(newBm)
      data._savedAt = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      return true
    } catch (e) { return false }
  }

  // ── 搜索书签 ──
  function searchBookmarks(query) {
    const bookmarks = getBookmarksFromLocalStorage()
    if (!query) return bookmarks.slice(0, 20)
    const q = query.toLowerCase()
    return bookmarks.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      (b.notes || '').toLowerCase().includes(q)
    ).slice(0, 20)
  }

  // ── 监听来自 background/popup 的消息 ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'LINKVAULT_SEARCH') {
      const results = searchBookmarks(msg.data?.query || '')
      sendResponse({ results })
      return
    }
    if (msg.type === 'LINKVAULT_GET_ALL') {
      const bookmarks = getBookmarksFromLocalStorage()
      sendResponse({ bookmarks })
      return
    }
    if (msg.type === 'LINKVAULT_SAVE_BOOKMARK') {
      const success = saveBookmarkToLocalStorage(msg.data)
      sendResponse({ success })
      return
    }
  })
})()
