/**
 * cloudCandidates.ts — AI 候选站点生成层（自 cloudAiClient.ts 拆出）
 * 职责：意图寻站（本地精选知识库启发式）与类似平替挖掘（预置同类映射库），
 * 候选统一经偏好过滤与分类/属性上下文预匹配，生成对齐与链 Schema 的候选卡片。
 */

import type { Category, CustomAttribute } from '../../types.js'
import type { AiSearchPreference, AiCandidateBookmark } from '../../types/ai.js'
import { t, getLocale } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { getSimilarExternalWebsites } from './similarWebsites.js'

/**
 * 根据偏好过滤与重排候选集
 * 注意：均为软过滤/软排序——关键词命中即调整，不做强保证；open_source 不排除闭源项，仅前置开源项。
 * 文案已 i18n，标记词按中英双语匹配（zh/en 语言包文案均可能出现在 tag/highlight/notes）。
 */
function filterByPreferences(candidates: AiCandidateBookmark[], prefs: AiSearchPreference[]): AiCandidateBookmark[] {
  if (!prefs.length) return candidates

  const filtered = candidates.filter(c => {
    const text = (c.tag + ' ' + c.highlight + ' ' + c.notes + ' ' + c.url).toLowerCase()
    for (const p of prefs) {
      if (p === 'free' && (text.includes('收费') || text.includes('订阅') || text.includes('需付费') || text.includes('paid') || text.includes('subscription'))) {
        return false
      }
      // 软过滤：仅按显式文本线索剔除，不做域名后缀臆断
      if (p === 'no_proxy' && (text.includes('需翻墙') || text.includes('需要网络代理') || text.includes('vpn') || text.includes('proxy'))) {
        return false
      }
    }
    return true
  })

  if (prefs.includes('open_source')) {
    const isOpenSource = (c: AiCandidateBookmark) => {
      const text = (c.tag + ' ' + c.highlight + ' ' + c.notes + ' ' + c.url).toLowerCase()
      return text.includes('开源') || text.includes('open source') || c.url.includes('github.com')
    }
    filtered.sort((a, b) => Number(isOpenSource(b)) - Number(isOpenSource(a)))
  }

  return filtered
}

/**
 * 辅助函数：根据网址和描述，智能匹配用户现有分类和属性
 * （videoHarvest.ts 的视频收割候选也复用同一预匹配口径）
 */
export function enrichContext(
  bm: AiCandidateBookmark,
  categories: Category[],
  attributes: CustomAttribute[]
): AiCandidateBookmark {
  const prefill = getSmartPrefill(bm.url, [], categories, attributes)

  return {
    ...bm,
    categoryId: prefill.categoryId || undefined,
    suggestedAttrIds: prefill.suggestedAttrIds?.length ? prefill.suggestedAttrIds : undefined,
  }
}

/**
 * 1. 意图寻站：根据用户自然语言需求与偏好检索候选网站
 */
export async function searchWebsitesByIntent(
  query: string,
  preferences: AiSearchPreference[] = [],
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiCandidateBookmark[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  // 基础精选知识库拓扑（本地启发式 + 云端大模型直连）；条目文案走 i18n（dbXxx 键）
  const database: Array<{ keywords: string[]; items: AiCandidateBookmark[] }> = [
    {
      keywords: ['流程图', '白板', '画图', '架构图', '思维导图', 'flowchart', 'diagram', 'board'],
      items: [
        {
          title: 'Excalidraw',
          url: 'https://excalidraw.com',
          notes: t('ai.dbExcalidrawNotes'),
          tag: t('ai.tagOpenFree'),
          highlight: t('ai.dbExcalidrawHighlight'),
        },
        {
          title: 'draw.io',
          url: 'https://app.diagrams.net',
          notes: t('ai.dbDrawioNotes'),
          tag: t('ai.tagNoProxy'),
          highlight: t('ai.dbDrawioHighlight'),
        },
        {
          title: 'tldraw',
          url: 'https://www.tldraw.com',
          notes: t('ai.dbTldrawNotes'),
          tag: t('ai.tagLightFree'),
          highlight: t('ai.dbTldrawHighlight'),
        },
        {
          title: 'ProcessOn',
          url: 'https://www.processon.com',
          notes: t('ai.dbProcessonNotes'),
          tag: t('ai.tagProBiz'),
          highlight: t('ai.dbProcessonHighlight'),
        },
      ],
    },
    {
      keywords: ['切图', '修图', '设计', '图片处理', '去背景', '抠图', 'photo', 'image', 'design'],
      items: [
        {
          title: 'Photopea',
          url: 'https://www.photopea.com',
          notes: t('ai.dbPhotopeaNotes'),
          tag: t('ai.tagLightFree'),
          highlight: t('ai.dbPhotopeaHighlight'),
        },
        {
          title: 'TinyPNG',
          url: 'https://tinypng.com',
          notes: t('ai.dbTinypngNotes'),
          tag: t('ai.tagNoProxy'),
          highlight: t('ai.dbTinypngHighlight'),
        },
        {
          title: 'Penpot',
          url: 'https://penpot.app',
          notes: t('ai.dbPenpotNotes'),
          tag: t('ai.tagGeekOpen'),
          highlight: t('ai.dbPenpotHighlight'),
        },
      ],
    },
    {
      keywords: ['ai', '生图', '写作', 'gpt', '大模型', 'chat', '对话', 'prompt'],
      items: [
        {
          title: 'DeepSeek',
          url: 'https://chat.deepseek.com',
          notes: t('ai.dbDeepseekNotes'),
          tag: t('ai.tagNoProxy'),
          highlight: t('ai.dbDeepseekHighlight'),
        },
        {
          title: 'Kimi',
          url: 'https://kimi.moonshot.cn',
          notes: t('ai.dbKimiNotes'),
          tag: t('ai.tagNoProxy'),
          highlight: t('ai.dbKimiHighlight'),
        },
        {
          title: 'Claude',
          url: 'https://claude.ai',
          notes: t('ai.dbClaudeNotes'),
          tag: t('ai.tagProBiz'),
          highlight: t('ai.dbClaudeHighlight'),
        },
      ],
    },
    {
      keywords: ['建站', '部署', '开发', '托管', 'serverless', '前端', 'deploy', 'hosting'],
      items: [
        {
          title: 'Zeabur',
          url: 'https://zeabur.com',
          notes: t('ai.dbZeaburNotes'),
          tag: t('ai.tagNoProxy'),
          highlight: t('ai.dbZeaburHighlight'),
        },
        {
          title: 'Cloudflare Pages',
          url: 'https://pages.cloudflare.com',
          notes: t('ai.dbCfpagesNotes'),
          tag: t('ai.tagFullyFree'),
          highlight: t('ai.dbCfpagesHighlight'),
        },
        {
          title: 'Vercel',
          url: 'https://vercel.com',
          notes: t('ai.dbVercelNotes'),
          tag: t('ai.tagProBiz'),
          highlight: t('ai.dbVercelHighlight'),
        },
      ],
    },
  ]

  let results: AiCandidateBookmark[] = []
  for (const group of database) {
    if (group.keywords.some(kw => q.includes(kw))) {
      results = group.items
      break
    }
  }

  // 若无强匹配，提供通用发现入口（如实标注：非个性化结果）
  if (!results.length) {
    results = [
      {
        title: 'GitHub Explore',
        url: 'https://github.com/explore',
        notes: t('ai.genericGithubNotes', { query }),
        tag: t('ai.tagGeekOpen'),
        highlight: t('ai.genericEntryHighlight'),
        generic: true,
      },
      {
        title: 'Product Hunt',
        url: 'https://www.producthunt.com',
        notes: t('ai.genericProductHuntNotes'),
        tag: t('ai.tagProBiz'),
        highlight: t('ai.genericEntryHighlight'),
        generic: true,
      },
    ]
  }

  // 偏好筛选与分类/属性上下文预先绑定
  const filtered = filterByPreferences(results, preferences)
  return filtered.map(item => enrichContext(item, categories, attributes))
}

/**
 * 2. 类似平替挖掘：根据目标网站挖掘开源/免翻/轻量同类
 */
export async function findSimilarWebsites(
  targetUrl: string,
  targetTitle: string,
  preferences: AiSearchPreference[] = [],
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiCandidateBookmark[]> {
  // 查预置的高频同类映射库
  const similarItems = getSimilarExternalWebsites(targetUrl)
  let candidates: AiCandidateBookmark[] = []

  if (similarItems.length) {
    const isZh = getLocale().toLowerCase().startsWith('zh')
    candidates = similarItems.map(item => {
      const desc = isZh ? item.descriptionZh : item.descriptionEn
      return {
        title: item.title,
        url: item.url,
        notes: desc,
        tag: item.tags.some(tg => tg.includes('开源')) ? t('ai.tagGeekOpen') : item.tags.some(tg => tg.includes('国内')) ? t('ai.tagNoProxy') : t('ai.tagLightAlt'),
        highlight: desc,
      }
    })
  } else {
    // 无真实平替数据：诚实返回空，不拼猜 alternativeto.net 路径冒充候选
    candidates = []
  }

  const filtered = filterByPreferences(candidates, preferences)
  return filtered.map(item => enrichContext(item, categories, attributes))
}
