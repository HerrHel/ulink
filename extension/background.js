// background.js — LinkVault Extension Service Worker (Side Panel 架构)

// ── 安装时设置：点击扩展图标直接打开 Side Panel ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

// ── 消息处理：Side Panel ↔ background ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0]
      sendResponse(tab ? { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl } : null)
    })
    return true
  }

  if (msg.type === 'IMPORT_CHROME_BOOKMARKS') {
    importChromeBookmarks().then(result => sendResponse(result))
    return true
  }
})

// ── Chrome 书签导入：递归遍历书签树 ──
async function importChromeBookmarks() {
  const tree = await chrome.bookmarks.getTree()
  const bookmarks = []
  const folders = new Map() // folderPath → categoryId

  function walk(nodes, path = '') {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push({
          title: node.title || node.url,
          url: node.url,
          folder: path,
          dateAdded: node.dateAdded || 0,
        })
      }
      if (node.children) {
        const childPath = path ? `${path}/${node.title || ''}` : (node.title || '')
        walk(node.children, childPath)
      }
    }
  }

  walk(tree)
  return { bookmarks, count: bookmarks.length }
}
