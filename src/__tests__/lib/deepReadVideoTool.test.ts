/**
 * deepReadVideoTool.test.ts — 平台深度解析下线后的工具行为
 *
 * 2026-11-01 起：第三方平台链接不再抓取/下载，统一引导用户使用「上传媒体解析」。
 * 本测试锁定两点：
 * 1. 视频平台 URL 返回上传引导，不提交任何深度任务；
 * 2. 非视频链接/缺 URL 返回参数错误文案。
 */
import { describe, expect, it } from 'vitest'
import { createAiAgentToolRunner } from '../../composables/domain/useAiChatAgent.js'

const t = (key: string) => key

function makeRunner() {
  const context = {
    ds: {} as any,
    ui: {} as any,
    t: t as any,
    tN: ((key: string) => key) as any,
  }
  return createAiAgentToolRunner(context)
}

describe('deep_read_video — 平台深度解析已下线', () => {
  it('B站链接只返回上传引导，不执行下载/ASR', async () => {
    const runner = makeRunner()
    const turn: any = { steps: [], candidates: [] }
    const result = await runner(turn, new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://www.bilibili.com/video/BV1xx411c7mD' },
    })
    expect(result).toBe('ai.deepUploadGuide')
    expect(turn.steps).toHaveLength(0)
    expect(turn.candidates).toHaveLength(0)
  })

  it('非视频 URL 返回参数错误，不执行任何动作', async () => {
    const runner = makeRunner()
    const turn: any = { steps: [], candidates: [] }
    const result = await runner(turn, new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://example.com/article' },
    })
    expect(result).toBe('ai.deepReadNeedVideoUrl')
    expect(turn.steps).toHaveLength(0)
  })

  it('缺少 URL 同样返回参数错误', async () => {
    const runner = makeRunner()
    const turn: any = { steps: [], candidates: [] }
    const result = await runner(turn, new AbortController(), {
      name: 'deep_read_video',
      arguments: {},
    })
    expect(result).toBe('ai.deepReadNeedVideoUrl')
  })
})
