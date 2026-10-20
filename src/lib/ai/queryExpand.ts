/**
 * queryExpand.ts — 模型辅助查询改写（模糊查询的检索增强）
 *
 * 场景：用户用模糊/口语化表达提问（如「找个能做旅行攻略的地方」）时，本地混合 RAG
 * 召回薄弱（<3 条）。此时让模型仅基于「用户 query 本身」生成概念扩展词，再并入检索词
 * 重查，命中概念簇的概率显著提升。
 *
 * 隐私红线：外发内容只有用户 query + 固定系统提示，绝不携带分类/标签/书签数据。
 * 容错策略：任何失败（网络/超时/未登录/垃圾回复）fail-open 返回 []，不阻塞主问答流程。
 * 缓存：内存 LRU 80 条 + localStorage 持久化，同一 query 不重复请求。
 */

import { createBoundedCache } from '../boundedCache.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../storageSafe.js'
import { redactSensitivePatterns } from './secretFilter.js'
import { askMiMoRaw, type MiMoChatMessage } from './mimoClient.js'

/** 持久化键（bump 版本号可整体作废旧缓存） */
const K_EXPAND_CACHE = 'lv_ai_query_expand_v1'
/** 内存/持久化缓存上限 */
const CACHE_MAX = 80
/** 单次改写请求超时（毫秒） */
const TIMEOUT_MS = 4000
/** 扩展词数量上限 */
const MAX_TERMS = 8
/** 单个扩展词长度上限 */
const MAX_TERM_LEN = 12

/** 固定小系统提示：只描述任务，不带任何用户库数据 */
const SYS_PROMPT_ZH =
  '你是书签检索的查询改写助手。把用户查询改写为不超过 8 个用于检索的概念扩展词' +
  '（同义词、上位概念、相关领域词），每词不超过 12 个字。只输出 JSON 数组，' +
  '例如 ["词1","词2"]，不要输出任何其他文字。'
const SYS_PROMPT_EN =
  'You are a query rewriting assistant for bookmark retrieval. Rewrite the user query into ' +
  'at most 8 concept expansion terms (synonyms, hypernyms, related domain words), each at ' +
  'most 12 characters. Output only a JSON array like ["term1","term2"], nothing else.'

/** 垃圾/客套回复前缀：整段拒答或寒暄不得混进检索词 */
const GARBAGE_TERM_RE = /^(抱歉|对不起|好的|你好|以下是|请注意|我(不|无法|不能)|sorry|ok|okay|sure|here (are|is)|i (cannot|can't|am sorry))/i

/** 内存缓存 + 插入序镜像（BoundedCache 不可迭代，持久化序列化需要顺序） */
const cache = createBoundedCache<string, string[]>(CACHE_MAX)
const cacheKeys: string[] = []
let cacheLoaded = false

/** 首次使用时从 localStorage 恢复持久化缓存（失败静默，仅内存生效） */
function ensureCacheLoaded(): void {
  if (cacheLoaded) return
  cacheLoaded = true
  const record = safeJsonParse<Record<string, string[]>>(safeGetItem(K_EXPAND_CACHE), {})
  const entries = Object.entries(record).slice(-CACHE_MAX)
  for (const [key, value] of entries) {
    if (!Array.isArray(value)) continue
    cache.set(key, value)
    cacheKeys.push(key)
  }
}

/** 写缓存（内存 LRU + 插入序镜像同步 + 持久化） */
function cacheSet(key: string, value: string[]): void {
  const isNew = !cache.has(key)
  // BoundedCache 满时淘汰最早插入项，镜像同步移除队首以保持一致
  if (isNew && cache.size >= CACHE_MAX) cacheKeys.shift()
  cache.set(key, value)
  if (isNew) cacheKeys.push(key)
  const record: Record<string, string[]> = {}
  for (const k of cacheKeys) {
    const v = cache.get(k)
    if (v) record[k] = v
  }
  safeSetItem(K_EXPAND_CACHE, JSON.stringify(record))
}

/** 规范化 query 作为缓存键：去首尾空白 + 小写 + 折叠连续空白 */
export function normalizeExpandKey(query: string): string {
  return (query || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 词条清洗：脱敏、去引号、截断、去重、限量 */
function normalizeTerms(items: string[]): string[] {
  const out: string[] = []
  for (const item of items) {
    let term = redactSensitivePatterns(String(item ?? ''))
      .replace(/^[\"'\s「【\[]+|[\"'\s」】\].。!！?？]+$/g, '')
      .slice(0, MAX_TERM_LEN)
      .trim()
    if (!term || GARBAGE_TERM_RE.test(term)) continue
    if (!out.some((t) => t.toLowerCase() === term.toLowerCase())) out.push(term)
    if (out.length >= MAX_TERMS) break
  }
  return out
}

/** 回复解析容错：JSON 数组优先，逗号/顿号/空白分割兜底，垃圾回复→[] */
export function parseExpandReply(raw: string): string[] {
  const text = redactSensitivePatterns(String(raw ?? '')).trim()
  if (!text) return []

  // 1. JSON 数组（可能是「好的，以下是 ["a","b"]」这类夹带文本，取首个中括号段）
  const jsonMatch = text.match(/\[[\s\S]*?\]/)
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0])
      if (Array.isArray(arr)) return normalizeTerms(arr.map((x) => String(x)))
    } catch {
      // 破损 JSON 落入文本分割兜底
    }
  }

  // 2. 逗号/顿号/分号/换行/空白分割
  const splitTerms = normalizeTerms(text.split(/[,，、;；\n\r\s]+/))
  if (splitTerms.length > 0) return splitTerms

  // 3. 无任何分隔符的极短单回复可整体作为单个扩展词，长文本视为垃圾→[]
  const whole = text.slice(0, MAX_TERM_LEN).trim()
  return whole && text.length <= MAX_TERM_LEN && !GARBAGE_TERM_RE.test(whole) ? [whole] : []
}

/**
 * 模型辅助查询改写：仅外发用户 query 本身生成概念扩展词。
 *
 * @param query 用户原始查询
 * @param opts.signal 外部中止信号（与内部 4s 超时联动）
 * @param opts.isZh 语言（决定系统提示语种）
 * @returns 扩展词数组；任何失败 fail-open 返回 []（含缓存命中时直接返回缓存值）
 */
export async function expandQueryTerms(
  query: string,
  opts?: { signal?: AbortSignal; isZh?: boolean }
): Promise<string[]> {
  const key = normalizeExpandKey(query)
  if (!key) return []

  ensureCacheLoaded()
  const cached = cache.get(key)
  if (cached) return [...cached]

  // 已中止不再发起请求
  if (opts?.signal?.aborted) return []

  try {
    // 内部超时与外部中止信号联动到同一个 controller
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    opts?.signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let reply = ''
    try {
      const messages: MiMoChatMessage[] = [
        { role: 'system', content: opts?.isZh === false ? SYS_PROMPT_EN : SYS_PROMPT_ZH },
        // 隐私红线：仅携带用户 query，绝不携带分类/标签/书签数据
        { role: 'user', content: query.trim().slice(0, 500) },
      ]
      reply = await askMiMoRaw(messages, { signal: controller.signal, temperature: 0.3 })
    } finally {
      clearTimeout(timer)
      opts?.signal?.removeEventListener('abort', onAbort)
    }

    const terms = parseExpandReply(reply)
    // 空结果不入缓存：模型偶发空回复不应长期污染同一 query
    if (terms.length > 0) cacheSet(key, terms)
    return terms
  } catch {
    // fail-open：网络/超时/未登录等任何失败不阻塞主问答流程
    return []
  }
}
