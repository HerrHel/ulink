/**
 * useAiChatAgent.ts — AI Agent 工具执行分发（自 useAiChat.ts 的 handleAiSubmit 内嵌
 * runAgentToolCall 纯搬运抽出为可注入依赖的工厂）
 * 职责：模型 Tool Calling 的单一分发点，首轮与续轮工具链共用同一分发（防多轮复刻同类分支）。
 * 入参显式携带 assistantTurn 与 controller（等同原闭包捕获的同名变量），行为与拆分前逐字一致。
 */
import { dispatchSiteCommand } from '../../lib/ai/siteCommander.js'
import { createTaskDagPlan } from '../../lib/ai/taskPlanner.js'
import { createDedupDraftDiff } from '../../lib/ai/draftDiff.js'
import { findDuplicateCandidates } from '../../lib/ai/localClustering.js'
import { buildDagPlanActionCard, buildDraftDiffActionCard } from '../../lib/ai/siteHitl.js'
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
      const siteRes = await dispatchSiteCommand('/deadlink', { ds, ui, app: (ui as any).app, signal: controller.signal })
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
      const siteRes = await dispatchSiteCommand('/export', { ds, ui, app: (ui as any).app, signal: controller.signal })
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
    } else {
      resultText = t('ai.toolResultUnknown', { name: call.name })
    }
    return resultText
  }
}
