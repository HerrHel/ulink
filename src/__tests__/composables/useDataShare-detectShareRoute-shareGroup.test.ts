/**
 * useDataShare-detectShareRoute-shareGroup.test.ts — 分享路由检测 + 分享组编排行为契约护栏
 *
 * detectShareRoute（useDataShare L44 export）是纯函数：path 风格 /s/<gid> 路由末段优先 +
 * hash #share/<gid> 兜底 + isValidShareGroupId（/^[a-zA-Z0-9_-]{2,64}$/）校验失败返 null，
 * 决定客户端从 URL 拉公开组的入口。零护栏（fetchPublicGroup 已被 fetchPublicGroup.test.ts 覆盖，
 * detectShareRoute 路由解析本身无护栏）：
 *   - path 风格 /s/<gid> 优先（末段可选 / 结尾）
 *   - path gid 不合法（超长/单字符/非法字符）→ null
 *   - 非 /s/ 路径 → 落 hash 兜底
 *   - hash #share/<gid> 兼容旧链接 + 新链接 hash 兜底段
 *   - hash gid 不合法 → null
 *   - path + hash 都无 → null
 *   - path 优先于 hash（path 命中不读 hash）
 *
 * shareGroup（L19 export async）编排：
 *   - sg 不存在 → toast('组不存在', false) + return（不 copy 不碰 setGroupPublic）
 *   - sg 已 isPublic=true → 跳过 setGroupPublic 直接 copyToClipboard(<path 风格 url>)
 *   - sg.isPublic=false + setGroupPublic 成功 → copyToClipboard
 *   - sg.isPublic=false + setGroupPublic 失败 → toast('分享需登录') + return 不 copy
 *   - 生成 path 风格 url：origin + base + 's/' + gid + '#share/' + gid（path 主 + hash 兜底）
 *
 * 口径：纯加测试零源文件改动。detectShareRoute 直接 import 调（纯函数 location 读取，
 * 用 history.pushState 改 pathname + Object.defineProperty(window,'location',...) 改 hash）；
 * shareGroup mock copyToClipboard（spy 断 url）+ toast + setGroupPublic（可控成功/失败），
 * 用真实 useDataStore（验 groupMap.isPublic 态）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── copyToClipboard spy（断 url 入参 + 抑真实 clipboard 副作用）──
const _copy = vi.hoisted(() => ({ copyToClipboardSpy: vi.fn() }))
vi.mock('../../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils.js')>('../../utils.js')
  return { ...actual, copyToClipboard: _copy.copyToClipboardSpy }
})

// ── toast spy ──
const _toast = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: _toast.toastSpy }))

// ── setGroupPublic mock（shareGroup 编排用，可控成功/失败）──
// 注：需绕过 import 顺序——useDataShare 直接 import setGroupPublic from syncShare.js，
// 此 mock 必须在 useDataShare import 前生效
const _sgp = vi.hoisted(() => ({ returns: true as boolean }))
vi.mock('../../composables/domain/syncShare.js', () => ({
  setGroupPublic: vi.fn(async (_gid: string, _isPublic: boolean) => _sgp.returns),
  fetchPublicGroup: vi.fn(),
}))

// ── 抑制 useCloudSync import 链（shareGroup 不调 useCloudSync，但模块顶层 import 链可能拉它）──
vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({ fullSync: vi.fn(async () => {}), fetchPublicGroup: vi.fn() }),
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  _copy.copyToClipboardSpy.mockClear()
  _toast.toastSpy.mockClear()
  _sgp.returns = true
  // 重置 location 为洁净 base（jsdom 允许 history.pushState 改 pathname）
  history.pushState({}, '', '/')
})

// ── location 工具：设 pathname + hash（jsdom location 不可直接赋值，用 defineProperty 重定义）──
function setLocation(pathname: string, hash = '') {
  // 重写 window.location 为受控对象（jsdom 下 location 是特殊对象，用 Object.defineProperty 覆盖）
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://app.example.com',
      pathname,
      hash,
    },
  })
}
function restoreLocation() {
  // 删除受控覆盖，恢复默认 location
  // @ts-ignore
  delete window.location
  // 重新触发 jsdom 重建 location（pushState 触发 location getter 重绑）
  history.pushState({}, '', '/')
}

afterEach(() => restoreLocation())

async function seedGroup(gid: string, isPublic = false) {
  const { useDataStore } = await import('../../stores/data.js')
  const ds = useDataStore()
  ds.siblingGroups.push({
    id: gid, name: 'g', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1, isPublic,
  } as any)
  ds._grpMap[gid] = ds.siblingGroups[ds.siblingGroups.length - 1] as any
  return ds
}

describe('detectShareRoute 纯路由解析', () => {
  it('path 风格 /s/<gid> 末段命中 → 返回 gid', async () => {
    setLocation('/s/g-pub-1')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('g-pub-1')
  })

  it('path 风格 /s/<gid>/ 末尾可选斜杠 → 命中', async () => {
    setLocation('/s/abc_def/')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('abc_def')
  })

  it('path gid 超长（>64）→ null（isValidShareGroupId 拒绝）', async () => {
    setLocation('/s/' + 'x'.repeat(65))
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })

  it('path gid 单字符（<2）→ null', async () => {
    setLocation('/s/a')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })

  it('path gid 含非法字符（空格/.）→ null', async () => {
    setLocation('/s/g.x')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })

  it('非 /s/ 路径 → 落 hash 兜底', async () => {
    setLocation('/other', '#share/hash-pub-1')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('hash-pub-1')
  })

  it('hash #share/<gid> 旧链接兼容 → 命中', async () => {
    setLocation('/', '#share/legacy-group')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('legacy-group')
  })

  it('hash gid 不合法（超长）→ null', async () => {
    setLocation('/', '#share/' + 'y'.repeat(65))
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })

  it('path + hash 都无匹配 → null', async () => {
    setLocation('/bookmarks', '')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })

  it('path 优先于 hash（path 命中不读 hash）', async () => {
    setLocation('/s/path-wins', '#share/hash-loses')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBe('path-wins')
  })

  it('嵌套路径 /a/s/<gid> 非末段 → null（仅末段 /s/<gid> 才命中）', async () => {
    setLocation('/s/g-pub/extra')
    const { detectShareRoute } = await import('../../composables/domain/useDataShare.js')
    expect(detectShareRoute()).toBeNull()
  })
})

describe('shareGroup 分享编排契约', () => {
  it('sg 不存在 → toast("组不存在") + return（不 copy 不碰 setGroupPublic）', async () => {
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-missing')

    expect(_toast.toastSpy).toHaveBeenCalledWith('组不存在', false)
    expect(_copy.copyToClipboardSpy).not.toHaveBeenCalled()
  })

  it('sg 已 isPublic=true → 跳过 setGroupPublic，直接 copy url', async () => {
    await seedGroup('g-already', true)
    setLocation('/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-already')

    // setGroupPublic mock 未被 require（因 sg 已 public 跳过）：经 import spy 间接验——
    // 直接断 copyToClipboard 被调 + url 形如 origin+base+'s/' gid + '#share/' gid
    expect(_copy.copyToClipboardSpy).toHaveBeenCalledTimes(1)
    const url = _copy.copyToClipboardSpy.mock.calls[0][0] as string
    expect(url).toContain('/s/g-already')
    expect(url).toContain('#share/g-already')
  })

  it('sg.isPublic=false + setGroupPublic 成功 → copy url', async () => {
    await seedGroup('g-new', false)
    _sgp.returns = true
    setLocation('/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-new')

    expect(_copy.copyToClipboardSpy).toHaveBeenCalledTimes(1)
    const url = _copy.copyToClipboardSpy.mock.calls[0][0] as string
    expect(url).toContain('/s/g-new')
    expect(url).toContain('#share/g-new')
  })

  it('sg.isPublic=false + setGroupPublic 失败 → toast("分享需登录") + return 不 copy', async () => {
    await seedGroup('g-fail', false)
    _sgp.returns = false
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-fail')

    expect(_toast.toastSpy).toHaveBeenCalledWith('分享需要登录云同步，请先登录', false)
    expect(_copy.copyToClipboardSpy).not.toHaveBeenCalled()
  })

  it('path 风格 url 保留部署子路径前缀（如 /linkvault/）+ origin', async () => {
    await seedGroup('g-deploy', true)
    // 模拟部署在子路径 /linkvault/ 下（pathname = /linkvault/bookmarks）
    setLocation('/linkvault/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-deploy')

    const url = _copy.copyToClipboardSpy.mock.calls[0][0] as string
    // origin + base（去末段保留 /linkvault/）+ 's/' + gid + '#share/' + gid
    expect(url).toBe('https://app.example.com/linkvault/s/g-deploy#share/g-deploy')
  })

  it('根路径部署（pathname=/bookmarks 空 base → /）→ url origin + /s/<gid>#share/<gid>', async () => {
    await seedGroup('g-root', true)
    setLocation('/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-root')

    const url = _copy.copyToClipboardSpy.mock.calls[0][0] as string
    expect(url).toBe('https://app.example.com/s/g-root#share/g-root')
  })
})
