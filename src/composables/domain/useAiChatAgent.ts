/**
 * useAiChatAgent.ts — AI Agent 工具执行分发（自 useAiChat.ts 的 handleAiSubmit 内嵌
 * runAgentToolCall 纯搬运抽出为可注入依赖的工厂）
 * 职责：模型 Tool Calling 的单一分发点，首轮与续轮工具链共用同一分发（防多轮复刻同类分支）。
 * 入参显式携带 assistantTurn 与 controller（等同原闭包捕获的同名变量），行为与拆分前逐字一致。
 */
import { dispatchSiteCommand, batchTagBookmarks } from '../../lib/ai/siteCommander.js'
import {
  executeManageCategories,
  executeManageTags,
  executeManageBookmarks,
  executeManageWorkspaces,
  executeManageSettings,
} from '../../lib/ai/universalAgent.js'
import { createTaskDagPlan } from '../../lib/ai/taskPlanner.js'
import { createDedupDraftDiff } from '../../lib/ai/draftDiff.js'
import { findDuplicateCandidates } from '../../lib/ai/localClustering.js'
import { buildDagPlanActionCard, buildDraftDiffActionCard } from '../../lib/ai/siteHitl.js'
import { fetchPageContentViaJina } from '../../lib/ai/jinaReader.js'
import {
  fetchVideoExtractServer,
  isVideoPlatformUrl,
  buildVideoContentText,
  videoSourceLabel,
  extractVideoInsightsWithAI,
} from '../../lib/ai/videoExtract.js'
import {
  submitDeepVideo,
  pollDeepVideo,
  deepStageLabel,
  isDeepVideoAvailable,
  isDeepVideoError,
  type DeepVideoJobStatus,
  type DeepVideoResult,
} from '../../lib/ai/deepVideoExtract.js'
import { toast } from '../../lib/toast.js'
import type { useI18n } from '../../i18n/index.js'
import type { useDataStore } from '../../stores/data.js'
import type { useUIStore } from '../../stores/ui.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

/** 工具执行器依赖（由请求编排层注入） */
export interface AiAgentToolContext {
  ds: ReturnType<typeof useDataStore>
  ui: ReturnType<typeof useUIStore>
  t: ReturnType<typeof useI18n>['t']
  tN: ReturnType<typeof useI18n>['tN']
}

export function createAiAgentToolRunner(context: AiAgentToolContext) {
  const { ds, ui, t, tN } = context

  /** 深度解析结果 → 给模型阅读的纯文本（标题/时长/上传者/口播转写/画面网址） */
  function buildDeepVideoText(result: DeepVideoResult | undefined): string {
    if (!result) return ''
    const parts: string[] = []
    if (result.title) parts.push(`标题：${result.title}`)
    if (result.uploader) parts.push(`上传者：${result.uploader}`)
    if (typeof result.duration === 'number' && result.duration > 0) {
      const total = Math.round(result.duration)
      const mm = Math.floor(total / 60)
      const ss = total % 60
      parts.push(`时长：${mm > 0 ? `${mm} 分 ` : ''}${ss} 秒`)
    }
    const transcript = (result.transcript?.text || '').trim()
    if (transcript) {
      // 口播转写可能很长：截断到 6000 字再交给后续提炼/模型，避免撑爆单条消息上限
      parts.push(`实验性口播转写（语音识别生成，可能有个别错字）：\n${transcript.slice(0, 6000)}`)
    }
    const urls = Array.isArray(result.on_screen_urls) ? result.on_screen_urls : []
    if (urls.length > 0) {
      const lines = urls.slice(0, 30).map((u) => {
        const extra: string[] = []
        if (typeof u.confidence === 'number') extra.push(`置信度 ${Math.round(u.confidence * 100)}%`)
        if (typeof u.frames === 'number') extra.push(`出现 ${u.frames} 帧`)
        return `- ${u.url}${extra.length ? `（${extra.join('，')}）` : ''}`
      })
      parts.push(`画面识别网址：\n${lines.join('\n')}`)
    }
    return parts.join('\n\n')
  }

  /**
   * deep_read_video 工具执行：提交异步任务 → 轮询（steps 实时展示阶段）→ 拼文本 →
   * 交给现有 LLM 提炼（含画面网址，便于生成候选书签卡片）。
   * 配额/登录/服务不可用一律如实回传并 toast，不静默降级（降级等于绕过配额）。
   */
  async function runDeepReadVideo(
    assistantTurn: ChatTurn,
    controller: AbortController,
    args: Record<string, any> | undefined,
  ): Promise<string> {
    const rawUrl = typeof args?.url === 'string' ? args.url.trim() : ''
    const question = typeof args?.question === 'string' ? args.question.trim().slice(0, 200) : ''
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || !isVideoPlatformUrl(rawUrl)) {
      return t('ai.deepReadNeedVideoUrl')
    }
    // B站/抖音在机房 IP 上会被风控，官方推荐路径是浏览器扩展读取页面态播放地址
    const needsExtension = /bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com/i.test(rawUrl)
    const extensionHint = needsExtension ? `\n\n${t('ai.deepNeedsExtension')}` : ''
    if (!isDeepVideoAvailable()) {
      toast(t('ai.deepUnavailable'), false)
      return t('ai.deepUnavailable') + extensionHint
    }

    if (!assistantTurn.steps) assistantTurn.steps = []
    assistantTurn.steps.push({ text: t('ai.deepSubmitting', { url: rawUrl }), done: false })
    const stepIndex = assistantTurn.steps.length - 1
    // 必须经 reactive proxy 写入才能驱动聊天步骤实时刷新（直接改局部对象不会触发依赖更新）
    const setStep = (text: string, done = false): void => {
      const step = assistantTurn.steps?.[stepIndex]
      if (step) {
        step.text = text
        step.done = done
      }
    }

    try {
      const job = await submitDeepVideo(rawUrl, { signal: controller.signal })
      setStep(t('ai.deepJobQueued', { eta: job.eta_seconds != null ? job.eta_seconds : 60 }))
      const final: DeepVideoJobStatus = await pollDeepVideo(job.job_id, {
        signal: controller.signal,
        onProgress: (stage, progress) => {
          setStep(t('ai.deepStageProgress', { stage: deepStageLabel(stage), progress: Math.round(progress * 100) }))
        },
      })
      if (final.status === 'failed') {
        const code = final.error?.code || 'internal'
        const message = final.error?.message || '—'
        const refundedHint = final.quota_refunded ? `\n\n${t('ai.deepQuotaRefunded')}` : ''
        const failedText = t('ai.deepFailed', { code, message }) + extensionHint + refundedHint
        setStep(failedText, false)
        toast(failedText, false)
        return failedText
      }

      const deepText = buildDeepVideoText(final.result)
      if (!deepText) {
        setStep(t('ai.deepResultEmpty'))
        return t('ai.deepResultEmpty')
      }

      // 转写与画面网址一并交给现有 LLM 提炼（内部 sanitizeForPrompt 截断），产出候选书签卡片
      const insight = await extractVideoInsightsWithAI(deepText, ds.categories, ds.customAttributes, {
        signal: controller.signal,
        question: question || undefined,
      })
      if (insight.candidates?.length) {
        const seen = new Set((assistantTurn.candidates || []).map((c) => c.url))
        const fresh = insight.candidates.filter((c) => c.url && !seen.has(c.url))
        if (fresh.length) assistantTurn.candidates = [...(assistantTurn.candidates || []), ...fresh]
      }
      setStep(t('ai.deepStageDone'), true)
      return insight.summary ? `${insight.summary}\n\n${deepText}` : deepText
    } catch (err) {
      if (isDeepVideoError(err)) {
        if (err.code === 'aborted') {
          setStep(t('ai.stopped'), false)
          return t('ai.stopped')
        }
        const message =
          err.code === 'login_required'
            ? t('ai.deepLoginRequired')
            : err.code === 'deep_quota_exceeded'
              ? err.limit != null
                ? t('ai.deepQuotaExceeded', { limit: err.limit })
                : t('ai.deepQuotaExceededUnknown')
              : err.code === 'deep_unavailable'
                ? t('ai.deepUnavailable') + extensionHint
                : err.code === 'timeout'
                  ? t('ai.deepTimeout')
                  : err.message || t('ai.deepRequestFailedNetwork')
        setStep(message, false)
        if (err.code !== 'timeout') toast(message, false)
        return message
      }
      const message = err instanceof Error && err.message ? err.message : t('ai.deepRequestFailedNetwork')
      setStep(message, false)
      return message
    }
  }

  // Agent 工具执行器：首轮与续轮工具链共用同一分发（单一分发点，防多轮复刻同类分支）
  return async function runAgentToolCall(
    assistantTurn: ChatTurn,
    controller: AbortController,
    call: { name: string; arguments?: Record<string, any>; argsParseFailed?: boolean },
  ): Promise<string> {
    // 参数 JSON 解析失败：不执行任何副作用，如实回错误结果给模型（role:'tool'）
    if (call.argsParseFailed) return t('ai.toolResultArgsInvalid', { name: call.name })
    let resultText = ''
    if (call.name === 'audit_vault') {
      const siteRes = await dispatchSiteCommand('/health', { ds, ui, app: (ui as any).app, signal: controller.signal })
      if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
      if (!assistantTurn.content) assistantTurn.content = siteRes.reply
      resultText = siteRes.reply
    } else if (call.name === 'inbox_zero') {
      const siteRes = await dispatchSiteCommand('/inbox', { ds, ui, app: (ui as any).app, signal: controller.signal })
      if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
      if (!assistantTurn.content) assistantTurn.content = siteRes.reply
      resultText = siteRes.reply
    } else if (call.name === 'create_workspace') {
      const topic = call.arguments?.topic || t('ai.wsTopicDefault')
      assistantTurn.actionCard = {
        type: 'custom',
        actionName: 'create_topic_workspace',
        title: t('ai.wsCardTitle', { name: topic }),
        desc: tN('ai.wsCardDesc', (assistantTurn.candidates || []).length, { n: (assistantTurn.candidates || []).length }),
        buttonText: t('ai.wsCardButton'),
        payload: {
          topic,
          candidates: assistantTurn.candidates,
        },
      }
      resultText = tN('ai.toolResultWorkspaceCard', (assistantTurn.candidates || []).length, { topic, n: (assistantTurn.candidates || []).length })
    } else if (call.name === 'merge_duplicates') {
      const siteRes = await dispatchSiteCommand('/dedup', { ds, ui, app: (ui as any).app, signal: controller.signal })
      if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
      if (!assistantTurn.content) assistantTurn.content = siteRes.reply
      resultText = siteRes.reply
    } else if (call.name === 'heal_deadlinks') {
      const target = call.arguments?.target
      if (target && target !== 'all') {
        const found = ds.bookmarks.some(
          (b) => !b.deletedAt && (b.id === target || b.title?.includes(target) || b.url?.includes(target))
        )
        if (!found) {
          resultText = `书签库中未找到与「${target}」相关的有效书签，未执行死链替换。`
          return resultText
        }
      }
      const targetParam = target && target !== 'all' ? ` ${target}` : ''
      const siteRes = await dispatchSiteCommand(`/deadlink${targetParam}`, { ds, ui, app: (ui as any).app, signal: controller.signal })
      if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
      if (!assistantTurn.content) assistantTurn.content = siteRes.reply
      resultText = siteRes.reply
    } else if (call.name === 'toggle_theme') {
      // 必填参数缺失/非法不静默兜底：如实回「未执行」，不伪报切换成功（约束：结果如实）
      const mode = call.arguments?.mode
      if (typeof mode !== 'string' || !mode.trim()) {
        resultText = t('ai.toolResultArgsRejected', { name: call.name })
      } else {
        const siteRes = await dispatchSiteCommand(`/theme ${mode}`, { ds, ui, app: (ui as any).app, signal: controller.signal })
        // 命令未命中（如非法枚举值）时 dispatch 返回 handled:false，同样不得伪报成功
        resultText = siteRes.handled && siteRes.reply
          ? siteRes.reply
          : t('ai.toolResultNotExecuted', { name: call.name })
      }
    } else if (call.name === 'change_view') {
      const layout = call.arguments?.layout
      if (typeof layout !== 'string' || !layout.trim()) {
        resultText = t('ai.toolResultArgsRejected', { name: call.name })
      } else {
        const siteRes = await dispatchSiteCommand(`/view ${layout}`, { ds, ui, app: (ui as any).app, signal: controller.signal })
        resultText = siteRes.handled && siteRes.reply
          ? siteRes.reply
          : t('ai.toolResultNotExecuted', { name: call.name })
      }
    } else if (call.name === 'export_data') {
      const format = call.arguments?.format === 'html' ? 'html' : 'json'
      const siteRes = await dispatchSiteCommand(`/export ${format}`, { ds, ui, app: (ui as any).app, signal: controller.signal })
      resultText = siteRes.handled && siteRes.reply
        ? siteRes.reply
        : t('ai.toolResultNotExecuted', { name: call.name })
    } else if (call.name === 'plan_task_dag') {
      const title = call.arguments?.title || t('ai.planDefaultTitle')
      const description = call.arguments?.description || ''
      const rawSteps = Array.isArray(call.arguments?.steps) ? call.arguments.steps : []
      const plan = createTaskDagPlan({
        title,
        description,
        steps: rawSteps.map((s: any, idx: number) => ({
          id: s.id || `step_${idx + 1}`,
          title: s.title || `步骤 ${idx + 1}`,
          desc: s.desc,
          actionName: s.actionName,
          actionArgs: s.actionArgs,
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
        })),
      })
      assistantTurn.actionCard = buildDagPlanActionCard(plan)
      resultText = t('ai.toolResultDagPlanCreated', { title, count: plan.steps.length })
    } else if (call.name === 'preview_draft_diff') {
      const target = call.arguments?.target || 'inbox'
      if (target === 'dedup') {
        const dups = findDuplicateCandidates(ds.bookmarks)
        const diffPayload = createDedupDraftDiff({ duplicates: dups })
        assistantTurn.actionCard = buildDraftDiffActionCard(diffPayload)
        resultText = t('ai.toolResultDedupDiffCreated', { count: diffPayload.stats.total })
      } else {
        const siteRes = await dispatchSiteCommand('/inbox', { ds, ui, app: (ui as any).app, signal: controller.signal })
        if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
        resultText = siteRes.reply
      }
    } else if (call.name === 'read_webpage') {
      const url = call.arguments?.url
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        resultText = '读取失败：未提供有效公开网址（必须以 http:// 或 https:// 开头）。'
      } else {
        const targetUrl = url.trim()
        if (!assistantTurn.steps) assistantTurn.steps = []
        const isVideo = isVideoPlatformUrl(targetUrl)
        assistantTurn.steps.push({
          text: isVideo ? `正在解析视频内容：${targetUrl}` : `正在读取网页正文：${targetUrl}`,
          done: true,
        })
        // 普通网页抓取兜底（视频平台解析失败时才走，仍如实回报失败原因）
        const readPlainPage = async (): Promise<string> => {
          const pageData = await fetchPageContentViaJina(targetUrl, { signal: controller.signal, timeoutMs: 9000, maxChars: 25000 })
          if (!pageData.success || !pageData.markdown) {
            return `读取网页失败：${pageData.error || '未能成功获取该网页正文内容'}`
          }
          return `网页标题：「${pageData.title || '无标题'}」\n\n正文摘要提取：\n${pageData.markdown.slice(0, 3200)}`
        }
        try {
          if (isVideo) {
            // 视频/图文平台：优先走 extract-video（服务端平台适配器 + yt-dlp 微服务），
            // 避免抖音这类强风控站点在 r.jina.ai 上直接 502
            const video = await fetchVideoExtractServer(targetUrl, { signal: controller.signal })
            if (video?.quotaExceeded) {
              // 今日额度用完：不再降级抓取（否则等于绕过配额），如实告知用户
              resultText = t('ai.videoQuotaExceeded', video.quotaLimit != null ? { limit: video.quotaLimit } : {})
            } else {
              const videoText = video ? buildVideoContentText(video) : ''
              // 来源展示中文标签（不回显内部枚举）；degraded 必须披露「已降级为 r.jina.ai 网页正文」
              const degradedHint = video?.degraded ? `\n\n${t('ai.videoDegradedNotice')}` : ''
              resultText = videoText
                ? `视频内容解析（来源：${videoSourceLabel(video!.source)}）\n\n${videoText.slice(0, 3200)}${degradedHint}`
                : await readPlainPage()
            }
          } else {
            resultText = await readPlainPage()
          }
        } catch (fetchErr: any) {
          resultText = `抓取网页异常：${fetchErr?.message || '网络连接或服务异常'}`
        }
      }
    } else if (call.name === 'deep_read_video') {
      // 视频深度解析（异步：口播 ASR + 画面网址 OCR）；失败/配额/登录一律如实回传
      resultText = await runDeepReadVideo(assistantTurn, controller, call.arguments)
    } else if (call.name === 'batch_tag_bookmarks') {
      const items = Array.isArray(call.arguments?.items) ? call.arguments.items : []
      if (items.length === 0) {
        resultText = '未提供待打标书签列表，未执行打标。'
      } else {
        const res = await batchTagBookmarks(items, { ds, ui, app: (ui as any).app, signal: controller.signal })
        if (res.success && res.taggedCount > 0) {
          resultText = `${res.message}\n已打标明细：\n${res.details.map((d) => `• ${d.title}: [${d.tags.join(', ')}]`).join('\n')}`
          if (!assistantTurn.steps) assistantTurn.steps = []
          assistantTurn.steps.push({ text: `已完成 ${res.taggedCount} 个书签的标签写入`, done: true })
          assistantTurn.actionCard = {
            type: 'custom',
            actionName: 'batch_tag_bookmarks',
            title: `批量标签写入（${res.taggedCount} 个书签）`,
            desc: res.details.slice(0, 5).map((d) => `${d.title} → ${d.tags.join('、')}`).join('；') + (res.details.length > 5 ? ` 等共 ${res.taggedCount} 项` : ''),
            buttonText: '已完成打标',
            completed: true,
            payload: { items },
          }
        } else {
          resultText = res.message || '未匹配到可打标的书签。'
        }
      }
    } else if (call.name === 'manage_categories') {
      const res = await executeManageCategories((call.arguments || {}) as any, { ds, ui, app: (ui as any).app, signal: controller.signal })
      resultText = res.message
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
      }
    } else if (call.name === 'manage_tags') {
      const res = await executeManageTags((call.arguments || {}) as any, { ds, ui, app: (ui as any).app, signal: controller.signal })
      resultText = res.message
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
      }
    } else if (call.name === 'manage_bookmarks') {
      const res = await executeManageBookmarks((call.arguments || {}) as any, { ds, ui, app: (ui as any).app, signal: controller.signal })
      resultText = res.message
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
        if (res.data?.id) {
          assistantTurn.actionCard = {
            type: 'custom',
            actionName: 'manage_bookmarks',
            title: `书签「${res.data.title}」`,
            desc: res.data.url,
            buttonText: '已完成操作',
            completed: true,
            payload: call.arguments,
          }
        }
      }
    } else if (call.name === 'manage_workspaces') {
      const res = await executeManageWorkspaces((call.arguments || {}) as any, { ds, ui, app: (ui as any).app, signal: controller.signal })
      resultText = res.message
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
        if (res.data?.id) {
          assistantTurn.actionCard = {
            type: 'custom',
            actionName: 'create_topic_workspace',
            title: `工作台「${res.data.name}」`,
            desc: `包含 ${res.data.bookmarkIds?.length || 0} 个书签工具`,
            buttonText: '聚焦查看',
            completed: true,
            resultGid: res.data.id,
          }
        }
      }
    } else if (call.name === 'manage_settings') {
      const res = await executeManageSettings((call.arguments || {}) as any, { ds, ui, app: (ui as any).app, signal: controller.signal })
      resultText = res.message
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
      }
    } else {
      resultText = t('ai.toolResultUnknown', { name: call.name })
    }
    return resultText
  }
}
