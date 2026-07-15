/**
 * 锁定态同步判定：_opNeedsUnlock 单测
 *
 * E2E 启用未解锁期间，_pushFromQueue 用 _opNeedsUnlock 决定哪些 upsert op 静默留 IDB
 * 等解锁、哪些可明文照常推送。语义：只有触及敏感字段的改动才需等解锁。
 */
import { describe, it, expect } from 'vitest'
import { _opNeedsUnlock } from '../../composables/domain/useCloudSync.js'
import type { SyncOp } from '../../stores/storage.js'

const mk = (table: SyncOp['table'], data: Record<string, unknown>): SyncOp => ({
  action: 'upsert', table, itemId: 'x', data, ts: 1, retries: 0,
})

describe('_opNeedsUnlock 锁定态排队判定', () => {
  it('bookmark 只改 title/url（无敏感字段）→ false，可明文推送', () => {
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: ['title', 'url'], title: 't', url: 'https://x.example', username: '', notes: '',
    }))).toBe(false)
  })

  it('bookmark changedFields 含 username → true，需等解锁', () => {
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: ['title', 'username'], title: 't', username: 'secret', notes: '',
    }))).toBe(true)
  })

  it('bookmark changedFields 含 notes → true', () => {
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: ['notes'], notes: '私密',
    }))).toBe(true)
  })

  it('bookmark 新建（changedFields 为空）且有非空 username → true', () => {
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: null, title: 't', username: 'secret', notes: '',
    }))).toBe(true)
  })

  it('bookmark 新建且敏感字段全空 → false', () => {
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: null, title: 't', url: 'https://x.example', username: '', notes: '',
    }))).toBe(false)
  })

  it('group changedFields 含 name → true', () => {
    expect(_opNeedsUnlock(mk('sibling_groups', {
      _changedFields: ['name'], name: '改名',
    }))).toBe(true)
  })

  it('group 只改 notes 之外的字段（如 bookmark_ids）→ false', () => {
    expect(_opNeedsUnlock(mk('sibling_groups', {
      _changedFields: ['bookmarkIds'], name: '', notes: '',
    }))).toBe(false)
  })

  it('category/attribute 永不排队（无敏感字段）→ false', () => {
    expect(_opNeedsUnlock(mk('categories', { _changedFields: ['name'], name: '工作' }))).toBe(false)
    expect(_opNeedsUnlock(mk('custom_attributes', { _changedFields: ['name'], name: '标签' }))).toBe(false)
  })

  it('changedFields 为空数组时回退到本体扫描（新建语义）', () => {
    // 空数组 ≠ null：空数组意味着已知字段集为空（异常态），回退本体扫描更保守
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: [], username: 'secret', notes: '',
    }))).toBe(true)
    expect(_opNeedsUnlock(mk('bookmarks', {
      _changedFields: [], username: '', notes: '',
    }))).toBe(false)
  })

  it('data 为 null → false', () => {
    const op: SyncOp = { action: 'upsert', table: 'bookmarks', itemId: 'x', data: null, ts: 1, retries: 0 }
    expect(_opNeedsUnlock(op)).toBe(false)
  })
})