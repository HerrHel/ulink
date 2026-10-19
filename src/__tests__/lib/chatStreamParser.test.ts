import { describe, it, expect } from 'vitest'
import {
  formatLightMarkdown,
  parseTurnContentSegments,
  mergeParsedCandidates,
} from '../../lib/ai/chatStreamParser.js'
import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'

describe('chatStreamParser', () => {
  const dummyCats: Category[] = [
    { id: 'cat-1', name: '设计灵感', icon: '', color: '', order: 0 },
    { id: 'cat-2', name: '工具', icon: '', color: '', order: 1 },
  ]
  const dummyAttrs: CustomAttribute[] = [
    { id: 'attr-1', name: '免费', type: 'boolean' },
  ]

  describe('formatLightMarkdown', () => {
    it('正确将 ## 转换为标题，将 ** 转换为 strong', () => {
      const md = `## 推荐工具
这是**加粗说明**，还有\`code\`代码。`
      const html = formatLightMarkdown(md)

      expect(html).toContain('<h3 class="chat-flow-heading">推荐工具</h3>')
      expect(html).toContain('<strong>加粗说明</strong>')
      expect(html).toContain('<code class="chat-flow-code">code</code>')
    })

    it('正确将列表项包裹在 ul/li 中', () => {
      const md = `- 优势一
- 优势二`
      const html = formatLightMarkdown(md)

      expect(html).toContain('<ul class="chat-flow-list">')
      expect(html).toContain('<li>优势一</li>')
      expect(html).toContain('<li>优势二</li>')
    })

    it('有效过滤 XSS 危险脚本标签', () => {
      const md = 'Hello <script>alert(1)</script> World'
      const html = formatLightMarkdown(md)

      expect(html).not.toContain('<script>')
      expect(html).toContain('Hello')
      expect(html).toContain('World')
    })
  })

  describe('parseTurnContentSegments', () => {
    it('正确解析随文图文混排的多个卡片与段落', () => {
      const content = `为你推荐好用的视频转 GIF 工具：

\`\`\`ulink-card
{"title":"Ezgif","url":"https://ezgif.com","suggestedCategory":"工具","tags":["免费"]}
\`\`\`
这是 Ezgif 的详细分析。
- 为什么选它：完全免费
- 适用人群：教程制作者

\`\`\`ulink-card
{"title":"AConvert","url":"https://aconvert.com","suggestedCategory":"工具","tags":["免费"]}
\`\`\`
这是 AConvert 的轻量评测。`

      const { segments, allCandidates } = parseTurnContentSegments(content, dummyCats, dummyAttrs)

      expect(segments).toHaveLength(5)
      expect(segments[0].type).toBe('text')
      expect((segments[0] as any).rawText).toContain('为你推荐好用的视频转 GIF 工具：')

      expect(segments[1].type).toBe('card')
      expect((segments[1] as any).candidate.title).toBe('Ezgif')
      expect((segments[1] as any).candidate.categoryId).toBe('cat-2')

      expect(segments[2].type).toBe('text')
      expect((segments[2] as any).rawText).toContain('这是 Ezgif 的详细分析')

      expect(segments[3].type).toBe('card')
      expect((segments[3] as any).candidate.title).toBe('AConvert')

      expect(segments[4].type).toBe('text')
      expect((segments[4] as any).rawText).toContain('这是 AConvert 的轻量评测')

      expect(allCandidates).toHaveLength(2)
    })

    it('处理无卡片的纯文本内容', () => {
      const content = '这是纯回答文本，没有任何卡片。'
      const { segments, allCandidates } = parseTurnContentSegments(content, dummyCats, dummyAttrs)

      expect(segments).toHaveLength(1)
      expect(segments[0].type).toBe('text')
      expect(allCandidates).toHaveLength(0)
    })

    it('流式生成中，当卡片处于未闭合阶段时隐藏半截 JSON 避免闪烁暴露', () => {
      const streamingContent = `为你推荐手绘白板工具：

\`\`\`ulink-card
{"title":"Excalidraw","url":"https://excalidraw`
      const { segments, allCandidates } = parseTurnContentSegments(streamingContent, dummyCats, dummyAttrs)

      // 仅渲染卡片出现前的段落，未闭合的 JSON 块被安全隐藏
      expect(segments).toHaveLength(1)
      expect(segments[0].type).toBe('text')
      expect((segments[0] as any).rawText).toContain('为你推荐手绘白板工具：')
      expect((segments[0] as any).html).not.toContain('Excalidraw')
      expect(allCandidates).toHaveLength(0)
    })

    it('处理空字符串输入', () => {
      const { segments, allCandidates } = parseTurnContentSegments('', dummyCats, dummyAttrs)
      expect(segments).toHaveLength(0)
      expect(allCandidates).toHaveLength(0)
    })
  })

  describe('mergeParsedCandidates', () => {
    const cand = (title: string, extra: Partial<AiCandidateBookmark> = {}): AiCandidateBookmark => ({
      title,
      url: `https://${title.toLowerCase()}.com`,
      notes: '',
      ...extra,
    })

    it('流式期间新到卡片持续合并进 turn.candidates（不只保留首批）', () => {
      const card1 = `\`\`\`ulink-card\n{"title":"Ezgif","url":"https://ezgif.com"}\n\`\`\``
      const card2 = `\`\`\`ulink-card\n{"title":"AConvert","url":"https://aconvert.com"}\n\`\`\``

      // 首批：仅第一张卡解析完成
      const first = parseTurnContentSegments(`推荐一：\n${card1}`, dummyCats, dummyAttrs)
      let candidates = mergeParsedCandidates(undefined, first.allCandidates)
      expect(candidates).toHaveLength(1)

      // 第二批：流式内容增长，两张卡都完整（全量重解析）
      const second = parseTurnContentSegments(`推荐一：\n${card1}\n推荐二：\n${card2}`, dummyCats, dummyAttrs)
      candidates = mergeParsedCandidates(candidates, second.allCandidates)

      // 后到的卡必须合入，不得因「已有首批」被丢弃
      expect(candidates).toHaveLength(2)
      expect(candidates?.map((c) => c.title)).toEqual(['Ezgif', 'AConvert'])
    })

    it('按 url|title 去重，重复解析不产生重复条目', () => {
      const parsed = [cand('a'), cand('b'), cand('a')]
      const merged = mergeParsedCandidates([cand('b')], parsed)
      expect(merged?.map((c) => c.title)).toEqual(['b', 'a'])
    })

    it('既有条目优先保留，不重置 isAdded 等用户操作状态', () => {
      const existing = [cand('a', { isAdded: true, notes: '已存入前的备注' })]
      const merged = mergeParsedCandidates(existing, [cand('a', { isAdded: false, notes: '重解析的备注' }), cand('b')])
      expect(merged?.[0].isAdded).toBe(true)
      expect(merged?.[0].notes).toBe('已存入前的备注')
      expect(merged).toHaveLength(2)
    })

    it('无新增时返回原数组引用（渲染期不反复改写状态）', () => {
      const existing = [cand('a')]
      expect(mergeParsedCandidates(existing, [cand('a')])).toBe(existing)
      expect(mergeParsedCandidates(existing, [])).toBe(existing)
    })

    it('既有为空时以解析结果为准', () => {
      const parsed = [cand('a')]
      expect(mergeParsedCandidates(undefined, parsed)).toEqual(parsed)
      expect(mergeParsedCandidates([], parsed)).toEqual(parsed)
    })
  })
})
