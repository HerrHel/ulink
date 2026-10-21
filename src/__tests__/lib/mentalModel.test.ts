import { describe, it, expect } from 'vitest'
import {
  buildUserMentalModel,
  formatMentalModelPrompt,
} from '../../lib/ai/mentalModel.js'

describe('mentalModel.ts — 隐式心智模型与情景认知画像', () => {
  it('从书签和属性分布中识别领域专注度与成本取向', () => {
    const mockBookmarks: any[] = [
      {
        id: '1',
        title: 'VS Code',
        categoryId: 'cat_dev',
        attributes: { attr_free: true, attr_open: true },
      },
      {
        id: '2',
        title: 'Rust Toolchain',
        categoryId: 'cat_dev',
        attributes: { attr_open: true },
      },
      {
        id: '3',
        title: 'Vim',
        categoryId: 'cat_dev',
        attributes: { attr_free: true },
      },
      {
        id: '4',
        title: 'Figma',
        categoryId: 'cat_design',
        attributes: {},
      },
    ]

    const mockCategories: any[] = [
      { id: 'cat_dev', name: '开发工具' },
      { id: 'cat_design', name: 'UI设计' },
    ]

    const mockAttributes: any[] = [
      { id: 'attr_free', name: '免费' },
      { id: 'attr_open', name: '开源' },
    ]

    const mockGroups: any[] = [
      { id: 'grp1', name: '前端开发工作台' },
    ]

    const model = buildUserMentalModel({
      bookmarks: mockBookmarks,
      groups: mockGroups,
      categories: mockCategories,
      customAttributes: mockAttributes,
      activeGroupId: 'grp1',
    })

    expect(model.topCategories).toContain('开发工具')
    expect(model.costTendency).toBe('free_preferred')
    expect(model.activeWorkspaceFocus).toBe('前端开发工作台')
    expect(model.formatPreference).toBe('concise_bullets')
  })

  it('格式化安全高密度的心智模型提示词', () => {
    const model = {
      topDomains: [],
      topCategories: ['前端架构', '系统设计'],
      costTendency: 'free_preferred' as const,
      networkTendency: 'direct_preferred' as const,
      formatPreference: 'concise_bullets' as const,
      activeWorkspaceFocus: '微前端探秘',
      confidenceScore: 0.8,
    }

    const promptZh = formatMentalModelPrompt(model, 300, true)
    expect(promptZh).toContain('【用户隐式心智模型')
    expect(promptZh).toContain('核心关注领域: [前端架构、系统设计]')
    expect(promptZh).toContain('当前攻坚工作台: 「微前端探秘」')
    expect(promptZh).toContain('开源优先')
    expect(promptZh).toContain('优先免翻直连')
    expect(promptZh.length).toBeLessThanOrEqual(300)

    const promptEn = formatMentalModelPrompt(model, 300, false)
    expect(promptEn).toContain('Primary Focus: [前端架构, 系统设计]')
    expect(promptEn).toContain('Open Source')
  })

  it('低置信度且无活跃工作台时返回空串（防冷启动幻觉）', () => {
    const emptyModel = {
      topDomains: [],
      topCategories: [],
      costTendency: 'neutral' as const,
      networkTendency: 'neutral' as const,
      formatPreference: 'standard' as const,
      confidenceScore: 0.05,
    }

    const prompt = formatMentalModelPrompt(emptyModel)
    expect(prompt).toBe('')
  })
})
