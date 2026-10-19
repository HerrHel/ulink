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

import { t } from '../../i18n/index.js'
import { isPrivateUrl, sanitizeUrlForExternalService } from './urlGuard.js'

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
  options: { signal?: AbortSignal; timeoutMs?: number; maxChars?: number } = {}
): Promise<JinaReadResult> {
  const cleanUrl = targetUrl.trim()
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    return {
      success: false,
      url: cleanUrl,
      error: t('ai.jinaInvalidUrl'),
    }
  }

  if (isPrivateUrl(cleanUrl)) {
    return {
      success: false,
      url: cleanUrl,
      error: t('ai.jinaPrivateHostBlocked'),
    }
  }

  const timeoutMs = options.timeoutMs ?? 10000
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

  const combinedSignal = options.signal
    ? anySignal([options.signal, timeoutController.signal])
    : timeoutController.signal

  try {
    const safeUrl = sanitizeUrlForExternalService(cleanUrl)
    const endpoint = `https://r.jina.ai/${safeUrl}`
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
        error: t('ai.jinaReadFailed', { status: res.status, statusText: res.statusText }),
      }
    }

    const text = await res.text()
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        url: cleanUrl,
        error: t('ai.jinaEmpty'),
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
      // 限制上下文长度，防 context 溢出；视频深度提取场景可调大 maxChars 以覆盖字幕/评论区
      markdown: text.slice(0, options.maxChars ?? 8000),
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return {
        success: false,
        url: cleanUrl,
        error: t('ai.jinaTimeout'),
      }
    }
    return {
      success: false,
      url: cleanUrl,
      error: t('ai.jinaNetError', { msg: err?.message || 'Unknown error' }),
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
