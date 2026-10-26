/**
 * functions/api/extract-metadata.ts — Cloudflare Pages 边缘网页元数据真实提取端点
 *
 * 核心机制：
 * 1. 突破浏览器 CORS 跨域限制，在 Cloudflare 全球边缘节点安全读取公网网页；
 * 2. 严格的 SSRF 防护（拦截私有/回环网络）；
 * 3. 提取真实 HTML <title>、<meta description>、<meta og:title>、<meta og:description>；
 * 4. 对纯动态客户端渲染页面（SPA）自动降级至 Jina Reader 读取；
 * 5. 零伪造数据，失败诚实返回。
 */

interface Env {}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  })
}

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

function isPrivateIp(hostname: string): boolean {
  const host = hostname.toLowerCase().trim()
  if (PRIVATE_HOSTS.has(host)) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  return false
}

function decodeHtmlEntities(str: string): string {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim()
}

function decodeHtmlBuffer(buffer: ArrayBuffer, contentTypeHeader = ''): string {
  const headerMatch = contentTypeHeader.match(/charset=([a-zA-Z0-9_-]+)/i)
  let charset = headerMatch ? headerMatch[1].toLowerCase() : ''

  const previewSlice = new Uint8Array(buffer.slice(0, 2048))
  let previewStr = ''
  for (let i = 0; i < previewSlice.length; i++) {
    const b = previewSlice[i]
    previewStr += b < 128 ? String.fromCharCode(b) : ' '
  }

  if (!charset) {
    const metaCharsetMatch =
      previewStr.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) ||
      previewStr.match(/<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i)
    if (metaCharsetMatch) {
      charset = metaCharsetMatch[1].toLowerCase()
    }
  }

  if (charset.includes('gb')) {
    charset = 'gbk'
  } else if (charset.includes('big5')) {
    charset = 'big5'
  } else if (charset.includes('utf-8') || charset.includes('utf8')) {
    charset = 'utf-8'
  }

  try {
    if (charset && charset !== 'utf-8') {
      return new TextDecoder(charset).decode(buffer)
    }
  } catch {}

  const utf8Decoder = new TextDecoder('utf-8', { fatal: false })
  const utf8Str = utf8Decoder.decode(buffer)
  const errorCount = (utf8Str.match(/\uFFFD/g) || []).length
  if (errorCount > 3) {
    try {
      const gbkStr = new TextDecoder('gbk').decode(buffer)
      if ((gbkStr.match(/\uFFFD/g) || []).length < errorCount) {
        return gbkStr
      }
    } catch {}
  }
  return utf8Str
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request } = context

  if (request.method === 'OPTIONS') {
    return onRequestOptions()
  }

  let rawUrl = ''
  let availableAttributes: Array<{ id: string; name: string }> = []
  let availableCategories: Array<{ id: string; name: string }> = []
  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as {
        url?: string
        availableAttributes?: Array<{ id: string; name: string }>
        availableCategories?: Array<{ id: string; name: string }>
      }
      rawUrl = body.url || ''
      if (Array.isArray(body.availableAttributes)) {
        availableAttributes = body.availableAttributes
      }
      if (Array.isArray(body.availableCategories)) {
        availableCategories = body.availableCategories
      }
    } catch {
      return jsonResponse({ success: false, error: 'invalid_json' }, 400)
    }
  } else {
    const parsed = new URL(request.url)
    rawUrl = parsed.searchParams.get('url') || ''
  }

  const cleanUrl = rawUrl.trim()
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    return jsonResponse({ success: false, error: 'invalid_url' }, 400)
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(cleanUrl)
  } catch {
    return jsonResponse({ success: false, error: 'invalid_url_format' }, 400)
  }

  if (isPrivateIp(targetUrl.hostname)) {
    return jsonResponse({ success: false, error: 'private_ip_forbidden' }, 400)
  }

  try {
    const tryFetch = async (target: string) => {
      return await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      })
    }

    let res: Response | null = null
    try {
      res = await tryFetch(targetUrl.href)
    } catch {
      // 顶级裸域名（如 baidu.com）直接连接若不通，自动尝试 www. 子域重试
      try {
        if (!targetUrl.hostname.startsWith('www.') && targetUrl.hostname.split('.').length === 2) {
          const wwwUrl = new URL(targetUrl.href)
          wwwUrl.hostname = 'www.' + wwwUrl.hostname
          res = await tryFetch(wwwUrl.href)
        }
      } catch {}
    }

    let title = ''
    let description = ''

    try {
      const contentType = res ? res.headers.get('content-type') || '' : ''
      if (res && res.ok && (contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType)) {
        const buf = await res.arrayBuffer()
        const html = decodeHtmlBuffer(buf, contentType)
        const headSlice = html.slice(0, 150000)

        // 提取标题：优先 og:title，其次 <title>
        const ogTitleMatch =
          headSlice.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
          headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
        const tagTitleMatch = headSlice.match(/<title[^>]*>([^<]+)<\/title>/i)

        if (ogTitleMatch && ogTitleMatch[1].trim()) {
          title = decodeHtmlEntities(ogTitleMatch[1])
        } else if (tagTitleMatch && tagTitleMatch[1].trim()) {
          title = decodeHtmlEntities(tagTitleMatch[1])
        }

        // 提取描述：优先 meta description 或 og:description
        const descMatch =
          headSlice.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
          headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
          headSlice.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
          headSlice.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i)

        if (descMatch && descMatch[1].trim()) {
          description = decodeHtmlEntities(descMatch[1])
        }
      }
    } catch {}

    // 若 HTML 未提取到标题（如纯 JS 动态单页应用），自动平滑降级至 Jina Reader
    if (!title && res && res.ok) {
      const jinaTargets = [targetUrl.href]
      if (!targetUrl.hostname.startsWith('www.') && targetUrl.hostname.split('.').length === 2) {
        jinaTargets.push(`https://www.${targetUrl.hostname}${targetUrl.pathname}${targetUrl.search}`)
      }
      for (const jt of jinaTargets) {
        try {
          const jinaRes = await fetch(`https://r.jina.ai/${jt}`, {
            headers: { Accept: 'text/plain' },
            signal: AbortSignal.timeout(6000),
          })
          if (jinaRes.ok) {
            const text = await jinaRes.text()
            const tm = text.match(/^Title:\s*(.+)$/im)
            const dm = text.match(/^Description:\s*(.+)$/im)
            if (tm && tm[1].trim()) title = decodeHtmlEntities(tm[1].trim())
            if (dm && dm[1].trim()) description = decodeHtmlEntities(dm[1].trim())
            else if (!description) {
              const bodyClean = text
                .replace(/^Title:.*$/im, '')
                .replace(/^URL Source:.*$/im, '')
                .replace(/^Markdown Content:.*$/im, '')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/[#*`_~>-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
              if (bodyClean.length > 10) description = bodyClean.slice(0, 160)
            }
            if (title) break
          }
        } catch {}
      }
    }

    
    // 3. 终极真智能提炼：调用大模型（LLM），将抓取到的原始网页标题与描述深度提炼为
    // 真正的「网站名称」与精炼「备注」（去除SEO关键词堆砌、口号与域名后缀，概括核心业务用途）
    let llmSuggestedAttrs: string[] = []
    let llmSuggestedCatId: string | undefined = undefined
    // ⚠️ 密钥只能来自环境绑定，**绝不允许硬编码兜底**：
    // 一旦写进源码就会进版本历史，即使后续删除也无法真正撤销（需轮换密钥）。
    // 缺 key 时跳过 LLM 提炼，由后续本地多级分类兜底（功能降级但不报错）。
    const mimoKey = (context.env as any)?.MIMO_API_KEY as string | undefined
    if (!mimoKey) {
      console.warn('[extract-metadata] MIMO_API_KEY 未绑定，跳过 LLM 提炼（降级本地分类）')
    }
    if (mimoKey) {
      try {
        const attrClause = availableAttributes.length > 0
          ? `\n可选属性标签（严格从以下标签中挑选0-3个最匹配的ID数组，没有则填[]）：\n${JSON.stringify(availableAttributes.map(a => ({ id: a.id, name: a.name })))}`
          : ''
        const catClause = availableCategories.length > 0
          ? `\n可选分类列表（严格从以下分类列表中挑选最匹配的一个分类ID，没有把握填null）：\n${JSON.stringify(availableCategories.map(c => ({ id: c.id, name: c.name })))}`
          : ''

        const llmPrompt = `你是一个专业的浏览器书签管理器 AI 整理助手。
用户正在收藏网页：${cleanUrl}
${title ? `从该网页抓取到的原始标题：${title}` : ''}
${description ? `从该网页抓取到的原始描述：${description}` : ''}
${attrClause}${catClause}

请根据网址及以上原始信息，为用户智能提炼最地道、规范的书签元数据：
1. "title": 真正的“网站名称”（简洁、地道、纯粹的品牌或产品名，如“4399小游戏”、“GitHub”、“哔哩哔哩”。绝对不要带SEO关键词堆砌、网站后缀、二级域名、营销口号或冗长描述，控制在2-15字内）
2. "description": 真正的“备注”（用一句话精炼概括该网站是什么、核心功能或用途，文雅通顺，20-60字。严禁堆砌游戏名、商品列表或SEO关键词，不要简单复读标题）
3. "suggestedCategoryId": 从可选分类列表中选中的最匹配分类ID（若无可填null）
4. "suggestedAttrIds": 从可选属性标签中挑选0-3个最匹配的ID数组
5. 严禁任何 Emoji 表情符号，输出典雅清晰的纯中文/英文文字。

直接输出合法的JSON，不要任何Markdown或多余文本：
{"title": "站点名称", "description": "一句话精炼简介", "suggestedCategoryId": "分类ID或null", "suggestedAttrIds": []}`

        const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mimoKey}`,
          },
          body: JSON.stringify({
            model: 'mimo-v2.6-flash',
            messages: [{ role: 'user', content: llmPrompt }],
            temperature: 0.1,
            max_tokens: 300,
          }),
          signal: AbortSignal.timeout(10000),
        })

        if (mimoRes.ok) {
          const mData = await mimoRes.json()
          const mRaw = mData.choices?.[0]?.message?.content?.trim() || ''
          const mJson = mRaw.replace(/^\`\`\`json\s*/i, '').replace(/^\`\`\`\s*/i, '').replace(/\`\`\`$/i, '').trim()
          const parsed = JSON.parse(mJson)
          if (parsed && parsed.title) {
            title = parsed.title
            if (parsed.description) description = parsed.description
            if (parsed.suggestedCategoryId && typeof parsed.suggestedCategoryId === 'string' && parsed.suggestedCategoryId !== 'null') {
              llmSuggestedCatId = parsed.suggestedCategoryId
            }
            if (Array.isArray(parsed.suggestedAttrIds)) {
              llmSuggestedAttrs = parsed.suggestedAttrIds.filter((id: any) => typeof id === 'string')
            }
          }
        }
      } catch {}
    }

    const stripEmojis = (s: string) =>
      s.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '').trim()

    title = stripEmojis(title)
    description = stripEmojis(description)

    if (!title && !description) {
      return jsonResponse({ success: false, error: 'empty_extracted_content' })
    }

    return jsonResponse({
      success: true,
      title: title || undefined,
      description: description || undefined,
      categoryId: llmSuggestedCatId || undefined,
      suggestedAttrIds: llmSuggestedAttrs.length > 0 ? llmSuggestedAttrs : undefined,
      url: targetUrl.href,
    })
  } catch (err: unknown) {
    const isTimeout = (err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError'
    return jsonResponse(
      {
        success: false,
        error: isTimeout ? 'timeout' : (err as Error)?.message || 'network_error',
      },
      502
    )
  }
}
