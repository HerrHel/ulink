/**
 * siteIntents — 参数提取类指令的「名称形似度」护栏（全量审计）
 *
 * 背景：`parseSpecificMoveIntent` 曾把「将此书签移到合适的分类去，并补上合适标签」
 * 整句后半段当成分类名。审计发现同一类缺陷另有 4 处，本文件逐一锁死：
 *
 * | 解析器                 | 误判后果                                   |
 * |------------------------|--------------------------------------------|
 * | parseCatIntent         | **真的建出**名叫「来放工作用的东西」的分类   |
 * | parseBatchMoveIntent   | 批量模式下报「未找到目标分类『合适的分类去…』」|
 * | parseMoveIntent        | 报「未找到分类『合适的分类去』」             |
 * | parsePackIntent        | 拿「一个前端学习」去云端检索并生成工作台计划 |
 * | parseSimilarSiteIntent | 拿「这样的工具」当关键词搜平替               |
 *
 * 统一原则：自然语言分支的捕获物必须通过形似度判定；显式 /slash 指令信任用户输入。
 */
import {
  parseCatIntent,
  parsePackIntent,
  parseBatchMoveIntent,
  parseMoveIntent,
  parseSimilarSiteIntent,
  looksLikeTopicName,
} from '../../lib/ai/siteIntents.js'

describe('parseCatIntent — 不把整句口语当分类名（写副作用）', () => {
  it('模糊创建请求交回大模型，避免凭空建出奇怪分类', () => {
    expect(parseCatIntent('帮我创建分类来放工作用的东西')).toBeNull()
    expect(parseCatIntent('创建分类用于整理工作书签并同步')).toBeNull()
  })

  it('明确的分类名仍正常创建', () => {
    expect(parseCatIntent('新建分类：设计资源')).toEqual({ kind: 'add', name: '设计资源' })
    expect(parseCatIntent('创建分类 读书笔记')).toEqual({ kind: 'add', name: '读书笔记' })
  })

  it('显式 /cat 指令不受守卫影响（用户明确指定即信任）', () => {
    expect(parseCatIntent('/cat 一个很长的分类名字超过十二个字')).toEqual({
      kind: 'add',
      name: '一个很长的分类名字超过十二个字',
    })
  })

  it('分类列表意图不受影响', () => {
    expect(parseCatIntent('分类列表')).toEqual({ kind: 'list' })
  })
})

describe('parseBatchMoveIntent — 目标必须是分类名', () => {
  it('整句口语目标交回大模型', () => {
    expect(parseBatchMoveIntent('把这些书签移到合适的分类去，并补上合适标签')).toBeNull()
  })

  it('真实分类名正常解析', () => {
    expect(parseBatchMoveIntent('把这些书签移到设计资源')).toEqual({ targetName: '设计资源' })
    expect(parseBatchMoveIntent('把选中的书签移动到 前端开发')).toEqual({ targetName: '前端开发' })
  })
})

describe('parseMoveIntent — 未分类批量整理的目标必须是分类名', () => {
  it('口语目标交回大模型', () => {
    expect(parseMoveIntent('把所有未分类移到合适的分类去')).toBeNull()
  })

  it('真实分类名 / 显式指令均正常', () => {
    expect(parseMoveIntent('把所有未分类移到 前端开发')).toEqual({ targetCategoryRaw: '前端开发' })
    expect(parseMoveIntent('/move uncategorized 某个很长的分类名字测试')).toEqual({
      targetCategoryRaw: '某个很长的分类名字测试',
    })
  })
})

describe('parsePackIntent — 主题名需剥离量词与口语', () => {
  it('量词前缀 / 口语残留交回大模型', () => {
    expect(parsePackIntent('帮我搭建一个前端学习工作台')).toBeNull()
    expect(parsePackIntent('整理一下桌面工作台')).toBeNull()
  })

  it('正常主题保留', () => {
    expect(parsePackIntent('帮我搭建一套前端学习工作台')).toEqual({ rawTopic: '前端学习' })
    expect(parsePackIntent('/pack 设计资源')).toEqual({ rawTopic: '设计资源' })
  })

  it('无主题的 /pack 仍返回 undefined 走用法提示', () => {
    expect(parsePackIntent('/pack')).toEqual({ rawTopic: undefined })
  })
})

describe('parseSimilarSiteIntent — 泛化/指代目标不是实体名', () => {
  it('指代性目标交回大模型', () => {
    expect(parseSimilarSiteIntent('像这样的工具')).toBeNull()
    expect(parseSimilarSiteIntent('找一些这种网站')).toBeNull()
  })

  it('真实产品名正常解析', () => {
    expect(parseSimilarSiteIntent('有没有类似 Notion 的工具')).toEqual({ target: 'Notion' })
    expect(parseSimilarSiteIntent('找类似 Excalidraw 的网站')).toEqual({ target: 'Excalidraw' })
  })
})

describe('looksLikeTopicName — 主题名形似度', () => {
  it('接受真实主题', () => {
    for (const name of ['前端学习', 'AI 绘画工作流', '设计资源']) {
      expect(looksLikeTopicName(name)).toBe(true)
    }
  })

  it('拒绝量词前缀、口语与超长文本', () => {
    for (const name of ['一个前端学习', '一下桌面', '整理一下所有的工作台主题吧', '']) {
      expect(looksLikeTopicName(name)).toBe(false)
    }
  })
})
