/**
 * semanticSearch.ts — 本地自然语言意图与语义检索引擎
 * 让用户通过自然语言（如：“找做流程图的”、“AI生图工具”、“前端状态管理”）
 * 快速召回相关书签，无需精准记住名称或拼写。
 * 纯本地计算，零延迟，零隐私泄漏。
 */

import type { Bookmark, SiblingGroup } from '../../types.js'
import { domain } from '../../utils.js'
import { isThreePartCipher } from '../../crypto.js'

function _plain(v?: string): string {
  if (!v) return ''
  return isThreePartCipher(v) ? '' : v
}

export interface SemanticMatch {
  id: string
  title: string
  url: string
  notes?: string
  icon?: string
  categoryId?: string
  isGroup: boolean
  score: number
  matchedConcept: string
  reason: string
}

interface ConceptCluster {
  name: string
  keywords: string[]
  relatedTerms: string[]
  domains: string[]
}

/**
 * 语义概念网络拓扑
 */
const CONCEPT_ONTOLOGY: ConceptCluster[] = [
  {
    name: '流程图与架构白板',
    keywords: ['流程图', '架构图', '白板', '思维导图', '拓扑图', '关系图', 'uml', '时序图', '画图', '制图', '草图'],
    relatedTerms: ['flowchart', 'diagram', 'whiteboard', 'mindmap', 'draw', 'sketch', 'graph'],
    domains: ['excalidraw.com', 'tldraw.com', 'processon.com', 'draw.io', 'diagrams.net', 'eraser.io', 'gitmind.cn', 'xmind.app'],
  },
  {
    name: 'AI 图像与创意生成',
    keywords: ['ai生图', 'ai绘图', '文生图', '图生图', '绘画模型', '图像生成', '画画', '插画生成', 'lora'],
    relatedTerms: ['midjourney', 'stable diffusion', 'diffusion', 'civitai', 'dalle', 'flux', 'comfyu', 'leonardo', 'liblib', 'image generation'],
    domains: ['midjourney.com', 'civitai.com', 'stability.ai', 'leonardo.ai', 'liblib.art'],
  },
  {
    name: 'AI 语言模型与对话',
    keywords: ['ai对话', '大模型', '语言模型', '智能助手', '问答机器人', '提示词', 'ai搜索', '长文本分析'],
    relatedTerms: ['chatgpt', 'claude', 'deepseek', 'gemini', 'kimi', 'perplexity', 'doubao', 'openai', 'anthropic', 'ollama', 'llm'],
    domains: ['chatgpt.com', 'claude.ai', 'deepseek.com', 'perplexity.ai', 'gemini.google.com', 'kimi.moonshot.cn', 'doubao.com'],
  },
  {
    name: 'AI 辅助编程',
    keywords: ['ai编程', '编程ai', '代码生成', 'ai补全', 'ai写代码', '写代码', '自动代码', '代码编辑器', '编程助手'],
    relatedTerms: ['cursor', 'copilot', 'v0', 'bolt', 'windsurf', 'cline', 'code generation'],
    domains: ['cursor.com', 'v0.dev', 'github.com/features/copilot', 'bolt.new'],
  },
  {
    name: '前端开发与状态管理',
    keywords: ['前端', '组件库', '状态管理', '界面开发', '打包构建', '单页应用'],
    relatedTerms: ['vue', 'react', 'pinia', 'redux', 'zustand', 'vite', 'tailwind', 'nextjs', 'nuxt', 'svelte', 'typescript', 'css'],
    domains: ['vuejs.org', 'react.dev', 'pinia.vuejs.org', 'tailwindcss.com', 'vite.dev', 'nextjs.org'],
  },
  {
    name: '后端、接口与数据库',
    keywords: ['后端', '接口', '数据库', '微服务', '服务端', 'orm', '缓存', 'api调试'],
    relatedTerms: ['api', 'postman', 'hoppscotch', 'apifox', 'supabase', 'prisma', 'docker', 'postgresql', 'mysql', 'redis', 'node', 'python', 'golang'],
    domains: ['supabase.com', 'postman.com', 'hoppscotch.io', 'apifox.com', 'docker.com'],
  },
  {
    name: 'UI/UX 界面原型设计',
    keywords: ['ui设计', '交互原型', '切图', '设计系统', '设计规范', '高保真原型', '配色', '图标库', '矢量图'],
    relatedTerms: ['figma', 'sketch', 'framer', 'mastergo', 'jsdesign', 'penpot', 'iconify', 'coolors', 'dribbble', 'behance', 'mobbin', 'design'],
    domains: ['figma.com', 'framer.com', 'mastergo.com', 'iconify.design', 'coolors.co', 'dribbble.com', 'behance.net', 'mobbin.com'],
  },
  {
    name: '笔记、文档与知识管理',
    keywords: ['笔记', '知识库', '双链笔记', '个人维基', '写作', '文档', '备忘', '闪念', '卡片盒'],
    relatedTerms: ['notion', 'obsidian', 'logseq', 'wolai', '语雀', '飞书', 'flomo', 'craft', 'flowus', 'markdown', 'wiki', 'notes'],
    domains: ['notion.so', 'obsidian.md', 'feishu.cn', 'yuque.com', 'flomoapp.com', 'craft.do'],
  },
  {
    name: '流媒体与视频娱乐',
    keywords: ['看视频', '看剧', '影视', '视频教程', '弹幕', '录屏', '剪辑', '追剧'],
    relatedTerms: ['bilibili', 'youtube', 'netflix', 'b站', '油管', 'capcut', '剪映', 'video'],
    domains: ['bilibili.com', 'youtube.com', 'netflix.com'],
  },
  {
    name: '音乐、音频与播客',
    keywords: ['听歌', '音乐', '播客', '音效', '背景音', '白噪音', '电台'],
    relatedTerms: ['music', 'podcast', 'audio', 'spotify', '网易云', 'qq音乐', '喜马拉雅', 'sound'],
    domains: ['spotify.com', 'music.163.com', 'y.qq.com', 'xiaoyuzhoufm.com'],
  },
  {
    name: '开发者社区与技术论坛',
    keywords: ['技术论坛', '开发者社区', '极客讨论', '问答', '博客', '技术分享'],
    relatedTerms: ['v2ex', 'zhihu', 'juejin', 'stackoverflow', 'reddit', 'github', '掘金', '知乎', 'community'],
    domains: ['v2ex.com', 'zhihu.com', 'juejin.cn', 'stackoverflow.com', 'reddit.com'],
  },
  {
    name: '部署、运维与云服务',
    keywords: ['部署', '云服务器', '域名解析', '反向代理', '边缘计算', '免备案建站', '自动化流水线'],
    relatedTerms: ['vercel', 'cloudflare', 'netlify', 'railway', 'aliyun', 'aws', 'docker', 'devops', 'hosting'],
    domains: ['vercel.com', 'cloudflare.com', 'netlify.com', 'railway.app'],
  },
  {
    name: '实用工具箱与在线转换',
    keywords: ['工具箱', '格式转换', '计算器', '压缩', '正则', 'base64', 'json格式化', 'pdf工具', '时间戳'],
    relatedTerms: ['tool', 'utility', 'converter', 'regex', 'json', 'pdf', 'calculator'],
    domains: ['tool.lu', 'caniuse.com', 'json.cn', 'transform.tools'],
  },
]

/**
 * 过滤自然语言提问中的停用词与助词
 */
function cleanNaturalLanguageQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/(我想找|请问有没有|有没有|有没有什么|找找|找一下|帮我找|相关的|推荐个|有哪些|哪个|做|看|关于|相关的工具|的工具|的网站|平台)/g, ' ')
    .trim()
}

/**
 * 计算纯文本匹配度
 */
function textMatchScore(source: string, target: string): number {
  if (!source || !target) return 0
  const s = source.toLowerCase()
  const t = target.toLowerCase()
  if (s === t) return 100
  if (s.includes(t)) return 80
  // 单词重合率：查询词中的关键词必须在文本中出现
  const sWords = s.split(/[\s\-_\/|·]+/).filter(Boolean)
  const tWords = t.split(/[\s\-_\/|·]+/).filter(Boolean)
  let hits = 0
  for (const tw of tWords) {
    if (tw.length < 2) continue
    if (sWords.some(sw => sw === tw || (sw.length >= tw.length && sw.includes(tw)))) hits++
  }
  return hits > 0 ? (hits / tWords.length) * 60 : 0
}

/**
 * 自然语言语义搜书签
 */
export function searchSemanticBookmarks(
  rawQuery: string,
  bookmarks: Bookmark[],
  groups: SiblingGroup[] = [],
): SemanticMatch[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query || query.length < 2 || isThreePartCipher(rawQuery)) return []

  const cleaned = cleanNaturalLanguageQuery(query)
  const activeBms = bookmarks.filter(b => !b.deletedAt)
  const activeGroups = groups.filter(g => !g.deletedAt)

  // 1. 识别命中的概念网络
  const matchedClusters: ConceptCluster[] = []
  for (const cluster of CONCEPT_ONTOLOGY) {
    // 检查查询词是否命中该概念的关键词或相关词
    const hasKw = cluster.keywords.some(kw => query.includes(kw) || (cleaned && cleaned.includes(kw)))
    const hasTerm = cluster.relatedTerms.some(term => query.includes(term.toLowerCase()))
    if (hasKw || hasTerm) {
      matchedClusters.push(cluster)
    }
  }

  const results: SemanticMatch[] = []

  // 2. 匹配书签
  for (const b of activeBms) {
    const rawTitle = _plain(b.title)
    const rawNotes = _plain(b.notes)
    const rawUrl = _plain(b.url)
    const bmHost = domain(rawUrl).toLowerCase()
    const bmTitle = rawTitle.toLowerCase()
    const bmNotes = rawNotes.replace(/<[^>]+>/g, '').toLowerCase()

    let bestScore = 0
    let bestReason = ''
    let bestConcept = ''

    // A. 概念集群语义碰撞
    for (const cluster of matchedClusters) {
      let clusterScore = 0
      const reasons: string[] = []

      // 域名精确命中概念核心站
      if (cluster.domains.some(d => bmHost === d || bmHost.includes(d))) {
        clusterScore += 70
        reasons.push('核心同源服务')
      }

      // 标题或笔记中含有该概念的相关词
      const hitKw = cluster.keywords.find(kw => bmTitle.includes(kw) || bmNotes.includes(kw))
      if (hitKw) {
        clusterScore += 40
        reasons.push(`包含概念词「${hitKw}」`)
      }

      const hitTerm = cluster.relatedTerms.find(term => bmTitle.includes(term) || bmHost.includes(term))
      if (hitTerm) {
        clusterScore += 30
        reasons.push(`匹配术语「${hitTerm}」`)
      }

      if (clusterScore > bestScore) {
        bestScore = clusterScore
        bestConcept = cluster.name
        bestReason = `语义意图 · ${cluster.name}（${reasons.join(' · ')}）`
      }
    }

    // B. 直搜文本相似度加成
    const titleScore = textMatchScore(bmTitle, query) || (cleaned ? textMatchScore(bmTitle, cleaned) : 0)
    const notesScore = textMatchScore(bmNotes, query) || (cleaned ? textMatchScore(bmNotes, cleaned) : 0)
    const hostScore = textMatchScore(bmHost, query)

    const directScore = Math.max(titleScore * 1.0, notesScore * 0.7, hostScore * 0.8)

    if (directScore >= 50) {
      if (directScore > bestScore) {
        bestScore = directScore
        bestConcept = '文本高相关'
        bestReason = '标题/内容精准吻合'
      } else {
        bestScore = Math.min(100, bestScore + directScore * 0.3)
      }
    }

    if (bestScore >= 35) {
      results.push({
        id: b.id,
        title: b.title,
        url: b.url,
        notes: b.notes ? b.notes.replace(/<[^>]+>/g, '').slice(0, 100) : '',
        icon: b.icon,
        categoryId: b.categoryId,
        isGroup: false,
        score: Math.round(bestScore),
        matchedConcept: bestConcept || '意图相关',
        reason: bestReason || '自然语言相关度匹配',
      })
    }
  }

  // 3. 匹配笔记组
  for (const g of activeGroups) {
    const rawGName = _plain(g.name)
    const rawGNotes = _plain(g.notes)
    const gName = rawGName.toLowerCase()
    const gNotes = rawGNotes.replace(/<[^>]+>/g, '').toLowerCase()

    let gScore = 0
    let gReason = ''
    let gConcept = ''

    for (const cluster of matchedClusters) {
      if (cluster.keywords.some(kw => gName.includes(kw) || gNotes.includes(kw))) {
        gScore = 65
        gConcept = cluster.name
        gReason = `笔记主题包含「${cluster.name}」`
        break
      }
    }

    const titleScore = textMatchScore(gName, query)
    if (titleScore >= 50) {
      gScore = Math.max(gScore, titleScore)
      gConcept = '组名高相关'
      gReason = '笔记组标题吻合'
    }

    if (gScore >= 40) {
      results.push({
        id: g.id,
        title: g.name,
        url: '',
        notes: g.notes ? g.notes.replace(/<[^>]+>/g, '').slice(0, 100) : '',
        icon: g.icon,
        categoryId: g.categoryId,
        isGroup: true,
        score: Math.round(gScore),
        matchedConcept: gConcept || '主题相近',
        reason: gReason,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 12)
}
