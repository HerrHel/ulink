/**
 * useAiChatSubmit.ts — AI 核心提交调度（自 useAiChat.ts 纯搬运拆出）
 * 职责：handleAiSubmit 主流程：
 * 1. 附件解析 → 提问组装（含卡片/笔记深度结构化数据注入）；
 * 2. 分流：站内指令 → 视频提取 → 网址相似检索 → MiMo 自然语言（Tool Calling 循环）；
 * 3. history 组装防双份注入、askMiMoStream 流式回调、Agent 续轮编排、本地知识库兜底；
 * 4. 终端式输入历史记录与收尾（思考气泡置停、会话持久化）。
 * 共享状态由 useAiChat Facade 显式注入，行为与拆分前逐字一致。
 */
import { domain } from '../../utils.js'
import { wrapUntrustedData } from '../../lib/ai/mimoPrompt.js'
import {
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'
import { containsVideoPlatformUrl } from '../../lib/ai/videoPlatforms.js'
import { askMiMoStream, getMiMoConfig, sanitizeToolResult, type MiMoChatMessage } from '../../lib/ai/mimoClient.js'
import { dispatchSiteCommand } from '../../lib/ai/siteCommander.js'
import { normalizeWorkspaceTopic } from '../../lib/ai/siteActions.js'
import { updateSession, type AiChatSession, type ChatTurn } from '../../lib/ai/chatSessions.js'
import {
  resolveCardContext,
  formatAttachedCardsForPrompt,
  getDefaultAttachedPrompt,
  type ResolvedCardContext,
} from '../../lib/ai/cardReader.js'
import { formatAttachedFilesForPrompt } from '../../lib/ai/attachmentHelper.js'
import { prepareUnifiedMedia } from '../../lib/ai/unifiedMedia.js'
import { useAuthStore } from '../../stores/auth.js'
import { vaultRAG } from '../../lib/ai/localRAG.js'
import { expandQueryTerms } from '../../lib/ai/queryExpand.js'
import { remember, buildProfilePrompt } from '../../lib/ai/aiProfile.js'
import { buildUserMentalModel, formatMentalModelPrompt } from '../../lib/ai/mentalModel.js'
import { buildSendSummary } from '../../lib/ai/sendSummary.js'
import { isAiEnabled } from '../../lib/ai/aiEnabled.js'
import {
  inferToolExecStatus,
  formatToolResultForModel,
  type ToolExecStatus,
} from '../../lib/ai/toolResult.js'
import { toast } from '../../lib/toast.js'
import { createAiAgentToolRunner } from './useAiChatAgent.js'
import type { AbortControllerSlot } from './useAiChatSessions.js'
import type { useI18n } from '../../i18n/index.js'
import type { useDataStore } from '../../stores/data.js'
import type { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import type { AiSearchPreference } from '../../types/ai.js'
import { reactive, type Ref, type ComputedRef } from 'vue'

/** 本层依赖的共享状态与回调（由 useAiChat Facade 注入） */
export interface AiChatSubmitContext {
  ds: ReturnType<typeof useDataStore>
  ui: ReturnType<typeof useUIStore>
  aiQuery: Ref<string>
  aiLoading: Ref<boolean>
  loadingTextKey: Ref<string>
  preferences: Ref<AiSearchPreference[]>
  inputHistory: Ref<string[]>
  historyCursor: Ref<number>
  chatTurns: Ref<ChatTurn[]>
  sessions: Ref<AiChatSession[]>
  currentSessionId: Ref<string>
  abortSlot: AbortControllerSlot
  isZh: ComputedRef<boolean>
  t: ReturnType<typeof useI18n>['t']
  tN: ReturnType<typeof useI18n>['tN']
  persistCurrentSession: () => void
  handleCreateSession: () => void
  /** 对话轮次变化后需要滚动到底部时回调 */
  onTurnsChanged?: () => void
  /** aiQuery 被代码改写后回调（供调用方重置输入框高度） */
  onQueryChanged?: () => void
  /** 提交对话需切回「对话」tab 时回调 */
  showAiTab?: () => void
}

function resolveAppStore() {
  try {
    if (typeof useAppStore === 'function') return useAppStore()
  } catch {
    // 兼容部分仅 mock 了 saveAppData 的测试沙箱
  }
  return { save: () => {} } as unknown as ReturnType<typeof useAppStore>
}

export function useAiChatSubmit(context: AiChatSubmitContext) {
  const app = resolveAppStore()
  const {
    ds,
    ui,
    aiQuery,
    aiLoading,
    loadingTextKey,
    preferences,
    inputHistory,
    historyCursor,
    chatTurns,
    sessions,
    currentSessionId,
    abortSlot,
    isZh,
    t,
    tN,
    persistCurrentSession,
    handleCreateSession,
    onTurnsChanged,
    onQueryChanged,
    showAiTab,
  } = context

  /** 检索结果摘要：0 结果时改用空态引导文案，避免「甄选到 0 个」；
   *  全为通用兜底入口时不冒充个性化「甄选」，如实标注非个性化结果 */
  function formatFoundCount(n: number, videoTitle?: string, items?: Array<{ generic?: boolean }>): string {
    if (n <= 0) return t('ai.emptyResultsHint')
    const base = items && items.length > 0 && items.every((c) => c.generic)
      ? t('ai.foundCountFallback', { n })
      : t('ai.foundCountGeneric', { n })
    return videoTitle ? `${videoTitle} (${base})` : base
  }

  /**
   * 失败收尾（唯一收口点）：复位思考态、保留已生成片段、给出本地化原因。
   * 旧实现只置 loading=false，isThinking 仍为 true → 界面永远停在「正在思考…」；
   * 且把浏览器原始英文异常（如 network error）直接拼进中文提示，用户无法判断发生了什么。
   */
  function markTurnFailed(turn: ChatTurn, err: unknown) {
    turn.loading = false
    turn.isThinking = false
    turn.candidates = []
    const raw = err instanceof Error ? err.message : ''
    const streamErr = err as { isStreamError?: boolean; partialContent?: string; partialReasoning?: string } | null
    // 流式中断：已生成的思考/正文一律保留，正文后追加中断说明（可重试补齐）
    if (streamErr?.isStreamError) {
      if (streamErr.partialReasoning) turn.reasoning = streamErr.partialReasoning
      if (streamErr.partialContent && streamErr.partialContent.trim()) {
        turn.content = `${streamErr.partialContent}\n\n${t('ai.streamInterrupted')}`
        return
      }
    }
    // 服务端业务文案（额度超限 / 未配置等）本身已是可读中文，直接透出
    if (raw && /[\u4e00-\u9fa5]/.test(raw)) {
      turn.content = raw
      return
    }
    // 浏览器/传输层异常统一本地化，界面不再出现 network error 之类英文原文
    turn.content =
      streamErr?.isStreamError || /(network|fetch|terminated|aborted|offline|ERR_)/i.test(raw)
        ? t('ai.errNetwork')
        : t('ai.searchFailed')
  }

  /** 核心提交分流：自动识别视频 / 网址 / 自然语言需求 */
  async function handleAiSubmit() {
    // 1. 抓取并解析用户拖入附加的卡片与笔记、添加或粘贴的附件文件
    const attachedRefs = [...(ui.aiAttachedCards || [])]
    const attachedFiles = [...(ui.aiAttachedFiles || [])]
    const resolvedCards: ResolvedCardContext[] = attachedRefs
      .map((ref) =>
        resolveCardContext(ref.type, ref.id, {
          bookmarkMap: ds.bookmarkMap,
          groupMap: ds.groupMap,
          categories: ds.categories,
          customAttributes: ds.customAttributes,
        }),
      )
      .filter((c): c is ResolvedCardContext => c !== null)

    let raw = aiQuery.value.trim()
    // 若用户未输入自定义文字，但添加了卡片或附件文件，自动生成贴合意图的高质量缺省提问
    if (!raw) {
      if (resolvedCards.length > 0) {
        raw = getDefaultAttachedPrompt(resolvedCards, isZh.value)
      } else if (attachedFiles.length > 0) {
        raw = t('ai.defaultFilePrompt')
      }
    }

    // 守卫前置：生成中/空输入不提交，且附件槽位保持不动
    // （此前清空在守卫之前，生成中带附件按 Enter 会把附件丢掉）
    if (!raw || aiLoading.value) return

    // 服务端 mimo-guard 对单条消息硬限 4000 字符；这里预留余量，超限直接提示并保留输入，
    // 避免把长文/大附件发出去后只收到 413 与笼统的「搜索失败」。
    const MAX_USER_MESSAGE_CHARS = 3800
    if (raw.length > MAX_USER_MESSAGE_CHARS) {
      toast(t('ai.promptTooLong', { max: MAX_USER_MESSAGE_CHARS }), false)
      return
    }

    if (raw === '/clear') {
      handleCreateSession()
      return
    }

    // AI 总开关（隐私政策 §3.3/§3.4 的「关闭后不再外发」承诺）：
    // 关闭时只保留纯本地的 /slash 站内指令，任何会发起网络请求的路径一律拦下。
    // 其余入口（智能预填 / 候选推荐 / 网页解析 / 视频深度解析）由 isAiEnabled() 各自把关。
    if (isAiEnabled() === false && !raw.startsWith('/')) {
      toast(t('settings.aiDisabledTip'), false)
      return
    }

    // 个人记忆学习：显式「记住…」与隐式偏好句式（仅学习用户原始输入，不含附件拼接）
    remember(raw)

    // 用户发起了新一轮输入：收起历史轮次所有预判胶囊
    for (const t of chatTurns.value) {
      if (t.suggestedReplies?.length) {
        t.suggestedReplies = []
      }
    }

    showAiTab?.()
    aiLoading.value = true
    loadingTextKey.value = 'ai.thinking'

    // 捕获局部 controller 引用：提前初始化供多媒体预处理及流式全程取消守护
    const controller = new AbortController()
    abortSlot.current = controller

    // 构建发给模型的完整提示词（内嵌详细卡片与多模态附件材料）
    const cardSection = resolvedCards.length > 0 ? formatAttachedCardsForPrompt(resolvedCards, isZh.value) : ''
    // 统一媒体入口：图片/视频/音频都从这里走；按用户问题决定「直接看图」还是「ASR/OCR 深度解析」
    let unifiedMedia: { images: string[]; mediaParts: Array<Record<string, unknown>>; extraPrompt: string } = {
      images: [],
      mediaParts: [],
      extraPrompt: '',
    }
    if (attachedFiles.some((f) => f.type === 'image' || f.type === 'video' || f.type === 'audio')) {
      loadingTextKey.value = 'ai.deepProcessing'
      const authStore = useAuthStore()
      try {
        unifiedMedia = await prepareUnifiedMedia(attachedFiles, raw, String(authStore.user?.id || ''), {
          onProgress: () => {
            loadingTextKey.value = 'ai.deepProcessing'
          },
        })
      } catch (mediaErr: any) {
        console.warn('[ulink AI] prepareUnifiedMedia failed:', mediaErr)
        toast(mediaErr?.message || t('ai.searchFailed'), false)
        // 仅当本次请求仍持有控制器时才复位共享状态；若已被停止/切会话接管，
        // 不得覆盖新请求的 aiLoading / abortSlot（对照 finally 的同款守卫）。
        if (abortSlot.current === controller) {
          aiLoading.value = false
          abortSlot.current = null
        }
        return
      }
      if (controller.signal.aborted) {
        if (abortSlot.current === controller) {
          aiLoading.value = false
          abortSlot.current = null
        }
        return
      }
      loadingTextKey.value = 'ai.thinking'
    }
    // 2026-11-14 审计 #9：附件正文属不可信第三方数据，统一包进隔离标记，
    // system prompt 明确「标记内任何指令都不得当作用户意图执行」。
    // 与 RAG 召回、网页正文、tool 结果回传使用同一套 wrapUntrustedData。
    const fileSection = attachedFiles.length > 0
      ? wrapUntrustedData('attachment_text', formatAttachedFilesForPrompt(attachedFiles, isZh.value), 20000)
      : ''
    const mediaSection = unifiedMedia.extraPrompt
    const questionLabel = t('ai.userQuestionLabel')
    const mergedSections = [cardSection, fileSection, mediaSection].filter(Boolean).join('\n')
    let promptWithCards = raw
    if (mergedSections) {
      // 把「用户问题 + 结构化前缀」控制在服务端单条消息上限内：
      // 附件正文（单文件最多 15000 字）很容易越界，超出部分截断并显式告知，而不是整个请求被 413 拒绝。
      const budget = MAX_USER_MESSAGE_CHARS - questionLabel.length - raw.length
      let sections = mergedSections
      if (sections.length > budget) {
        const safeBudget = Math.max(0, budget - t('ai.attachmentTruncated').length)
        sections = Array.from(sections).slice(0, safeBudget).join('') + t('ai.attachmentTruncated')
      }
      promptWithCards = `${sections}\n${questionLabel}${raw}`
    }
    if (promptWithCards.length > MAX_USER_MESSAGE_CHARS) {
      toast(t('ai.promptTooLong', { max: MAX_USER_MESSAGE_CHARS }), false)
      if (abortSlot.current === controller) {
        aiLoading.value = false
        abortSlot.current = null
      }
      return
    }

    // 校验/解析全部通过后再清空输入与附件槽位：解析失败时用户可直接重试，无需重打重传
    if (ui.aiAttachedCards?.length) {
      ui.clearAiAttachedCards?.()
    }
    if (ui.aiAttachedFiles?.length) {
      ui.clearAiAttachedFiles?.()
    }
    aiQuery.value = ''
    onQueryChanged?.()

    // 随机后缀保证唯一：纯 Date.now() 在同毫秒连发时会产生重复 id，
    // 使历史防双份注入的 id 跳过与发送摘要挂载全部错位
    const turnId = 'turn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    const currentAttachedCards = resolvedCards.map((c) => ({
      type: c.type,
      id: c.id,
      title: c.title,
      url: c.url,
    }))

    chatTurns.value.push({
      id: turnId + '-user',
      role: 'user',
      content: raw,
      promptContent: promptWithCards,
      attachedCards: currentAttachedCards,
      attachedFiles,
      timestamp: Date.now(),
    })

    // 必须以 reactive 代理创建：push 进 chatTurns 后闭包持有的若是原始对象，后续流式写入
    // content/loading 属性会绕过 proxy、不触发依赖更新（子组件拆分后无「同组件搭车重渲染」
    // 兜底，流式内容将永不渲染）。经代理写入才能驱动 ChatStream 更新。
    const assistantTurn = reactive({
      id: turnId + '-assistant',
      role: 'assistant',
      content: '',
      reasoning: '',
      reasoningTimeMs: 0,
      isThinking: false,
      _thinkingOpen: true,
      loading: true,
      candidates: [],
      attachedCards: currentAttachedCards,
      attachedFiles,
      timestamp: Date.now(),
    }) as ChatTurn
    chatTurns.value.push(assistantTurn)
    onTurnsChanged?.()

    // 本轮是否失败收尾：错误轮次不得再挂载「换个方案 / 存为卡片」等预判胶囊
    let replyFailed = false
    const failTurn = (err: unknown) => {
      replyFailed = true
      markTurnFailed(assistantTurn, err)
    }

    // 流式空闲哨兵：长时间无任何增量时给出明确提示，避免用户面对无限转圈无从判断
    const onStreamStall = (idleMs: number) => {
      if (controller.signal.aborted) return
      console.warn('[ulink AI] stream idle for', idleMs, 'ms')
      if (!assistantTurn.reasoning && !assistantTurn.content) {
        // 尚无任何输出：直接替换等待文案（呼吸点区域显示）
        loadingTextKey.value = 'ai.slowResponse'
        return
      }
      toast(t('ai.slowResponse'), false)
    }

    try {
      // 优先尝试站内指令/In-App Agent CLI 调度（传 abort 信号：停止生成后不再执行命令副作用）
      const siteCmd = await dispatchSiteCommand(raw, { ds, ui, app, signal: controller.signal })
      if (controller.signal.aborted) return
      if (siteCmd.handled) {
        assistantTurn.loading = false
        assistantTurn.content = siteCmd.reply
        assistantTurn.steps = siteCmd.steps
        assistantTurn.actionCard = siteCmd.actionCard
        if (siteCmd.actionCard) {
          assistantTurn.suggestedReplies = ['✨ 好的，执行', '🔄 换个方案', '✏️ 我想调整一下']
        }
        return
      }

      // 视频平台判定统一走单一真源（src/config/videoPlatforms.json），
      // 不再手写域名正则——历史上客户端/云函数/worker 三份清单各写一份导致漂移。
      const isVideo = containsVideoPlatformUrl(raw)
      // 仅「纯 URL」走相似站点分支；URL + 用户问题（含空白）必须交给模型，
      // 否则 domain(raw) 解析失败 → 相似站点返回空，用户的问题被整段丢弃。
      const isUrl = !/\s/.test(raw) && /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/.test(raw)
      loadingTextKey.value = isVideo ? 'ai.extracting' : isUrl ? 'ai.analyzing' : 'ai.thinking'

      if (isVideo) {
        const res = await extractBookmarksFromVideo(raw, ds.categories, ds.customAttributes)
        if (controller.signal.aborted) return
        assistantTurn.loading = false
        assistantTurn.candidates = res.bookmarks
        if (res.bookmarks.length === 0 && res.summary) {
          const titlePrefix =
            res.videoTitle &&
            !res.videoTitle.includes('404') &&
            !res.videoTitle.includes('视频去哪了') &&
            !res.videoTitle.includes('视频不见了')
              ? `**${res.videoTitle}**\n\n`
              : ''
          assistantTurn.content = `${titlePrefix}${res.summary}`
          assistantTurn.suggestedReplies = ['📝 存为卡片笔记', '🔍 帮我找类似工具']
        } else {
          assistantTurn.content = formatFoundCount(res.bookmarks.length, res.videoTitle, res.bookmarks)
          // 文字源总结（简介/字幕/评论区提炼）：带用户问题时为「回答提问」模式，标签随之切换，无则缺省
          if (res.summary) {
            const summaryLabel = res.question ? t('ai.videoAnswerLabel') : t('ai.videoSummaryLabel')
            assistantTurn.content += `\n\n**${summaryLabel}**\n${res.summary}`
          }
          if (res.bookmarks.length > 0) {
            assistantTurn.suggestedReplies = ['📥 全部一键加入收藏', '💡 还有其他同类吗？']
          }
        }
      } else if (isUrl) {
        const res = await findSimilarWebsites(raw, domain(raw), preferences.value, ds.categories, ds.customAttributes)
        if (controller.signal.aborted) return
        assistantTurn.loading = false
        assistantTurn.candidates = res
        assistantTurn.content = formatFoundCount(res.length, undefined, res)
        if (res.length > 0) {
          assistantTurn.suggestedReplies = ['📥 全部一键加入收藏', '🇨🇳 只要国内免翻直连的', '💡 还有其他同类吗？']
        }
      } else {
        const mimoConf = getMiMoConfig()
        let mimoSuccess = false
        // 一次用户提交（最多 1 首轮 + 4 续轮 = 5 次 LLM 调用）共用同一个 traceId：
        // 云函数把 X-Ulink-Trace-Id 写进结构化日志并回写响应头，Agent 会话才可串联。
        const requestTraceId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

        if (mimoConf.enabled) {
          try {
            const history: MiMoChatMessage[] = []
            // 回放文本统一限长：留出充足余量低于 mimo-guard 4000 字符硬性单条上限，
            // 多轮回放的 user promptContent / assistant 结论不设限会逐轮膨胀直至整轮失败
            const REPLAY_MSG_MAX_LEN = 3500
            const replayText = (s: string) => (s || '').slice(0, REPLAY_MSG_MAX_LEN)
            for (const t of chatTurns.value) {
              if (t.loading || t.id === assistantTurn.id) continue
              // 本轮 user 轮不进 history：其内容会以 promptWithCards 作为 query 再发一次，
              // 否则同一条消息双份注入（浪费上下文预算且放大注入面）
              if (t.id === turnId + '-user') continue
              if (t.role === 'user') {
                if (t.content) history.push({ role: 'user', content: replayText(t.promptContent || t.content) })
                continue
              }
              // assistant 轮：无工具链则直接回传文本；有工具链则还原
              // assistant(tool_calls) → tool(结果) → assistant(续轮结论) 的协议序列，
              // 多轮对话不再对已执行的工具结果失忆
              if (t.toolCalls?.length && t.toolResults?.length) {
                history.push({
                  role: 'assistant',
                  content: replayText(t.preToolContent || ''),
                  tool_calls: t.toolCalls.map((c) => ({
                    id: c.id || `call_${Date.now()}`,
                    type: 'function' as const,
                    function: {
                      name: c.name,
                      arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {}),
                    },
                  })),
                })
                for (const r of t.toolResults) {
                  // 回放同样过 sanitizeToolResult：持久化的历史可能来自修复前的版本，
                  // 脱敏/限长在发送前统一兜底（与当轮回传同口径）。
                  // 旧会话没有 status 字段时按工具名推断，保证协议链状态标记不缺失。
                  const status = r.status || inferToolExecStatus({ name: r.name, resultText: r.resultText })
                  history.push({
                    role: 'tool',
                    tool_call_id: r.toolCallId || (r as any).id,
                    content: formatToolResultForModel(sanitizeToolResult(r.resultText), status, isZh.value),
                  })
                }
                if (t.content) history.push({ role: 'assistant', content: replayText(t.content) })
              } else if (t.content) {
                history.push({ role: 'assistant', content: replayText(t.content) })
              }
            }

            let thinkingStartTime = 0

            // 动态构建情境切片 (Dynamic Context Slice)
            let focusedGroupName: string | undefined
            let focusedGroupBookmarks: Array<{ title: string; url: string }> | undefined
            let focusedGroupTotal: number | undefined
            if (ui.focusedGroupId && ds.groupMap[ui.focusedGroupId]) {
              const grp = ds.groupMap[ui.focusedGroupId]
              focusedGroupName = grp.name
              const validGroupItems = (grp.bookmarkIds || [])
                .map((id: string) => ds.bookmarkMap[id])
                .filter((b: any) => b && !b.deletedAt)
              // 截断前总数进发送摘要：披露「注入 N/总数 M」的真实截断情况
              focusedGroupTotal = validGroupItems.length
              focusedGroupBookmarks = validGroupItems
                .slice(0, 10)
                .map((b: any) => ({ title: b.title, url: b.url }))
            }

            let currentCategoryName: string | undefined
            if (ui.curCat && ui.curCat !== 'all' && ui.curCat !== 'uncategorized') {
              const cat = ds.categories.find((c: any) => c.id === ui.curCat && !c.deletedAt)
              if (cat) currentCategoryName = cat.name
            }

            let selectedBookmarks: Array<{ title: string; url: string }> | undefined
            let selectedTotal: number | undefined
            if (ui.batchMode && ui.batchSelected?.length) {
              const validSelectedItems = ui.batchSelected
                .map((id: string) => ds.bookmarkMap[id])
                .filter((b: any) => b && !b.deletedAt)
              selectedTotal = validSelectedItems.length
              selectedBookmarks = validSelectedItems
                .slice(0, 8)
                .map((b: any) => ({ title: b.title, url: b.url }))
            }

            // 端侧轻量混合 RAG：从全库毫秒级检索与本轮用户意图最高相关的书签与笔记片段
            let retrievedVaultKnowledge: string | undefined
            try {
              vaultRAG.buildIndex(ds.bookmarks, ds.siblingGroups, ds.categories, ds.customAttributes)
              let ragChunks = vaultRAG.queryRelevantContext(raw)
              // 模糊查询的召回增强：本地召回薄弱（<3 条）时，让模型仅基于用户 query 生成
              // 概念扩展词并入检索词重查（书签库数据不出去，仅 query 经官方通道外发）。
              // expandQueryTerms 内部 fail-open，失败返回 [] 不阻塞主流程
              if (ragChunks.length < 3 && !controller.signal.aborted) {
                const terms = await expandQueryTerms(raw, { signal: controller.signal, isZh: isZh.value })
                if (terms.length > 0 && !controller.signal.aborted) {
                  const expanded = vaultRAG.queryRelevantContext(`${raw} ${terms.join(' ')}`)
                  // 本地已召回优先，扩展结果去重补足至 10 条
                  const seen = new Set(ragChunks.map((c) => c.id))
                  for (const c of expanded) {
                    if (ragChunks.length >= 10) break
                    if (!seen.has(c.id)) {
                      seen.add(c.id)
                      ragChunks.push(c)
                    }
                  }
                }
              }
              if (ragChunks.length > 0) {
                retrievedVaultKnowledge = vaultRAG.formatChunksForPrompt(ragChunks, 2200)
              }
            } catch (ragErr) {
              console.warn('[ulink AI] localRAG index/query failed:', ragErr)
            }

            // 动态情境切片：请求与发送摘要共用同一对象，保证「披露的即所发」
            // 端侧隐式心智模型合成（领域专注度、价值取向与审美画像）
            let mentalModelPrompt: string | undefined
            try {
              const mentalModel = buildUserMentalModel({
                bookmarks: ds.bookmarks,
                groups: ds.siblingGroups,
                categories: ds.categories,
                customAttributes: ds.customAttributes,
                activeGroupId: ui.focusedGroupId || undefined,
              })
              mentalModelPrompt = formatMentalModelPrompt(mentalModel, 260, isZh.value)
            } catch (mmErr) {
              console.warn('[ulink AI] mentalModel synthesis failed:', mmErr)
            }

            // 动态感知：若用户意图涉及标签补全或书签扫描，抓取库内未打标签的书签明细注入情境切片
            // 严格区分顶级独立书签与从属子书签，避免子书签占满截断配额或造成全盲
            let untaggedBookmarks: Array<{ id: string; title: string; url: string; category?: string }> | undefined
            let untaggedStats: {
              totalCount: number
              topLevelCount: number
              subCount: number
              subGroupSummary?: string
            } | undefined
            if (/(?:补打|打标|打标签|未打标|标签|补齐标签|扫描书签|盘点书签|分析书签|书签扫描)/i.test(raw)) {
              const catMap = new Map(ds.categories.map((c) => [c.id, c.name]))
              const allUntagged = ds.bookmarks.filter(
                (b) => !b.deletedAt && (!b.attributes || Object.keys(b.attributes).length === 0) && !b.id.startsWith('bm_ulink_')
              )

              // 严格区分顶级书签（独立站点）与子书签（从属子账号/子页面）
              const topLevelUntagged = allUntagged.filter((b) => !b.parentId)
              const subUntagged = allUntagged.filter((b) => !!b.parentId)

              // 聚合子书签从属关系：按 parentId 统计归拢，绝不与独立顶级书签大杂烩平铺
              const subByParent = new Map<string, Array<{ id: string; title: string; url: string }>>()
              for (const sub of subUntagged) {
                if (sub.parentId) {
                  const list = subByParent.get(sub.parentId) || []
                  list.push({ id: sub.id, title: sub.title || '无标题', url: sub.url })
                  subByParent.set(sub.parentId, list)
                }
              }

              const subSummaries: string[] = []
              for (const [parentId, subList] of subByParent.entries()) {
                const parentBm = ds.bookmarkMap[parentId] || ds.bookmarks.find((b) => b.id === parentId)
                const parentName = parentBm?.title || '未知父站点'
                subSummaries.push(`父站点「${parentName}」下挂 ${subList.length} 个子页面/子账号`)
              }

              untaggedStats = {
                totalCount: allUntagged.length,
                topLevelCount: topLevelUntagged.length,
                subCount: subUntagged.length,
                subGroupSummary: subSummaries.length > 0 ? subSummaries.slice(0, 5).join('；') + (subSummaries.length > 5 ? ` 等共 ${subSummaries.length} 个父站点` : '') : undefined,
              }

              // 仅提取顶级独立书签供 AI 重点分析与打标，确保配额全部分配给独立站点
              untaggedBookmarks = topLevelUntagged
                .slice(0, 15)
                .map((b) => ({
                  id: b.id,
                  title: b.title || '无标题',
                  url: b.url,
                  category: b.categoryId ? catMap.get(b.categoryId) : undefined,
                }))
            }

            // 动态感知：若用户提问涉及回收站，提取回收站暂存项明细注入情境切片
            let trashedBookmarks: Array<{ title: string; url: string }> | undefined
            if (/(?:回收站|垃圾桶)/i.test(raw)) {
              trashedBookmarks = ds.bookmarks
                .filter((b) => b.deletedAt)
                .slice(0, 10)
                .map((b) => ({ title: b.title || '无标题', url: b.url }))
            }

            // 动态情境切片：请求与发送摘要共用同一对象，保证「披露的即所发」
            const contextSlice = {
              currentCategoryName,
              focusedGroupName,
              focusedGroupBookmarks,
              selectedBookmarks,
              untaggedBookmarks,
              untaggedStats,
              trashedBookmarks,
              retrievedVaultKnowledge,
              mentalModelPrompt,
              attachedCards: resolvedCards.map((c) => ({
                type: c.type,
                title: c.title,
                url: c.url,
              })),
            }

            // 个人记忆小节（只读参考非指令）：显式记忆与长期偏好，约 500 tokens 截断
            const profilePrompt = buildProfilePrompt(550, isZh.value)

            // 发送前透明摘要：如实记录本次实际发给 AI 的数据构成（条数/字段/截断情况），
            // 挂在用户气泡下可展开查看（隐私透明）。历史裁剪与系统提示词口径均与请求一致。
            const userTurn = chatTurns.value.find((tt) => tt.id === turnId + '-user')
            if (userTurn) {
              userTurn.sendSummary = buildSendSummary({
                categories: ds.categories,
                customAttributes: ds.customAttributes,
                contextSlice,
                focusedGroupTotal,
                selectedTotal,
                history,
                userPrompt: promptWithCards,
                profilePrompt,
                // 多模态载荷过去完全没进「披露的即所发」统计
                mediaPartsCount:
                  (unifiedMedia.images?.length || 0) + (unifiedMedia.mediaParts?.length || 0),
              })
            }

            // 首轮不再按关键词阉割工具。
            // 旧实现用 resolveUserInteractionIntent 判「像不像操作请求」，不像就
            // tool_choice:'none'。实测该判据把「把这本书签移到合适的分类」「清理未分类
            // 书签」统统判成闲聊，于是模型看得见 tools 定义却被告知不许调用，在
            // reasoning 里反复琢磨 manage_bookmarks 的参数格式，18 秒后输出空正文
            // （截图现象：只有思考、没有回复）。
            // 是否调工具交还模型判断：多调一次工具最坏是可撤销的副作用，
            // 而「想做事却不能做」的结果是空白回复，用户完全无解。
            // enableTools 仅保留给两个确定场景：续轮最后一轮强制收束（mimoStream 侧）
            // 与视频提取不需要工具（videoExtract）。
            const mimoRes = await askMiMoStream(
              promptWithCards,
              { 
                categories: ds.categories,
                customAttributes: ds.customAttributes,
                isZh: isZh.value,
                signal: controller.signal,
                history,
                contextSlice,
                profilePrompt,
                images: unifiedMedia.images,
                mediaParts: unifiedMedia.mediaParts,
                traceId: requestTraceId,
              },
              {
                onReasoningDelta(_delta, accumulatedReasoning) {
                  if (controller.signal.aborted) return
                  if (!thinkingStartTime) {
                    thinkingStartTime = Date.now()
                    assistantTurn.isThinking = true
                    assistantTurn._thinkingOpen = true
                  }
                  assistantTurn.reasoning = accumulatedReasoning
                  onTurnsChanged?.()
                },
                onContentDelta(_delta, accumulatedContent) {
                  if (controller.signal.aborted) return
                  if (assistantTurn.isThinking) {
                    assistantTurn.isThinking = false
                    assistantTurn.reasoningTimeMs = Date.now() - (thinkingStartTime || Date.now())
                    // 正式回答开始流出时，默认折叠思考过程，让出核心视线（用户可随时点击展开）
                    assistantTurn._thinkingOpen = false
                  }
                  assistantTurn.content = accumulatedContent
                  onTurnsChanged?.()
                },
                onStall: onStreamStall,
              }
            )

            if (controller.signal.aborted) return
            // MiMo 响应已成功落地：此后（工具链/持久化）异常不得再落入本地兜底改写结果，
            // 否则会把已发生副作用的工具链掩盖成「本地甄选」结果
            mimoSuccess = true
            assistantTurn.loading = false
            assistantTurn.isThinking = false
            if (thinkingStartTime && !assistantTurn.reasoningTimeMs) {
              assistantTurn.reasoningTimeMs = Date.now() - thinkingStartTime
            }
            assistantTurn.content = mimoRes.cleanText || mimoRes.reply
            assistantTurn.reasoning = mimoRes.reasoning || assistantTurn.reasoning
            assistantTurn.candidates = mimoRes.candidates
            if (mimoRes.suggestedReplies?.length) {
              assistantTurn.suggestedReplies = mimoRes.suggestedReplies
            }
            assistantTurn.steps = []

            // 兜底 A：模型只输出思考、不给正文（长 reasoning 后收束失败）时不得留白。
            // 静默空白会让用户以为卡死——这是本轮「光思考不回复」体验的直接来源之一。
            if (!mimoRes.toolCalls?.length && !assistantTurn.content.trim()) {
              assistantTurn.content = t('ai.emptyReply')
            }

            // Agent 工具执行器：首轮与续轮工具链共用同一分发（单一分发点，防多轮复刻同类分支）
            const runAgentToolCall = createAiAgentToolRunner({ ds, ui, t, tN })

            // 核心：若大模型自主触发了标准 Tool Calling (Function Calling)，即刻调度并挂载行动卡片
            if (mimoRes.toolCalls?.length) {
              // 工具调用流已触发：清空首轮预发言草稿，避免在后续续轮流式输出时发生突兀覆盖闪烁
              assistantTurn.content = ''
              const toolResults: Array<{ id: string; name: string; resultText: string; status: ToolExecStatus }> = []
              for (const call of mimoRes.toolCalls) {
                // 「停止生成」后不再执行后续工具副作用（已执行的照常持久化）
                if (controller.signal.aborted) break
                assistantTurn.steps.push({ text: t('ai.toolCallStep', { name: call.name }), done: true })
                // 单工具异常如实回传错误结果（role:'tool'），不冒充成功、不落入本地兜底改写
                let resultText: string
                let threw = false
                try {
                  resultText = await runAgentToolCall(assistantTurn, controller, call)
                } catch (toolErr) {
                  console.warn('[ulink AI] tool execution failed:', toolErr)
                  threw = true
                  resultText = t('ai.toolResultError', { name: call.name })
                  assistantTurn.steps.push({ text: resultText, done: false })
                }
                // 语义状态：多数工具只生成 HITL 待确认卡片，不能让模型误以为「已办成」。
                // notExecutedTexts 用 t() 现算，避免依赖具体语言包字面量。
                const status = inferToolExecStatus({
                  name: call.name,
                  args: call.arguments,
                  argsParseFailed: call.argsParseFailed,
                  resultText,
                  threw,
                  notExecutedTexts: [
                    t('ai.toolResultArgsInvalid', { name: call.name }),
                    t('ai.toolResultArgsRejected', { name: call.name }),
                    t('ai.toolResultNotExecuted', { name: call.name }),
                    t('ai.toolResultUnknown', { name: call.name }),
                  ],
                })
                toolResults.push({ id: call.id, name: call.name, resultText, status })
              }

              // 持久化到会话轮次：多轮对话还原 assistant→tool→assistant 协议链用。
              // 仅持久化真实执行过的调用，中止后未执行的不得混入协议链（否则 tool_calls 与 tool 结果数量不匹配）
              const executedCalls = mimoRes.toolCalls.slice(0, toolResults.length)
              assistantTurn.preToolContent = mimoRes.reply || ''
              assistantTurn.toolCalls = executedCalls.map((c) => ({
                id: c.id,
                name: c.name,
                arguments: c.arguments,
              }))
              assistantTurn.toolResults = toolResults.map((r) => ({
                toolCallId: r.id,
                name: r.name,
                resultText: r.resultText,
                status: r.status,
              }))
              sessions.value = updateSession(currentSessionId.value, chatTurns.value)

              // 已中止：不再续轮，但已执行工具的真实结果已持久化
              if (controller.signal.aborted) {
                assistantTurn.loading = false
                return
              }

              // 真 Agent 多步循环：tool 结果以 role:'tool' 回传后继续放开 Tool Calling，
              // 模型可自主串联多步工具链（如体检 → 收件箱清零 → 建工作台），直至收束结论或达到轮次上限
              const MAX_AGENT_ROUNDS = 4
              // 首轮 user 消息由 askMiMoStream 组装成「文本 + image_url + mediaParts」多模态 content；
              // 续轮若只补回纯文本，模型从第 2 次 LLM 调用起就看不到图片/音视频。这里按首轮
              // 同口径重构多模态 content 复用为续轮 user 消息，保证 Agent 多步全程可见附件。
              const roundImageUrls = (unifiedMedia.images || [])
                .filter((url) => typeof url === 'string' && /^data:image\//i.test(url))
                .slice(0, 4)
              const roundMediaParts = Array.isArray(unifiedMedia.mediaParts) ? unifiedMedia.mediaParts : []
              const imageParts: Array<Record<string, unknown>> = roundImageUrls.map((url) => ({
                type: 'image_url',
                image_url: { url },
              }))
              let multimodalUserContent: MiMoChatMessage['content'] = promptWithCards
              if (imageParts.length > 0 || roundMediaParts.length > 0) {
                const parts: Array<Record<string, unknown>> = [
                  { type: 'text', text: promptWithCards },
                  ...imageParts,
                  ...roundMediaParts,
                ]
                multimodalUserContent = parts
              }
              const roundHistory: MiMoChatMessage[] = [
                ...history,
                { role: 'user', content: multimodalUserContent },
              ]
              let pendingCalls = mimoRes.toolCalls
              let pendingResults = toolResults
              let pendingReply = mimoRes.reply || ''
              let followUpDone = false

              for (let round = 0; round < MAX_AGENT_ROUNDS && !controller.signal.aborted; round++) {
                // 本轮协议链：assistant(tool_calls) → tool(逐条结果)
                roundHistory.push({
                  role: 'assistant',
                  content: pendingReply,
                  tool_calls: pendingCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) },
                  })),
                })
                for (const r of pendingResults) {
                  roundHistory.push({
                    role: 'tool',
                    tool_call_id: r.id,
                    // 状态标记必须在脱敏/限长之后拼，保证不被截断；模型据此区分
                    // 「卡片已生成但未确认」与「操作已真实落地」。
                    content: formatToolResultForModel(
                      sanitizeToolResult(r.resultText),
                      r.status,
                      isZh.value,
                    ),
                  })
                }

                // 最后一轮强制收束为纯文本结论，保证必有最终答复
                const isLastRound = round === MAX_AGENT_ROUNDS - 1
                try {
                  const followUpRes = await askMiMoStream(
                    '',
                    {
                      categories: ds.categories,
                      customAttributes: ds.customAttributes,
                      isZh: isZh.value,
                      signal: controller.signal,
                      history: roundHistory,
                      enableTools: !isLastRound,
                      // 续轮必须与首轮看到同一份动态情境，否则第 2 步起 Agent 在
                      // 「失忆」状态下继续操作书签库（且 system prompt 前后不一致）。
                      contextSlice,
                      profilePrompt,
                      traceId: requestTraceId,
                    },
                    {
                      onContentDelta(_delta, accumulatedContent) {
                        if (controller.signal.aborted) return
                        assistantTurn.content = accumulatedContent
                        onTurnsChanged?.()
                      },
                      onStall: onStreamStall,
                    },
                  )
                  if (controller.signal.aborted) return
                  followUpDone = true
                  if (followUpRes.reply.trim()) {
                    assistantTurn.content = followUpRes.cleanText || followUpRes.reply
                    assistantTurn.candidates = followUpRes.candidates?.length ? followUpRes.candidates : assistantTurn.candidates
                  }
                  if (followUpRes.suggestedReplies?.length) {
                    assistantTurn.suggestedReplies = followUpRes.suggestedReplies
                  }

                  // 模型不再请求工具：多步链收束
                  if (!followUpRes.toolCalls?.length) break

                  // 模型继续请求工具：执行后下一轮以 role:'tool' 回传，形成完整多步链
                  pendingCalls = followUpRes.toolCalls
                  pendingReply = followUpRes.reply || ''
                  pendingResults = []
                  for (const call of followUpRes.toolCalls) {
                    assistantTurn.steps.push({ text: t('ai.toolCallStep', { name: call.name }), done: true })
                    // 同上：工具异常如实回传错误结果，不冒充成功
                    let resultText: string
                    let threw = false
                    try {
                      resultText = await runAgentToolCall(assistantTurn, controller, call)
                    } catch (toolErr) {
                      console.warn('[ulink AI] tool execution failed:', toolErr)
                      threw = true
                      resultText = t('ai.toolResultError', { name: call.name })
                      assistantTurn.steps.push({ text: resultText, done: false })
                    }
                    const status = inferToolExecStatus({
                      name: call.name,
                      args: call.arguments,
                      argsParseFailed: call.argsParseFailed,
                      resultText,
                      threw,
                      notExecutedTexts: [
                        t('ai.toolResultArgsInvalid', { name: call.name }),
                        t('ai.toolResultArgsRejected', { name: call.name }),
                        t('ai.toolResultNotExecuted', { name: call.name }),
                        t('ai.toolResultUnknown', { name: call.name }),
                      ],
                    })
                    pendingResults.push({ id: call.id, name: call.name, resultText, status })
                    // 多轮工具链累积持久化：多轮对话回放 assistant→tool 协议链不失忆
                    if (assistantTurn.toolCalls && assistantTurn.toolResults) {
                      assistantTurn.toolCalls.push({ id: call.id, name: call.name, arguments: call.arguments })
                      assistantTurn.toolResults.push({ toolCallId: call.id, name: call.name, resultText, status })
                    }
                  }
                  sessions.value = updateSession(currentSessionId.value, chatTurns.value)
                } catch (followUpErr: unknown) {
                  // 续轮失败不覆盖前面已执行的真实结果，仅记录并收束
                  console.warn('[ulink AI] tool result follow-up failed:', followUpErr)
                  break
                }
              }
              if (followUpDone) assistantTurn.steps.push({ text: t('ai.toolFollowUpStep'), done: true })
              // 兜底 B：工具确实执行了（有真实副作用），但模型没能给出总结时也不能留白，
              // 否则用户既看不到结果说明、也不知道刚才改了什么。提示里给出撤销入口。
              if (!assistantTurn.content.trim()) {
                assistantTurn.content = t('ai.emptyReplyAfterTools')
              }
            }

            persistCurrentSession()
          } catch (mimoErr: unknown) {
            if (controller.signal.aborted) return
            // 仅 MiMo 请求本身失败才处理；工具链异常已在上游如实回传，不落兜底
            if (mimoSuccess) {
              console.warn('[ulink AI] post-response processing failed:', mimoErr)
              assistantTurn.loading = false
              assistantTurn.isThinking = false
              if (!assistantTurn.content) assistantTurn.content = t('ai.searchFailed')
              return
            }
            console.warn('[ulink AI] MiMo API call failed:', mimoErr)
            // 统一失败收口：复位思考态 + 保留流式中断前已生成的内容 + 本地化原因
            failTurn(mimoErr)
          }
        } else {
          failTurn(new Error(t('ai.errDisabled')))
        }

        // 彻底废除保底假回复：AI 请求失败如实报错，绝不伪装成离线甄选搜索
        if (!mimoSuccess) {
          assistantTurn.loading = false
          assistantTurn.isThinking = false
          assistantTurn.candidates = []
          if (!assistantTurn.content) {
            assistantTurn.content = t('ai.searchFailed')
          }
        }
      }

      // 智能挂载行动卡片：当单轮甄选到 3 个及以上候选站点且未挂载卡片时，出具一键装配工作台卡片
      if (assistantTurn.candidates && assistantTurn.candidates.length >= 3 && !assistantTurn.actionCard) {
        const topicRaw =
          raw
            .replace(/^(?:请?帮?我?)?(?:推荐|找|搜|整理|搭建|介绍|有哪些|看下)?\s*/i, '')
            .replace(/[?？!！。]+$/, '')
            .trim()
            .slice(0, 16) || t('ai.wsTopicFallback')
        const cleanTopic = normalizeWorkspaceTopic(topicRaw)
        assistantTurn.actionCard = {
          type: 'custom',
          actionName: 'create_topic_workspace',
          title: t('ai.wsCardTitle', { name: cleanTopic }),
          desc: tN('ai.wsCardDesc', assistantTurn.candidates.length, { n: assistantTurn.candidates.length }),
          buttonText: t('ai.wsCardButton'),
          payload: {
            topic: cleanTopic,
            candidates: assistantTurn.candidates,
          },
        }
      }

      // 智能附带预判快捷按钮：若尚未挂载预判选项，根据产物类型自动提供极简决策胶囊（报错轮次不展示假预判）
      const isErrorReply = replyFailed || !assistantTurn.content || assistantTurn.content.startsWith(t('ai.searchFailed'))
      if (!assistantTurn.suggestedReplies?.length && !isErrorReply) {
        if (assistantTurn.actionCard) {
          assistantTurn.suggestedReplies = ['✨ 好的，执行', '🔄 换个方案', '✏️ 我想调整一下']
        } else if (assistantTurn.candidates && assistantTurn.candidates.length > 0) {
          assistantTurn.suggestedReplies = ['📥 全部一键加入收藏', '🇨🇳 只要国内免翻直连的', '💡 还有其他同类吗？']
        } else if (assistantTurn.content && !assistantTurn.loading) {
          assistantTurn.suggestedReplies = ['📝 存为卡片笔记', '🔍 帮我找类似工具']
        }
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      console.error('[ulink AI] search error:', err)
      failTurn(err)
    } finally {
      // 兜底收尾：任何路径遗留的思考气泡（如 abort 竞态）一律置为已停止，防悬挂
      if (assistantTurn.loading || assistantTurn.isThinking) {
        assistantTurn.loading = false
        assistantTurn.isThinking = false
        if (!assistantTurn.content) assistantTurn.content = t('ai.stopped')
      }

      // 记录输入历史
      if (raw && !inputHistory.value.includes(raw)) {
        inputHistory.value.push(raw)
        if (inputHistory.value.length > 30) inputHistory.value.shift()
      }
      historyCursor.value = inputHistory.value.length

      // 仅当本次请求仍持有控制器时才收尾共享状态；
      // 若已被停止/切会话接管（abortInFlight 已收尾持久化），不得覆盖其状态
      if (abortSlot.current === controller) {
        aiLoading.value = false
        abortSlot.current = null
        persistCurrentSession()
        onTurnsChanged?.()
      }
    }
  }

  return {
    handleAiSubmit,
    formatFoundCount,
  }
}
