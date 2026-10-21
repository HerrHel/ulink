/**
 * taskPlanner.ts — 目标驱动任务规划器 (Goal-Driven Task DAG Planner)
 * 职责：
 * 1. 针对多步骤复杂意图，生成结构化有向无环任务流 (Task DAG Plan)；
 * 2. 维护各步骤的依赖关系 (dependsOn) 与生命周期状态 (pending | running | success | failed | skipped)；
 * 3. 支持拓扑依赖解析与单步 / 自动全量调度执行；
 * 4. 实时计算流水线进度与输出沉淀。
 */

import { t } from '../../i18n/index.js'

export type TaskStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface TaskDagStep {
  id: string
  title: string
  desc?: string
  status: TaskStepStatus
  actionName?: string
  actionArgs?: Record<string, unknown>
  dependsOn?: string[]
  output?: string
  error?: string
}

export type TaskPlanStatus = 'planning' | 'running' | 'completed' | 'failed' | 'paused'

export interface TaskDagPlan {
  id: string
  title: string
  description?: string
  status: TaskPlanStatus
  steps: TaskDagStep[]
  currentStepId?: string
}

export interface PlanProgress {
  total: number
  completed: number
  failed: number
  running: number
  pending: number
  percent: number
}

/**
 * 校验并初始化一个 Task DAG Plan
 */
export function createTaskDagPlan(params: {
  id?: string
  title: string
  description?: string
  steps: Array<{
    id: string
    title: string
    desc?: string
    actionName?: string
    actionArgs?: Record<string, unknown>
    dependsOn?: string[]
  }>
}): TaskDagPlan {
  const planId = params.id || `dag-plan-${Date.now()}`
  const steps: TaskDagStep[] = params.steps.map((s) => ({
    id: s.id,
    title: s.title,
    desc: s.desc,
    status: 'pending',
    actionName: s.actionName,
    actionArgs: s.actionArgs,
    dependsOn: s.dependsOn || [],
  }))

  return {
    id: planId,
    title: params.title,
    description: params.description,
    status: 'planning',
    steps,
  }
}

/**
 * 计算计划完成进度百分比与计数
 */
export function calculatePlanProgress(plan: TaskDagPlan): PlanProgress {
  const total = plan.steps.length
  if (total === 0) {
    return { total: 0, completed: 0, failed: 0, running: 0, pending: 0, percent: 100 }
  }

  let completed = 0
  let failed = 0
  let running = 0
  let pending = 0

  for (const step of plan.steps) {
    if (step.status === 'success' || step.status === 'skipped') completed++
    else if (step.status === 'failed') failed++
    else if (step.status === 'running') running++
    else pending++
  }

  const percent = Math.round((completed / total) * 100)
  return { total, completed, failed, running, pending, percent }
}

/**
 * 获取当前所有就绪可执行的步骤（处于 pending 状态，且其所有 dependsOn 步骤已 success）
 */
export function getExecutableSteps(plan: TaskDagPlan): TaskDagStep[] {
  const successStepIds = new Set(
    plan.steps.filter((s) => s.status === 'success' || s.status === 'skipped').map((s) => s.id),
  )

  return plan.steps.filter((step) => {
    if (step.status !== 'pending') return false
    const deps = step.dependsOn || []
    return deps.every((depId) => successStepIds.has(depId))
  })
}

/**
 * 执行器上下文类型
 */
export type DagStepExecutor = (
  step: TaskDagStep,
  plan: TaskDagPlan,
) => Promise<{ success: boolean; output?: string; error?: string }>

/**
 * 单步执行
 */
export async function executeDagStep(
  plan: TaskDagPlan,
  stepId: string,
  executor: DagStepExecutor,
): Promise<{ success: boolean; plan: TaskDagPlan }> {
  const step = plan.steps.find((s) => s.id === stepId)
  if (!step) {
    return { success: false, plan }
  }

  step.status = 'running'
  plan.status = 'running'
  plan.currentStepId = step.id

  try {
    const res = await executor(step, plan)
    if (res.success) {
      step.status = 'success'
      step.output = res.output
    } else {
      step.status = 'failed'
      step.error = res.error
      plan.status = 'failed'
    }
  } catch (err: any) {
    step.status = 'failed'
    step.error = err?.message || String(err)
    plan.status = 'failed'
  }

  // 检查是否全量完成
  const progress = calculatePlanProgress(plan)
  if (progress.completed === progress.total) {
    plan.status = 'completed'
  } else if (progress.failed > 0) {
    plan.status = 'failed'
  }

  return { success: step.status === 'success', plan }
}

/**
 * 拓扑顺序自动连续执行全部就绪步骤，直到无法继续或遇到错误
 */
export async function executeAllDagSteps(
  plan: TaskDagPlan,
  executor: DagStepExecutor,
  options?: { signal?: AbortSignal },
): Promise<TaskDagPlan> {
  plan.status = 'running'

  while (true) {
    if (options?.signal?.aborted) {
      plan.status = 'paused'
      break
    }

    const readySteps = getExecutableSteps(plan)
    if (readySteps.length === 0) {
      break
    }

    // 顺序执行就绪步骤
    for (const step of readySteps) {
      if (options?.signal?.aborted) {
        plan.status = 'paused'
        return plan
      }
      const { success } = await executeDagStep(plan, step.id, executor)
      if (!success) {
        plan.status = 'failed'
        return plan
      }
    }
  }

  const progress = calculatePlanProgress(plan)
  if (progress.completed === progress.total) {
    plan.status = 'completed'
  }

  return plan
}

/**
 * 快速构建常见的全库治理任务流 (Vault Grooming Plan)
 */
export function buildVaultHealthPlan(): TaskDagPlan {
  return createTaskDagPlan({
    title: t('ai.planVaultHealthTitle'),
    description: t('ai.planVaultHealthDesc'),
    steps: [
      {
        id: 'step_scan',
        title: t('ai.planStepScanTitle'),
        desc: t('ai.planStepScanDesc'),
        actionName: 'audit_vault',
      },
      {
        id: 'step_inbox_diff',
        title: t('ai.planStepInboxDiffTitle'),
        desc: t('ai.planStepInboxDiffDesc'),
        actionName: 'inbox_zero',
        dependsOn: ['step_scan'],
      },
      {
        id: 'step_dedup',
        title: t('ai.planStepDedupTitle'),
        desc: t('ai.planStepDedupDesc'),
        actionName: 'merge_duplicates',
        dependsOn: ['step_scan'],
      },
      {
        id: 'step_verify',
        title: t('ai.planStepVerifyTitle'),
        desc: t('ai.planStepVerifyDesc'),
        actionName: 'audit_vault',
        dependsOn: ['step_inbox_diff', 'step_dedup'],
      },
    ],
  })
}
