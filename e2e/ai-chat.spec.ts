/**
 * AI 对话全链路 e2e（mock 模型 SSE，无真实出站）
 *
 * 1. 流式渲染 + 候选卡片快捷存入落库：
 *    发送自然语言提问 → SSE 多段 content 增量流式渲染 → ```ulink-card``` 解析为内嵌候选卡
 *    → 点快捷存入 → 书签写入 localStorage（linkvault_v2）
 * 2. 行动卡片（Agent 工具调用）点击 → 落库：
 *    第 1 轮响应 content（含候选卡）+ tool_calls(create_workspace) → 行动卡片渲染且候选默认全选
 *    → 点执行 → createTopicWorkspace 建书签+组 → 完成态 + 续轮结论 + 落库
 *
 * 查询语句刻意避开 siteCommander 的站内指令/意图正则（新建分类/搭建XX工作台/移动到…等），
 * 确保走 MiMo 自然语言链路。
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { installSupabaseMock } from './helpers/supabaseMock'

// 锁定 zh-CN：CI 浏览器默认 en-US，i18n 会渲染英文导致中文断言失配
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lv_locale', 'zh-CN')
  })
})

const FENCE = '```'

/** 单条 SSE 事件（OpenAI 兼容 delta 格式） */
function sse(events: Array<Record<string, unknown>>): string {
  return (
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') +
    'data: [DONE]\n\n'
  )
}

function deltaContent(text: string): Record<string, unknown> {
  return { choices: [{ delta: { content: text } }] }
}

function deltaToolCall(
  id: string,
  name: string,
  args: string,
): Record<string, unknown> {
  return {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id, function: { name, arguments: args } }],
        },
      },
    ],
  }
}

/** ulink-card 围栏 JSON（数组格式，2 个公网候选） */
function cardBlock(): string {
  const cards = [
    {
      title: 'Excalidraw',
      url: 'https://excalidraw.com',
      notes: '开源手绘风白板',
      tags: ['开源'],
    },
    {
      title: 'tldraw',
      url: 'https://tldraw.com',
      notes: '无限画布白板',
      tags: ['免费'],
    },
  ]
  return `${FENCE}ulink-card\n${JSON.stringify(cards)}\n${FENCE}`
}

/** 拦截 mimo-chat Edge Function，返回给定 SSE 流 */
async function mockMimoSse(page: Page, handler: (reqCount: number) => string) {
  let count = 0
  await page.route('**/functions/v1/mimo-chat', async (route: Route) => {
    count++
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: handler(count),
    })
  })
}

/** 打开 AI 侧边栏并等待输入框就绪 */
async function openAiPanel(page: Page) {
  await page.getByTestId('lv-card-grid').waitFor({ state: 'attached', timeout: 15000 })
  await page.locator('#btnToggleDetail').click()
  await expect(page.locator('.chat-textarea')).toBeVisible({ timeout: 5000 })
}

/** 落库断言：localStorage 缓存（linkvault_v2）包含目标 URL */
async function expectPersisted(page: Page, urlPart: string) {
  await page.waitForFunction(
    (part) => {
      const raw = localStorage.getItem('linkvault_v2') || ''
      return raw.includes(part)
    },
    urlPart,
    { timeout: 8000 },
  )
}

test.describe('AI 对话全链路（mock SSE）', () => {
  test('流式渲染 + 候选卡片快捷存入落库', async ({ page }) => {
    test.setTimeout(60000)
    await installSupabaseMock(page)
    await mockMimoSse(page, () =>
      sse([
        deltaContent('推荐两个画图工具：'),
        deltaContent(`\n${cardBlock()}\n`),
        deltaContent('适合白板协作与草图场景。'),
      ]),
    )

    await page.goto('/app')
    await openAiPanel(page)

    await page.locator('.chat-textarea').fill('帮我推荐一些画图的网站')
    await page.locator('.chat-send-btn').click()

    // 流式正文渲染：ulink-card 前后文字切成两段（段落 → 卡片 → 段落）
    await expect(page.locator('.chat-flow-text').first()).toContainText('推荐两个画图工具', {
      timeout: 10000,
    })
    await expect(page.locator('.chat-flow-text').last()).toContainText('适合白板协作与草图场景', {
      timeout: 5000,
    })

    // ulink-card 解析出的内嵌候选卡
    const cards = page.locator('.ai-inline-card')
    await expect(cards).toHaveCount(2, { timeout: 10000 })
    await expect(cards.nth(0)).toContainText('Excalidraw')
    await expect(cards.nth(1)).toContainText('tldraw')

    // 快捷存入第一张候选 → 已存态 + 落库
    await cards.nth(0).locator('.inline-save-btn').click()
    await expect(cards.nth(0).locator('.inline-added-actions')).toBeVisible({ timeout: 5000 })
    await expectPersisted(page, 'excalidraw.com')
  })

  test('行动卡片（create_workspace）点击 → 建组落库 + 续轮结论', async ({ page }) => {
    test.setTimeout(60000)
    await installSupabaseMock(page)
    await mockMimoSse(page, (n) => {
      if (n === 1) {
        // 第 1 轮：正文带候选卡 + create_workspace 工具调用
        return sse([
          deltaContent(`为你甄选的工具如下：\n${cardBlock()}\n`),
          deltaToolCall('call_ws_1', 'create_workspace', '{"topic":"AI工具台"}'),
        ])
      }
      // 续轮：工具结果回传后的结论文本
      return sse([
        deltaContent('已为你创建「AI工具台」工作台，两个工具均已存入。'),
      ])
    })

    await page.goto('/app')
    await openAiPanel(page)

    await page.locator('.chat-textarea').fill('帮我推荐一个AI工具导航站')
    await page.locator('.chat-send-btn').click()

    // 行动卡片出现，候选默认全选（2 个复选框均勾选）
    const actionCard = page.locator('.chat-action-card')
    await expect(actionCard).toBeVisible({ timeout: 15000 })
    const checkboxes = actionCard.locator('.action-candidate-checkbox')
    await expect(checkboxes).toHaveCount(2, { timeout: 5000 })
    await expect(checkboxes.nth(0)).toBeChecked()
    await expect(checkboxes.nth(1)).toBeChecked()

    // 执行 → 完成态 + 续轮结论渲染（续轮结论文本在行动卡片所在轮次内）
    await actionCard.locator('.action-card-btn').click()
    await expect(actionCard.locator('.action-card-done')).toBeVisible({ timeout: 15000 })
    const cardTurnText = page
      .locator('.chat-turn-item', { has: page.locator('.chat-action-card') })
      .locator('.chat-flow-text')
    await expect(cardTurnText).toContainText('已为你创建「AI工具台」工作台', { timeout: 10000 })
    // 执行结果消息（后置新轮次）包含主题名
    await expect(page.locator('.chat-flow-text').last()).toContainText('AI工具台', { timeout: 5000 })

    // createTopicWorkspace 真实建书签落库（两个候选 URL 均写入）
    await expectPersisted(page, 'excalidraw.com')
    await expectPersisted(page, 'tldraw.com')
  })
})
