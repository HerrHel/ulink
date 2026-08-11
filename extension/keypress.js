// extension/keypress.js — 搜索快捷键劫持判定纯函数（无 chrome.* / DOM 依赖，可被 vitest 测）。
// B3 修复：原 keydown 里 Ctrl+F 分支无 e.target.tagName 限制，焦点在 INPUT 时按 Ctrl+F 仍被劫走，
// 与 / 分支「INPUT 内不劫」的 design intent 不对齐。抽成纯函数便于单测锁全部分支。
// 挂 window.LinkVaultKeyHijack 全局（仿 config.js / crypto.js 范式），sidepanel.js 消费。
(function () {
  function shouldHijackSearchKey(e) {
    var inInput = !!(e && e.target && e.target.tagName === 'INPUT')
    if (inInput) return false
    if (e.ctrlKey && e.key === 'f') return true
    if (!e.ctrlKey && !e.metaKey && e.key === '/') return true
    return false
  }
  window.LinkVaultKeyHijack = { shouldHijackSearchKey: shouldHijackSearchKey }
})()
