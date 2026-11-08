/**
 * ai-module5-audit-fixes.test.ts
 *
 * 针对模块 5（AI 工作台、智能体系统与知识增强层）全量深层审计修复的专项回归测试：
 * 1. secretFilter.ts: Recovery Key (24 位) 与 E2E 三段密文脱敏
 * 2. localRAG.ts: formatChunksForPrompt 清洗代码围栏与控制字符（Prompt Injection 防线）
 * 3. universalAgent.ts: set_parent 多级回溯防成环死锁崩溃
 * 4. universalAgent.ts: update_notes 锁定态密文防覆写与 sanitizeHTML 过滤
 * 5. universalAgent.ts: navigate 自动切回 ui.activeView = 'bookmarks'
 * 6. useAiActionCards.ts: navigateToActionTarget 自动切回 ui.activeView = 'bookmarks'
 * 7. chatSessions.ts: saveSessions 超大多模态 Base64 dataUrl 与 prompt 超长截断（防 localStorage 撑爆）
 * 8. taskPlanner.ts: 依赖死锁/不可解析时 executeAllDagSteps 自动收敛为 failed（不挂起 running）
 * 9. useAiChatAgent.ts: read_webpage 严格拦截内网/环回 SSRF 地址
 * 10. bookmarkEnrich.ts: 密文与内网 URL 短路拦截
 * 11. siteCommands/theme.ts: 切换主题后自动保存 UI 状态
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { redactSensitivePatterns } from '../../lib/ai/secretFilter.js'
import { vaultRAG } from '../../lib/ai/localRAG.js'
import {
  executeManageBookmarks,
  executeManageWorkspaces,
  executeManageSettings,
} from '../../lib/ai/universalAgent.js'
import { useAiActionCards } from '../../composables/domain/useAiActionCards.js'
import { saveSessions, loadSessions, type AiChatSession } from '../../lib/ai/chatSessions.js'
import {
  createTaskDagPlan,
  executeAllDagSteps,
} from '../../lib/ai/taskPlanner.js'
import { createAiAgentToolRunner } from '../../composables/domain/useAiChatAgent.js'
import { enrichBookmarkMetadata } from '../../lib/ai/bookmarkEnrich.js'
import { themeBlock } from '../../lib/ai/siteCommands/theme.js'
import { locateAndHighlightCard } from '../../lib/ai/cardLocator.js'
import { resolveCardContext, formatAttachedCardsForPrompt } from '../../lib/ai/cardReader.js'
import { getSmartPrefill } from '../../lib/ai/smartPrefill.js'
import { findSimilarWebsites } from '../../lib/ai/cloudCandidates.js'
import { evolvingGraph } from '../../lib/ai/evolvingGraph.js'
import { appendAiContentToGroup, replaceAiContentToGroup } from '../../lib/ai/noteWriteback.js'
import { normalizeUrlForDedup, detectParentChildRelations, findDuplicateCandidates } from '../../lib/ai/localClustering.js'
import { findSerendipityMatches } from '../../lib/ai/serendipityEngine.js'
import { formatAttachedFilesForPrompt, type AttachedMediaFile } from '../../lib/ai/attachmentHelper.js'
import { extractSessionTitle } from '../../lib/ai/chatSessions.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { ref } from 'vue'
import type { Bookmark, SiblingGroup, Category } from '../../types.js'

function mockBm(partial: Partial<Bookmark> & { id: string; title: string; url: string }): Bookmark {
  return {
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: 'all',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 100,
    updatedAt: 100,
    ...partial,
  }
}

function mockGroup(partial: Partial<SiblingGroup> & { id: string; name: string }): SiblingGroup {
  return {
    categoryId: 'all',
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '',
    updatedAt: 100,
    useCount: 0,
    ...partial,
  }
}

function mockCat(partial: Partial<Category> & { id: string; name: string }): Category {
  return {
    icon: 'folder',
    color: '#000000',
    order: 0,
    ...partial,
  }
}

describe('Module 5 Deep Audit Fixes Regression Suite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  // ─────────────────────────────────────────────────────────────
  // 1. secretFilter.ts: 恢复密钥与 E2E 密文脱敏
  // ─────────────────────────────────────────────────────────────
  describe('1. secretFilter.ts 敏感凭证过滤', () => {
    it('对与链 24 位主密码恢复密钥精准脱敏为 [REDACTED_RECOVERY_KEY]', () => {
      const input = '用户询问：我的恢复密钥是 A1B2-C3D4-E5F6-G7H8-I9J0-K1L2，能帮我看下吗？'
      const redacted = redactSensitivePatterns(input)
      expect(redacted).not.toContain('A1B2-C3D4-E5F6-G7H8-I9J0-K1L2')
      expect(redacted).toContain('[REDACTED_RECOVERY_KEY]')
    })

    it('对 E2E 三段式密文（salt.iv.ciphertext）脱敏为 [REDACTED_CIPHERTEXT]', () => {
      // 44 字符 salt, 16 字符 iv, 24+ 字符 ciphertext
      const salt = '1234567890123456789012345678901234567890123=' // 44 chars
      const iv = '1234567890123456' // 16 chars
      const cipher = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456' // 32 chars
      const mockCipher = `${salt}.${iv}.${cipher}`
      const input = `这是一个加密字段: ${mockCipher} 请不要泄露`
      const redacted = redactSensitivePatterns(input)
      expect(redacted).not.toContain(mockCipher)
      expect(redacted).toContain('[REDACTED_CIPHERTEXT]')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. localRAG.ts: formatChunksForPrompt 提示词注入清洗
  // ─────────────────────────────────────────────────────────────
  describe('2. localRAG.ts 召回内容安全消毒', () => {
    it('过滤代码围栏反引号与不可见控制字符', () => {
      const chunks = [
        {
          id: 'c1',
          sourceType: 'bookmark' as const,
          sourceId: 'b1',
          title: '恶意书签 ```python system_prompt ```',
          content: '正文注入 \x00\x08 攻击换行 \n\n```json {"hack": true}',
          url: 'https://example.com/`injected`',
          category: '系统`分类`',
          tags: ['注入`标签`', '正常'],
        },
      ]
      const prompt = vaultRAG.formatChunksForPrompt(chunks)
      // 反引号必须被全部替换为空格，不能包含代码围栏
      expect(prompt).not.toContain('```')
      expect(prompt).not.toContain('`')
      // 控制字符 \x00 等被剥离
      expect(prompt).not.toContain('\x00')
      expect(prompt).not.toContain('\x08')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. universalAgent.ts: set_parent 多级回溯防成环
  // ─────────────────────────────────────────────────────────────
  describe('3. universalAgent.ts set_parent 防环', () => {
    it('多级嵌套形成环状（A -> B -> C -> A）时应被阻断', async () => {
      const ds = useDataStore()
      const bmA = mockBm({
        id: 'bm_a',
        title: '站点 A',
        url: 'https://a.com',
        categoryId: 'cat_1',
        order: 1,
      })
      const bmB = mockBm({
        id: 'bm_b',
        title: '站点 B',
        url: 'https://b.com',
        parentId: 'bm_a', // B 挂在 A 下
        categoryId: 'cat_1',
        order: 2,
      })
      const bmC = mockBm({
        id: 'bm_c',
        title: '站点 C',
        url: 'https://c.com',
        parentId: 'bm_b', // C 挂在 B 下
        categoryId: 'cat_1',
        order: 3,
      })
      ds.bookmarks = [bmA, bmB, bmC]

      // 试图把 A 挂在 C 下：A -> C -> B -> A 形成死环
      const res = await executeManageBookmarks(
        { action: 'set_parent', target: 'bm_a', targetParent: 'bm_c' },
        { ds }
      )

      expect(res.success).toBe(false)
      expect(res.message).toContain('循环从属关系')
      expect(bmA.parentId).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. universalAgent.ts: update_notes 锁定态保护与 HTML 净化
  // ─────────────────────────────────────────────────────────────
  describe('4. universalAgent.ts update_notes 密文与安全', () => {
    it('当工作台笔记处于密文锁定状态时，拒绝直接覆盖', async () => {
      const ds = useDataStore()
      const cipherNotes = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
      const grp = mockGroup({
        id: 'sg_1',
        name: '机密工作台',
        categoryId: 'cat_1',
        order: 1,
        notes: cipherNotes,
      })
      ds.addGroup(grp)

      const res = await executeManageWorkspaces(
        { action: 'update_notes', workspaceId: 'sg_1', notes: '<p>新笔记覆盖</p>' },
        { ds }
      )

      expect(res.success).toBe(false)
      expect(res.message).toContain('加密锁定状态')
      expect(ds.groupMap['sg_1'].notes).toBe(cipherNotes) // 未被篡改
    })

    it('写入笔记时经过 sanitizeHTML 过滤危险标签', async () => {
      const ds = useDataStore()
      const grp = mockGroup({
        id: 'sg_2',
        name: '公开工作台',
        categoryId: 'cat_1',
        order: 1,
        notes: '<p>旧笔记</p>',
      })
      ds.addGroup(grp)

      const res = await executeManageWorkspaces(
        { action: 'update_notes', workspaceId: 'sg_2', notes: '<p>合规内容</p><script>alert("xss")</script>' },
        { ds }
      )

      expect(res.success).toBe(true)
      const updated = ds.groupMap['sg_2']
      expect(updated.notes).not.toContain('<script>')
      expect(updated.notes).toContain('<p>合规内容</p>')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. universalAgent.ts: navigate 自动切回书签视图
  // ─────────────────────────────────────────────────────────────
  describe('5. universalAgent.ts navigate 视图同步', () => {
    it('跳转分类视图时，将 ui.activeView 自动置为 bookmarks', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      ds.categories = [mockCat({ id: 'cat_dev', name: '开发工具' })]
      ui.activeView = 'ai' // 当前在 AI 对话页

      const res = await executeManageSettings(
        { action: 'navigate', navigateTarget: 'category', targetName: '开发工具' },
        { ds, ui }
      )

      expect(res.success).toBe(true)
      expect(ui.curCat).toBe('cat_dev')
      expect(ui.activeView).toBe('bookmarks')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 6. useAiActionCards.ts: navigateToActionTarget 视图同步
  // ─────────────────────────────────────────────────────────────
  describe('6. useAiActionCards.ts 卡片导航视图同步', () => {
    it('点击行动卡片导航至目标工作台时切回 bookmarks 视图', () => {
      const ds = useDataStore()
      const ui = useUIStore()
      ds.siblingGroups = [mockGroup({ id: 'sg_target', name: '目标工作台' })]
      ui.activeView = 'ai'

      const actionCards = useAiActionCards({
        ds,
        ui,
        chatTurns: ref([]),
        sessions: ref([]),
        currentSessionId: ref(''),
        t: (k: string) => k,
        tN: (_k: string, n: number) => String(n),
      })

      actionCards.navigateToActionTarget({
        type: 'custom',
        title: '已建工作台',
        buttonText: '前往查看',
        actionName: 'view',
        resultGid: 'sg_target',
      })

      expect(ui.focusedGroupId).toBe('sg_target')
      expect(ui.activeView).toBe('bookmarks')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 7. chatSessions.ts: saveSessions 超大图片与 prompt 截断防爆
  // ─────────────────────────────────────────────────────────────
  describe('7. chatSessions.ts 持久化存储防爆保护', () => {
    it('剥离超过 32KB 的超大 Base64 dataUrl，并截断超长 promptContent', () => {
      const hugeDataUrl = 'data:image/png;base64,' + 'A'.repeat(40000)
      const smallDataUrl = 'data:image/png;base64,' + 'B'.repeat(100)
      const hugePrompt = 'C'.repeat(15000)

      const session: AiChatSession = {
        id: 'session_huge',
        title: '测试超大会话',
        turns: [
          {
            id: 'turn_1',
            role: 'user',
            content: '你好',
            promptContent: hugePrompt,
            attachedFiles: [
              {
                id: 'f1',
                name: 'huge.png',
                type: 'image',
                mimeType: 'image/png',
                size: 40000,
                sizeFormatted: '40KB',
                dataUrl: hugeDataUrl,
              },
              {
                id: 'f2',
                name: 'small.png',
                type: 'image',
                mimeType: 'image/png',
                size: 100,
                sizeFormatted: '100B',
                dataUrl: smallDataUrl,
              },
            ],
            timestamp: 100,
          },
        ],
        createdAt: 100,
        updatedAt: 100,
      }

      saveSessions([session])
      const loaded = loadSessions()
      const savedTurn = loaded[0].turns[0]

      // 超大图被剥离，小图保留
      expect(savedTurn.attachedFiles?.[0].dataUrl).toBeUndefined()
      expect(savedTurn.attachedFiles?.[1].dataUrl).toBe(smallDataUrl)
      // promptContent 被截断到 8000 字符内
      expect(savedTurn.promptContent?.length).toBeLessThanOrEqual(8000)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 8. taskPlanner.ts: 依赖死循环时自动收敛 failed
  // ─────────────────────────────────────────────────────────────
  describe('8. taskPlanner.ts 异常依赖自动收敛', () => {
    it('当步骤依赖不存在的步骤时，executeAllDagSteps 自动置为 failed 而非 running', async () => {
      const plan = createTaskDagPlan({
        title: '异常流水线',
        steps: [
          {
            id: 'step_1',
            title: '步骤 1',
            actionName: 'test',
            dependsOn: ['step_non_existent'], // 永远无法满足
          },
        ],
      })

      await executeAllDagSteps(plan, async () => ({ success: true }))
      expect(plan.status).toBe('failed')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 9. useAiChatAgent.ts: read_webpage 严格拦截内网 SSRF
  // ─────────────────────────────────────────────────────────────
  describe('9. useAiChatAgent.ts read_webpage SSRF 安全拦截', () => {
    it('拒绝抓取 127.0.0.1、localhost 等内网/环回地址', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      const runner = createAiAgentToolRunner({
        ds,
        ui,
        t: (k: string) => k,
        tN: (_k: string, n: number) => String(n),
      })

      const assistantTurn = {
        id: 'turn_agent',
        role: 'assistant' as const,
        content: '',
        timestamp: 100,
      }
      const controller = new AbortController()

      const res = await runner(assistantTurn, controller, {
        name: 'read_webpage',
        arguments: { url: 'http://127.0.0.1:8080/admin' },
      })

      expect(res).toContain('安全拦截')
      expect(res).toContain('私有局域网')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 10. bookmarkEnrich.ts: 密文与内网 URL 短路
  // ─────────────────────────────────────────────────────────────
  describe('10. bookmarkEnrich.ts 密文与私有地址保护', () => {
    it('当书签 URL 为三段密文时立即短路不发起抓取', async () => {
      const cipherUrl = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ=:MDEyMzQ1Njc4OTAxMjM0NQ==:MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE='
      const bm = mockBm({
        id: 'bm_locked',
        title: '加密书签',
        url: cipherUrl,
      })

      const diff = await enrichBookmarkMetadata(bm, [], [])
      expect(diff.currentTitle).toBe('加密书签')
      expect(diff.suggestedNotes).toBe('')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 11. siteCommands/theme.ts: 切换主题后持久化 UI 状态
  // ─────────────────────────────────────────────────────────────
  describe('11. siteCommands/theme.ts 主题切换状态持久化', () => {
    it('通过 /theme dark 指令切换主题后调用 saveUIState', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      const app = useAppStore()
      const saveSpy = vi.spyOn(ui, 'saveUIState')

      const res = await themeBlock({
        query: '/theme dark',
        ds,
        ui,
        app,
      })

      expect(res?.handled).toBe(true)
      expect(ui.themeColor).toBe('dark')
      expect(saveSpy).toHaveBeenCalled()
    })

    it('通过自然语言「切换深色模式」切换主题后调用 saveUIState', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      const app = useAppStore()
      const saveSpy = vi.spyOn(ui, 'saveUIState')

      const res = await themeBlock({
        query: '切换深色模式',
        ds,
        ui,
        app,
      })

      expect(res?.handled).toBe(true)
      expect(ui.themeColor).toBe('dark')
      expect(saveSpy).toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 12. cardLocator.ts: AI 视图下卡片定位自动切换视图
  // ─────────────────────────────────────────────────────────────
  describe('12. cardLocator.ts 视图对齐与卡片高亮定位', () => {
    it('当处于 ui.activeView === "ai" 视图时，locateAndHighlightCard 自动切回 "bookmarks"', async () => {
      const ui = useUIStore()
      const ds = useDataStore()
      ui.activeView = 'ai'

      const bm = mockBm({ id: 'bm_locate_1', title: '定位测试', url: 'https://example.com' })
      ds.bookmarks.push(bm)

      const result = await locateAndHighlightCard({ id: 'bm_locate_1' })
      // 虽然测试环境无真实 DOM (#cardGrid)，但必须完成 activeView 的重置对齐
      expect(ui.activeView).toBe('bookmarks')
      expect(result.targetId).toBe('bm_locate_1')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 13. cardReader.ts: 拖拽/附加卡片密文防外送
  // ─────────────────────────────────────────────────────────────
  describe('13. cardReader.ts 密文卡片上下文过滤', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('resolveCardContext 解析带有密文 notes 的书签与笔记时置空 notes', () => {
      const bm = mockBm({ id: 'bm_cipher_ctx', title: '明文标题', url: 'https://ok.com', notes: cipher })
      const group = mockGroup({ id: 'grp_cipher_ctx', name: '明文笔记', notes: cipher })

      const bmCtx = resolveCardContext('bm', 'bm_cipher_ctx', {
        bookmarkMap: { [bm.id]: bm },
        groupMap: {},
      })
      expect(bmCtx?.notes).toBe('')
      expect(bmCtx?.desc).toBe('')

      const grpCtx = resolveCardContext('group', 'grp_cipher_ctx', {
        bookmarkMap: {},
        groupMap: { [group.id]: group },
      })
      expect(grpCtx?.notes).toBe('')
    })

    it('formatAttachedCardsForPrompt 绝不将包含密文的附件吐给提示词', () => {
      const ctxList = [{
        type: 'bm' as const,
        id: 'bm_test',
        title: '加密标题',
        notes: cipher,
      }]
      const prompt = formatAttachedCardsForPrompt(ctxList, true)
      expect(prompt).not.toContain(cipher)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 14. smartPrefill.ts: 密文 URL 预填保护
  // ─────────────────────────────────────────────────────────────
  describe('14. smartPrefill.ts 密文 URL 预填防回显', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('传入三段密文 URL 时，直接返回空 title，绝不回显密文乱码', () => {
      const prefill = getSmartPrefill(cipher)
      expect(prefill.title).toBe('')
      expect(prefill.confidence).toBe('fallback')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 15. cloudCandidates.ts: 密文与内网 URL 防平替外发
  // ─────────────────────────────────────────────────────────────
  describe('15. cloudCandidates.ts 平替挖掘安全护栏', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('传入密文或内网地址时短路返回空数组，不请求外部接口', async () => {
      const resCipher = await findSimilarWebsites(cipher, '测试')
      expect(resCipher).toEqual([])

      const resPrivate = await findSimilarWebsites('http://192.168.1.1/dashboard', '内网路由器')
      expect(resPrivate).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 16. evolvingGraph.ts: 排除密文标题与密文组名
  // ─────────────────────────────────────────────────────────────
  describe('16. evolvingGraph.ts 动态图谱自进化密文过滤', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('mineFromKnowledge 遇到密文标题或组名时不将其作为概念节点存入图谱', () => {
      evolvingGraph.clear()
      const bm = mockBm({ id: 'bm_c', title: cipher, url: 'https://test.com' })
      const grp = mockGroup({ id: 'grp_c', name: cipher })

      evolvingGraph.mineFromKnowledge([bm], [grp])
      expect(evolvingGraph.nodeCount).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 17. noteWriteback.ts: 密文锁定笔记防破坏
  // ─────────────────────────────────────────────────────────────
  describe('17. noteWriteback.ts 密文笔记回写安全拦截', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('当笔记组处于密文锁定态时，appendAiContentToGroup 拒绝写入并返回失败', () => {
      const ds = useDataStore()
      const grp = mockGroup({ id: 'grp_locked', name: '加密组', notes: cipher })
      ds.siblingGroups.push(grp)

      const resAppend = appendAiContentToGroup('grp_locked', 'AI 总结内容')
      expect(resAppend.success).toBe(false)
      expect(resAppend.error).toContain('locked')

      const resReplace = replaceAiContentToGroup('grp_locked', 'AI 新内容')
      expect(resReplace.success).toBe(false)
      expect(resReplace.error).toContain('locked')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 18. localClustering.ts: 聚类与查重排除密文 URL
  // ─────────────────────────────────────────────────────────────
  describe('18. localClustering.ts 密文 URL 聚类与查重防护', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('normalizeUrlForDedup 对密文 URL 直接返回空串', () => {
      expect(normalizeUrlForDedup(cipher)).toBe('')
    })

    it('findDuplicateCandidates 排除未解锁的密文书签，防止误当重复项剔除', () => {
      const b1 = mockBm({ id: 'b1', title: '加密1', url: cipher })
      const b2 = mockBm({ id: 'b2', title: '加密2', url: cipher })
      const dups = findDuplicateCandidates([b1, b2])
      expect(dups).toEqual([])
    })

    it('detectParentChildRelations 排除密文书签', () => {
      const b1 = mockBm({ id: 'b1', title: '加密1', url: cipher })
      const b2 = mockBm({ id: 'b2', title: '加密2', url: cipher })
      const links = detectParentChildRelations([b1, b2])
      expect(links).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 19. serendipityEngine.ts: 知识偶遇过滤密文
  // ─────────────────────────────────────────────────────────────
  describe('19. serendipityEngine.ts 知识偶遇密文过滤', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('目标书签或候选书签包含密文时，不触发偶遇唤醒', () => {
      const target = mockBm({ id: 'target', title: cipher, url: 'https://a.com' })
      const cand = mockBm({ id: 'cand', title: '普通书签', url: 'https://b.com', createdAt: Date.now() - 1000 * 3600 * 24 * 30 })

      const matches = findSerendipityMatches(target, [cand])
      expect(matches).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 20. attachmentHelper.ts: 附件正文敏感凭证脱敏与防注入
  // ─────────────────────────────────────────────────────────────
  describe('20. attachmentHelper.ts 附件正文脱敏与防围栏注入', () => {
    it('formatAttachedFilesForPrompt 对文本附件中的 API Key 执行脱敏并转义代码围栏', () => {
      const file: AttachedMediaFile = {
        id: 'f1',
        name: 'secret.txt',
        type: 'file',
        mimeType: 'text/plain',
        size: 100,
        sizeFormatted: '100 B',
        textContent: 'my key is sk-12345678901234567890123456\n```\nmalicious injection',
      }

      const prompt = formatAttachedFilesForPrompt([file], true)
      expect(prompt).not.toContain('sk-12345678901234567890123456')
      expect(prompt).toContain('[REDACTED_API_KEY]')
      expect(prompt).not.toContain('```\nmalicious')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 21. chatSessions.ts: 提取会话标题排除密文
  // ─────────────────────────────────────────────────────────────
  describe('21. chatSessions.ts 提取会话标题排除密文', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)

    it('当输入为三段密文时，extractSessionTitle 返回空字符串', () => {
      const title = extractSessionTitle(cipher)
      expect(title).toBe('')
    })
  })
})
