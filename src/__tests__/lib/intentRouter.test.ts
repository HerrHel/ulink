import { describe, it, expect } from 'vitest'
import { resolveUserInteractionIntent } from '../../lib/ai/intentRouter.js'

describe('intentRouter.ts — 意图准入路由器与工具防抢跑门禁', () => {
  it('识别明确的操作指令为 OPERATIONAL', () => {
    expect(resolveUserInteractionIntent('/deadlink')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('/inbox')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('帮我修复书签库里的死链')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('请把重复书签合并一下')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('帮我整理收件箱')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('对全库进行健康体检')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('我要规划一下全库治理流水线')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('帮我切换深色模式')).toBe('OPERATIONAL')
    expect(resolveUserInteractionIntent('导出我的书签数据')).toBe('OPERATIONAL')
  })

  it('质询、元对话与长引用文本识别为 CONVERSATIONAL，严格阻断工具', () => {
    // 用户实际场景：复制上一轮异常输出
    const copiedPreviousAnswer = `视频去哪了呢？ _哔哩哔哩_bilibili (为你找到 8 个匹配站点) AI 回答 给定内容中视频已失效（页面提示"视频不见了"），仅包含 Bilibili 站内导航链接（首页、番剧、直播、游戏中心、会员购、漫画等），没有出现其他网站或工具，因此无法总结视频内分享的网站。建议提供视频的完整简介、字幕或评论文本后再试。`
    expect(resolveUserInteractionIntent(copiedPreviousAnswer)).toBe('CONVERSATIONAL')

    // 元质询
    expect(resolveUserInteractionIntent('这个回答符合预期吗？')).toBe('CONVERSATIONAL')
    expect(resolveUserInteractionIntent('这是什么意思？')).toBe('CONVERSATIONAL')
    expect(resolveUserInteractionIntent('为什么会这样？')).toBe('CONVERSATIONAL')
    expect(resolveUserInteractionIntent('什么是死链？它是怎么产生的？')).toBe('CONVERSATIONAL')
    expect(resolveUserInteractionIntent('推荐 3 个好用的原型设计工具')).toBe('CONVERSATIONAL')
  })

  it('长文本引用且无指令动词时，启发式判定为 CONVERSATIONAL', () => {
    const quoteText = '这是我从某技术论坛复制的一篇关于前端工程化落地的长篇心得体会，主要讨论了微前端与单体架构的取舍问题。'
    expect(resolveUserInteractionIntent(quoteText)).toBe('CONVERSATIONAL')
  })
})
