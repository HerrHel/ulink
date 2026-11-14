/**
 * useAiChatAgent.ts — AI Agent 工具执行分发（自 useAiChat.ts 的 handleAiSubmit 内嵌
 * runAgentToolCall 纯搬运抽出为可注入依赖的工厂）
 * 职责：模型 Tool Calling 的单一分发点，首轮与续轮工具链共用同一分发（防多轮复刻同类分支）。
 * 入参显式携带 assistantTurn 与 controller（等同原闭包捕获的同名变量），行为与拆分前逐字一致。
 */
import { dispatchSiteCommand, batchTagBookmarks } from '../../lib/ai/siteCommander.js'
import { mergeDuplicateBookmarks } from '../../lib/ai/siteActions.js'
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
} from '../../lib/ai/videoExtract.js'
import { isPrivateUrl } from '../../lib/ai/urlGuard.js'
// 硬编码失败文案统一取自 toolResult 登记常量，与状态判定兜底同源，保证失败不报成功
import { HARDCODED_NOT_EXECUTED_TEXTS, DYNAMIC_NOT_EXECUTED_PREFIX } from '../../lib/ai/toolResult.js'


import type { useI18n } from '../../i18n/index.js'
import type { useDataStore } from '../../stores/data.js'
import type { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

/**
 * #9 破坏性写工具门槛：模型参数里的 confirm:true 不算「用户确认」（可被 RAG 召回 /
 * 网页正文 / 附件全文里的注入指令伪造），必须经 UI 点击 actionCard 确认后由
 * confirmDestructiveTool() 登记一次性许可，否则一律拒绝执行、只生成待确认卡片。
 */
const DESTRUCTIVE_CONFIRMED = new Set<string>()

/** 稳定签名：按参数键排序后序列化，避免键序差异导致确认许可不匹配 */
function destructiveToolSignature(call: { name: string; arguments?: Record<string, any> }): string {
  let args = '{}'
  try {
    const a = call.arguments || {}
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(a).sort()) sorted[k] = a[k]
    args = JSON.stringify(sorted)
  } catch { /* 参数不可序列化时签名退化，仍按 name 匹配 */ }
  return `${call.name}:${args}`
}

/** 判定一次工具调用是否属于「破坏性写」白名单 */
export function isDestructiveToolCall(call: { name: string; arguments?: Record<string, any> }): boolean {
  const action = call.arguments?.action
  if (call.name === 'manage_settings') return action === 'empty_trash' || action === 'export_data'
  if (call.name === 'manage_bookmarks') return action === 'delete' || action === 'move'
  if (call.name === 'merge_duplicates') return call.arguments?.confirm === true
  if (call.name === 'export_data') return true // 旧独立导出工具
  return false
}

/**
 * #9 UI 接线点：用户在破坏性操作的 actionCard 上点「确认」时调用，登记该调用的一次性许可。
 * 随后模型续轮重发同一调用，runAgentToolCall 消费许可并放行执行。
 * 需接线位置见文末报告（useAiActionCards.ts 的 handleActionCardClick 新增分支）。
 */
export function confirmDestructiveTool(call: { name: string; arguments?: Record<string, any> }): void {
  DESTRUCTIVE_CONFIRMED.add(destructiveToolSignature(call))
}

/** 清空全部确认许可（新会话 / 停止生成 / 切换账号 / 测试复位） */
export function resetDestructiveConfirmations(): void {
  DESTRUCTIVE_CONFIRMED.clear()
}

/** 工具执行器依赖（由请求编排层注入） */
export interface AiAgentToolContext {
  ds: ReturnType<typeof useDataStore>
  ui: ReturnType<typeof useUIStore>
  t: ReturnType<typeof useI18n>['t']
  tN: ReturnType<typeof useI18n>['tN']
}

function resolveAppStore() {
  try {
    if (typeof useAppStore === 'function') return useAppStore()
  } catch {
    // 兼容部分仅 mock 了 saveAppData 的测试沙箱
  }
  return { save: () => {} } as unknown as ReturnType<typeof useAppStore>
}

export function createAiAgentToolRunner(context: AiAgentToolContext) {
  const { ds, ui, t, tN } = context

  /**
   * deep_read_video 工具执行：平台深度解析已下线，统一引导用户使用「上传媒体解析」。
   */
  async function runDeepReadVideo(
    _assistantTurn: ChatTurn,
    _controller: AbortController,
    args: Record<string, any> | undefined,
  ): Promise<string> {
    const rawUrl = typeof args?.url === 'string' ? args.url.trim() : ''
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl) || !isVideoPlatformUrl(rawUrl)) {
      return t('ai.deepReadNeedVideoUrl')
    }
    // 平台深度解析已下线：不再抓取第三方平台，统一引导用户上传授权文件
    return t('ai.deepUploadGuide')
  }

  // Agent 工具执行器：首轮与续轮工具链共用同一分发（单一分发点，防多轮复刻同类分支）
  const app = resolveAppStore()
  return async function runAgentToolCall(
    assistantTurn: ChatTurn,
    controller: AbortController,
    call: { name: string; arguments?: Record<string, any>; argsParseFailed?: boolean },
  ): Promise<string> {
    // 参数 JSON 解析失败：不执行任何副作用，如实回错误结果给模型（role:'tool'）
    if (call.argsParseFailed) return t('ai.toolResultArgsInvalid', { name: call.name })

    // #9：破坏性写工具门槛——未经本轮用户显式确认一律拒绝执行，只生成待确认卡片。
    if (isDestructiveToolCall(call) && !DESTRUCTIVE_CONFIRMED.delete(destructiveToolSignature(call))) {
      assistantTurn.actionCard = {
        type: 'custom',
        actionName: 'confirm_destructive_tool',
        title: `请确认操作：${call.name}`,
        desc: `模型请求执行「${call.name}」（${JSON.stringify(call.arguments || {}).slice(0, 200)}），该操作会删除/移动/导出数据；确认后才会真正执行。`,
        buttonText: '我已确认，执行',
        payload: { toolCall: { name: call.name, arguments: call.arguments } },
      }
      // 拒绝执行：以 DYNAMIC_NOT_EXECUTED_PREFIX 兜底，保证 inferToolExecStatus 判
      // not_executed（绝不误报 executed）；语义为 proposed（HITL 待确认），由 actionCard
      // 承载用户确认入口。模型据此不得宣称操作已完成，须提示用户点击卡片确认。
      return `${DYNAMIC_NOT_EXECUTED_PREFIX}该操作「${call.name}」需用户显式确认（proposed，已生成待确认卡片），未执行任何写操作。`
    }
    let resultText = ''
    if (call.name === 'audit_vault') {
      const siteRes = await dispatchSiteCommand('/health', { ds, ui, app, signal: controller.signal })
      if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
      if (!assistantTurn.content) assistantTurn.content = siteRes.reply
      resultText = siteRes.reply
    } else if (call.name === 'inbox_zero') {
      const siteRes = await dispatchSiteCommand('/inbox', { ds, ui, app, signal: controller.signal })
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
      const confirm = Boolean(call.arguments?.confirm)
      if (confirm) {
        const mergeRes = await mergeDuplicateBookmarks({ ds, ui, app, signal: controller.signal })
        resultText = mergeRes.message || t('aiCmd.mergeNone')
        if (!assistantTurn.content) assistantTurn.content = resultText
      } else {
        const siteRes = await dispatchSiteCommand('/dedup', { ds, ui, app, signal: controller.signal })
        if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
        if (!assistantTurn.content) assistantTurn.content = siteRes.reply
        resultText = siteRes.reply
      }
    } else if (call.name === 'heal_deadlinks') {
      const target = call.arguments?.target
      if (target && target !== 'all') {
        const found = ds.bookmarks.some(
          (b) => !b.deletedAt && (b.id === target || b.title?.includes(target) || b.url?.includes(target))
        )
        if (!found) {
          resultText = HARDCODED_NOT_EXECUTED_TEXTS.deadlinkNotFound(target)
          return resultText
        }
      }
      const targetParam = target && target !== 'all' ? ` ${target}` : ''
      const siteRes = await dispatchSiteCommand(`/deadlink${targetParam}`, { ds, ui, app, signal: controller.signal })
      if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
      if (!assistantTurn.content) assistantTurn.content = siteRes.reply
      resultText = siteRes.reply
    } else if (call.name === 'toggle_theme') {
      // 必填参数缺失/非法不静默兜底：如实回「未执行」，不伪报切换成功（约束：结果如实）
      const mode = call.arguments?.mode
      if (typeof mode !== 'string' || !mode.trim()) {
        resultText = t('ai.toolResultArgsRejected', { name: call.name })
      } else {
        const siteRes = await dispatchSiteCommand(`/theme ${mode}`, { ds, ui, app, signal: controller.signal })
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
        const siteRes = await dispatchSiteCommand(`/view ${layout}`, { ds, ui, app, signal: controller.signal })
        resultText = siteRes.handled && siteRes.reply
          ? siteRes.reply
          : t('ai.toolResultNotExecuted', { name: call.name })
      }
    } else if (call.name === 'export_data') {
      const format = call.arguments?.format === 'html' ? 'html' : 'json'
      const siteRes = await dispatchSiteCommand(`/export ${format}`, { ds, ui, app, signal: controller.signal })
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
        const siteRes = await dispatchSiteCommand('/inbox', { ds, ui, app, signal: controller.signal })
        if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
        resultText = siteRes.reply
      }
    } else if (call.name === 'read_webpage') {
      const url = call.arguments?.url
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        resultText = HARDCODED_NOT_EXECUTED_TEXTS.readInvalidUrl
      } else if (isPrivateUrl(url.trim())) {
        resultText = HARDCODED_NOT_EXECUTED_TEXTS.readPrivateBlocked
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
            return HARDCODED_NOT_EXECUTED_TEXTS.readFailed(pageData.error || '未能成功获取该网页正文内容')
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
              // 轻量解析完成后引导用户改用「上传媒体解析」做深度处理（不再依赖平台反爬/扩展）
              const uploadGuide = videoText ? `\n\n${t('ai.deepUploadGuide')}` : ''
              resultText = videoText
                ? `视频内容解析（来源：${videoSourceLabel(video!.source)}）\n\n${videoText.slice(0, 3200)}${degradedHint}${uploadGuide}`
                : await readPlainPage()
            }
          } else {
            resultText = await readPlainPage()
          }
        } catch (fetchErr: any) {
          resultText = HARDCODED_NOT_EXECUTED_TEXTS.fetchException(fetchErr?.message || '网络连接或服务异常')
        }
      }
    } else if (call.name === 'deep_read_video') {
      // 视频深度解析（异步：口播 ASR + 画面网址 OCR）；失败/配额/登录一律如实回传
      resultText = await runDeepReadVideo(assistantTurn, controller, call.arguments)
    } else if (call.name === 'batch_tag_bookmarks') {
      const items = Array.isArray(call.arguments?.items) ? call.arguments.items : []
      if (items.length === 0) {
        resultText = HARDCODED_NOT_EXECUTED_TEXTS.batchTagEmpty
      } else {
        const res = await batchTagBookmarks(items, { ds, ui, app, signal: controller.signal })
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
          resultText = `${DYNAMIC_NOT_EXECUTED_PREFIX}${res.message || HARDCODED_NOT_EXECUTED_TEXTS.batchTagNone}`
        }
      }
    } else if (call.name === 'manage_categories') {
      const res = await executeManageCategories((call.arguments || {}) as any, { ds, ui, app, signal: controller.signal })
      resultText = res.success ? res.message : `${DYNAMIC_NOT_EXECUTED_PREFIX}${res.message}`
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
      }
    } else if (call.name === 'manage_tags') {
      const res = await executeManageTags((call.arguments || {}) as any, { ds, ui, app, signal: controller.signal })
      resultText = res.success ? res.message : `${DYNAMIC_NOT_EXECUTED_PREFIX}${res.message}`
      if (res.success) {
        if (!assistantTurn.steps) assistantTurn.steps = []
        assistantTurn.steps.push({ text: res.message, done: true })
      }
    } else if (call.name === 'manage_bookmarks') {
      const res = await executeManageBookmarks((call.arguments || {}) as any, { ds, ui, app, signal: controller.signal })
      resultText = res.success ? res.message : `${DYNAMIC_NOT_EXECUTED_PREFIX}${res.message}`
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
      const res = await executeManageWorkspaces((call.arguments || {}) as any, { ds, ui, app, signal: controller.signal })
      resultText = res.success ? res.message : `${DYNAMIC_NOT_EXECUTED_PREFIX}${res.message}`
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
      const res = await executeManageSettings((call.arguments || {}) as any, { ds, ui, app, signal: controller.signal })
      resultText = res.success ? res.message : `${DYNAMIC_NOT_EXECUTED_PREFIX}${res.message}`
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
