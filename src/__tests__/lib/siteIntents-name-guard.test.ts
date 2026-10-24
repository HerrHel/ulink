/**
 * siteIntents — 仅存的两处「参数提取类指令」护栏
 *
 * 背景：`parseSpecificMoveIntent` 曾把「将此书签移到合适的分类去，并补上合适标签」
 * 整句后半段当成分类名。审计后确认根因不是某个正则写错，而是**拿正则做开放集合的
 * 参数提取**：意图是封闭集合（可穷举），参数是开放集合（无法穷举）。
 * 因此带参数的自然语言指令已整体交还大模型（见 siteCommander.test.ts 里
 * 「对应的自然语言说法一律交回大模型」），只保留两处有独特理由的：
 *
 * - parseBatchMoveIntent：依赖 UI 勾选状态（ui.batchMode / batchSelected），
 *   这是大模型看不见的信息，正则才有优势；
 * - parseSimilarSiteIntent：LLM 侧没有对应工具（tools.ts 只有 read_webpage，
 *   没有 find-similar），删掉是实打实的功能损失。
 *
 * 这两处仍需形似度护栏兜底——没护栏时它们分别会报「未找到目标分类『合适的分类去…』」
 * 和拿「这样的工具」当关键词搜平替。
 */
import {
  parseBatchMoveIntent,
  parseSimilarSiteIntent,
  looksLikeCategoryName,
} from '../../lib/ai/siteIntents.js'

describe('parseBatchMoveIntent — 目标必须是分类名（依赖 UI 勾选状态，保留）', () => {
  it('整句口语目标交回大模型', () => {
    expect(parseBatchMoveIntent('把这些书签移到合适的分类去，并补上合适标签')).toBeNull()
  })

  it('真实分类名正常解析', () => {
    expect(parseBatchMoveIntent('把这些书签移到设计资源')).toEqual({ targetName: '设计资源' })
    expect(parseBatchMoveIntent('把选中的书签移动到 前端开发')).toEqual({ targetName: '前端开发' })
  })
})

describe('parseSimilarSiteIntent — 泛化/指代目标不是实体名（LLM 无对应工具，保留）', () => {
  it('指代性目标交回大模型', () => {
    expect(parseSimilarSiteIntent('像这样的工具')).toBeNull()
    expect(parseSimilarSiteIntent('找一些这种网站')).toBeNull()
  })

  it('真实产品名正常解析', () => {
    expect(parseSimilarSiteIntent('有没有类似 Notion 的工具')).toEqual({ target: 'Notion' })
    expect(parseSimilarSiteIntent('找类似 Excalidraw 的网站')).toEqual({ target: 'Excalidraw' })
  })
})

describe('looksLikeCategoryName — 分类名形似度', () => {
  it('接受真实分类名', () => {
    for (const name of ['设计资源', '前端开发', '云服务', 'AI 工具', 'DevOps', '读书笔记']) {
      expect(looksLikeCategoryName(name)).toBe(true)
    }
  })

  it('拒绝整句口语（标点 / 连词 / 模糊限定词 / 目的小句）', () => {
    for (const name of [
      '合适的分类去，并补上合适标签',
      '合适的地方',
      '相关的分类',
      '设计资源，并补上标签',
      '前端开发 然后打标签',
      '随便哪个分类',
      '来放工作用的东西',
      '用于整理工作书签',
    ]) {
      expect(looksLikeCategoryName(name)).toBe(false)
    }
  })

  it('拒绝超长文本、空串与句末语气词', () => {
    expect(looksLikeCategoryName('这是一个明显超过长度上限的分类名称')).toBe(false)
    expect(looksLikeCategoryName('   ')).toBe(false)
    expect(looksLikeCategoryName('设计资源吧')).toBe(false)
  })

  it('不误伤「去中心化」这类以动词字开头的真实名称', () => {
    expect(looksLikeCategoryName('去中心化资源')).toBe(true)
  })
})
