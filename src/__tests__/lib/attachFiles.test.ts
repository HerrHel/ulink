/**
 * attachFilesToAi 单测：AI 页、右侧 AI 栏共用的文件转附件入口
 * 覆盖：成功挂载与提示、200MB 上限跳过、单个失败不影响其余、多文件计数提示、空输入。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from '../../stores/ui.js'

const { toastMock, processMock } = vi.hoisted(() => ({ toastMock: vi.fn(), processMock: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: toastMock }))
vi.mock('../../lib/ai/attachmentHelper.js', () => ({ processFileForAi: processMock }))

import { attachFilesToAi, MAX_AI_ATTACH_BYTES } from '../../lib/ai/attachFiles.js'

function file(name: string, size = 10): File {
  const f = new File(['x'], name)
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('attachFilesToAi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let seq = 0
    processMock.mockImplementation(async (f: File) => ({ id: 'file_' + ++seq, name: f.name, type: 'file', mimeType: '', size: f.size, sizeFormatted: '' }))
  })

  it('单个文件：挂到 AI 附件并提示文件名', async () => {
    expect(await attachFilesToAi([file('a.txt')])).toBe(1)
    expect(useUIStore().aiAttachedFiles.map((f) => f.name)).toEqual(['a.txt'])
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('a.txt'))
  })

  it('超过 200MB 的跳过并提示，其余照常添加', async () => {
    const n = await attachFilesToAi([file('big.mp4', MAX_AI_ATTACH_BYTES + 1), file('ok.txt')])
    expect(n).toBe(1)
    expect(processMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('200MB'), false)
    expect(useUIStore().aiAttachedFiles.map((f) => f.name)).toEqual(['ok.txt'])
  })

  it('解析失败的给出原因，不影响其余；多文件提示数量', async () => {
    processMock.mockRejectedValueOnce(new Error('视频时长超过限制'))
    const n = await attachFilesToAi([file('bad.mp4'), file('b.txt'), file('c.txt')])
    expect(n).toBe(2)
    expect(toastMock).toHaveBeenCalledWith('视频时长超过限制', false)
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('2'))
  })

  it('空输入直接返回 0', async () => {
    expect(await attachFilesToAi(null)).toBe(0)
    expect(await attachFilesToAi([])).toBe(0)
    expect(toastMock).not.toHaveBeenCalled()
  })
})
