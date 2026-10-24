/**
 * siteIntents — 「把 X 移到 Y」确定性指令的误判护栏
 *
 * 回归背景：用户对附加卡片说「将此书签移到合适的分类去，并补上合适标签」时，
 * 正则把整句后半段当成分类名去查库，回复「未找到名称包含《合适的分类去…》的分类」，
 * 且 handled=true 直接短路了大模型 —— 模型从未看到这句话。
 *
 * 本文件锁死两条守卫：主体是指代词、或目标不像分类名时，一律返回 null 交回 LLM；
 * 同时覆盖真实分类名不被误伤（宁可漏判，不许错判）。
 */
import { parseSpecificMoveIntent, looksLikeCategoryName } from '../../lib/ai/siteIntents.js'

describe('looksLikeCategoryName — 分类名形似度判定', () => {
  it('接受真实分类名', () => {
    for (const name of ['设计资源', '前端开发', '云服务', 'AI 工具', 'DevOps', '读书笔记']) {
      expect(looksLikeCategoryName(name)).toBe(true)
    }
  })

  it('拒绝整句口语（标点 / 连词 / 模糊限定词）', () => {
    for (const name of [
      '合适的分类去，并补上合适标签',
      '合适的地方',
      '相关的分类',
      '设计资源，并补上标签',
      '前端开发 然后打标签',
      '随便哪个分类',
    ]) {
      expect(looksLikeCategoryName(name)).toBe(false)
    }
  })

  it('拒绝超长文本、空串与句末语气词', () => {
    expect(looksLikeCategoryName('这是一个明显超过长度上限的分类名称')).toBe(false)
    expect(looksLikeCategoryName('   ')).toBe(false)
    expect(looksLikeCategoryName('设计资源吧')).toBe(false)
  })

  it('长度按码点计算，不把 emoji 拆成两字', () => {
    expect(looksLikeCategoryName('设计资源合集')).toBe(true)
  })
})

describe('parseSpecificMoveIntent — 误判护栏', () => {
  it('截图场景：指代主体 + 整句口语目标 → null（交回大模型）', () => {
    expect(parseSpecificMoveIntent('将此书签移到合适的分类去，并补上合适标签')).toBeNull()
  })

  it('指代性主体一律交回上下文 / 大模型', () => {
    for (const q of [
      '把这张移到合适分类',
      '把它移到设计资源',
      '将当前书签移到设计资源',
      '把这个放到前端开发',
    ]) {
      expect(parseSpecificMoveIntent(q)).toBeNull()
    }
  })

  it('复合意图（移动 + 打标签）不接管', () => {
    expect(parseSpecificMoveIntent('把 Vue 移到 设计资源，并补上标签')).toBeNull()
    expect(parseSpecificMoveIntent('把 Vue 移到 设计资源 然后打标签')).toBeNull()
  })

  it('真实书签 + 真实分类名仍正常解析（不误伤）', () => {
    expect(parseSpecificMoveIntent('把 Vue 移到 设计资源 分类')).toEqual({
      itemQuery: 'Vue',
      targetCategoryName: '设计资源',
    })
    expect(parseSpecificMoveIntent('将腾讯云移到云服务分类')).toEqual({
      itemQuery: '腾讯云',
      targetCategoryName: '云服务',
    })
    expect(parseSpecificMoveIntent('请把 React 移动到前端开发')).toEqual({
      itemQuery: 'React',
      targetCategoryName: '前端开发',
    })
  })

  it('既有守卫不受影响：未分类批量整理 / 选中的书签', () => {
    expect(parseSpecificMoveIntent('把所有未分类移到前端开发')).toBeNull()
    expect(parseSpecificMoveIntent('把选中的书签移动到设计资源')).toBeNull()
  })
})
