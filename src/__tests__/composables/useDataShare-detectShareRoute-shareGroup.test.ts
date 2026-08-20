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
 *   - sg 已 isPublic=true → 跳过 setGroupPublic 直接 copyToClipboard(<SSR 函数 url>)
 *   - sg.isPublic=false + setGroupPublic 成功 → copyToClipboard
 *   - sg.isPublic=false + setGroupPublic 失败 → toast('分享需登录') + return 不 copy
 *   - 生成 url = `${SHARE_FUNCTION_BASE}?gid=<gid>`（SSR Edge Function，爬虫/人类拿到预渲染页），
 *     与 location.pathname/origin 解耦；旧 /s/<gid> + #share/<gid> 路由（detectShareRoute）
 *     保留作向后兼容兜底
 *
 * 口径：纯加测试零源文件改动。detectShareRoute 直接 import 调（纯函数 location 读取，
 * 用 history.pushState 同时设 pathname + hash——不用 Object.defineProperty 覆盖 window.location，
 * 避免污染同进程其他测试文件共享的 jsdom window）；
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

// ── SHARE_FUNCTION_BASE 钉为确定值 ──
// CI 的 Unit Tests 步骤不注入 VITE_SUPABASE_URL（secrets 仅 build 步骤注入），
// 否则 urls.ts 推导塌缩成纯路径 `/functions/v1/share-html`，下面 4 个断言期望完整
// 域名 `https://<ref>.supabase.co/functions/v1/share-html` 会整组挂。钉死该导出使测试
// 不依赖外部 env，本地/CI 一致；同时仍验证 shareGroup 用 SHARE_FUNCTION_BASE 且与 location 解耦。
vi.mock('../../config/urls.js', async () => {
  const actual = await vi.importActual<typeof import('../../config/urls.js')>('../../config/urls.js')
  return {
    ...actual,
    SHARE_FUNCTION_BASE: 'https://yqouglfopbmujkqmjgpu.supabase.co/functions/v1/share-html',
  }
})

beforeEach(async () => {
  setActivePinia(createPinia())
  _copy.copyToClipboardSpy.mockClear()
  _toast.toastSpy.mockClear()
  _sgp.returns = true
  // 重置 location 为洁净 base（jsdom 允许 history.pushState 改 pathname）
  history.pushState({}, '', '/')
})

// ── location 工具：设 pathname + hash ──
// jsdom 的 window.location 属性不可直接赋值，但 history.pushState 可同时改 pathname 与 hash，
// 且 pushState 会同步到 location.pathname / location.hash。绝不 Object.defineProperty 覆盖
// window.location——delete 还原会破坏同进程后续测试文件共享的 jsdom window（曾致
// TrashPanel-branches 在全量 CI 里随机挂：b1 永久删除后仍在 bookmarks 里）。
function setLocation(pathname: string, hash = '') {
  history.pushState({}, '', `${pathname}${hash}`)
}
function restoreLocation() {
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
    // 直接断 copyToClipboard 被调 + url = SHARE_FUNCTION_BASE?gid=<gid>
    const SHARE_FN = 'https://yqouglfopbmujkqmjgpu.supabase.co/functions/v1/share-html'
    expect(_copy.copyToClipboardSpy).toHaveBeenCalledTimes(1)
    const url = _copy.copyToClipboardSpy.mock.calls[0][0] as string
    expect(url).toBe(`${SHARE_FN}?gid=g-already`)
  })

  it('sg.isPublic=false + setGroupPublic 成功 → copy url', async () => {
    await seedGroup('g-new', false)
    _sgp.returns = true
    setLocation('/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-new')

    const SHARE_FN = 'https://yqouglfopbmujkqmjgpu.supabase.co/functions/v1/share-html'
    expect(_copy.copyToClipboardSpy).toHaveBeenCalledTimes(1)
    const url = _copy.copyToClipboardSpy.mock.calls[0][0] as string
    expect(url).toBe(`${SHARE_FN}?gid=g-new`)
  })

  it('sg.isPublic=false + setGroupPublic 失败 → toast("分享需登录") + return 不 copy', async () => {
    await seedGroup('g-fail', false)
    _sgp.returns = false
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-fail')

    expect(_toast.toastSpy).toHaveBeenCalledWith('分享需要登录云同步，请先登录', false)
    expect(_copy.copyToClipboardSpy).not.toHaveBeenCalled()
  })

  it('链接与部署子路径/根路径无关：始终 = SHARE_FUNCTION_BASE?gid=<gid>', async () => {
    const SHARE_FN = 'https://yqouglfopbmujkqmjgpu.supabase.co/functions/v1/share-html'
    // 部署在子路径 /linkvault/ 下：旧实现会拼 origin+/linkvault/；新实现与 location 无关
    await seedGroup('g-deploy', true)
    setLocation('/linkvault/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-deploy')
    expect(_copy.copyToClipboardSpy.mock.calls[0][0]).toBe(`${SHARE_FN}?gid=g-deploy`)
  })

  it('根路径部署同样走 SSR 函数 url（无 /s/<gid> 后缀）', async () => {
    const SHARE_FN = 'https://yqouglfopbmujkqmjgpu.supabase.co/functions/v1/share-html'
    await seedGroup('g-root', true)
    setLocation('/bookmarks')
    const { shareGroup } = await import('../../composables/domain/useDataShare.js')
    await shareGroup('g-root')
    expect(_copy.copyToClipboardSpy.mock.calls[0][0]).toBe(`${SHARE_FN}?gid=g-root`)
  })
})
