// douyin-hook.js — 在 MAIN world 捕获抖音页面的播放地址响应（document_start 注入）
// 只读取页面自己发起的、已由用户登录态签名的响应，不构造请求、不逆向签名。
;(function () {
  'use strict'
  if (window.__ULINK_DOUYIN_HOOK__) return
  window.__ULINK_DOUYIN_HOOK__ = true

  const state = { urls: [], title: '', uploader: '', duration: null }
  window.__ULINK_DOUYIN_MEDIA__ = state
  let seq = 0

  function add(value) {
    if (typeof value !== 'string') return
    const url = value.trim()
    if (!/^https:\/\//i.test(url)) return
    if (!/(douyinvod|bytecdn|byteimg|snssdk|amemv|zjcdn)\./i.test(url)) return
    if (state.urls.indexOf(url) >= 0) return
    state.urls.push(url)
    if (state.urls.length > 24) state.urls.shift()
    seq += 1
  }

  function scan(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return
    if (Array.isArray(node)) {
      for (const item of node) scan(item, depth + 1)
      return
    }
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (typeof value === 'string') {
        if (/^(url_list|urlList|play_addr|playAddr|download_addr|downloadAddr|playApi|uri)$/i.test(key)) {
          add(value)
        } else if (/^https:\/\//i.test(value) && /(douyinvod|bytecdn|amemv|zjcdn)\./i.test(value)) {
          add(value)
        }
      } else if (value && typeof value === 'object') {
        if (/^(aweme_detail|awemeDetail|video|play_addr|playAddr|download_addr|downloadAddr|bit_rate|bitRate|url_list|urlList)$/i.test(key)) {
          scan(value, depth + 1)
        } else if (depth < 3) {
          scan(value, depth + 1)
        }
      }
    }
  }

  function scanText(text) {
    if (!text || typeof text !== 'string') return
    if (!/(aweme_detail|play_addr|playAddr|douyinvod|bytecdn)/i.test(text)) return
    try {
      scan(JSON.parse(text), 0)
    } catch (_) {}
  }

  function shouldInspect(url) {
    return /aweme\/detail|aweme\/v1\/web\/aweme\/detail|aweme\/v1\/web\/feed|aweme\/v1\/web\/aweme\/post/i.test(
      String(url || ''),
    )
  }

  try {
    const origFetch = window.fetch
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        const args = arguments
        const requestUrl = args && args[0] && (args[0].url || args[0])
        return origFetch.apply(this, args).then(function (response) {
          try {
            if (shouldInspect(requestUrl)) {
              response
                .clone()
                .text()
                .then(scanText)
                .catch(function () {})
            }
          } catch (_) {}
          return response
        })
      }
    }
  } catch (_) {}

  try {
    const origSend = XMLHttpRequest.prototype.send
    const origOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__ulinkUrl = url
      return origOpen.apply(this, arguments)
    }
    XMLHttpRequest.prototype.send = function () {
      const xhr = this
      if (shouldInspect(xhr.__ulinkUrl)) {
        xhr.addEventListener('load', function () {
          try {
            scanText(xhr.responseText)
          } catch (_) {}
        })
      }
      return origSend.apply(this, arguments)
    }
  } catch (_) {}

  // 兜底：视频元素/资源加载后再扫一遍
  setInterval(function () {
    try {
      for (const video of document.querySelectorAll('video')) {
        if (video.currentSrc) add(video.currentSrc)
      }
    } catch (_) {}
  }, 3000)
})()
