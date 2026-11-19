import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatLightMarkdown } from '../lib/ai/chatStreamParser.js'
import { createTaskDagPlan, getExecutableSteps } from '../lib/ai/taskPlanner.js'
import { runAmbientGroomingScan } from '../lib/ai/ambientGrooming.js'
import { restoreSnapshot } from '../composables/domain/useUndo.js'
import { evolvingGraph } from '../lib/ai/evolvingGraph.js'
import { useDataStore } from '../stores/data.js'
import { setActivePinia, createPinia } from 'pinia'

describe('Audit Fixes Batch 11', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  describe('chatStreamParser: code block entity escaping', () => {
    it('escapes HTML tags in fenced code blocks so DOMPurify does not eat or execute them', () => {
      const codeSnippet = [
        '```tsx',
        'function App() {',
        '  return <div><script>alert(1)</script><span>Hello</span></div>',
        '}',
        '```',
      ].join('\n')

      const formatted = formatLightMarkdown(codeSnippet)

      // Must be escaped into &lt; and &gt;
      expect(formatted).toContain('&lt;div&gt;')
      expect(formatted).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(formatted).toContain('&lt;span&gt;Hello&lt;/span&gt;')
      // Must not contain unescaped live html elements inside the pre
      expect(formatted).not.toContain('<div>')
      expect(formatted).not.toContain('<script>')
    })
  })

  describe('taskPlanner: getExecutableSteps dependency alignment', () => {
    it('does not treat skipped steps as satisfied dependencies', () => {
      const plan = createTaskDagPlan({
        title: 'Test Plan',
        steps: [
          { id: 's1', title: 'Step 1' },
          { id: 's2', title: 'Step 2', dependsOn: ['s1'] },
        ],
      })

      // If s1 is skipped, s2 should NOT be considered executable
      plan.steps[0].status = 'skipped'
      const executable = getExecutableSteps(plan)
      expect(executable.map(s => s.id)).not.toContain('s2')

      // Only when s1 is success should s2 be executable
      plan.steps[0].status = 'success'
      const executableAfterSuccess = getExecutableSteps(plan)
      expect(executableAfterSuccess.map(s => s.id)).toContain('s2')
    })
  })

  describe('ambientGrooming: encrypted bookmarks not flagged as vague', () => {
    it('ignores encrypted ciphertext bookmarks when scanning for vague/unnamed bookmarks', () => {
      const validCipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const bookmarks = [
        { id: 'b1', title: validCipher, url: validCipher, parentId: null } as any,
        { id: 'b2', title: validCipher, url: validCipher, parentId: null } as any,
        { id: 'b3', title: validCipher, url: validCipher, parentId: null } as any,
      ]

      const insights = runAmbientGroomingScan({
        bookmarks,
        groups: [],
        categories: [],
      })

      const vague = insights.find(i => i.type === 'vague')
      expect(vague).toBeUndefined()
    })
  })

  describe('useUndo: search index dirtying', () => {
    it('restoreSnapshot sets _searchIndexDirty and bumps _searchVersion', () => {
      const ds = useDataStore()
      ds.siblingGroups = [
        { id: 'g1', name: 'Group 1', bookmarkIds: [], notes: 'original', attributes: {} } as any,
      ]
      ds._syncMaps()
      ds._searchIndexDirty = false
      const vBefore = ds._searchVersion

      restoreSnapshot('g1', {
        notes: 'restored notes',
        bookmarkIds: [],
        pushedAt: Date.now(),
      })

      expect(ds._searchIndexDirty).toBe(true)
      expect(ds._searchVersion).toBeGreaterThan(vBefore)
    })
  })

  describe('evolvingGraph: empty name safety', () => {
    it('touchNode returns safe fallback object without throwing on empty or whitespace name', () => {
      expect(() => evolvingGraph.touchNode('')).not.toThrow()
      expect(() => evolvingGraph.touchNode('   ')).not.toThrow()

      const res = evolvingGraph.touchNode('   ')
      expect(res.id).toBe('')
      expect(res.frequency).toBe(0)
    })
  })
})
