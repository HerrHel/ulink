// extension/save-payload.js — 扩展保存载荷构建与查重纯函数（可被 vitest 测）
(function () {
  'use strict'

  function isSafeHttpUrl(url) {
    if (!url || typeof url !== 'string') return false
    try {
      var u = new URL(url.trim())
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch (_) {
      return false
    }
  }

  function extractHostname(url) {
    if (!url) return ''
    try {
      var u = new URL(url.startsWith('http') ? url : 'https://' + url)
      return u.hostname || ''
    } catch (_) {
      return ''
    }
  }

  function normalizeUrlForMatch(url) {
    if (!url || typeof url !== 'string') return ''
    return url.trim().replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
  }

  function newBookmarkId(uniqHint) {
    var ts = Date.now().toString(36)
    var rand = Math.random().toString(36).slice(2, 8)
    var hint = uniqHint == null ? '' : String(uniqHint)
    return 'b' + ts + rand + hint
  }

  function nextBookmarkOrder(existingBookmarks) {
    if (!existingBookmarks || !existingBookmarks.length) return 1
    var max = 0
    for (var i = 0; i < existingBookmarks.length; i++) {
      var o = existingBookmarks[i].order || 0
      if (o > max) max = o
    }
    return max + 1
  }

  function buildBookmarkPayload(params) {
    var rawUrl = (params && params.url) || ''
    if (!isSafeHttpUrl(rawUrl)) {
      throw new Error('UNSAFE_OR_INVALID_URL')
    }

    var host = extractHostname(rawUrl)
    var title = (params.title && String(params.title).trim()) || host || 'Untitled'
    var url = rawUrl.trim()
    var categoryId = (params.categoryId && String(params.categoryId).trim()) || 'uncategorized'
    var notes = (params.notes && String(params.notes).trim()) || ''
    var icon = (params.favIconUrl && String(params.favIconUrl).trim()) || (host ? 'https://www.google.com/s2/favicons?domain=' + host + '&sz=32' : '')
    var userId = params.userId || ''
    var now = Date.now()
    var order = nextBookmarkOrder(params.existingBookmarks)
    var id = params.id || newBookmarkId()

    return {
      id: id,
      user_id: userId,
      title: title,
      url: url,
      username: '',
      password: '""',
      notes: notes,
      icon: icon,
      category_id: categoryId,
      parent_id: null,
      order: order,
      use_count: 0,
      attributes: {},
      created_at_num: now,
      updated_at_num: now,
      pinned_at: null,
      deleted_at: null,
    }
  }

  const api = {
    isSafeHttpUrl: isSafeHttpUrl,
    extractHostname: extractHostname,
    normalizeUrlForMatch: normalizeUrlForMatch,
    newBookmarkId: newBookmarkId,
    nextBookmarkOrder: nextBookmarkOrder,
    buildBookmarkPayload: buildBookmarkPayload,
  }

  if (typeof window !== 'undefined') {
    window.LinkVaultSavePayload = api
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.LinkVaultSavePayload = api
  }
})()
