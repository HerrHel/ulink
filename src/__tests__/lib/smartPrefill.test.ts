import { describe, it, expect } from 'vitest'
import { getSmartPrefill } from '../../lib/ai/smartPrefill.js'
import type { Bookmark, Category, CustomAttribute } from '../../types.js'

function makeBm(partial: Partial<Bookmark> & { id: string; title: string; url: string }): Bookmark {
  return {
    notes: '',
    username: '',
    password: '',
    icon: '',
    categoryId: 'uncategorized',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('smartPrefill — 智能书签预填引擎', () => {
  const dummyCategories: Category[] = [
    { id: 'cat-ai', name: 'AI 工具', icon: 'sparkles', color: '#ff0000', order: 0 },
    { id: 'cat-dev', name: '开发技术', icon: 'code', color: '#00ff00', order: 1 },
    { id: 'cat-design', name: '设计美工', icon: 'palette', color: '#0000ff', order: 2 },
  ]

  const dummyAttributes: CustomAttribute[] = [
    { id: 'attr-ai', name: 'AI', type: 'boolean' },
    { id: 'attr-code', name: '代码', type: 'boolean' },
    { id: 'attr-doc', name: '文档', type: 'boolean' },
  ]

  it('精选热门站点预填：自动匹配高置信度标题、描述、分类与属性标签', () => {
    const res = getSmartPrefill('https://chatgpt.com', [], dummyCategories, dummyAttributes)
    expect(res.title).toBe('ChatGPT')
    expect(res.notes).toContain('OpenAI')
    expect(res.categoryId).toBe('cat-ai')
    expect(res.suggestedAttrIds).toContain('attr-ai')
    expect(res.confidence).toBe('high')
  })

  it('国民级核心大站预填：百度（baidu.com）0ms 秒级识别', () => {
    const res = getSmartPrefill('https://baidu.com')
    expect(res.title).toBe('百度')
    expect(res.notes).toBe('')
    expect(res.confidence).toBe('high')
  })

  it('精选设计类工具预填：Excalidraw 匹配', () => {
    const res = getSmartPrefill('https://excalidraw.com')
    expect(res.title).toContain('Excalidraw')
    expect(res.notes).toContain('白板')
    expect(res.confidence).toBe('high')
  })

  it('GitHub 路径语义解析：仓库、PR、Issue', () => {
    const repoRes = getSmartPrefill('https://github.com/vuejs/core')
    expect(repoRes.title).toBe('core (vuejs/core)')
    expect(repoRes.notes).toContain('GitHub 开源项目仓库')
    expect(repoRes.confidence).toBe('high')

    const prRes = getSmartPrefill('https://github.com/vuejs/core/pull/1234')
    expect(prRes.title).toBe('core #1234 · Pull Request')
    expect(prRes.notes).toContain('代码合入请求')

    const issueRes = getSmartPrefill('https://github.com/vuejs/core/issues/567')
    expect(issueRes.title).toBe('core #567 · Issue')
    expect(issueRes.notes).toContain('Issue')
  })

  it('V2EX 与 B站路径语义解析', () => {
    const v2exRes = getSmartPrefill('https://v2ex.com/t/998877')
    expect(v2exRes.title).toBe('V2EX 讨论帖')
    expect(v2exRes.notes).toContain('交流主题帖')

    const biliRes = getSmartPrefill('https://www.bilibili.com/video/BV1xx411c7mD')
    expect(biliRes.title).toBe('Bilibili 视频教程与精选')
    expect(biliRes.notes).toContain('视频')
  })

  it('同源书签继承：继承同域历史书签的常用账号与分类偏好', () => {
    const existingBookmarks: Bookmark[] = [
      makeBm({
        id: 'bm-1',
        title: 'My Vercel Project 1',
        url: 'https://vercel.com/project-a',
        categoryId: 'cat-dev',
        username: 'dev_user_777',
        attributes: { 'attr-code': true },
      }),
      makeBm({
        id: 'bm-2',
        title: 'My Vercel Project 2',
        url: 'https://vercel.com/project-b',
        categoryId: 'cat-dev',
        username: 'dev_user_777',
        attributes: { 'attr-code': true },
      }),
    ]

    const res = getSmartPrefill(
      'https://vercel.com/dashboard/settings',
      existingBookmarks,
      dummyCategories,
      dummyAttributes
    )

    // 应继承常用账号和历史分类
    expect(res.suggestedUsername).toBe('dev_user_777')
    expect(res.categoryId).toBe('cat-dev')
    expect(res.suggestedAttrIds).toContain('attr-code')
  })

  it('中英文双语适配：中文环境推荐地道中文名，英文环境推荐纯正英文名', () => {
    // Bilibili
    const biliZh = getSmartPrefill('https://www.bilibili.com', [], [], [], 'zh-CN')
    expect(biliZh.title).toBe('哔哩哔哩 (B站)')
    expect(biliZh.notes).toContain('视频')

    const biliEn = getSmartPrefill('https://www.bilibili.com', [], [], [], 'en-US')
    expect(biliEn.title).toBe('Bilibili')
    expect(biliEn.notes).toContain('video')

    // 知乎
    const zhihuZh = getSmartPrefill('https://www.zhihu.com', [], [], [], 'zh-CN')
    expect(zhihuZh.title).toBe('知乎')
    const zhihuEn = getSmartPrefill('https://www.zhihu.com', [], [], [], 'en-US')
    expect(zhihuEn.title).toBe('Zhihu')

    // Notion
    const notionZh = getSmartPrefill('https://www.notion.so', [], [], [], 'zh-CN')
    expect(notionZh.title).toBe('Notion 笔记空间')
    const notionEn = getSmartPrefill('https://www.notion.so', [], [], [], 'en-US')
    expect(notionEn.title).toBe('Notion')
  })

  it('子域名精准识别：docs.* 不误截为 Docs，正确提取主品牌', () => {
    const dockerDocZh = getSmartPrefill('https://docs.docker.com/engine/install/', [], [], [], 'zh-CN')
    expect(dockerDocZh.title).toBe('Docker 官方开发文档')
    expect(dockerDocZh.notes).toContain('Docker')

    const dockerDocEn = getSmartPrefill('https://docs.docker.com/engine/install/', [], [], [], 'en-US')
    expect(dockerDocEn.title).toBe('Docker Official Docs')
  })

  it('文章 Slug 提炼：长路径文章自动转换为清晰单词标题', () => {
    const slugRes = getSmartPrefill('https://mydevblog.org/articles/how-to-learn-modern-vue')
    expect(slugRes.title).toContain('How To Learn Modern Vue')
  })

  it('中文路径与知乎微信等通用规则提炼', () => {
    // 中文 URL 解码
    const zhSlug = getSmartPrefill('https://myblog.com/posts/%E5%89%8D%E7%AB%AF%E6%80%A7%E8%83%BD%E4%BC%98%E5%8C%96%E6%8C%87%E5%8D%97')
    expect(zhSlug.title).toContain('前端性能优化指南')

    // 知乎专栏
    const zhihu = getSmartPrefill('https://zhuanlan.zhihu.com/p/999888')
    expect(zhihu.title).toBe('知乎专栏深度文章')

    // 微信公众号
    const wx = getSmartPrefill('https://mp.weixin.qq.com/s/abcdef123')
    expect(wx.title).toBe('微信公众平台文章')

    // 下厨房
    const xcf = getSmartPrefill('https://www.xiachufang.com/recipe/123456/')
    expect(xcf.title).toBe('下厨房精选菜谱')
  })

  it('同域名多账号收集与高频优选：candidateUsernames 包含所有不重复账号', () => {
    const multiUserBms: Bookmark[] = [
      makeBm({ id: '1', title: 'A1', url: 'https://aws.amazon.com/console', username: 'work_admin' }),
      makeBm({ id: '2', title: 'A2', url: 'https://aws.amazon.com/s3', username: 'work_admin' }),
      makeBm({ id: '3', title: 'A3', url: 'https://aws.amazon.com/ec2', username: 'personal_dev' }),
    ]
    const res = getSmartPrefill('https://aws.amazon.com/rds', multiUserBms)
    // 频次高的 work_admin 作为默认
    expect(res.suggestedUsername).toBe('work_admin')
    // candidateUsernames 包含二者
    expect(res.candidateUsernames).toContain('work_admin')
    expect(res.candidateUsernames).toContain('personal_dev')
  })

  it('冷门站点与通用兜底：算法推理标题与地道非空描述', () => {
    const res = getSmartPrefill('https://myawesomecoolsite.xyz/posts/abc')
    expect(res.title).toContain('专栏文章')
    expect(res.notes).toContain('专栏文章')
    expect(res.confidence).toBe('medium')

    // 纯根域名不输出机械公式化套话，留空待真实内容回填
    const rootRes = getSmartPrefill('https://unknown-domain-test.net')
    expect(rootRes.title).toContain('Unknown')
    expect(rootRes.notes).toBe('')
    expect(rootRes.confidence).toBe('medium')
  })

  it('非法输入或空 URL 安全回退', () => {
    const res1 = getSmartPrefill('')
    expect(res1.title).toBe('')
    expect(res1.notes).toBe('')

    const res2 = getSmartPrefill('just-a-plain-string')
    expect(res2.title).toBeTruthy()
  })

  it('数字域名与 IPv4 地址保护：4399.com 与 192.168.1.1 品牌精准提取', () => {
    // 4399.com
    const res4399 = getSmartPrefill('https://4399.com')
    expect(res4399.title).toBe('4399小游戏')
    expect(res4399.notes).toBe('')

    // IPv4 保护：不将 192.168.1.1 的倒数第二段 1 误切片为品牌
    const resIp = getSmartPrefill('http://192.168.1.1:8080/admin')
    expect(resIp.title).toContain('192.168.1.1')
    expect(resIp.title).not.toBe('1')
  })

  it('主流平台与未知站点非模板化丰富摘要：抖音、快手、少数派与 AI 词形识别', () => {
    // 抖音 douyin.com
    const douyinRes = getSmartPrefill('https://douyin.com')
    expect(douyinRes.title).toBe('抖音')
    expect(douyinRes.notes).toBe('')

    // 快手 kuaishou.com
    const ksRes = getSmartPrefill('https://kuaishou.com')
    expect(ksRes.title).toBe('快手')
    expect(ksRes.notes).toBe('')

    // 少数派 sspai.com
    const sspaiRes = getSmartPrefill('https://sspai.com')
    expect(sspaiRes.title).toBe('少数派')
    expect(sspaiRes.notes).toContain('数字生活方式')

    // 未知 AI 域名词形意图自动推断
    const aiRes = getSmartPrefill('https://fastgpt.in')
    expect(aiRes.title).toBe('Fast Gpt')
    expect(aiRes.notes).toBe('')
  })
  it('高校教育与学术平台预填：超星学习通（v8.chaoxing.com）精准识别与保底', () => {
    const res = getSmartPrefill('https://v8.chaoxing.com/')
    expect(res.title).toBe('超星学习通')
    expect(res.notes).toContain('高校数字化课程教学')
    expect(res.confidence).toBe('high')
  })

})
