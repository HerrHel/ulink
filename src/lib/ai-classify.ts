/**
 * ai-classify.ts — 本地分类建议
 * 基于关键词匹配的轻量分类器，为收藏的书签自动建议分类和属性标签。
 * 后续可替换为 Transformers.js 本地模型。
 */
import type { Category } from '../types.js'

// ── 域名 → 分类关键词映射 ──
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  '开发': ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'dev.to', 'npmjs.com', 'pypi.org', 'crates.io', 'hub.docker.com', 'vercel.com', 'netlify.com', 'heroku.com', 'railway.app', 'digitalocean.com', 'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com', 'developer.mozilla.org', 'w3schools.com', 'freecodecamp.org', 'codepen.io', 'jsfiddle.net', 'replit.com', 'codesandbox.io'],
  '设计': ['figma.com', 'dribbble.com', 'behance.net', 'canva.com', 'adobe.com', 'sketch.com', 'invisionapp.com', 'zeplin.io', 'coolors.co', 'colorhunt.co'],
  '社交': ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'discord.com', 'telegram.org', 'web.telegram.org', 'mastodon.social', 'threads.net', 'xiaohongshu.com', 'weibo.com', 'douban.com', 'zhihu.com'],
  '视频': ['youtube.com', 'youtu.be', 'bilibili.com', 'vimeo.com', 'twitch.tv', 'netflix.com', 'disneyplus.com', 'iqiyi.com', 'youku.com'],
  '音乐': ['spotify.com', 'music.apple.com', 'soundcloud.com', 'music.163.com', 'y.qq.com', 'bandcamp.com'],
  '新闻': ['news.ycombinator.com', 'medium.com', 'bbc.com', 'cnn.com', 'reuters.com', 'theverge.com', 'techcrunch.com', 'arstechnica.com', 'wired.com', '36kr.com', 'sspai.com'],
  '购物': ['amazon.com', 'amazon.cn', 'taobao.com', 'jd.com', 'pinduoduo.com', 'ebay.com', 'walmart.com', 'target.com', 'suning.com'],
  '工具': ['notion.so', 'trello.com', 'asana.com', 'slack.com', 'zoom.us', 'docs.google.com', 'airtable.com', 'miro.com', 'excalidraw.com', 'whimsical.com', 'grammarly.com', 'deepl.com', 'translate.google.com'],
  '文档': ['docs.', 'wiki.', 'readthedocs.io', 'gitbook.io', 'confluence.', 'atlassian.com'],
  'AI': ['openai.com', 'chat.openai.com', 'claude.ai', 'anthropic.com', 'huggingface.co', 'midjourney.com', 'stability.ai', 'bard.google.com', 'gemini.google.com', 'poe.com', 'perplexity.ai'],
}

// ── 标题关键词 → 分类映射 ──
// M9：短英文词（ai/ui/git/api/code 等）用词边界匹配，避免 email/digital/capital 误命中
const TITLE_KEYWORDS: Record<string, string[]> = {
  '开发': ['github', 'gitlab', 'stackoverflow', '代码', '编程', '开发', 'api', 'sdk', '文档', 'developer', 'code', 'programming', 'frontend', 'backend', 'react', 'vue', 'angular', 'node', 'python', 'java', 'rust', 'golang', 'typescript', 'javascript', 'css', 'html', 'webpack', 'vite', 'docker', 'kubernetes', 'linux', 'git', 'npm', 'yarn', 'pnpm'],
  '设计': ['设计', 'design', 'figma', 'sketch', 'ui', 'ux', '图标', 'icon', 'illustration', '插画', '配色', '字体', 'font'],
  '社交': ['微博', '推特', 'twitter', 'facebook', 'instagram', 'linkedin', 'reddit', '社交', '社区', '论坛', 'forum'],
  '视频': ['视频', 'video', 'youtube', 'bilibili', '哔哩哔哩', '电影', 'movie', '剧集', '直播', 'live'],
  '音乐': ['音乐', 'music', '歌单', 'playlist', '播客', 'podcast'],
  '新闻': ['新闻', 'news', '资讯', '头条', '日报', 'daily', '周报', 'weekly'],
  '购物': ['购物', 'shopping', '商城', '商店', 'store', '优惠', '折扣', 'coupon'],
  '工具': ['工具', 'tool', '效率', 'productivity', '笔记', 'note', 'todo', '待办', '日程', 'calendar', '协作', 'collaborate'],
  'AI': ['ai', '人工智能', '机器学习', 'machine learning', '深度学习', 'deep learning', '大模型', 'llm', 'chatgpt', 'gpt', 'transformer', 'diffusion', 'stable diffusion', 'midjourney'],
  '学习': ['教程', 'tutorial', '课程', 'course', '学习', 'learn', '入门', '指南', 'guide', 'book', '书', '电子书'],
  '游戏': ['游戏', 'game', 'steam', 'epic', 'playstation', 'xbox', 'nintendo', 'switch'],
}

/** 纯 ASCII 短词：按词边界匹配；中文/多词短语仍用 includes */
function titleHasKeyword(titleLower: string, kw: string): boolean {
  if (/^[a-z0-9.+#-]{1,12}$/i.test(kw)) {
    const re = new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[.+#-]/g, '\\$&')}(?=[^a-z0-9]|$)`, 'i')
    return re.test(titleLower)
  }
  return titleLower.includes(kw)
}

// ── 属性关键词映射 ──
const ATTR_KEYWORDS: Record<string, { domains: string[]; titles: string[] }> = {
  '常用': {
    domains: ['github.com', 'google.com', 'stackoverflow.com', 'youtube.com', 'chat.openai.com', 'claude.ai'],
    titles: ['常用', '每日', 'daily', '必读'],
  },
  '工作': {
    domains: ['slack.com', 'zoom.us', 'notion.so', 'trello.com', 'asana.com', 'jira.', 'confluence.', 'docs.google.com', 'airtable.com'],
    titles: ['工作', 'work', '项目', 'project', '会议', 'meeting', '日报', '周报'],
  },
  '学习': {
    domains: ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'freecodecamp.org', 'codecademy.com', 'leetcode.com', 'duolingo.com'],
    titles: ['学习', 'learn', '教程', 'tutorial', '课程', 'course', '入门', '指南'],
  },
  '临时': {
    domains: ['pastebin.com', 'gist.github.com', 'hastebin.com', 'rentry.co'],
    titles: ['临时', 'temp', '草稿', 'draft', '测试', 'test'],
  },
}

/**
 * 根据 URL 和标题建议分类
 * 返回最匹配的分类 ID，无匹配返回 null
 */
export function suggestCategory(
  url: string,
  title: string,
  categories: Category[],
): string | null {
  if (!url && !title) return null
  const urlLower = (url || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const scores = new Map<string, number>()

  // 域名匹配（权重高）
  for (const [catName, domains] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const d of domains) {
      if (urlLower.includes(d)) {
        scores.set(catName, (scores.get(catName) || 0) + 3)
        break
      }
    }
  }

  // 标题关键词匹配（M9：短英文词边界）
  for (const [catName, keywords] of Object.entries(TITLE_KEYWORDS)) {
    for (const kw of keywords) {
      if (titleHasKeyword(titleLower, kw)) {
        scores.set(catName, (scores.get(catName) || 0) + 1)
      }
    }
  }

  if (scores.size === 0) return null

  // 找得分最高的分类名
  let bestName = ''
  let bestScore = 0
  for (const [name, score] of scores) {
    if (score > bestScore) { bestScore = score; bestName = name }
  }

  // 匹配到已有分类
  const cat = categories.find(c => c.name === bestName)
  return cat?.id || null
}

/**
 * 根据 URL 和标题建议属性标签
 * 返回建议勾选的属性 ID 数组
 */
export function suggestAttributes(
  url: string,
  title: string,
  customAttributes: { id: string; name: string }[],
): string[] {
  if (!url && !title) return []
  const urlLower = (url || '').toLowerCase()
  const titleLower = (title || '').toLowerCase()
  const suggested: string[] = []

  for (const attr of customAttributes) {
    const rules = ATTR_KEYWORDS[attr.name]
    if (!rules) continue
    const domainHit = rules.domains.some(d => urlLower.includes(d))
    const titleHit = rules.titles.some(t => titleHasKeyword(titleLower, t))
    if (domainHit || titleHit) suggested.push(attr.id)
  }

  return suggested
}
