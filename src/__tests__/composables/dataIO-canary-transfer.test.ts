/**
 * dataIO-canary-transfer.test.ts — E2E/保险柜 canary 随备份导出导入往返护栏
 *
 * 换设备正确姿势：canaryData（密钥派生参数 salt/it + 密文验证串 canary/recovery_canary，
 * 不含明文业务数据或主密码）存本机 localStorage、不随数据快照走。导出 JSON 若不附带它，
 * 新设备导入后会引导"重新设置主密码"生成新 key → 旧主密码加密的历史密文永久解不开
 * （用户报的换设备密码乱码的根因场景之一）。本护栏锁三条行为契约：
 *  - exportData：本机有 E2E/保险柜 canary 时，导出 JSON 附带 __e2eCanary / __vaultCanary
 *  - importFromDataInternal：带 __e2eCanary 且本机无 canary → 写回本地 + e2e store 置 enabled
 *  - 本机已有 canary → 绝不覆盖（本地优先；覆盖会破坏本机既有解锁）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))
vi.mock('../../stores/persist.js', () => ({
  saveToLocalStorage: vi.fn(),
  loadFromStorage: vi.fn(),
  getStorageInfo: vi.fn(),
}))
vi.mock('../../stores/storage.js', () => ({ clearAllSyncOps: vi.fn() }))
vi.mock('../../stores/migrations.js', () => ({ runMigrations: vi.fn() }))

import { useDataStore } from '../../stores/data.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useVaultStore } from '../../stores/vault.js'
import { exportData, importFromDataInternal } from '../../composables/domain/useDataIO.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { AppData } from '../../types.js'

type AddBookmarkInput = Parameters<ReturnType<typeof useDataStore>['addBookmark']>[0]

function makeBookmark(id: string): AddBookmarkInput {
  return {
    id,
    title: '书签' + id,
    url: 'https://example.com/' + id,
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: CAT_UNCATEGORIZED,
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 1000,
  } as AddBookmarkInput
}

/** 捕获 downloadFile 落盘 Blob（与 dataIO-export-chain.test.ts 同脚手架） */
function captureDownload() {
  const click = vi.fn()
  let captured: Blob | null = null
  const createObjectURL = vi.fn((blob: Blob) => { captured = blob; return 'blob:mock' })
  const revokeObjectURL = vi.fn()
  const origURL = globalThis.URL
  vi.stubGlobal('URL', { ...origURL, createObjectURL, revokeObjectURL })
  const origCreate = document.createElement.bind(document)
  const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreate(tag)
    if (tag === 'a') (el as HTMLAnchorElement).click = click
    return el
  })
  return {
    captured: () => captured,
    click,
    restore: () => {
      vi.unstubAllGlobals()
      createSpy.mockRestore()
    },
  }
}

const E2E_CANARY_KEY = 'lv_e2e_canary'
const VAULT_CANARY_KEY = 'lv_vault_canary'
const E2E_CANARY = { canary: 'abc.def.ghi', salt: [1, 2, 3], it: 600000 }
const VAULT_CANARY = { canary: 'v.abc.def', salt: [9, 8, 7], it: 600000 }

function minimalBackup(extra: Record<string, unknown> = {}): AppData {
  return {
    bookmarks: [],
    siblingGroups: [],
    categories: [],
    customAttributes: [],
    ...extra,
  } as unknown as AppData
}

describe('canary 随备份导出导入往返', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ═══ 导出侧：附带 canary ═══

  it('exportData：本机有 E2E/保险柜 canary 时，导出 JSON 附带 __e2eCanary / __vaultCanary', async () => {
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(E2E_CANARY))
    localStorage.setItem(VAULT_CANARY_KEY, JSON.stringify(VAULT_CANARY))
    useDataStore().addBookmark(makeBookmark('bk1') as any)

    const dl = captureDownload()
    try {
      exportData()
      expect(dl.captured()).toBeTruthy()
      const json = JSON.parse(await dl.captured()!.text()) as Record<string, unknown>
      expect(json.__e2eCanary).toEqual(E2E_CANARY)
      expect(json.__vaultCanary).toEqual(VAULT_CANARY)
    } finally {
      dl.restore()
    }
  })

  it('exportData：本机无 canary 时不附带加密元数据字段', async () => {
    useDataStore().addBookmark(makeBookmark('bk1') as any)

    const dl = captureDownload()
    try {
      exportData()
      const json = JSON.parse(await dl.captured()!.text()) as Record<string, unknown>
      expect(json.__e2eCanary).toBeUndefined()
      expect(json.__vaultCanary).toBeUndefined()
    } finally {
      dl.restore()
    }
  })

  // ═══ 导入侧：恢复 canary ═══

  it('importFromDataInternal：带 __e2eCanary 且本机无 canary → 写回本地 + e2e/vault store 置 enabled', () => {
    const e2eStore = useE2EStore()
    const vaultStore = useVaultStore()
    expect(e2eStore.isE2EEnabled).toBe(false)
    expect(vaultStore.isVaultEnabled).toBe(false)

    importFromDataInternal(minimalBackup({ __e2eCanary: E2E_CANARY, __vaultCanary: VAULT_CANARY }), 'LinkVault')

    expect(localStorage.getItem(E2E_CANARY_KEY)).toBe(JSON.stringify(E2E_CANARY))
    expect(localStorage.getItem(VAULT_CANARY_KEY)).toBe(JSON.stringify(VAULT_CANARY))
    expect(e2eStore.isE2EEnabled).toBe(true)
    expect(vaultStore.isVaultEnabled).toBe(true)
  })

  it('importFromDataInternal：本机已有 canary → 绝不覆盖（本地优先），无 vault canary 时仍恢复 vault', () => {
    const local = { canary: 'local.existing', salt: [5], it: 600000 }
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    const e2eStore = useE2EStore()
    e2eStore.setEnabled(true) // 模拟本机已启用 E2E（checkE2EStatus 判定过）

    importFromDataInternal(minimalBackup({ __e2eCanary: E2E_CANARY, __vaultCanary: VAULT_CANARY }), 'LinkVault')

    // E2E canary 保持本机原值，不被导入覆盖
    expect(localStorage.getItem(E2E_CANARY_KEY)).toBe(JSON.stringify(local))
    // vault canary 本机没有 → 正常恢复
    expect(localStorage.getItem(VAULT_CANARY_KEY)).toBe(JSON.stringify(VAULT_CANARY))
    expect(useVaultStore().isVaultEnabled).toBe(true)
  })

  it('importFromDataInternal：无 canary 字段的普通备份（Raindrop/HTML/CSV 等）不写不置', () => {
    const e2eStore = useE2EStore()
    importFromDataInternal(minimalBackup(), 'Raindrop.io')
    expect(localStorage.getItem(E2E_CANARY_KEY)).toBeNull()
    expect(localStorage.getItem(VAULT_CANARY_KEY)).toBeNull()
    expect(e2eStore.isE2EEnabled).toBe(false)
  })
})
