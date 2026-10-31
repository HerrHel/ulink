// video-extract.js — 扩展内视频深度解析（页面态媒体地址 → 云函数 deep 任务）
/* global chrome, LinkVaultExtConfig */

;(function () {
  'use strict'

  const API_BASE = 'https://ulink.ren'
  const POLL_INTERVAL_MS = 2000
  const POLL_MAX_MS = 4 * 60 * 1000
  const PLATFORM_LABELS = {
    bilibili: '哔哩哔哩 B站',
    douyin: '抖音',
    xiaohongshu: '小红书',
  }
  const PLATFORM_NOTES = {
    bilibili: 'B站：正式支持（读取页面 __playinfo__）',
    douyin: '抖音：实验性适配（依赖页面态，未登录/验证码时可能失败）',
    xiaohongshu: '小红书：实验性适配（通常需要登录）',
  }

  const el = {
    platform: document.getElementById('uve-platform'),
    statusCard: document.getElementById('uve-status-card'),
    statusTitle: document.getElementById('uve-status-title'),
    statusDesc: document.getElementById('uve-status-desc'),
    spinner: document.getElementById('uve-spinner'),
    progress: document.getElementById('uve-progress'),
    hint: document.getElementById('uve-hint'),
    resultCard: document.getElementById('uve-result-card'),
    title: document.getElementById('uve-title'),
    meta: document.getElementById('uve-meta'),
    degraded: document.getElementById('uve-degraded'),
    transcript: document.getElementById('uve-transcript'),
    segments: document.getElementById('uve-segments'),
    links: document.getElementById('uve-links'),
    errorCard: document.getElementById('uve-error-card'),
    error: document.getElementById('uve-error'),
    guide: document.getElementById('uve-guide'),
  }

  function setStatus(title, desc, progress) {
    el.statusTitle.textContent = title
    if (desc) el.statusDesc.textContent = desc
    if (typeof progress === 'number') el.progress.style.width = Math.max(4, Math.min(100, progress)) + '%'
  }

  function showError(message, guide) {
    el.statusCard.classList.add('uve-hidden')
    el.resultCard.classList.add('uve-hidden')
    el.errorCard.classList.remove('uve-hidden')
    el.error.textContent = message || '未知错误'
    el.guide.textContent = guide || ''
  }

  function setSpinner(on) {
    el.spinner.style.display = on ? '' : 'none'
  }

  function readKey() {
    const params = new URLSearchParams(location.search)
    return params.get('key') || ''
  }

  async function getSessionToken() {
    try {
      const cfg = window.LinkVaultExtConfig || {}
      // window.supabase 是 CloudBase shim（lib/supabase.js），不是 Supabase 后端
      const sb = window.supabase.createClient(cfg.CLOUDBASE_ENV_ID, cfg.CLOUDBASE_PUBLISHABLE_KEY)
      for (let i = 0; i < 10; i += 1) {
        const res = await sb.auth.getSession()
        const session = res && res.data && res.data.session
        const token = session && (session.accessToken || session.access_token || session.token)
        if (token) return token
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      return ''
    } catch (_) {
      return ''
    }
  }

  function platformGuide(platform, reason) {
    if (reason === 'inject_failed') {
      return '浏览器不允许读取该页面（可能页面未加载完成或浏览器版本过旧）。请刷新页面后重试。'
    }
    if (reason === 'unsupported_page') {
      return '当前页面不是支持的视频详情页，请打开具体视频后再试。'
    }
    if (reason === 'no_page_state') {
      return '没有读取到页面播放数据，请等视频开始播放后重试。'
    }
    if (reason === 'no_media_url') {
      if (platform === 'douyin') {
        return '抖音页面没有暴露可下载地址（常见于未登录、触发验证码或页面改版）。请先在抖音网页版登录并播放一次再试；抖音适配目前是实验性。'
      }
      if (platform === 'xiaohongshu') {
        return '小红书页面没有暴露视频地址（通常需要登录）。当前为实验性适配，可能无法使用。'
      }
      return 'B站页面还没有加载出播放地址，请刷新页面、登录后重试。'
    }
    return '请刷新页面后重试；如果持续失败，请反馈该视频链接。'
  }

  function renderResult(result) {
    el.statusCard.classList.add('uve-hidden')
    el.errorCard.classList.add('uve-hidden')
    el.resultCard.classList.remove('uve-hidden')
    el.title.textContent = result.title || '（无标题）'
    const meta = []
    if (result.duration) meta.push(Math.floor(result.duration / 60) + ' 分 ' + (result.duration % 60) + ' 秒')
    if (result.uploader) meta.push(result.uploader)
    if (result.source) meta.push(result.source)
    el.meta.textContent = meta.join(' · ')

    if (result.degraded) {
      el.degraded.classList.remove('uve-hidden')
      el.degraded.textContent =
        '本次结果有降级：可能缺少时间轴，或扩展只提供了音频/视频之一（例如抖音只拿到视频地址时不做单独 OCR）。'
    }

    const transcript = result.transcript || null
    el.transcript.textContent = (transcript && transcript.text) || '没有拿到口播转写（视频可能无人声或仅有音乐）。'
    const segments = transcript && Array.isArray(transcript.segments) ? transcript.segments : []
    el.segments.textContent = segments
      .slice(0, 80)
      .map((s) => '[' + Number(s.start || 0).toFixed(1) + 's] ' + (s.text || ''))
      .join('\n')

    el.links.innerHTML = ''
    const urls = Array.isArray(result.on_screen_urls) ? result.on_screen_urls : []
    if (!urls.length) {
      el.links.textContent = '画面中没有识别到网址（或本次未启用OCR）。'
    } else {
      for (const item of urls) {
        const a = document.createElement('a')
        a.href = item.url
        a.target = '_blank'
        a.rel = 'noreferrer'
        a.textContent = item.url + (item.confidence ? '（置信度 ' + Math.round(item.confidence * 100) + '%）' : '')
        el.links.appendChild(a)
      }
    }
  }

  async function pollJob(jobId, token) {
    const started = Date.now()
    while (Date.now() - started < POLL_MAX_MS) {
      const res = await fetch(API_BASE + '/extract-video', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ action: 'deep_status', job_id: jobId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        throw new Error((data && data.error) || '查询深度任务失败（HTTP ' + res.status + '）')
      }
      if (data.status === 'queued') {
        setStatus('实验性深度解析排队中…', '任务已提交，正在等待 Worker 处理。', 10)
      } else if (data.status === 'running') {
        const progress = Math.round(Number(data.progress || 0) * 100)
        const stageMap = {
          download: '下载音视频',
          asr: '语音转写',
          ocr: '画面网址识别',
          aggregate: '汇总结果',
        }
        setStatus(
          '实验性深度解析中：' + (stageMap[data.stage] || data.stage || '处理中'),
          '已完成 ' + progress + '%',
          progress,
        )
      } else if (data.status === 'done') {
        return data.result || {}
      } else if (data.status === 'failed') {
        const error = data.error || {}
        const code = error.code || 'deep_failed'
        const refundNote = data.quota_refunded ? ' 本次体验额度已退回。' : ''
        const message = (error.message || '深度解析失败') + refundNote
        const withRefund = (guide) => (guide || '') + refundNote
        if (code === 'download_failed') {
          throw Object.assign(new Error(message), {
            guide: withRefund(
              '扩展提供的播放地址可能已过期。请回到原视频页面刷新后，重新右键使用「与链：深度解析此视频」。',
            ),
          })
        }
        if (code === 'too_long') {
          throw Object.assign(new Error(message), { guide: withRefund('视频超过时长/体积上限，请换更短的视频。') })
        }
        if (code === 'ocr_unavailable') {
          throw Object.assign(new Error(message), { guide: withRefund('画面 OCR 暂未启用，可先只用口播转写。') })
        }
        throw new Error(message)
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw Object.assign(new Error('深度解析超时'), {
      guide: '任务超过 4 分钟未完成，请稍后重试或换更短的视频。',
    })
  }

  async function submitDeep(state, token) {
    const payload = state.payload || {}
    const includeOcr = Array.isArray(payload.video_urls) && payload.video_urls.length > 0
    const body = {
      action: 'deep',
      url: state.url || payload.url,
      include: { transcript: true, ocr: includeOcr },
      client: {
        platform: payload.platform,
        title: payload.title,
        duration: payload.duration,
        uploader: payload.uploader,
        audio_urls: payload.audio_urls || [],
        video_urls: payload.video_urls || [],
        referer: payload.referer,
      },
    }
    setStatus('已读取页面播放地址，正在提交任务…', '使用你自己的浏览器 IP 与登录态，不会额外登录平台。', 6)
    const res = await fetch(API_BASE + '/extract-video', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (res.status === 401 || (data && data.code === 'login_required')) {
      throw Object.assign(new Error('需要先登录与链'), {
        guide: '请打开 https://ulink.ren/app?login=1 登录后，再回来重试；扩展里的登录态与网页端共用。',
      })
    }
    if (res.status === 429 || (data && data.code === 'deep_quota_exceeded')) {
      throw Object.assign(new Error((data && data.error) || '今日实验性深度解析体验额度已用完'), {
        guide: '深度解析是实验性体验额度（每日 2 次），不是主套餐固定承诺；额度用完请明天再试。',
      })
    }
    if (!res.ok || !data || !data.job_id) {
      throw Object.assign(new Error((data && data.error) || '提交深度任务失败（HTTP ' + res.status + '）'), {
        guide: '服务可能暂时不可用，请稍后重试。',
      })
    }
    return data.job_id
  }

  async function main() {
    const key = readKey()
    if (!key) {
      showError('打开方式不正确', '请回到视频页面，右键选择「与链：深度解析此视频」。')
      return
    }
    const stored = await new Promise((resolve) => {
      chrome.storage.local.get([key], function (items) {
        resolve(items && items[key])
      })
    })
    if (!stored) {
      showError('没有找到页面数据', '请回到视频页面重新右键解析；页面数据只在本次操作内有效。')
      return
    }
    const platform = stored.platform || (stored.payload && stored.payload.platform) || ''
    el.platform.textContent = PLATFORM_LABELS[platform] || '视频解析'
    el.hint.textContent = PLATFORM_NOTES[platform] || ''

    if (!stored.ok) {
      showError(
        platform === 'bilibili'
          ? 'B站页面没有返回播放数据'
          : platform === 'douyin'
            ? '抖音页面没有暴露可下载地址'
            : '页面没有暴露视频地址',
        platformGuide(platform, stored.reason),
      )
      return
    }

    try {
      setSpinner(true)
      const token = await getSessionToken()
      if (!token) {
        throw Object.assign(new Error('需要先登录与链'), {
          guide: '请打开 https://ulink.ren/app?login=1 登录；扩展与网页端共用登录态，登录后重新右键解析。',
        })
      }
      const jobId = await submitDeep(stored, token)
      const result = await pollJob(jobId, token)
      renderResult(result)
    } catch (e) {
      showError((e && e.message) || '解析失败', (e && e.guide) || '请稍后重试。')
    } finally {
      setSpinner(false)
    }
  }

  main()
})()
