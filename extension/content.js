// content.js — 提取当前页面元数据，供 Side Panel 快速收藏使用

(function () {
  'use strict'

  // 提取页面 description
  function getPageDescription() {
    const meta = document.querySelector('meta[name="description"]')
    if (meta) return meta.content || ''
    const ogDesc = document.querySelector('meta[property="og:description"]')
    if (ogDesc) return ogDesc.content || ''
    return ''
  }

  // 提取页面 keywords
  function getPageKeywords() {
    const meta = document.querySelector('meta[name="keywords"]')
    return meta ? meta.content || '' : ''
  }

  // 监听来自 Side Panel 的消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_META') {
      sendResponse({
        description: getPageDescription(),
        keywords: getPageKeywords(),
      })
    }
  })
})()
