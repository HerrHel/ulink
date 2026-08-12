// extension/pwa-open.js — PWA 打开决策纯函数（无 chrome.* / DOM 依赖，可 vitest 测）。
// B2 修复：原 background.js openPwaWithUrl 不返 Promise，SAVE_TO_VAULT 同步 sendResponse{ok:true}
// 即使 url 协议被拦/为空静默 return，用户看到「已保存」但实际未开 PWA 标签。
// 抽决策纯函数（协议拦截+URL 构造），vitest 锁全部分支。pwaUrl 由调用方注入（background.js 的
// PWA_URL 常量），避免决策函数依赖扩展全局。挂 window.LinkVaultPwaOpen 全局。
(function () {
  function decideOpenPwa(url, title, notes, pwaUrl) {
    if (!url) return { shouldOpen: false, reason: 'NO_URL', targetUrl: null }
    if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:')
        || url.startsWith('file:') || url.startsWith('javascript:') || url.startsWith('data:')
        || url.startsWith('blob:') || url.startsWith('view-source:')) {
      return { shouldOpen: false, reason: 'UNSAFE_PROTOCOL', targetUrl: null }
    }
    var params = new URLSearchParams({ ext_save_url: url, ext_save_title: title || url })
    if (notes) params.set('ext_save_notes', notes)
    return { shouldOpen: true, reason: null, targetUrl: pwaUrl + '/?ext_save=1&' + params.toString() }
  }
  window.LinkVaultPwaOpen = { decideOpenPwa: decideOpenPwa }
})()