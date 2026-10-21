import { describe, it, expect, beforeEach } from 'vitest'
import {
  EvolvingKnowledgeGraph,
  K_AI_GRAPH,
} from '../../lib/ai/evolvingGraph.js'

describe('evolvingGraph.ts — 端侧自进化概念与实体关系图谱', () => {
  let graph: EvolvingKnowledgeGraph

  beforeEach(() => {
    localStorage.removeItem(K_AI_GRAPH)
    graph = new EvolvingKnowledgeGraph()
  })

  it('添加节点与增加频次', () => {
    const n1 = graph.touchNode('WebGPU', 'concept')
    expect(n1.name).toBe('WebGPU')
    expect(n1.frequency).toBe(1)

    const n2 = graph.touchNode('webgpu', 'concept')
    expect(n2.frequency).toBe(2)
    expect(graph.nodeCount).toBe(1)
  })

  it('记录共现关系并支持邻居游走扩散', () => {
    graph.addAssociation('WebGPU', 'WGSL', 1.5)
    graph.addAssociation('WebGPU', 'Compute Shader', 1.0)
    graph.addAssociation('React', 'Next.js', 1.2)

    expect(graph.nodeCount).toBe(5)
    expect(graph.edgeCount).toBe(3)

    // 查询 WebGPU 关联邻居
    const neighbors = graph.getRelatedNeighbors(['webgpu'], 5)
    expect(neighbors.map((n) => n.name)).toContain('WGSL')
    expect(neighbors.map((n) => n.name)).toContain('Compute Shader')
    expect(neighbors.map((n) => n.name)).not.toContain('React')
    expect(neighbors.map((n) => n.name)).not.toContain('WebGPU') // 不回传自身

    // 权重最高优先
    expect(neighbors[0].name).toBe('WGSL')
  })

  it('从知识库书签与笔记组中挖掘共现关系', () => {
    const mockBookmarks: any[] = [
      {
        id: 'bm1',
        title: 'Three.js 3D 渲染引擎',
        url: 'https://threejs.org',
        categoryId: 'cat_3d',
        attributes: { attr_webgl: true },
      },
      {
        id: 'bm2',
        title: 'Babylon.js 游戏框架',
        url: 'https://babylonjs.com',
        categoryId: 'cat_3d',
        attributes: { attr_webgl: true },
      },
    ]

    const mockGroups: any[] = [
      {
        id: 'grp1',
        name: '3D 图形与渲染工作台',
        bookmarkIds: ['bm1', 'bm2'],
      },
    ]

    const mockCategories: any[] = [
      { id: 'cat_3d', name: '图形渲染' },
    ]

    const mockAttributes: any[] = [
      { id: 'attr_webgl', name: 'WebGL' },
    ]

    graph.mineFromKnowledge(mockBookmarks, mockGroups, mockCategories, mockAttributes)

    expect(graph.nodeCount).toBeGreaterThan(3)

    // 验证「图形渲染」或「WebGL」能够关联出组名和书签
    const neighbors = graph.getRelatedNeighbors(['图形渲染'], 5)
    expect(neighbors.length).toBeGreaterThan(0)
  })

  it('支持持久化与存储恢复', () => {
    graph.addAssociation('Vue3', 'Pinia', 2.0)
    graph.saveToStorage()

    const graphRestored = new EvolvingKnowledgeGraph()
    const neighbors = graphRestored.getRelatedNeighbors(['vue3'])
    expect(neighbors.map((n) => n.name)).toContain('Pinia')
  })
})
