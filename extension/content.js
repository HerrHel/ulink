// content.js — LinkVault: 捕获右键点击的链接文本

let lastLinkText = ''

// 右键菜单弹出前记录链接文字
document.addEventListener('contextmenu', function (e) {
  var target = e.target
  while (target && target !== document.body) {
    if (target.tagName === 'A') {
      lastLinkText = target.textContent.trim()
      return
    }
    target = target.parentElement
  }
  lastLinkText = ''
})

// 响应 background 的查询
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'GET_LINK_TEXT') {
    sendResponse({ text: lastLinkText })
  }
})
