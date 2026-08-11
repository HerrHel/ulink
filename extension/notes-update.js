// extension/notes-update.js — 备注更新结果决策纯函数（无 chrome.* / DOM 依赖，可被 vitest 测）。
// B1 修复：原 bdEditNotes handler 乐观写「先改本地引用再 update」，update 失败时 allBookmarks 里
// 该元素（currentMatchedBookmark 是 find 返回的数组元素引用）.notes 已污染成新值但云端未存，
// 搜索/详情显形假备注。抽决策函数：update 失败时不写本地（writeLocal=false），消除污染。
// 挂 window.LinkVaultNotesUpdate 全局（仿 config.js / keypress.js 范式），sidepanel.js 消费。
(function () {
  function notesUpdateOutcome(newNotes, r) {
    if (r && r.error) {
      return { writeLocal: false, toast: '保存失败: ' + r.error.message, refresh: false }
    }
    return { writeLocal: true, toast: '备注已更新', refresh: true }
  }
  window.LinkVaultNotesUpdate = { notesUpdateOutcome: notesUpdateOutcome }
})()
