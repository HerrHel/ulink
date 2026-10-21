import { describe, it, expect, vi } from 'vitest'
import {
  createTaskDagPlan,
  calculatePlanProgress,
  getExecutableSteps,
  executeDagStep,
  executeAllDagSteps,
  buildVaultHealthPlan,
} from '../../lib/ai/taskPlanner.js'

describe('taskPlanner.ts — 目标驱动任务规划器', () => {
  describe('createTaskDagPlan & calculatePlanProgress', () => {
    it('正确初始化 DAG 计划并计算初始进度', () => {
      const plan = createTaskDagPlan({
        title: '测试任务流',
        description: '任务简述',
        steps: [
          { id: 's1', title: '步骤1' },
          { id: 's2', title: '步骤2', dependsOn: ['s1'] },
          { id: 's3', title: '步骤3', dependsOn: ['s2'] },
        ],
      })

      expect(plan.title).toBe('测试任务流')
      expect(plan.status).toBe('planning')
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0].status).toBe('pending')

      const progress = calculatePlanProgress(plan)
      expect(progress.total).toBe(3)
      expect(progress.completed).toBe(0)
      expect(progress.pending).toBe(3)
      expect(progress.percent).toBe(0)
    })
  })

  describe('getExecutableSteps', () => {
    it('按拓扑依赖精确过滤出就绪步骤', () => {
      const plan = createTaskDagPlan({
        title: '依赖测试',
        steps: [
          { id: 'step_root', title: '根步骤' },
          { id: 'step_child1', title: '子步骤1', dependsOn: ['step_root'] },
          { id: 'step_child2', title: '子步骤2', dependsOn: ['step_root'] },
          { id: 'step_leaf', title: '叶步骤', dependsOn: ['step_child1', 'step_child2'] },
        ],
      })

      // 初始：仅 root 就绪
      let ready = getExecutableSteps(plan)
      expect(ready.map((s) => s.id)).toEqual(['step_root'])

      // root 完成后：child1 和 child2 就绪
      plan.steps[0].status = 'success'
      ready = getExecutableSteps(plan)
      expect(ready.map((s) => s.id)).toEqual(['step_child1', 'step_child2'])

      // 仅 child1 完成：leaf 仍未就绪
      plan.steps[1].status = 'success'
      ready = getExecutableSteps(plan)
      expect(ready.map((s) => s.id)).toEqual(['step_child2'])

      // child2 完成：leaf 就绪
      plan.steps[2].status = 'success'
      ready = getExecutableSteps(plan)
      expect(ready.map((s) => s.id)).toEqual(['step_leaf'])
    })
  })

  describe('executeDagStep & executeAllDagSteps', () => {
    it('单步执行成功并更新状态与输出', async () => {
      const plan = createTaskDagPlan({
        title: '执行测试',
        steps: [{ id: 's1', title: '扫描' }],
      })

      const executor = vi.fn().mockResolvedValue({
        success: true,
        output: '发现 5 个未分类书签',
      })

      const res = await executeDagStep(plan, 's1', executor)
      expect(res.success).toBe(true)
      expect(plan.steps[0].status).toBe('success')
      expect(plan.steps[0].output).toBe('发现 5 个未分类书签')
      expect(plan.status).toBe('completed')
    })

    it('单步执行失败正确标记 failed', async () => {
      const plan = createTaskDagPlan({
        title: '失败测试',
        steps: [{ id: 's1', title: '异常步骤' }],
      })

      const executor = vi.fn().mockResolvedValue({
        success: false,
        error: '网络超时',
      })

      const res = await executeDagStep(plan, 's1', executor)
      expect(res.success).toBe(false)
      expect(plan.steps[0].status).toBe('failed')
      expect(plan.steps[0].error).toBe('网络超时')
      expect(plan.status).toBe('failed')
    })

    it('executeAllDagSteps 顺序自动执行全量步骤', async () => {
      const plan = createTaskDagPlan({
        title: '自动流水线',
        steps: [
          { id: 's1', title: '第1步' },
          { id: 's2', title: '第2步', dependsOn: ['s1'] },
        ],
      })

      const order: string[] = []
      const executor = vi.fn().mockImplementation(async (step) => {
        order.push(step.id)
        return { success: true, output: `完成 ${step.id}` }
      })

      await executeAllDagSteps(plan, executor)

      expect(order).toEqual(['s1', 's2'])
      expect(plan.status).toBe('completed')
      expect(plan.steps.every((s) => s.status === 'success')).toBe(true)
    })
  })

  describe('buildVaultHealthPlan', () => {
    it('生成符合业务规范的治理流水线模板', () => {
      const plan = buildVaultHealthPlan()
      expect(plan.steps).toHaveLength(4)
      expect(plan.steps[0].id).toBe('step_scan')
      expect(plan.steps[1].dependsOn).toContain('step_scan')
      expect(plan.steps[2].dependsOn).toContain('step_scan')
      expect(plan.steps[3].dependsOn).toContain('step_inbox_diff')
      expect(plan.steps[3].dependsOn).toContain('step_dedup')
    })
  })
})
