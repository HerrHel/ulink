/**
 * 分享「一键保存」（2026-11-26）：
 * 分享页点「保存笔记」→ /app?save=1#share/<id>。此前落地后是一模一样的只读界面，
 * 访客还得再点一次「保存」，未登录还要先登录。现在：
 *   1. 登录与否都直接保存进访客自己的库（应用本地优先，游客数据首次登录时并入账号），
 *      保存完直接打开存好的笔记；?save=1 被剥掉（刷新不重复保存）
 *   2. 未登录：不弹登录框；保存后给一条带「登录」按钮的提示，点按钮才打开登录
 *   3. 登录态还在恢复（auth.loading）时先等它落定，避免已登录用户被误提示「已保存到本机」
 *   4. 没带 ?save=1 进来的分享不会被自动保存；顶栏手动点保存同样不拦登录
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { reactive, nextTick } from 'vue'

const _auth = vi.hoisted(() => ({ state: null as any }))
vi.mock('../../composables/domain/useAuth.js', () => ({ useAuth: () => _auth.state }))

const _share = vi.hoisted(() => ({
  fetchPublicGroup: vi.fn(),
  forkPublicGroup: vi.fn(async (..._args: unknown[]) => 'g-local'),
  forkPublicCategory: vi.fn(async (..._args: unknown[]) => 'cat-local'),
}))
vi.mock('../../composables/domain/useDataShare.js', async (orig) => {
  const real = await orig<typeof import('../../composables/domain/useDataShare.js')>()
  return {
    ...real,
    fetchPublicGroup: _share.fetchPublicGroup,
    forkPublicGroup: _share.forkPublicGroup,
    forkPublicCategory: _share.forkPublicCategory,
  }
})
const _toast = vi.hoisted(() => ({ toast: vi.fn(), toastWithAction: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: _toast.toast, toastWithAction: _toast.toastWithAction }))

const shared = {
  group: { id: 'gs1', name: '格式转换工具箱', notes: '<p>x</p>', bookmarkIds: ['b1'], categoryId: 'c1', isPublic: true },
  bookmarks: [{ id: 'b1', title: 'VERT', url: 'https://vert.sh', categoryId: 'c1' }],
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function setup(url: string, auth: { isLoggedIn: boolean; loading: boolean }) {
  history.replaceState(null, '', url)
  _auth.state = reactive({ ...auth, authModalOpen: false })
  const { useShareStore } = await import('../../stores/share.js')
  const { useUIStore } = await import('../../stores/ui.js')
  return { share: useShareStore(), ui: useUIStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  _share.fetchPublicGroup.mockReset().mockResolvedValue(shared)
  _share.forkPublicGroup.mockClear()
  _toast.toast.mockClear()
  _toast.toastWithAction.mockClear()
})

afterEach(() => {
  history.replaceState(null, '', '/')
})

describe('分享一键保存', () => {
  it('已登录 + ?save=1：数据就绪即保存，剥掉 ?save=1，保存后打开存好的笔记，不出登录提示', async () => {
    const { share, ui } = await setup('/app?save=1#share/gs1', { isLoggedIn: true, loading: false })
    await share.enter('gs1')
    await flush()
    expect(_share.forkPublicGroup).toHaveBeenCalledTimes(1)
    expect(_share.forkPublicGroup.mock.calls[0][2]).toEqual({ quiet: false })
    expect(location.search).toBe('')
    expect(ui.shareMode).toBeNull()
    expect(ui.focusedGroupId).toBe('g-local')
    expect(_toast.toastWithAction).not.toHaveBeenCalled()
  })

  it('未登录 + ?save=1：同样直接保存，不弹登录框；保存后给带「登录」按钮的提示', async () => {
    const { share, ui } = await setup('/app?save=1#share/gs1', { isLoggedIn: false, loading: false })
    await share.enter('gs1')
    await flush()
    expect(_share.forkPublicGroup).toHaveBeenCalledTimes(1)
    // 未登录时由 store 给合并后的提示，fork 自身的「已复制」toast 静音，避免两条叠在一起
    expect(_share.forkPublicGroup.mock.calls[0][2]).toEqual({ quiet: true })
    expect(_auth.state.authModalOpen).toBe(false)
    expect(ui.focusedGroupId).toBe('g-local')

    expect(_toast.toastWithAction).toHaveBeenCalledTimes(1)
    const [msg, label, action] = _toast.toastWithAction.mock.calls[0]
    expect(msg).toBe('已保存到本机 · 登录后可在其他设备同步')
    expect(label).toBe('登录')
    action()
    expect(_auth.state.authModalOpen).toBe(true)
  })

  it('登录态恢复中先等待；落定后再保存，并按实际登录态决定是否提示', async () => {
    const { share } = await setup('/app?save=1#share/gs1', { isLoggedIn: false, loading: true })
    await share.enter('gs1')
    await flush()
    expect(_share.forkPublicGroup).not.toHaveBeenCalled()

    _auth.state.isLoggedIn = true
    _auth.state.loading = false
    await flush()
    expect(_share.forkPublicGroup).toHaveBeenCalledTimes(1)
    expect(_toast.toastWithAction).not.toHaveBeenCalled()
  })

  it('没带 ?save=1：不自动保存', async () => {
    const { share, ui } = await setup('/app#share/gs1', { isLoggedIn: false, loading: false })
    await share.enter('gs1')
    await flush()
    expect(_share.forkPublicGroup).not.toHaveBeenCalled()
    expect(ui.shareMode).not.toBeNull()
  })

  it('顶栏手动点保存：未登录也直接保存，不拦登录', async () => {
    const { share } = await setup('/app#share/gs1', { isLoggedIn: false, loading: false })
    await share.enter('gs1')
    await flush()
    await share.fork()
    expect(_share.forkPublicGroup).toHaveBeenCalledTimes(1)
    expect(_auth.state.authModalOpen).toBe(false)
    expect(_toast.toastWithAction).toHaveBeenCalledTimes(1)
  })

  it('主动退出分享后不再自动保存', async () => {
    const { share } = await setup('/app?save=1#share/gs1', { isLoggedIn: false, loading: true })
    await share.enter('gs1')
    await flush()
    share.exit()
    _auth.state.loading = false
    await flush()
    expect(_share.forkPublicGroup).not.toHaveBeenCalled()
  })
})
