import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildUlinkSystemPrompt,
  parseMiMoReply,
  getMiMoConfig,
  saveMiMoConfig,
  askMiMoStream,
  DEFAULT_MIMO_MODEL,
  DEFAULT_MIMO_BASE_URL,
} from '../../lib/ai/mimoClient.js'
import type { Category, CustomAttribute } from '../../types.js'

describe('mimoClient', () => {
  const dummyCats: Category[] = [
    { id: 'cat-1', name: '设计灵感', icon: '', color: '', order: 0 },
    { id: 'cat-2', name: '开发工具', icon: '', color: '', order: 1 },
  ]
  const dummyAttrs: CustomAttribute[] = [
    { id: 'attr-1', name: '开源', type: 'boolean' },
    { id: 'attr-2', name: '免费', type: 'boolean' },
  ]

  beforeEach(() => {
    localStorage.clear()
  })

  describe('buildUlinkSystemPrompt', () => {
    it('正确将分类与属性注入中文系统提示词', () => {
      const prompt = buildUlinkSystemPrompt({
        categories: dummyCats,
        customAttributes: dummyAttrs,
        isZh: true,
      })

      expect(prompt).toContain('与链 (ULink)')
      expect(prompt).toContain('设计灵感、开发工具')
      expect(prompt).toContain('开源、免费')
      expect(prompt).toContain('/dedup')
      expect(prompt).toContain('```ulink-card')
      expect(prompt).toContain('严禁浮夸推销文案')
    })

    it('支持英文提示词生成', () => {
      const prompt = buildUlinkSystemPrompt({
        categories: dummyCats,
        customAttributes: dummyAttrs,
        isZh: false,
      })

      expect(prompt).toContain('ULink')
      expect(prompt).toContain('设计灵感、开发工具')
      expect(prompt).toContain('/dedup')
      expect(prompt).toContain('ulink-card')
    })

    it('动态情境切片：正确将当前聚焦笔记组、所处分类与多选书签注入系统提示词', () => {
      const prompt = buildUlinkSystemPrompt({
        categories: dummyCats,
        customAttributes: dummyAttrs,
        isZh: true,
        contextSlice: {
          currentCategoryName: '设计灵感',
          focusedGroupName: 'UI组件库',
          focusedGroupBookmarks: [
            { title: 'Ant Design', url: 'https://ant.design' },
            { title: 'Tailwind CSS', url: 'https://tailwindcss.com' },
          ],
          selectedBookmarks: [
            { title: 'Figma', url: 'https://figma.com' },
          ],
        },
      })

      expect(prompt).toContain('当前所处分类视图：「设计灵感」')
      expect(prompt).toContain('当前正处于笔记组工作台：「UI组件库」')
      expect(prompt).toContain('Ant Design (https://ant.design)')
      expect(prompt).toContain('Tailwind CSS (https://tailwindcss.com)')
      expect(prompt).toContain('当前用户多选勾选的书签 (1个)：[Figma]')
    })
  })

  describe('parseMiMoReply', () => {
    it('正确解析 ```ulink-card 并提取卡片，剥离正文中的代码块', () => {
      const reply = `为你推荐两款优秀的开源工具：

1. Excalidraw 手绘白板
2. tldraw 无限画布

\`\`\`ulink-card
[
  {
    "title": "Excalidraw",
    "url": "https://excalidraw.com",
    "notes": "纯网页端手绘白板，零登录即可使用",
    "suggestedCategory": "设计灵感",
    "tags": ["开源", "免费"]
  }
]
\`\`\``

      const { cleanText, candidates } = parseMiMoReply(reply, dummyCats, dummyAttrs)

      expect(cleanText).not.toContain('```ulink-card')
      expect(cleanText).toContain('Excalidraw 手绘白板')
      expect(candidates).toHaveLength(1)
      expect(candidates[0].title).toBe('Excalidraw')
      expect(candidates[0].url).toBe('https://excalidraw.com')
      expect(candidates[0].categoryId).toBe('cat-1') // 匹配到「设计灵感」
      expect(candidates[0].tag).toBe('开源')
    })

    it('当回复无 ulink-card 时优雅保留全部正文，候选为空', () => {
      const reply = '这是对与链功能的使用说明，无需推荐卡片。'
      const { cleanText, candidates } = parseMiMoReply(reply, dummyCats, dummyAttrs)

      expect(cleanText).toBe(reply)
      expect(candidates).toHaveLength(0)
    })

    it('当 ulink-card 中 JSON 损坏时，不抛错且保留文字', () => {
      const reply = `推荐：
\`\`\`ulink-card
[{ broken json
\`\`\``
      const { cleanText, candidates } = parseMiMoReply(reply, dummyCats, dummyAttrs)

      expect(cleanText).toBe('推荐：')
      expect(candidates).toHaveLength(0)
    })
  })

  describe('getMiMoConfig & saveMiMoConfig', () => {
    it('默认读取内置/环境变量配置', () => {
      const conf = getMiMoConfig()
      expect(conf.model).toBe(DEFAULT_MIMO_MODEL)
      expect(conf.baseUrl).toBe(DEFAULT_MIMO_BASE_URL)
      expect(conf.apiKey).toBeTruthy()
      expect(conf.enabled).toBe(true)
    })

    it('保存自定义配置后优先读取 LocalStorage', () => {
      saveMiMoConfig({
        apiKey: 'sk-custom-test-key',
        model: 'mimo-custom',
      })

      const conf = getMiMoConfig()
      expect(conf.apiKey).toBe('sk-custom-test-key')
      expect(conf.model).toBe('mimo-custom')
    })
  })

  describe('askMiMoStream', () => {
    it('正确解析 SSE 流并分别触发 onReasoningDelta 与 onContentDelta', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"reasoning_content":"思考步骤1"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"思考步骤2"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"这是正式"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"回答。"}}]}\n\n',
        'data: [DONE]\n\n',
      ]

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
          controller.close()
        },
      })

      const origFetch = globalThis.fetch
      globalThis.fetch = async () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })

      try {
        const reasoningDeltas: string[] = []
        const contentDeltas: string[] = []

        const res = await askMiMoStream(
          '测试问题',
          {
            categories: dummyCats,
            customAttributes: dummyAttrs,
          },
          {
            onReasoningDelta(delta) {
              reasoningDeltas.push(delta)
            },
            onContentDelta(delta) {
              contentDeltas.push(delta)
            },
          }
        )

        expect(reasoningDeltas).toEqual(['思考步骤1', '思考步骤2'])
        expect(contentDeltas).toEqual(['这是正式', '回答。'])
        expect(res.reasoning).toBe('思考步骤1思考步骤2')
        expect(res.reply).toBe('这是正式回答。')
      } finally {
        globalThis.fetch = origFetch
      }
    })

    it('正确解析 SSE 中的 delta.tool_calls 并结构化返回', async () => {
      saveMiMoConfig({ apiKey: 'sk-test-tool-call' })

      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"正在为你体检资产"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_audit_1","function":{"name":"audit_vault","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
          controller.close()
        },
      })

      const origFetch = globalThis.fetch
      globalThis.fetch = async () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })

      try {
        const toolCallsReceived: any[] = []
        const res = await askMiMoStream(
          '体检一下我的书签',
          {
            categories: dummyCats,
            customAttributes: dummyAttrs,
          },
          {
            onToolCall(tc) {
              toolCallsReceived.push(tc)
            },
          }
        )

        expect(res.toolCalls).toBeDefined()
        expect(res.toolCalls?.length).toBe(1)
        expect(res.toolCalls?.[0].name).toBe('audit_vault')
        expect(res.toolCalls?.[0].id).toBe('call_audit_1')
        expect(toolCallsReceived.length).toBe(1)
      } finally {
        globalThis.fetch = origFetch
      }
    })
  })
})
