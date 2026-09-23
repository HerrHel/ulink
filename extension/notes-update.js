// extension/notes-update.js — 备注更新结果决策与净化展示纯函数（无 chrome.* / DOM 依赖，可被 vitest 测）。
(function () {
  function notesUpdateOutcome(newNotes, r) {
    if (r && r.error) {
      return { writeLocal: false, toast: '保存失败: ' + r.error.message, refresh: false }
    }
    return { writeLocal: true, toast: '备注已更新', refresh: true }
  }

  function isThreePartCipher(s) {
    if (typeof s !== 'string' || !s) return false
    var parts = s.split('.')
    if (parts.length !== 3) return false
    var salt = parts[0], iv = parts[1], data = parts[2]
    if (!salt || !iv || !data) return false
    if (salt.length !== 44 || iv.length !== 16 || data.length < 24) return false
    var b64 = /^[A-Za-z0-9+/]+={0,2}$/
    return b64.test(salt) && b64.test(iv) && b64.test(data)
  }

  function formatNotesForDisplay(raw) {
    if (!raw || typeof raw !== 'string') return ''
    var str = raw.trim()
    if (!str) return ''
    if (isThreePartCipher(str)) return ''
    // 若含有 HTML 标签（兼容 TipTap 或网页富文本存储格式）
    if (/<[a-z][\s\S]*>/i.test(str)) {
      str = str.replace(/<br\s*\/?>/gi, '\n')
      str = str.replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      str = str.replace(/<[^>]+>/g, '')
      str = str.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    }
    // 规整换行与连续多余空行
    return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  const api = {
    isThreePartCipher: isThreePartCipher,
    notesUpdateOutcome: notesUpdateOutcome,
    formatNotesForDisplay: formatNotesForDisplay,
  }

  if (typeof window !== 'undefined') {
    window.LinkVaultNotesUpdate = api
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.LinkVaultNotesUpdate = api
  }
})()

