/**
 * universalUrlInference.ts — 全通用 URL 模式解构与自然语言语义推理算法引擎
 *
 * 核心目标：
 * 彻底消灭机械公式化模板（如千篇一律的 "xxx 官方网站与在线平台服务"）。
 * 依靠领域原型本体、形态学词根意图分析、通用架构子域与路径解构，无论面对全网任何未知域名、
 * 生僻博客、知名大站还是垂直工具，均能稳定输出极具辨识度的高水准标题、生动通顺的真实业务描述与精准分类。
 */

import type { Category, CustomAttribute } from '../../types.js'
import { extractBrandFromHostname } from './smartPrefill.js'
import { CATEGORY_SYNONYMS } from './knowledge.js'

export interface UniversalInferenceResult {
  title: string
  notes: string
  categoryKeyword: string
  suggestedCategoryId?: string
  suggestedAttrIds: string[]
  isSearchEngine?: boolean
}

/** 常见子域名功能特征图谱（纯通用 Web 架构模式，零特定网站绑定） */
const FUNCTIONAL_SUBDOMAINS: Record<string, { roleZh: string; roleEn: string; cat: string; tag: string }> = {
  docs:      { roleZh: '官方技术文档与指南', roleEn: 'Documentation & Guides', cat: '开发', tag: '文档' },
  doc:       { roleZh: '官方文档中心', roleEn: 'Documentation Center', cat: '开发', tag: '文档' },
  wiki:      { roleZh: '知识库与维基百科', roleEn: 'Wiki & Knowledge Base', cat: '开发', tag: '文档' },
  help:      { roleZh: '帮助与支持中心', roleEn: 'Help & Support', cat: '工具', tag: '帮助' },
  support:   { roleZh: '技术支持与服务门户', roleEn: 'Support Center', cat: '工具', tag: '支持' },
  api:       { roleZh: '开放接口与开发者平台', roleEn: 'API Platform', cat: '开发', tag: '开发' },
  dev:       { roleZh: '开发者技术社区', roleEn: 'Developer Portal', cat: '开发', tag: '开发' },
  developer: { roleZh: '开发者服务中心', roleEn: 'Developer Services', cat: '开发', tag: '开发' },
  blog:      { roleZh: '官方博客与专栏', roleEn: 'Official Blog', cat: '资讯', tag: '博客' },
  news:      { roleZh: '前沿快讯与媒体资讯', roleEn: 'News & Press', cat: '资讯', tag: '资讯' },
  mail:      { roleZh: '电子邮箱收发服务', roleEn: 'Webmail Service', cat: '工具', tag: '常用' },
  email:     { roleZh: '邮箱通讯中心', roleEn: 'Email Platform', cat: '工具', tag: '常用' },
  pan:       { roleZh: '云端网盘与文件存储', roleEn: 'Cloud Drive & Storage', cat: '工具', tag: '云盘' },
  cloud:     { roleZh: '云计算管理控制台', roleEn: 'Cloud Console', cat: '工具', tag: '云服务' },
  drive:     { roleZh: '云端云盘与同步空间', roleEn: 'Cloud Drive', cat: '工具', tag: '云盘' },
  disk:      { roleZh: '网络磁盘存储系统', roleEn: 'Network Storage', cat: '工具', tag: '云盘' },
  store:     { roleZh: '在线官方品牌商城', roleEn: 'Online Store', cat: '购物', tag: '购物' },
  shop:      { roleZh: '在线零售购物商城', roleEn: 'Online Shop', cat: '购物', tag: '购物' },
  mall:      { roleZh: '综合电商购物平台', roleEn: 'Shopping Mall', cat: '购物', tag: '购物' },
  pay:       { roleZh: '安全在线支付中心', roleEn: 'Payment Gateway', cat: '工具', tag: '支付' },
  passport:  { roleZh: '统一通行证身份认证', roleEn: 'Passport & Identity', cat: '工具', tag: '安全' },
  auth:      { roleZh: '安全单点登录门户', roleEn: 'SSO Authentication', cat: '工具', tag: '安全' },
  login:     { roleZh: '统一用户登录入口', roleEn: 'Login Portal', cat: '工具', tag: '登录' },
  admin:     { roleZh: '系统业务管理后台', roleEn: 'Admin Dashboard', cat: '工具', tag: '工作' },
  dashboard: { roleZh: '数据监控与运维看板', roleEn: 'Management Dashboard', cat: '工具', tag: '工作' },
  console:   { roleZh: '综合服务管理控制台', roleEn: 'Service Console', cat: '工具', tag: '工作' },
  forum:     { roleZh: '主题互动交流论坛', roleEn: 'Community Forum', cat: '社区', tag: '讨论' },
  bbs:       { roleZh: '主题讨论社区论坛', roleEn: 'Discussion BBS', cat: '社区', tag: '论坛' },
  community: { roleZh: '用户互动互助社区', roleEn: 'User Community', cat: '社区', tag: '社区' },
  status:    { roleZh: '系统服务实时可用性监控', roleEn: 'System Status Monitor', cat: '工具', tag: '运维' },
  git:       { roleZh: '代码协同与版本托管仓库', roleEn: 'Code Repository', cat: '开发', tag: '代码' },
}

/** 搜索引擎识别集合 */
const SEARCH_ENGINES = new Set([
  'baidu', 'google', 'bing', 'sogou', 'so', 'duckduckgo', 'yahoo', 'yandex', 'ecosia', 'searxng',
])

/** 知名核心词根拼音与专有品牌映射（美化英文拼音主名） */
const BRAND_PHONETICS: Record<string, string> = {
  chaoxing: '超星学习通',
  zhihuishu: '智慧树网',
  icourse163: '中国大学MOOC',
  xuetangx: '学堂在线',
  cnki: '中国知网',
  wanfangdata: '万方数据',
  cqvip: '维普网',
  yuketang: '雨课堂',
  duifene: '对分易',

  '4399': '4399小游戏',
  '163': '网易 163',
  '12306': '铁路 12306',
  '360': '360安全中心',
  douyin: '抖音',
  kuaishou: '快手',
  tiktok: 'TikTok',
  bilibili: '哔哩哔哩',
  baidu: '百度',
  taobao: '淘宝',
  tmall: '天猫',
  jd: '京东',
  pinduoduo: '拼多多',
  meituan: '美团',
  eleme: '饿了么',
  didi: '滴滴出行',
  dewu: '得物',
  zhihu: '知乎',
  weibo: '微博',
  douban: '豆瓣',
  tieba: '百度贴吧',
  xiaohongshu: '小红书',
  youku: '优酷',
  iqiyi: '爱奇艺',
  xueqiu: '雪球',
  xiachufang: '下厨房',
  ctrip: '携程旅行',
  zhipin: 'BOSS直聘',
  dxy: '丁香园',
  fenbi: '粉笔网',
  autohome: '汽车之家',
  dongchedi: '懂车帝',
  feishu: '飞书',
  lark: 'Lark 飞书',
  dingtalk: '钉钉',
  yuque: '语雀',
  flomo: 'flomo 浮墨笔记',
  notion: 'Notion',
  sspai: '少数派',
  '36kr': '36氪',
  ithome: 'IT之家',
  huxiu: '虎嗅网',
  aliyun: '阿里云',
  gitee: 'Gitee 码云',
  csdn: 'CSDN',
  juejin: '稀土掘金',
  oschina: '开源中国',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  deepseek: 'DeepSeek 深度求索',
  kimi: 'Kimi 智能助手',
  doubao: '豆包',
  tongyi: '通义千问',
  qwen: '通义千问 Qwen',
  ernie: '文心一言',
  google: 'Google',
  bing: '必应 Bing',
  github: 'GitHub',
  gitlab: 'GitLab',
  stackoverflow: 'Stack Overflow',
  microsoft: 'Microsoft',
  apple: 'Apple',
  figma: 'Figma',
}

/**
 * 复合词智能切分算法（如 fastgpt -> Fast GPT, mydevblog -> My Dev Blog）
 */
export function formatCompoundBrand(rawBrand: string): string {
  if (!rawBrand) return ''
  const lower = rawBrand.toLowerCase().trim()
  if (BRAND_PHONETICS[lower]) {
    return BRAND_PHONETICS[lower]
  }

  // 连字符或下划线连接的词
  if (lower.includes('-') || lower.includes('_')) {
    return lower
      .split(/[-_]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }

  // 常见英文词根词缀正则切割
  const prefixes = ['my', 'fast', 'easy', 'open', 'quick', 'super', 'smart', 'cloud', 'web', 'dev', 'free']
  const suffixes = ['app', 'hub', 'lab', 'box', 'flow', 'base', 'io', 'ai', 'tech', 'tool', 'tools', 'site', 'net']

  for (const pre of prefixes) {
    if (lower.startsWith(pre) && lower.length > pre.length + 2) {
      const rest = lower.slice(pre.length)
      return pre.charAt(0).toUpperCase() + pre.slice(1) + ' ' + rest.charAt(0).toUpperCase() + rest.slice(1)
    }
  }

  for (const suf of suffixes) {
    if (lower.endsWith(suf) && lower.length > suf.length + 2) {
      const main = lower.slice(0, -suf.length)
      return main.charAt(0).toUpperCase() + main.slice(1) + ' ' + suf.charAt(0).toUpperCase() + suf.slice(1)
    }
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * 通用路径模式解构分析算法
 */
export function analyzePathPattern(pathname: string, search: string): {
  type: string
  subTitleZh?: string
  subTitleEn?: string
  notesHintZh?: string
  notesHintEn?: string
  catKeyword?: string
} {
  const p = (pathname || '').toLowerCase().replace(/\/+$/, '')
  const s = (search || '').toLowerCase()

  // 1. 搜索场景判定
  if (p === '/search' || p === '/s' || p.startsWith('/search/') || p.startsWith('/s/') || s.includes('q=') || s.includes('wd=') || s.includes('keyword=')) {
    return {
      type: 'search',
      subTitleZh: '搜索服务',
      subTitleEn: 'Search',
      notesHintZh: '网络信息检索与内容搜索平台。',
      notesHintEn: 'Web search and information query portal.',
      catKeyword: '工具',
    }
  }

  // 2. 长文与专栏文章场景
  if (p.includes('/article') || p.includes('/post') || p.includes('/p/') || p.includes('/archives/') || p.includes('/news/')) {
    return {
      type: 'article',
      subTitleZh: '专栏文章',
      subTitleEn: 'Article',
      notesHintZh: '精选主题深度专栏文章与知识解读。',
      notesHintEn: 'In-depth reading and technical article.',
      catKeyword: '资讯',
    }
  }

  // 3. 官方技术文档场景
  if (p.includes('/docs') || p.includes('/guide') || p.includes('/wiki') || p.includes('/reference') || p.includes('/manual')) {
    return {
      type: 'docs',
      subTitleZh: '开发指南与文档',
      subTitleEn: 'Documentation',
      notesHintZh: '架构指南、操作手册与官方参考规范。',
      notesHintEn: 'Guides, architecture reference, and official documentation.',
      catKeyword: '开发',
    }
  }

  // 4. 视频播放场景
  if (p.includes('/video') || p.includes('/watch') || p.includes('/v/') || p.includes('/player')) {
    return {
      type: 'video',
      subTitleZh: '在线视频',
      subTitleEn: 'Video',
      notesHintZh: '精彩视频流媒体播放与多媒体内容分享。',
      notesHintEn: 'Video stream and multimedia playback page.',
      catKeyword: '娱乐',
    }
  }

  // 5. 社区问答与 Issue 场景
  if (p.includes('/question') || p.includes('/q/') || p.includes('/issue') || p.includes('/discuss') || p.includes('/topic') || p.includes('/t/')) {
    return {
      type: 'qa',
      subTitleZh: '问答与讨论',
      subTitleEn: 'Q&A Discussion',
      notesHintZh: '技术问答排错与社区互动讨论交流。',
      notesHintEn: 'Community topic discussion and Q&A exchange.',
      catKeyword: '社区',
    }
  }

  // 6. 商品购买与详情场景
  if (p.includes('/item') || p.includes('/product') || p.includes('/goods') || p.includes('/detail')) {
    return {
      type: 'commerce',
      subTitleZh: '商品详情',
      subTitleEn: 'Product Details',
      notesHintZh: '品质商品规格详情与在线购买下单。',
      notesHintEn: 'Online shopping item details and purchase portal.',
      catKeyword: '购物',
    }
  }

  // 7. 用户主页与创作者中心场景
  if (p.includes('/user/') || p.includes('/u/') || p.includes('/profile') || p.includes('/author/')) {
    return {
      type: 'profile',
      subTitleZh: '个人主页',
      subTitleEn: 'User Profile',
      notesHintZh: '创作者个人主页与专属内容发布专栏。',
      notesHintEn: 'Personal profile and user published collection.',
      catKeyword: '社区',
    }
  }

  return { type: 'generic' }
}

/**
 * 面向未知域名的通用词形与行业意图推导算法
 * 从域名词根中提炼业务实质，彻底告别机械模板
 */
function inferLexicalCategory(brand: string): string | null {
  const b = brand.toLowerCase()
  if (
    b.includes('gpt') ||
    b.includes('llm') ||
    b.startsWith('ai') ||
    b.endsWith('ai') ||
    b.endsWith('bot') ||
    b.endsWith('agent') ||
    /(?:^|[-_])(ai|bot|agent)(?:$|[-_0-9])/i.test(b)
  ) {
    return '工具'
  }
  if (/(?:^|[-_])(dev|code|api|git|tech|lab|stack)(?:$|[-_0-9])/i.test(b) || b.endsWith('dev') || b.endsWith('api')) {
    return '开发'
  }
  if (/(?:^|[-_])(shop|store|mall|buy|market)(?:$|[-_0-9])/i.test(b) || b.endsWith('shop') || b.endsWith('mall')) {
    return '购物'
  }
  if (/(?:^|[-_])(blog|news|feed|press|mag|media)(?:$|[-_0-9])/i.test(b) || b.endsWith('blog') || b.endsWith('news')) {
    return '资讯'
  }
  if (/(?:^|[-_])(cloud|pan|drive|box|storage)(?:$|[-_0-9])/i.test(b) || b.endsWith('cloud') || b.endsWith('drive')) {
    return '工具'
  }
  if (/(?:^|[-_])(pay|bank|wallet|finance|coin|crypto)(?:$|[-_0-9])/i.test(b) || b.endsWith('pay')) {
    return '工具'
  }
  if (/(?:^|[-_])(design|art|creative|ui|photo)(?:$|[-_0-9])/i.test(b)) {
    return '设计'
  }
  if (/(?:^|[-_])(game|play)(?:$|[-_0-9])/i.test(b)) {
    return '娱乐'
  }
  return null
}

/**
 * 全通用 URL 语义推理算法入口
 */
export function inferUrlSemantics(
  rawUrl: string,
  categories: Category[] = [],
  customAttributes: CustomAttribute[] = [],
  isZh = true
): UniversalInferenceResult {
  let urlObj: URL
  try {
    const cleanUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`
    urlObj = new URL(cleanUrl)
  } catch {
    return {
      title: rawUrl,
      notes: isZh ? '网络收藏书签。' : 'Bookmarked web resource.',
      categoryKeyword: '工具',
      suggestedAttrIds: [],
    }
  }

  const hostname = urlObj.hostname.toLowerCase().replace(/^www\./i, '')
  const { brand, sub } = extractBrandFromHostname(hostname)
  const brandLower = brand.toLowerCase()
  const formattedBrand = BRAND_PHONETICS[brandLower] || formatCompoundBrand(brand)

  const pathInfo = analyzePathPattern(urlObj.pathname, urlObj.search)
  const subFunc = sub && FUNCTIONAL_SUBDOMAINS[sub] ? FUNCTIONAL_SUBDOMAINS[sub] : null
  const isSearchEngineDomain = SEARCH_ENGINES.has(brandLower)

  // 1. 结构化构建标题（Layer 1 0ms 纯算法保底标题）
  let finalTitle = ''
  if (isSearchEngineDomain && pathInfo.type === 'search') {
    finalTitle = isZh ? `${formattedBrand} 搜索服务` : `${formattedBrand} Search`
  } else if (pathInfo.subTitleZh) {
    finalTitle = isZh ? `${formattedBrand} ${pathInfo.subTitleZh}` : `${formattedBrand} ${pathInfo.subTitleEn}`
  } else if (subFunc) {
    finalTitle = isZh ? `${formattedBrand} ${subFunc.roleZh}` : `${formattedBrand} ${subFunc.roleEn}`
  } else {
    finalTitle = formattedBrand
  }

  // 2. 本地 0ms 阶段备注处理：
  // 仅在明确命中特定路径类型时给出路径简述（如 /docs 或 /article）；
  // 首页与根域名严格留空，杜绝任何“xxx 官方网站与在线平台服务”这类机械虚假模板套话，
  // 真正丰富的正文描述交由 Layer 2 真实网页抓取自动回填。
  let finalNotes = ''
  if (pathInfo.notesHintZh) {
    finalNotes = isZh ? `${formattedBrand} ${pathInfo.notesHintZh}` : `${pathInfo.notesHintEn} on ${formattedBrand}`
  } else if (subFunc) {
    finalNotes = isZh ? `${formattedBrand} ${subFunc.roleZh}` : `${subFunc.roleEn} on ${formattedBrand}`
  }

  // 3. 推导核心分类关键词
  let catKeyword = '工具'
  if (isSearchEngineDomain) {
    catKeyword = '工具'
  } else if (pathInfo.catKeyword) {
    catKeyword = pathInfo.catKeyword
  } else if (subFunc?.cat) {
    catKeyword = subFunc.cat
  } else {
    const lexCat = inferLexicalCategory(brand)
    if (lexCat) catKeyword = lexCat
  }

  // 4. 模糊匹配用户现有分类体系
  let suggestedCategoryId: string | undefined
  const activeCats = categories.filter(c => !c.deletedAt && c.id !== 'all' && c.id !== 'uncategorized')
  if (activeCats.length > 0) {
    const synonyms = CATEGORY_SYNONYMS[catKeyword] || [catKeyword.toLowerCase()]
    for (const cat of activeCats) {
      const cn = cat.name.toLowerCase()
      if (cn.includes(catKeyword.toLowerCase()) || synonyms.some(s => cn.includes(s) || s.includes(cn))) {
        suggestedCategoryId = cat.id
        break
      }
    }
  }

  // 5. 推荐匹配属性标签
  const suggestedAttrIds: string[] = []
  const expectedTags = ['常用']
  if (subFunc?.tag) expectedTags.push(subFunc.tag)
  if (pathInfo.type === 'docs') expectedTags.push('文档')
  if (pathInfo.type === 'article') expectedTags.push('文章')

  const activeAttrs = customAttributes.filter(a => !a.deletedAt)
  for (const attr of activeAttrs) {
    const an = attr.name.toLowerCase()
    if (expectedTags.some(t => an.includes(t.toLowerCase()) || t.toLowerCase().includes(an))) {
      if (!suggestedAttrIds.includes(attr.id)) {
        suggestedAttrIds.push(attr.id)
      }
    }
  }

  return {
    title: finalTitle,
    notes: finalNotes,
    categoryKeyword: catKeyword,
    suggestedCategoryId,
    suggestedAttrIds,
    isSearchEngine: isSearchEngineDomain || pathInfo.type === 'search',
  }
}
