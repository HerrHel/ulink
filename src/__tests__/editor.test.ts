/**
 * editor.test.ts — EditorManager 静默抑制栈 + 基本注册表护栏（D1-39）
 *
 * 锁 src/lib/editor.ts 的 G1-003 核心不变量：
 * - isSilentSetContent 读取模块级 `_silentContentDepth` 计数器
 * - withSilent / silentSetContent 用 try/finally 维护计数栈的递增与回归，
 *   保证嵌套静默期间 GroupEditor.vue:188 onUpdate 前哨正确放行/拦截 syncToStore，
 *   且异常路径不泄漏 depth（泄漏会让后续远端正常写入也被误静默）。
 *
 * 纯加测试零逻辑改动：isSilentSetContent（行17）、EditorManager（行91 const）均已 export，
 * 无需改源文件。EditorManager 方法接受伪 Editor（仅实现被测路径所需最小面），
 * 不依赖真实 TipTap 实例。
 */
import { describe, it, expect, vi } from 'vitest'
import { isSilentSetContent, EditorManager } from '../lib/editor'

/** 构造最小伪 Editor：仅实现被测方法所需接口面。 */
function makeFakeEditor(opts: {
  setContent?: (html: string) => void | never
  setContentThrows?: unknown
  getHTML?: () => string
  getHTMLThrows?: unknown
} = {}) {
  const ed = {
    commands: {
      setContent: opts.setContentThrows
        ? (() => { throw opts.setContentThrows })
        : vi.fn((html: string) => { (ed as any)._lastHTML = html }),
    },
    getHTML: opts.getHTMLThrows
      ? (() => { throw opts.getHTMLThrows })
      : (opts.getHTML ?? (() => 'HTML')),
  }
  return ed as any
}

// ── isSilentSetContent 初始态 ──────────────────────────────────────────────
describe('isSilentSetContent — 模块级计数器读取', () => {
  it('未进入任何静默上下文时恒 false', () => {
    expect(isSilentSetContent()).toBe(false)
  })

  it('返回 boolean 类型（非 truthy 包装）', () => {
    expect(typeof isSilentSetContent()).toBe('boolean')
  })
})

// ── withSilent ─ depth 栈语义 ──────────────────────────────────────────────
describe('EditorManager.withSilent — 静默计数栈', () => {
  it('单层 withSilent：fn 内为 true，退出后回归 false', () => {
    let inside = false
    EditorManager.withSilent(() => {
      inside = isSilentSetContent()
    })
    expect(inside).toBe(true)
    expect(isSilentSetContent()).toBe(false)
  })

  it('嵌套 withSilent：depth 递增，内层退出后仍 true，最外层退出才 false', () => {
    let innerDuring = false
    let outerAfterInner = false
    EditorManager.withSilent(() => {
      EditorManager.withSilent(() => {
        innerDuring = isSilentSetContent() // depth=2 → true
      })
      outerAfterInner = isSilentSetContent() // depth 回 1 → 仍 true（核心不变量：不提前翻 false）
    })
    expect(innerDuring).toBe(true)
    expect(outerAfterInner).toBe(true)
    expect(isSilentSetContent()).toBe(false) // 最外层退出 depth=0 → false
  })

  it('三层嵌套 depth=3 全程 true，层层退出才回 false', () => {
    const depths: boolean[] = []
    EditorManager.withSilent(() => {
      EditorManager.withSilent(() => {
        EditorManager.withSilent(() => {
          depths.push(isSilentSetContent()) // depth=3
        })
        depths.push(isSilentSetContent()) // depth 回 2
      })
      depths.push(isSilentSetContent()) // depth 回 1
    })
    depths.push(isSilentSetContent()) // depth 回 0
    expect(depths).toEqual([true, true, true, false])
  })

  it('withSilent fn 抛错：finally 仍 depth-1 不泄漏（isSilentSetContent 回 false）', () => {
    expect(() => {
      EditorManager.withSilent(() => { throw new Error('boom') })
    }).toThrow('boom')
    expect(isSilentSetContent()).toBe(false)
  })

  it('withSilent 抛错在嵌套中：内层抛错后外层 depth 仍正确回归', () => {
    let outerDuringAfterInnerThrow = false
    EditorManager.withSilent(() => {
      expect(() => {
        EditorManager.withSilent(() => { throw new Error('inner') })
      }).toThrow('inner')
      outerDuringAfterInnerThrow = isSilentSetContent()
    })
    expect(outerDuringAfterInnerThrow).toBe(true) // 内层 finally 回 depth=1，外层仍在静默
    expect(isSilentSetContent()).toBe(false) // 外层 finally 回 depth=0
  })

  it('withSilent fn 无返回值/有返回值均不改 depth 行为', () => {
    EditorManager.withSilent(() => 'ignored')
    expect(isSilentSetContent()).toBe(false)
  })
})

// ── silentSetContent � 远端写回承载 ──────────────────────────────────────────
describe('EditorManager.silentSetContent — 远端程序化写回 notes', () => {
  it('ed 不存在：返 false 不动 depth（isSilentSetContent 仍 false）', () => {
    expect(EditorManager.silentSetContent('no-such-gid', '<p>x</p>')).toBe(false)
    expect(isSilentSetContent()).toBe(false)
  })

  it('成功：调用 ed.commands.setContent(html)，期间 isSilentSetContent true，返回后 false', () => {
    const setContent = vi.fn()
    EditorManager.register('g1', makeFakeEditor({ setContent }) as any)
    let duringCall = false
    // 包一层在 setContent 内部观测期间 depth
    ;(EditorManager.get('g1') as any).commands.setContent = (html: string) => {
      duringCall = isSilentSetContent()
      setContent(html)
    }
    const ok = EditorManager.silentSetContent('g1', '<p>hello</p>')
    expect(ok).toBe(true)
    expect(duringCall).toBe(true)
    expect(setContent).toHaveBeenCalledWith('<p>hello</p>')
    expect(isSilentSetContent()).toBe(false) // finally 回归
    EditorManager.unregister('g1')
  })

  it('ed.commands.setContent 抛错：catch 返 false + warn，但 finally 仍 depth-1 不泄漏', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    EditorManager.register('g2', makeFakeEditor({ setContentThrows: new Error('setContent fail') }) as any)
    const ok = EditorManager.silentSetContent('g2', '<p>x</p>')
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    // 核心不变量：异常路径 depth 不泄漏，后续 isSilentSetContent 仍 false
    expect(isSilentSetContent()).toBe(false)
    warnSpy.mockRestore()
    EditorManager.unregister('g2')
  })

  it('成功 silentSetContent 后 withSilent 仍可正常嵌套（depth 计数器回归后可复用）', () => {
    EditorManager.register('g3', makeFakeEditor() as any)
    EditorManager.silentSetContent('g3', '<p>a</p>')
    expect(isSilentSetContent()).toBe(false) // silentSetContent 已回归
    let inside = false
    EditorManager.withSilent(() => { inside = isSilentSetContent() })
    expect(inside).toBe(true)
    expect(isSilentSetContent()).toBe(false)
    EditorManager.unregister('g3')
  })

  it('连续多次 silentSetContent 成功：每次进出 depth 都正确增减', () => {
    EditorManager.register('g4', makeFakeEditor() as any)
    expect(EditorManager.silentSetContent('g4', '<p>1</p>')).toBe(true)
    expect(isSilentSetContent()).toBe(false)
    expect(EditorManager.silentSetContent('g4', '<p>2</p>')).toBe(true)
    expect(isSilentSetContent()).toBe(false)
    EditorManager.unregister('g4')
  })
})

// ── 注册表基本契约 ──────────────────────────────────────────────────────────
describe('EditorManager 注册表基本契约', () => {
  it('register 后 get 命中，unregister 后 get 返 null', () => {
    const ed = makeFakeEditor()
    EditorManager.register('reg-1', ed)
    expect(EditorManager.get('reg-1')).toBe(ed)
    EditorManager.unregister('reg-1')
    expect(EditorManager.get('reg-1')).toBeNull()
  })

  it('get 未注册的 gid 返 null（不抛）', () => {
    expect(EditorManager.get('never-reg')).toBeNull()
  })

  it('unregister 未注册的 gid 不抛（幂等）', () => {
    expect(() => EditorManager.unregister('also-not-reg')).not.toThrow()
  })

  it('getContentHTML ed 不存在返 null（不抛）', () => {
    expect(EditorManager.getContentHTML('no-ed')).toBeNull()
  })

  it('getContentHTML ed 存在：返回 ed.getHTML()', () => {
    const ed = makeFakeEditor({ getHTML: () => '<p>content</p>' })
    EditorManager.register('gh-1', ed)
    expect(EditorManager.getContentHTML('gh-1')).toBe('<p>content</p>')
    EditorManager.unregister('gh-1')
  })

  it('getContentHTML ed.getHTML 抛错：catch 返 null（不向上传播）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ed = makeFakeEditor({ getHTMLThrows: new Error('getHTML fail') })
    EditorManager.register('gh-2', ed)
    expect(EditorManager.getContentHTML('gh-2')).toBeNull()
    EditorManager.unregister('gh-2')
    warnSpy.mockRestore()
  })
})
