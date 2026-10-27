/**
 * jinaReader.ts — 真实网页与视频内容读取服务（基于开源 Jina Reader API 协议）
 *
 * 核心机制：
 * 1. 经 jina-proxy Edge Function 服务端转发到 https://r.jina.ai/<target_url>，
 *    前端零直连第三方（2026-10-20 决策：取消前端直连例外，改为服务端转发）；
 *    隐私披露：目标 URL 仍会经服务端发送给第三方 r.jina.ai，每次触发以 toast 向用户披露；
 * 2. 将目标 URL 转换为干净易解析的 Markdown 文本与元数据；
 * 3. 包含超时限制与 AbortSignal，绝不做假数据伪造；
 * 4. 无法抓取（未登录/未配置/内网/需登录的平台）时诚实返回错误与清晰指引。
 */

import { t } from '../../i18n/index.js'
import { toast } from '../toast.js'
import { supabase, isSupabaseConfigured } from '../supabase.js'
import { isCloudBaseBackend, edgeFnUrl } from '../cloudbase.js'
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
  options: { signal?: AbortSignal; timeoutMs?: number; maxChars?: number; silentNotice?: boolean } = {}
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

  // 服务端转发需登录态：未配置/未登录时如实报错，绝不回退成前端直连第三方
  //（CloudBase 云函数 v1 不验签、走 IP 哈希限流，无需会话 token）
  const cbMode = isCloudBaseBackend()
  let authHeaders: Record<string, string> = {}
  if (!cbMode) {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        url: cleanUrl,
        error: t('ai.jinaUnavailable'),
      }
    }
    let token = ''
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      token = sessionData?.session?.access_token || ''
    } catch {
      token = ''
    }
    if (!token) {
      return {
        success: false,
        url: cleanUrl,
        error: t('ai.jinaUnavailable'),
      }
    }
    authHeaders = {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
    }
  }
  const endpoint = edgeFnUrl('jina-proxy')
  if (!endpoint) {
    return {
      success: false,
      url: cleanUrl,
      error: t('ai.jinaUnavailable'),
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
    // 用户可见隐私披露：本次请求会把目标 URL 经服务端发送给第三方 r.jina.ai（每次触发均提示，不做静默外送）
    if (!options.silentNotice) {
      toast(t('ai.jinaThirdPartyNotice'))
    }
    // 前端只调自家 jina-proxy 云函数（服务端转发 r.jina.ai），零直连第三方
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ url: safeUrl }),
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

    const data: { text?: unknown } = await res.json()
    const text = typeof data.text === 'string' ? data.text : ''
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
    if (descMatch) {
      description = descMatch[1].trim()
    } else {
      const bodyClean = text
        .replace(/^Title:\s*.*$/im, '')
        .replace(/^URL Source:\s*.*$/im, '')
        .replace(/^Markdown Content:\s*.*$/im, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`_~>-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (bodyClean.length > 10) {
        description = bodyClean.slice(0, 160)
      }
    }

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
