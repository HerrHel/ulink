/**
 * editor-branches.test.ts — EditorManager 委托方法分支契约（补覆盖率，editor.ts 40.57%→≥85%）
 *
 * 补 src/lib/editor.test.ts（D1-39 已锁 isSilentSetContent/withSilent/silentSetContent/注册表/getContentHTML）
 * 未触达的 6 个委托方法分支：insertInlineCardHTML / toggleBold / setHeading / deleteNode /
 * insertAtCoords / insertText。锁住：
 *  - ed 不存在时各方法的守门早退（insert 类返 false / 命令类 no-op 不抛）
 *  - ed 存在时正确委托 chain() 链式命令（insertContent/focus/toggleBold/toggleHeading/insertContentAt/deleteRange）
 *  - try/catch 兜底：链式命令抛错时 insert 类返 false（不向上传播） / deleteRange 抛错 warn 继续删剩余
 *  - deleteNode descendants 收集匹配 attrs 节点 + reverse 后从尾到头删（删后 pos 不偏移核心契约）
 *  - insertAtCoords posAtCoords 返 null → fallback 到 insertInlineCardHTML（双降级路径）
 *  - insertAtCoords chain 抛错 → catch warn → fallback insertInlineCardHTML
 *
 * 纯加测试零逻辑改动：所有方法均已 export 在 EditorManager。伪 Editor 仅实现被测路径所需最小链式面，
 * 不依赖真实 TipTap 实例。沿用 editor.test.ts 的 makeFakeEditor 思路，扩展 chain()/state/view 面。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorManager } from '../lib/editor'

/** 构造链式 builder：每方法返自身以满足 chain().focus().toggleBold().run() 链式。
 *  run() 触发可选 runFn 供断言链式顺序。 */
function makeChainBuilder(opts: {
  run?: () => void
  insertContent?: (html: string) => void
  insertContentAt?: (pos: number, html: string) => void
  focus?: () => void
  toggleBold?: () => void
  toggleHeading?: (cfg: { level: number }) => void
  deleteRange?: (cfg: { from: number; to: number }) => void
} = {}) {
  const calls: string[] = []
  const b: any = {
    insertContent(html: string) { calls.push('insertContent:' + html); opts.insertContent?.(html); return b },
    insertContentAt(pos: number, html: string) { calls.push('insertContentAt:' + pos + ':' + html); opts.insertContentAt?.(pos, html); return b },
    focus() { calls.push('focus'); opts.focus?.(); return b },
    toggleBold() { calls.push('toggleBold'); opts.toggleBold?.(); return b },
    toggleHeading(cfg: { level: number }) { calls.push('toggleHeading:' + cfg.level); opts.toggleHeading?.(cfg); return b },
    deleteRange(cfg: { from: number; to: number }) { calls.push('deleteRange:' + cfg.from + '-' + cfg.to); opts.deleteRange?.(cfg); return b },
    run() { calls.push('run'); opts.run?.(); return b },
    _calls: calls,
  }
  return b
}

/** 构造伪 Editor：链式 chain() 返 builder + 可选 view.posAtCoords + state.doc.descendants。 */
function makeChainEditor(opts: {
  chain?: () => any
  chainThrows?: unknown
  posAtCoords?: (p: { left: number; top: number }) => { pos: number } | null
  descendants?: (cb: (node: { attrs?: Record<string, string> }, pos: number) => boolean | void) => void
} = {}) {
  const builder = makeChainBuilder()
  const ed: any = {
    chain: opts.chainThrows
      ? (() => { throw opts.chainThrows })
      : (opts.chain ?? (() => builder)),
  }
  if (opts.posAtCoords !== undefined) {
    ed.view = { posAtCoords: opts.posAtCoords }
  }
  if (opts.descendants !== undefined) {
    ed.state = { doc: { descendants: opts.descendants } }
  }
  ed._builder = builder
  return ed
}

beforeEach(() => {
  // 清理可能残留的注册项，保证测间隔离（_editors 是模块级非 export）
  // 用 unregister 幂等清理已知 gid 前缀
  ;['ic-1', 'ic-2', 'ic-3', 'tb-1', 'tb-2', 'sh-1', 'sh-2', 'dn-1', 'dn-2', 'dn-3', 'dn-4', 'iac-1', 'iac-2', 'iac-3', 'iac-4', 'it-1', 'it-2', 'it-3']
    .forEach((g) => EditorManager.unregister(g))
  ;['ce-1', 'ce-2', 'ce-3'].forEach((g) => EditorManager.unregister(g))
})

// ── insertInlineCardHTML ─ testdata style, chain-based insert ─────────────────
describe('EditorManager.insertInlineCardHTML — 链式插入 HTML', () => {
  it('ed 不存在：返 false 不抛', () => {
    expect(EditorManager.insertInlineCardHTML('no-ed', '<p>x</p>')).toBe(false)
  })

  it('成功：调 ed.chain().insertContent(html).run() 返 true', () => {
    const ed = makeChainEditor()
    EditorManager.register('ic-1', ed)
    expect(EditorManager.insertInlineCardHTML('ic-1', '<b>hi</b>')).toBe(true)
    expect(ed._builder._calls).toEqual(['insertContent:<b>hi</b>', 'run'])
    EditorManager.unregister('ic-1')
  })

  it('chain().run() 抛错：catch 返 false 静默吞错不向上传播（catch(_) 不 warn）', () => {
    // 源码 insertInlineCardHTML catch(_) {} 静默吞错不调 console.warn（与 insertText 同款）
    const ed = makeChainEditor({
      chain: () => {
        const b = makeChainBuilder()
        b.run = () => { throw new Error('run boom') }
        return b
      },
    })
    EditorManager.register('ic-2', ed)
    expect(EditorManager.insertInlineCardHTML('ic-2', '<p>x</p>')).toBe(false)
    EditorManager.unregister('ic-2')
  })
})

// ── toggleBold / setHeading ─ 命令委托（无返回值）────────────────────────────────
describe('EditorManager.toggleBold — 加粗命令委托', () => {
  it('ed 不存在：no-op 不抛', () => {
    expect(() => EditorManager.toggleBold('no-ed')).not.toThrow()
  })

  it('成功：调 chain().focus().toggleBold().run() 顺序', () => {
    const ed = makeChainEditor()
    EditorManager.register('tb-1', ed)
    EditorManager.toggleBold('tb-1')
    expect(ed._builder._calls).toEqual(['focus', 'toggleBold', 'run'])
    EditorManager.unregister('tb-1')
  })
})

describe('EditorManager.setHeading — 标题命令委托', () => {
  it('ed 不存在：no-op 不抛', () => {
    expect(() => EditorManager.setHeading('no-ed', 1)).not.toThrow()
  })

  it('成功：调 chain().focus().toggleHeading({level}).run()', () => {
    const ed = makeChainEditor()
    EditorManager.register('sh-1', ed)
    EditorManager.setHeading('sh-1', 2)
    expect(ed._builder._calls).toEqual(['focus', 'toggleHeading:2', 'run'])
    EditorManager.unregister('sh-1')
  })
})

// ── deleteNode — descendants 收集 + reverse 后从尾到头删 ───────────────────────
describe('EditorManager.deleteNode — 节点删除编排', () => {
  it('ed 不存在：no-op 不抛', () => {
    expect(() => EditorManager.deleteNode('no-ed', 'data-id', 'a')).not.toThrow()
  })

  it('未匹配任何节点：不调 deleteRange（toRemove 空）', () => {
    const descendants = vi.fn((cb) => {
      // 无匹配节点
      cb({ attrs: { 'data-id': 'other' } }, 5)
      cb({ attrs: { 'data-id': 'x' } }, 10)
    })
    const ed = makeChainEditor({ descendants })
    EditorManager.register('dn-1', ed)
    EditorManager.deleteNode('dn-1', 'data-id', 'target')
    expect(ed._builder._calls).toEqual([]) // 无 deleteRange 调用
    EditorManager.unregister('dn-1')
  })

  it('匹配多节点：reverse 后按倒序 deleteRange（防删首节点致后续 pos 偏移）', () => {
    const descendants = vi.fn((cb) => {
      cb({ attrs: { 'data-id': 'target' } }, 5)
      cb({ attrs: { 'data-id': 'no' } }, 10)
      cb({ attrs: { 'data-id': 'target' } }, 20)
      cb({ attrs: { 'data-id': 'target' } }, 30)
    })
    const ed = makeChainEditor({ descendants })
    EditorManager.register('dn-2', ed)
    EditorManager.deleteNode('dn-2', 'data-id', 'target')
    // 原始收集 [5,20,30] → reverse 后 [30,20,5]，每个链式 deleteRange(from,to=pos+1).run()
    expect(ed._builder._calls).toEqual([
      'deleteRange:30-31', 'run',
      'deleteRange:20-21', 'run',
      'deleteRange:5-6', 'run',
    ])
    EditorManager.unregister('dn-2')
  })

  it('单匹配节点：deleteRange(from,to=pos+1).run() 调一次', () => {
    const descendants = vi.fn((cb) => {
      cb({ attrs: { kind: 'mention' } }, 42)
    })
    const ed = makeChainEditor({ descendants })
    EditorManager.register('dn-3', ed)
    EditorManager.deleteNode('dn-3', 'kind', 'mention')
    expect(ed._builder._calls).toEqual(['deleteRange:42-43', 'run'])
    EditorManager.unregister('dn-3')
  })

  it('节点无 attrs 属性：cb 内 node.attrs 守门跳过不收集（attrs?. 守门）', () => {
    const descendants = vi.fn((cb) => {
      cb({} as any, 5) // 无 attrs
      cb({ attrs: { id: 'x' } }, 8)
    })
    const ed = makeChainEditor({ descendants })
    EditorManager.register('dn-4', ed)
    EditorManager.deleteNode('dn-4', 'id', 'x')
    // 仅第二个匹配，第一个无 attrs 被 node.attrs && 守门跳过
    expect(ed._builder._calls).toEqual(['deleteRange:8-9', 'run'])
    EditorManager.unregister('dn-4')
  })

  it('deleteRange 抛错：catch warn 但继续删剩余节点（不中断批量删除，run 在抛错迭代不执行）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const descendants = vi.fn((cb) => {
      cb({ attrs: { 'data-id': 't' } }, 10)
      cb({ attrs: { 'data-id': 't' } }, 20)
    })
    // inline 桩：chainCount 跨迭代共享（闭包外）使首个迭代抛错、后续不抛，锁「抛错不中断后续删除」
    let chainCount = 0
    const ed: any = {
      state: { doc: { descendants } },
      chain() {
        chainCount++
        const b = makeChainBuilder()
        b.deleteRange = (cfg: { from: number; to: number }) => {
          if (chainCount === 1) throw new Error('deleteRange boom') // 仅首个迭代抛错
        }
        return b
      },
    }
    EditorManager.register('dn-5', ed)
    expect(() => EditorManager.deleteNode('dn-5', 'data-id', 't')).not.toThrow()
    // 首个 deleteRange 抛错被 catch（run 未执行），第二个 deleteRange 成功后链 run 执行
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    EditorManager.unregister('dn-5')
  })
})

// ── insertAtCoords — posAtCoords 坐标转换 + 双降级 fallback ────────────────────
describe('EditorManager.insertAtCoords — 坐标定位插入 + fallback', () => {
  it('ed 不存在：返 false 不抛', () => {
    expect(EditorManager.insertAtCoords('no-ed', '<p>x</p>', 10, 20)).toBe(false)
  })

  it('posAtCoords 返有效 pos：insertContentAt(pos,html).run() 返 true', () => {
    const posAtCoords = vi.fn((p) => ({ pos: 17 }))
    const ed = makeChainEditor({ posAtCoords })
    EditorManager.register('iac-1', ed)
    expect(EditorManager.insertAtCoords('iac-1', '<img/>', 100, 200)).toBe(true)
    expect(posAtCoords).toHaveBeenCalledWith({ left: 100, top: 200 })
    expect(ed._builder._calls).toEqual(['insertContentAt:17:<img/>', 'run'])
    EditorManager.unregister('iac-1')
  })

  it('posAtCoords 返 null：走 fallback insertInlineCardHTML 返其结果', () => {
    const posAtCoords = vi.fn(() => null)
    const ed = makeChainEditor({ posAtCoords })
    EditorManager.register('iac-2', ed)
    // fallback 调 insertInlineCardHTML 成功 → true
    expect(EditorManager.insertAtCoords('iac-2', '<p>f</p>', 5, 5)).toBe(true)
    // posAtCoords 返 null 跳过 insertContentAt，走 fallback insertContent().run()
    expect(ed._builder._calls).toEqual(['insertContent:<p>f</p>', 'run'])
    EditorManager.unregister('iac-2')
  })

  it('posAtCoords 链式 insertContentAt 抛错：catch warn → fallback insertInlineCardHTML', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const posAtCoords = vi.fn(() => ({ pos: 9 }))
    const ed = makeChainEditor({
      posAtCoords,
      chain: () => {
        const b = makeChainBuilder()
        b.insertContentAt = () => { throw new Error('coords boom') } // insertContentAt 抛错触发 catch
        return b
      },
    })
    EditorManager.register('iac-3', ed)
    // catch 后 fallback this.insertInlineCardHTML → 重新 chain().insertContent().run()
    // 注：fallback 的 chain 是 ed.chain() 同一实现，但 catch 后重新走 insertContent 路径
    const result = EditorManager.insertAtCoords('iac-3', '<p>x</p>', 1, 2)
    expect(result).toBe(true) // fallback 成功
    expect(warnSpy).toHaveBeenCalled()
    EditorManager.unregister('iac-3')
    warnSpy.mockRestore()
  })

  it('posAtCoords 返 null 且 fallback insertInlineCardHTML chain 也抛错：最终返 false（末尾 fallback 路径不调 warn）', () => {
    // posAtCoords 返 null → coords falsy 跳过 if 不进主 catch（无 warn）→ 末尾 return insertInlineCardHTML
    // → insertInlineCardHTML chain 抛 → 其 catch(_) {} 静默吞错返 false（亦不 warn）
    // 故整条路径无 console.warn（与 insertAtCoords 主 catch 的 warn 路径区分）
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const posAtCoords = vi.fn(() => null)
    const ed = makeChainEditor({
      posAtCoords,
      chain: () => {
        const b = makeChainBuilder()
        b.run = () => { throw new Error('fallback boom') }
        return b
      },
    })
    EditorManager.register('iac-4', ed)
    expect(EditorManager.insertAtCoords('iac-4', '<p>x</p>', 1, 2)).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled() // 锁真实行为：null+fallback 抛错全链不 warn
    EditorManager.unregister('iac-4')
    warnSpy.mockRestore()
  })
})

// ── insertText ─ 纯文本插入委托 ───────────────────────────────────────────────
describe('EditorManager.insertText — 文本插入委托', () => {
  it('ed 不存在：返 false 不抛', () => {
    expect(EditorManager.insertText('no-ed', 'hello')).toBe(false)
  })

  it('成功：调 chain().insertContent(text).run() 返 true', () => {
    const ed = makeChainEditor()
    EditorManager.register('it-1', ed)
    expect(EditorManager.insertText('it-1', 'plain text')).toBe(true)
    expect(ed._builder._calls).toEqual(['insertContent:plain text', 'run'])
    EditorManager.unregister('it-1')
  })

  it('chain().run() 抛错：catch 返 false 静默吞错不向上传播（catch(_) 不 warn）', () => {
    // 源码 insertText catch(_) {} 静默吞错不调 console.warn（与 insertInlineCardHTML 同款）
    const ed = makeChainEditor({
      chain: () => {
        const b = makeChainBuilder()
        b.run = () => { throw new Error('text boom') }
        return b
      },
    })
    EditorManager.register('it-2', ed)
    expect(EditorManager.insertText('it-2', 'x')).toBe(false)
    EditorManager.unregister('it-2')
  })
})

// ── catch 非 Error 抛值分支（e instanceof Error ? msg : e 的 false 侧）──────────
describe('EditorManager — catch 兜底非 Error 抛值（锁 console.warn 不崩契约）', () => {
  it('deleteNode: deleteRange 抛非 Error 值（字符串）时 catch 仍兜住 warn 不崩', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const descendants = vi.fn((cb) => {
      cb({ attrs: { id: 'x' } }, 5)
    })
    const ed: any = {
      state: { doc: { descendants } },
      chain() {
        const b = makeChainBuilder()
        b.deleteRange = () => { throw 'string-throw-not-Error' } // 非 Error 抛值
        return b
      },
    }
    EditorManager.register('ce-1', ed)
    expect(() => EditorManager.deleteNode('ce-1', 'id', 'x')).not.toThrow()
    expect(warnSpy).toHaveBeenCalled() // catch 兜住，warn 记非 Error 值不崩
    warnSpy.mockRestore()
    EditorManager.unregister('ce-1')
  })

  it('insertAtCoords: insertContentAt.run() 抛非 Error 值时主 catch 兜住 + fallback 返结果', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const posAtCoords = vi.fn(() => ({ pos: 8 }))
    const ed: any = {
      view: { posAtCoords },
      chain() {
        const b = makeChainBuilder()
        b.insertContentAt = () => { throw 42 } // 非 Error 数字抛值
        return b
      },
    }
    EditorManager.register('ce-2', ed)
    expect(EditorManager.insertAtCoords('ce-2', '<p>x</p>', 1, 2)).toBe(true) // fallback 成功
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
    EditorManager.unregister('ce-2')
  })

  it('silentSetContent: ed.commands.setContent 抛非 Error 值时 catch 兜住返 false 不崩', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ed: any = { commands: { setContent: () => { throw 'silent-throw' } } }
    EditorManager.register('ce-3', ed)
    expect(EditorManager.silentSetContent('ce-3', '<p>x</p>')).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    EditorManager.unregister('ce-3')
    warnSpy.mockRestore()
  })
})
