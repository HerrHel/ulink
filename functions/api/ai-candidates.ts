/**
 * functions/api/ai-candidates.ts — Cloudflare Pages 边缘端真实 AI 意图寻站与同类平替推荐
 *
 * 核心机制：
 * 1. 突破纯本地静态字典限制，根据用户真实需求意图或目标站点，动态调用大模型实时生成推荐；
 * 2. 严格要求返回真实有效的公网网站、地道中文介绍与亮点标签；
 * 3. 杜绝 Emoji 噪声，输出格式化 JSON。
 */

interface Env {
  MIMO_API_KEY?: string
}

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

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = (await context.request.json().catch(() => ({}))) as {
      type?: 'similar' | 'intent'
      query?: string
      targetUrl?: string
      targetTitle?: string
    }

    const { type, query, targetUrl, targetTitle } = body

    const mimoKey = context.env.MIMO_API_KEY || ''
    if (!mimoKey) {
      return jsonResponse({ success: false, error: 'mimo_key_not_configured' }, 503)
    }

    let prompt = ''
    if (type === 'similar') {
      const site = targetTitle ? `${targetTitle} (${targetUrl || ''})` : targetUrl || '该网站'
      prompt = `你是一个资深互联网工具与高价值软件挖掘专家。
用户正在寻找与网站【${site}】功能相近、定位相似的优秀同类平台、优质竞品或开源平替工具。

请推荐 3-5 个真实存在、当前知名且正常运行的顶级公网网站。
要求：
1. 网站网址必须真实有效（如官方首页地址），严禁捏造或拼接不存在的网址。
2. 包含高质量同类工具、开源平替、轻量级替代或国内直连产品。
3. 严禁包含任何 Emoji 表情符号。
4. 输出合法的 JSON 数组，格式如下：
[
  {
    "title": "工具名称",
    "url": "https://...",
    "notes": "20-50字核心功能与特色说明",
    "tag": "开源免费/轻量易用/专业首选/国内直连 等简短标签",
    "highlight": "一句话推荐理由"
  }
]
直接输出 JSON，不要任何 Markdown 标记或多余文字。`
    } else {
      const q = (query || '').trim()
      if (!q) {
        return jsonResponse({ success: false, error: 'empty_query' }, 400)
      }
      prompt = `你是一个资深互联网工具与高价值软件挖掘专家。
用户正在寻找满足特定需求的真实优质网站或在线工具。
用户需求/意图："${q}"

请推荐 3-5 个真实存在、当前知名且正常运行的顶级公网网站。
要求：
1. 网站网址必须真实有效（如官方首页地址），严禁捏造或胡乱拼接不存在的网址。
2. 针对用户具体意图，精准给出具有代表性的实用工具。
3. 严禁包含任何 Emoji 表情符号。
4. 输出合法的 JSON 数组，格式如下：
[
  {
    "title": "工具名称",
    "url": "https://...",
    "notes": "20-50字核心功能与特色说明",
    "tag": "开源免费/轻量易用/专业首选/国内直连 等简短标签",
    "highlight": "一句话推荐理由"
  }
]
直接输出 JSON，不要任何 Markdown 标记或多余文字。`
    }

    const mimoRes = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mimoKey}`,
      },
      body: JSON.stringify({
        model: 'mimo-v2.6-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!mimoRes.ok) {
      return jsonResponse({ success: false, error: 'upstream_failed' }, 502)
    }

    const mData = (await mimoRes.json()) as any
    const mRaw = mData.choices?.[0]?.message?.content?.trim() || ''
    const mJson = mRaw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
    const items = JSON.parse(mJson)

    if (Array.isArray(items) && items.length > 0) {
      const validItems = items.filter(
        (it: any) => it && typeof it.title === 'string' && typeof it.url === 'string' && it.url.startsWith('http')
      )
      return jsonResponse({ success: true, items: validItems })
    }

    return jsonResponse({ success: false, error: 'empty_result' })
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'internal_error' }, 500)
  }
}
