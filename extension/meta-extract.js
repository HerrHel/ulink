// extension/meta-extract.js — 浏览器扩展页面元数据与 SEO 描述现场提取器
// 无外部依赖，可在页面 DOM 上下文注入运行，也可在 Service Worker / Side Panel / 单元测试中复用。

/**
 * 从 Document 和 Window 中提取页面元数据（OpenGraph、Twitter Card、SEO Meta、选中文本等）
 */
export function extractPageMetadataFromDoc(doc, win) {
  if (!doc) {
    return { title: '', description: '', keywords: '', selection: '', icon: '' }
  }

  function getMeta(sel) {
    try {
      var el = doc.querySelector(sel)
      return el ? (el.getAttribute('content') || '').trim() : ''
    } catch (_) {
      return ''
    }
  }

  // 1. 标题提取：优先 OpenGraph 和 Twitter Card，去噪站长追加的网站后缀
  var ogTitle = getMeta('meta[property="og:title"]')
  var twTitle = getMeta('meta[name="twitter:title"]')
  var docTitle = (doc.title || '').trim()
  var title = ogTitle || twTitle || docTitle

  // 2. 简介与备注提取：优先抓取站长亲笔撰写的 meta description
  var ogDesc = getMeta('meta[property="og:description"]')
  var metaDesc = getMeta('meta[name="description"]')
  var twDesc = getMeta('meta[name="twitter:description"]')
  var rawDesc = ogDesc || metaDesc || twDesc || ''
  // 清洗连续多余空白字符并限制长度（最多 600 字符）
  var description = rawDesc.replace(/\s+/g, ' ').trim()
  if (description.length > 600) {
    description = description.slice(0, 597) + '...'
  }

  // 3. 关键词提取
  var keywords = getMeta('meta[name="keywords"]') || getMeta('meta[property="article:tag"]') || ''

  // 4. 用户当前选中文本
  var selection = ''
  if (win && win.getSelection) {
    try {
      selection = (win.getSelection().toString() || '').trim()
    } catch (_) {}
  }

  // 5. 高清站点图标提取
  var icon = ''
  try {
    var iconEl = doc.querySelector('link[rel="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]')
    if (iconEl && iconEl.href) {
      icon = iconEl.href
    }
  } catch (_) {}

  return {
    title: title,
    description: description,
    keywords: keywords,
    selection: selection,
    icon: icon,
  }
}

/**
 * 注入标签页直接执行的自包含脚本（供 chrome.scripting.executeScript 直接作为 func 传递）
 * 注：不得引用任何外部闭包作用域变量。
 */
export function extractPageMetadataInTab() {
  function getMeta(sel) {
    try {
      var el = document.querySelector(sel)
      return el ? (el.getAttribute('content') || '').trim() : ''
    } catch (_) {
      return ''
    }
  }

  var ogTitle = getMeta('meta[property="og:title"]')
  var twTitle = getMeta('meta[name="twitter:title"]')
  var docTitle = (document.title || '').trim()
  var title = ogTitle || twTitle || docTitle

  var ogDesc = getMeta('meta[property="og:description"]')
  var metaDesc = getMeta('meta[name="description"]')
  var twDesc = getMeta('meta[name="twitter:description"]')
  var rawDesc = ogDesc || metaDesc || twDesc || ''
  var description = rawDesc.replace(/\s+/g, ' ').trim()
  if (description.length > 600) {
    description = description.slice(0, 597) + '...'
  }

  var keywords = getMeta('meta[name="keywords"]') || getMeta('meta[property="article:tag"]') || ''

  var selection = ''
  try {
    selection = (window.getSelection ? window.getSelection().toString() : '') || ''
    selection = selection.trim()
  } catch (_) {}

  var icon = ''
  try {
    var iconEl = document.querySelector('link[rel="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]')
    if (iconEl && iconEl.href) {
      icon = iconEl.href
    }
  } catch (_) {}

  return {
    title: title,
    description: description,
    keywords: keywords,
    selection: selection,
    icon: icon,
  }
}

/**
 * 根据提取到的元数据，智能预选用户现有的最匹配分类 ID
 * @param {object} meta extractPageMetadata 返回的对象
 * @param {Array<{ id: string, name: string }>} categories 用户已有的分类列表
 * @returns {string|null} 匹配到的已有分类 ID，无匹配返回 null
 */
export function matchCategoryByKeywords(meta, categories) {
  if (!meta || !categories || !categories.length) return null

  var textToScan = [meta.title || '', meta.description || '', meta.keywords || ''].join(' ').toLowerCase()
  if (!textToScan.trim()) return null

  // 常用技术与日常领域的通用分类词根映射
  var SYNONYMS = {
    '开发': ['开发', '编程', '代码', '前端', '后端', 'api', 'dev', 'code', 'github', 'software', 'engineering'],
    '技术': ['开发', '编程', '代码', '技术', 'tech', 'technology'],
    '设计': ['设计', 'ui', 'ux', '原型', '矢量', '灵感', 'design', 'figma', 'dribbble', 'color'],
    '工具': ['工具', '效率', '实用', '生成器', '转换器', 'tool', 'utility', 'converter', 'calculator'],
    'AI': ['ai', '大模型', '语言模型', '人工智能', 'gpt', 'chatgpt', 'llm', 'prompt', 'deepseek', 'claude'],
    '阅读': ['文章', '阅读', '博客', '资讯', '新闻', 'read', 'article', 'news', 'blog'],
    '社区': ['社区', '论坛', '问答', '讨论', 'community', 'forum', 'v2ex', 'reddit', 'zhihu'],
    '娱乐': ['视频', '音乐', '影视', '影音', '游戏', 'media', 'video', 'music', 'game'],
  }

  function containsTerm(text, term) {
    if (!text || !term) return false
    var t = term.toLowerCase().trim()
    if (!t) return false
    if (/^[a-zA-Z0-9_\-]+$/.test(t)) {
      var re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
      return re.test(text)
    }
    return text.indexOf(t) !== -1
  }

  // 1. 优先完全包含分类名自身
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i]
    if (!cat || !cat.name || cat.id === 'all' || cat.id === 'uncategorized') continue
    if (containsTerm(textToScan, cat.name)) {
      return cat.id
    }
  }

  // 2. 次选同义词碰撞
  for (var j = 0; j < categories.length; j++) {
    var c = categories[j]
    if (!c || !c.name || c.id === 'all' || c.id === 'uncategorized') continue
    var cName = c.name.trim()
    var terms = SYNONYMS[cName]
    if (terms) {
      for (var t = 0; t < terms.length; t++) {
        if (containsTerm(textToScan, terms[t])) {
          return c.id
        }
      }
    }
  }

  return null
}

// 供浏览器传统 script 标签（如 sidepanel.html）挂载全局
if (typeof window !== 'undefined') {
  window.LinkVaultMetaExtract = {
    extractPageMetadataFromDoc: extractPageMetadataFromDoc,
    extractPageMetadataInTab: extractPageMetadataInTab,
    matchCategoryByKeywords: matchCategoryByKeywords,
  }
}
