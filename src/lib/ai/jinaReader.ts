/**
 * jinaReader.ts — 真实网页与视频内容读取服务（基于开源 Jina Reader API 协议）
 *
 * 核心机制：
 * 1. 采用开源免费、零鉴权的 https://r.jina.ai/<target_url> 协议；
 *    隐私披露：使用即表示目标 URL 会发送给第三方 r.jina.ai 服务读取页面内容；
 * 2. 将目标 URL 转换为干净易解析的 Markdown 文本与元数据；
 * 3. 包含超时限制与 AbortSignal，绝不做假数据伪造；
 * 4. 无法抓取（如内网或需要登录的平台）时诚实返回错误与清晰指引。
 */

export interface JinaReadResult {
  success: boolean
  url: string
  title?: string
  description?: string
  markdown?: string
  error?: string
}

export async function fetchPageContentViaJina(
  targetUrl: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<JinaReadResult> {
  const cleanUrl = targetUrl.trim()
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    return {
      success: false,
      url: cleanUrl,
      error: '无效的目标网址，必须以 http:// 或 https:// 开头',
    }
  }

  const timeoutMs = options.timeoutMs ?? 10000
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

  const combinedSignal = options.signal
    ? anySignal([options.signal, timeoutController.signal])
    : timeoutController.signal

  try {
    const endpoint = `https://r.jina.ai/${cleanUrl}`
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'text/markdown, text/plain, */*',
        'X-No-Cache': 'true',
      },
      signal: combinedSignal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      return {
        success: false,
        url: cleanUrl,
        error: `读取失败 (HTTP ${res.status}): ${res.statusText}`,
      }
    }

    const text = await res.text()
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        url: cleanUrl,
        error: '目标页面返回空内容或不可公开抓取',
      }
    }

    // 从 Jina Reader 标准返回头中提炼标题与描述
    let title: string | undefined
    let description: string | undefined

    const titleMatch = text.match(/^Title:\s*(.+)$/im) || text.match(/^#\s+(.+)$/m)
    if (titleMatch) title = titleMatch[1].trim()

    const descMatch = text.match(/^Description:\s*(.+)$/im)
    if (descMatch) description = descMatch[1].trim()

    return {
      success: true,
      url: cleanUrl,
      title,
      description,
      markdown: text.slice(0, 8000), // 限制上下文长度，防 context 溢出
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return {
        success: false,
        url: cleanUrl,
        error: '页面读取超时或已被用户取消',
      }
    }
    return {
      success: false,
      url: cleanUrl,
      error: `网络或跨域读取异常: ${err?.message || '未知错误'}`,
    }
  }
}

/** 组合多个 AbortSignal */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort()
      return controller.signal
    }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
