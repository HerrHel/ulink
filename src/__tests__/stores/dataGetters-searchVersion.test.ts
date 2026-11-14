/**
 * `_bumpSearchVersionIfDirty` 护栏：getter 内唯一的 state 写必须能抗同步重入。
 *
 * 背景（线上真实遥测，2026-11-05 ~ 11-12 共 72 次）：
 *   RangeError: Maximum call stack size exceeded
 *     at Reflect.set / St.set (vue)
 *     at Proxy.filteredGroups (data-*.js)
 *     at <computed effect> → trigger → filteredGroups …
 * 即「在 getter 求值期间写 `_searchVersion`，写入又同步触发同一 getter 再求值」的
 * 无限递归，最终整页掉进 ErrorBoundary。下面的重入用例用「setter 内再调一次」精确复现
 * 这个调用栈形状（无保护时会栈溢出）。
 */
import { describe, it, expect } from 'vitest'
import { _bumpSearchVersionIfDirty } from '../../stores/dataGetters.js'

type State = { _searchIndexDirty: boolean; _searchVersion: number }

function makeState(dirty: boolean, version = 0): State {
  return { _searchIndexDirty: dirty, _searchVersion: version }
}

describe('_bumpSearchVersionIfDirty', () => {
  it('不脏则不 bump（避免无谓的索引重建）', () => {
    const st = makeState(false, 7)
    expect(_bumpSearchVersionIfDirty(st)).toBe(false)
    expect(st._searchVersion).toBe(7)
    expect(st._searchIndexDirty).toBe(false)
  })

  it('脏则递增一次并清标记', () => {
    const st = makeState(true, 3)
    expect(_bumpSearchVersionIfDirty(st)).toBe(true)
    expect(st._searchVersion).toBe(4)
    expect(st._searchIndexDirty).toBe(false)
  })

  it('同一轮再次调用不再重复 bump（标记已清）', () => {
    const st = makeState(true, 0)
    _bumpSearchVersionIfDirty(st)
    expect(_bumpSearchVersionIfDirty(st)).toBe(false)
    expect(st._searchVersion).toBe(1)
  })

  it('同步重入不会递归：版本只前进一次（线上栈溢出场景）', () => {
    let reentered = false
    let innerResult: boolean | null = null
    const st = {
      _searchIndexDirty: true,
      _version: 0,
      get _searchVersion() { return this._version },
      set _searchVersion(v: number) {
        this._version = v
        // 模拟 Vue：写入同步触发依赖该值的 computed 再次求值 → 再次进入本函数。
        // 此时 _searchIndexDirty 仍为 true（helper 是先 ++ 再清标记），无护栏即无限递归。
        if (!reentered) {
          reentered = true
          innerResult = _bumpSearchVersionIfDirty(st as never)
        }
      },
    }

    expect(_bumpSearchVersionIfDirty(st as never)).toBe(true)
    expect(reentered).toBe(true)
    expect(innerResult).toBe(false) // 重入那次被挡掉
    expect(st._version).toBe(1) // 只前进一次，没有形成 set→求值→set 的链
    expect(st._searchIndexDirty).toBe(false)
  })

  it('写入抛错后护栏释放，不会把后续调用永久挡住', () => {
    const st = {
      _searchIndexDirty: true,
      _version: 0,
      get _searchVersion() { return this._version },
      set _searchVersion(_v: number) { throw new Error('boom') },
    }
    expect(() => _bumpSearchVersionIfDirty(st as never)).toThrow('boom')

    const ok = makeState(true, 0)
    expect(_bumpSearchVersionIfDirty(ok)).toBe(true)
    expect(ok._searchVersion).toBe(1)
  })
})
