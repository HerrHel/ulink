// extension/sidepanel-match.js — 扩展侧边栏书签匹配、层级与主站备注纯函数（可被 vitest 测）
(function () {
  'use strict'

  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return ''
    return url.trim().replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
  }

  function extractDomain(url) {
    if (!url || typeof url !== 'string') return ''
    try {
      var u = new URL(url.startsWith('http') ? url : 'https://' + url)
      var host = (u.hostname || '').replace(/^www\./, '').toLowerCase()
      if (host !== 'localhost' && host.indexOf('.') === -1) {
        return ''
      }
      return host
    } catch (_) {
      return ''
    }
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

  function getNotesPreviewText(notes, maxLen) {
    if (!notes || typeof notes !== 'string') return ''
    if (isThreePartCipher(notes)) return ''
    var len = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 90
    var str = notes.trim()
    if (!str) return ''
    // 移除 HTML 标签与实体转换
    if (/<[a-z][\s\S]*>/i.test(str)) {
      str = str.replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    }
    var clean = str.replace(/\s+/g, ' ').trim()
    if (!clean) return ''
    return clean.length > len ? clean.slice(0, len) + '…' : clean
  }

  /**
   * 查找书签匹配：优先精准绝对 URL 匹配；若无，查找同域顶级书签（主站）
   */
  function findBookmarkMatch(bookmarks, currentUrl) {
    if (!currentUrl || !bookmarks || !bookmarks.length) {
      return { exactMatch: null, domainParent: null }
    }
    var normUrl = normalizeUrl(currentUrl)
    var curDomain = extractDomain(currentUrl)

    var exactMatch = null
    var domainParent = null

    for (var i = 0; i < bookmarks.length; i++) {
      var b = bookmarks[i]
      if (b.deleted_at) continue
      var bNorm = normalizeUrl(b.url)
      if (bNorm === normUrl) {
        exactMatch = b
        break
      }
    }

    if (curDomain) {
      for (var j = 0; j < bookmarks.length; j++) {
        var bm = bookmarks[j]
        if (bm.deleted_at) continue
        // 仅匹配独立主站（非子书签）
        if (bm.parent_id) continue
        var bDomain = extractDomain(bm.url)
        if (bDomain && (bDomain === curDomain || curDomain.endsWith('.' + bDomain) || bDomain.endsWith('.' + curDomain))) {
          domainParent = bm
          break
        }
      }
    }

    return {
      exactMatch: exactMatch,
      domainParent: domainParent,
    }
  }

  /**
   * 解析站点层级信息：提取主站对象、主站备注、本页备注、所有子书签
   */
  function resolveSiteHierarchy(bookmarks, matchedBm, currentUrl) {
    var bms = bookmarks || []

    if (matchedBm) {
      if (matchedBm.parent_id) {
        var parentBm = bms.find(function (p) { return p.id === matchedBm.parent_id && !p.deleted_at }) || null
        var siblings = bms.filter(function (s) { return s.parent_id === matchedBm.parent_id && !s.deleted_at })
        return {
          isSub: true,
          isDomainMatched: false,
          matchedBm: matchedBm,
          parentBm: parentBm,
          mainSiteTitle: parentBm ? (parentBm.title || extractDomain(parentBm.url)) : '',
          mainSiteNotes: parentBm ? (parentBm.notes || '') : '',
          pageNotes: matchedBm.notes || '',
          subBookmarks: siblings,
          effectivePasswordBm: matchedBm.password ? matchedBm : (parentBm && parentBm.password ? parentBm : null),
        }
      } else {
        var children = bms.filter(function (s) { return s.parent_id === matchedBm.id && !s.deleted_at })
        return {
          isSub: false,
          isDomainMatched: false,
          matchedBm: matchedBm,
          parentBm: null,
          mainSiteTitle: matchedBm.title || extractDomain(matchedBm.url),
          mainSiteNotes: matchedBm.notes || '',
          pageNotes: '',
          subBookmarks: children,
          effectivePasswordBm: matchedBm,
        }
      }
    }

    // 未精准匹配，检查是否属于某个已收藏的主站域名
    var matchRes = findBookmarkMatch(bms, currentUrl)
    var domParent = matchRes.domainParent
    if (domParent) {
      var domChildren = bms.filter(function (s) { return s.parent_id === domParent.id && !s.deleted_at })
      return {
        isSub: false,
        isDomainMatched: true,
        matchedBm: null,
        parentBm: domParent,
        mainSiteTitle: domParent.title || extractDomain(domParent.url),
        mainSiteNotes: domParent.notes || '',
        pageNotes: '',
        subBookmarks: domChildren,
        effectivePasswordBm: domParent,
      }
    }

    return {
      isSub: false,
      isDomainMatched: false,
      matchedBm: null,
      parentBm: null,
      mainSiteTitle: '',
      mainSiteNotes: '',
      pageNotes: '',
      subBookmarks: [],
      effectivePasswordBm: null,
    }
  }

  /**
   * 过滤书签库根书签列表（子书签绝对不作为独立根书签返回）
   */
  function filterRootBookmarks(bookmarks, categoryId, searchQuery) {
    if (!bookmarks || !bookmarks.length) return []
    var bms = bookmarks.filter(function (b) { return !b.deleted_at })

    // 核心铁律：主列表只显示顶层独立书签
    var rootBookmarks = bms.filter(function (b) {
      return !b.parent_id || b.parent_id === ''
    })

    if (categoryId && categoryId !== 'all') {
      rootBookmarks = rootBookmarks.filter(function (b) {
        var c = b.category_id || 'uncategorized'
        return c === categoryId
      })
    }

    if (!searchQuery || !searchQuery.trim()) {
      return rootBookmarks
    }

    var q = searchQuery.trim().toLowerCase()
    return rootBookmarks.filter(function (rootBm) {
      // 1. 根书签自身命中
      var rootTitle = isThreePartCipher(rootBm.title) ? '' : (rootBm.title || '').toLowerCase()
      var rootUrl = isThreePartCipher(rootBm.url) ? '' : (rootBm.url || '').toLowerCase()
      var rootHost = extractDomain(rootBm.url)
      var rootNotes = isThreePartCipher(rootBm.notes) ? '' : (rootBm.notes || '').toLowerCase()
      if (rootTitle.indexOf(q) !== -1 || rootUrl.indexOf(q) !== -1 || rootHost.indexOf(q) !== -1 || rootNotes.indexOf(q) !== -1) {
        return true
      }
      // 2. 或者其任一子书签命中
      var subs = bms.filter(function (s) { return s.parent_id === rootBm.id })
      for (var i = 0; i < subs.length; i++) {
        var sub = subs[i]
        var sTitle = isThreePartCipher(sub.title) ? '' : (sub.title || '').toLowerCase()
        var sUrl = isThreePartCipher(sub.url) ? '' : (sub.url || '').toLowerCase()
        var sHost = extractDomain(sub.url)
        var sNotes = isThreePartCipher(sub.notes) ? '' : (sub.notes || '').toLowerCase()
        if (sTitle.indexOf(q) !== -1 || sUrl.indexOf(q) !== -1 || sHost.indexOf(q) !== -1 || sNotes.indexOf(q) !== -1) {
          return true
        }
      }
      return false
    })
  }

  var api = {
    isThreePartCipher: isThreePartCipher,
    normalizeUrl: normalizeUrl,
    extractDomain: extractDomain,
    getNotesPreviewText: getNotesPreviewText,
    findBookmarkMatch: findBookmarkMatch,
    resolveSiteHierarchy: resolveSiteHierarchy,
    filterRootBookmarks: filterRootBookmarks,
  }

  if (typeof window !== 'undefined') {
    window.LinkVaultSidepanelMatch = api
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.LinkVaultSidepanelMatch = api
  }
})()
