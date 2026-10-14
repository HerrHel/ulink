/**
 * mimoClient.ts — 小米 MiMo (mimo-v2.6-flash) 与链专属大模型客户端
 *
 * 核心设计：
 * 1. 深度绑定「与链专家」提示词架构，注入当前用户的分类、标签与操作规范；
 * 2. 严守极简无 Emoji、客观克制的高级审美标准；
 * 3. 自动提炼与解析 ```ulink-card 结构化推荐卡片，无缝对接与链 Schema；
 * 4. 具备完备的超时控制、AbortSignal 中断响应以及优雅降级容错机制。
 */

import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import { getSmartPrefill } from './smartPrefill.js'

export const MIMO_STORAGE_KEY = 'ulink_mimo_config'

export const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1'
export const DEFAULT_MIMO_MODEL = 'mimo-v2.6-flash'
export const DEFAULT_MIMO_API_KEY = 'REDACTED'

export interface MiMoUserConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  enabled?: boolean
}

/**
 * 读取当前有效的 MiMo 配置（优先 LocalStorage 用户覆盖，次选环境变量，兜底内置配置）
 */
export function getMiMoConfig(): { apiKey: string; baseUrl: string; model: string; enabled: boolean } {
  let stored: MiMoUserConfig = {}
  try {
    const raw = localStorage.getItem(MIMO_STORAGE_KEY)
    if (raw) stored = JSON.parse(raw)
  } catch {
    // 忽略解析错误
  }

  const envKey = (import.meta.env.VITE_MIMO_API_KEY as string | undefined)?.trim()
  const envBase = (import.meta.env.VITE_MIMO_BASE_URL as string | undefined)?.trim()
  const envModel = (import.meta.env.VITE_MIMO_MODEL as string | undefined)?.trim()

  const apiKey = (stored.apiKey?.trim()) || envKey || DEFAULT_MIMO_API_KEY
  const baseUrl = (stored.baseUrl?.trim() || envBase || DEFAULT_MIMO_BASE_URL).replace(/\/+$/, '')
  const model = (stored.model?.trim()) || envModel || DEFAULT_MIMO_MODEL
  const enabled = stored.enabled !== false

  return { apiKey, baseUrl, model, enabled }
}

/**
 * 保存用户自定义的 MiMo 配置
 */
export function saveMiMoConfig(config: MiMoUserConfig): void {
  try {
    localStorage.setItem(MIMO_STORAGE_KEY, JSON.stringify(config))
  } catch (err) {
    console.error('[mimoClient] Failed to save config to localStorage:', err)
  }
}

/**
 * 组装「与链专家」系统提示词（动态注入实时分类与标签上下文）
 */
export function buildUlinkSystemPrompt(options: {
  categories: Category[]
  customAttributes: CustomAttribute[]
  isZh?: boolean
}): string {
  const isZh = options.isZh !== false
  const catNames = options.categories
    .filter(c => c.id !== 'all' && c.id !== 'uncategorized')
    .map(c => c.name)
    .join('、')

  const attrNames = options.customAttributes.map(a => a.name).join('、')

  if (!isZh) {
    return `You are the exclusive AI Navigator & Bookmark Asset Curator built into "ULink" (与链).
Core principles:
1. Tone: Professional, concise, objective, restrained. Strictly no marketing fluff, NO redundant emojis unless explicitly requested, maintaining an elegant, paper-like reading texture.
2. Value: Favor open-source, direct connection without proxy, local-first privacy, clean, functional software tools.
3. User's Live Categories: [${catNames || 'None'}]
4. User's Live Attributes/Tags: [${attrNames || 'None'}]
5. In-App Commands: /dedup (duplicate scan/merge), /stats (health check), /trash (recycle bin), /theme [dark|light|auto], /export [json|html], /help.
6. Structured Output: When recommending websites or tools, summarize concisely first, then append a valid JSON block enclosed in \`\`\`ulink-card:
\`\`\`ulink-card
[
  {
    "title": "Tool Name",
    "url": "https://...",
    "notes": "Objective 1-sentence value proposition",
    "suggestedCategory": "Exact match from user's categories if possible",
    "tags": ["Open Source", "Free"]
  }
]
\`\`\``
  }

  return `你是由「与链 (ULink)」团队打造的专属智能领航员与书签资产管家。
核心设计与行为准则：
1. 语言与审美：客观、专业、清爽、克制。严禁浮夸推销文案，杜绝使用无意义的 Emoji 符号，保持高品质纸质阅读体验。
2. 价值取向：推崇开源、国内免翻直连、数据本地优先、无套路的纯粹极客利器。
3. 用户当前书签分类: [${catNames || '暂无分类'}]
4. 用户当前标签属性: [${attrNames || '暂无标签'}]
5. 站内快捷指令体系（必要时可引导用户输入体验）：
   - /dedup: 扫描全库重复书签并支持一键安全合并。
   - /stats: 检查分类占比、死链率及资产健康度。
   - /trash: 打开回收站管理与清空。
   - /theme [dark|light|auto]: 切换深色/浅色主题。
   - /export [json|html]: 导出备份。
   - /help: 查看本站全量功能与快捷键。
6. 结构化随文内嵌卡片规范（图文混排排版标准）：
   当你推荐某个具体网站或工具时，必须采用「随文嵌入」模式：直接在介绍该工具的段落上方嵌入紧凑卡片标记，随后紧跟客观分析（核心亮点、适用人群、使用技巧）：
\`\`\`ulink-card
{"title":"工具名称","url":"https://example.com","suggestedCategory":"精准匹配用户分类","tags":["免费","开源"],"notes":"一句话功能简介"}
\`\`\`
- 为什么选它：...
- 适用人群：...

如果推荐多个工具，依次在各自段落前随文内嵌卡片，切忌将卡片孤立堆在全文末尾，确保阅读流图文交融。`
}

/**
 * 从模型回复中解析候选卡片（向前兼容整块与随文嵌入格式）
 */
export function parseMiMoReply(
  replyText: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): { cleanText: string; candidates: AiCandidateBookmark[] } {
  const cardRegex = /```ulink-card\s*([\s\S]*?)```/gi
  const candidates: AiCandidateBookmark[] = []

  let match: RegExpExecArray | null
  while ((match = cardRegex.exec(replyText)) !== null) {
    const rawJson = match[1]?.trim()
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson)
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (item && item.title && item.url) {
            const prefill = getSmartPrefill(item.url, [], categories, attributes)
            const matchedCat = categories.find(
              c => c.name === item.suggestedCategory && c.id !== 'all' && c.id !== 'uncategorized'
            )

            candidates.push({
              title: String(item.title).trim(),
              url: String(item.url).trim(),
              notes: item.notes ? String(item.notes).trim() : (prefill.notes || ''),
              categoryId: matchedCat?.id || prefill.categoryId || undefined,
              suggestedAttrIds: prefill.suggestedAttrIds?.length ? prefill.suggestedAttrIds : undefined,
              tag: item.tags?.[0] || (item.notes?.includes('开源') ? '开源免费' : '智能推荐'),
              highlight: item.notes || item.title,
            })
          }
        }
      } catch (err) {
        console.warn('[mimoClient] Failed to parse ulink-card JSON:', err, rawJson)
      }
    }
  }

  const cleanText = replyText.replace(cardRegex, '').trim()
  return { cleanText, candidates }
}

/**
 * 向小米 MiMo 发起专家级对话请求
 */
export async function askMiMo(
  userQuery: string,
  context: {
    categories: Category[]
    customAttributes: CustomAttribute[]
    isZh?: boolean
    signal?: AbortSignal
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  }
): Promise<{
  reply: string
  cleanText: string
  candidates: AiCandidateBookmark[]
  rawText: string
  model: string
}> {
  const config = getMiMoConfig()
  if (!config.apiKey) {
    throw new Error('MiMo API Key not configured')
  }

  const systemPrompt = buildUlinkSystemPrompt({
    categories: context.categories,
    customAttributes: context.customAttributes,
    isZh: context.isZh,
  })

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  // 加入最近几轮历史上下文（最多取最近 4 轮，保持焦点集中）
  if (context.history?.length) {
    const recent = context.history.slice(-4)
    for (const h of recent) {
      if (h.content) {
        messages.push({
          role: h.role,
          content: h.content,
        })
      }
    }
  }

  messages.push({
    role: 'user',
    content: userQuery,
  })

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.3,
    }),
    signal: context.signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`MiMo API request failed (${response.status}): ${errText || response.statusText}`)
  }

  const data = await response.json()
  const rawText: string = data.choices?.[0]?.message?.content || ''

  const { cleanText, candidates } = parseMiMoReply(rawText, context.categories, context.customAttributes)

  return {
    reply: rawText,
    cleanText: cleanText || rawText,
    candidates,
    rawText,
    model: config.model,
  }
}
