/**
 * 动效与层级回归契约（审计 #11/#12/#13/#19/#20/#22/#29/#30）
 *
 * 这些修复点都在 CSS / 模板接线层面，没有可断言的运行时产物（需要真实布局与
 * 浏览器绘制）。用「去注释后的源码断言」把它们钉住：
 *   - 规则一旦被删/被同特异性规则覆盖回去，这里立刻红；
 *   - 注释里写同样的字样不算数（避免假绿）。
 *
 * 断言只针对「谁覆盖谁」「终态是什么」这类可在源码层面判定的性质，不锁样式细节。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** 剥离注释后再断言（HTML / 块 / 行注释；块注释只认行首或空白后的 /*） */
const readCode = (p: string) =>
  read(p)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * 取选择器/at-rule 对应的完整花括号块（含嵌套）。
 * 用配对计数而不是 indexOf('}')：keyframes 里还有单层块，切到第一个 `}`
 * 会把 to 帧切在窗口外 —— 那样「to 里有没有 transform」永远断言不到（假绿）。
 */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  return css.slice(start)
}

describe('动效终态（审计 #22）', () => {
  it('viewSwapIn 不把 transform 钉在终态：keyframes 只写 from', () => {
    const css = readCode('src/styles/motion.css')
    const block = cssBlock(css, '@keyframes viewSwapIn')
    expect(block).not.toBe('')
    // to 里出现 transform 就会在 fill-mode both 下留下 matrix(1,0,0,1,0,0)
    expect(block).not.toMatch(/to\s*\{[^}]*transform/)
    expect(block).toContain('from')
    expect(block).toContain('translateY(6px)')
  })
})

describe('card-swap 交接（审计 #19）', () => {
  it.each([
    ['src/components/chat/ChatDagPlan.vue', '.dag-card-footer'],
    ['src/components/chat/ChatDraftDiff.vue', '.diff-card-footer'],
  ])('%s 的 footer 预留高度且完成提示可接管焦点', (file, footerSel) => {
    const s = readCode(file)
    const footer = cssBlock(s, `${footerSel} {`)
    expect(footer).not.toBe('')
    // out-in 交接空档 footer 无内容时不能塌陷
    expect(footer).toContain('min-height')
    // 旧按钮卸载后焦点不落 body：完成提示 tabindex=-1 + 挂载即 focus
    expect(s).toContain('tabindex="-1"')
    expect(s).toContain(':ref="focusOnDone"')
    expect(s).toContain('function focusOnDone')
    expect(s).toContain('.focus({ preventScroll: true })')
  })
})

describe('移动端让位与层级（审计 #11/#12）', () => {
  it('移动端正文顶部让位 ≥ 顶栏 44px + 呼吸距', () => {
    const s = readCode('src/components/chat/AiWorkspace.vue')
    const mq = s.slice(s.indexOf('@media (max-width: 768px)'), s.indexOf('.ai-dock-floating-container', s.indexOf('@media (max-width: 768px)')))
    const pad = mq.match(/padding:\s*(\d+)px\s+12px\s+110px/)
    expect(pad).not.toBeNull()
    // 顶栏移动端 44px（ChatConvHeader 的 max-width:768 块）
    expect(Number(pad![1])).toBeGreaterThanOrEqual(56)
  })

  it('历史抽屉遮罩用 sheet 层级（高于移动导航 rail 的 2000）', () => {
    const s = readCode('src/components/chat/AiWorkspace.vue')
    const block = cssBlock(s, '.ai-history-drawer-overlay {')
    expect(block).not.toBe('')
    expect(block).toMatch(/z-index:\s*var\(--z-sheet/)
    // 裸 1000 会被 .is-mobile .icon-rail 的 calc(--z-drawer + 200)=2000 盖住
    expect(block).not.toMatch(/z-index:\s*1000/)
  })
})

describe('按压反馈压过 hover（审计 #13）', () => {
  it('hover 位移之后必须有一条同特异性或更高的 :active 缩放', () => {
    const css = readCode('src/styles/nav.css')
    const hoverIdx = css.indexOf('.rail-item:not(.active):hover')
    const activeIdx = css.indexOf('.rail-item:not(.active):active')
    expect(hoverIdx).toBeGreaterThanOrEqual(0)
    expect(activeIdx).toBeGreaterThan(hoverIdx)
    const block = cssBlock(css, '.rail-item:not(.active):active')
    expect(block).toContain('scale(0.98)')
  })
})

describe('紧凑导航强调条（审计 #20）', () => {
  it('条移到右缘时圆角方向同时翻转', () => {
    const css = readCode('src/styles/responsive.css')
    const block = cssBlock(css, '.rail-active-pill::before{left:auto;right:0')
    expect(block).not.toBe('')
    expect(block).toContain('right:0')
    // 右缘条的外露边在左侧：3px 0 0 3px；沿用左缘条的 0 3px 3px 0 是反的
    expect(block).toContain('border-radius:3px 0 0 3px')
  })
})

describe('测量时机（审计 #29/#30）', () => {
  it('AppNav 滑块：curSpace 变化与字体就绪都要重测', () => {
    const s = readCode('src/components/shell/AppNav.vue')
    expect(s).toContain('uiStore.curSpace')
    expect(s).toContain('document.fonts')
    expect(s).toContain('syncPill')
  })

  it('ChatTurnRail：窗口 resize 合并到下一帧再量（不逐事件强制回流）', () => {
    const s = readCode('src/components/chat/ChatTurnRail.vue')
    expect(s).toContain('onViewportResize')
    expect(s).toContain('requestAnimationFrame')
    expect(s).toContain("addEventListener('resize', onViewportResize)")
    expect(s).toContain("removeEventListener('resize', onViewportResize)")
  })
})

describe('morph 收尾（审计 #14/#15）', () => {
  it('morphCapsule 用 transitionend 收尾、带代次防重入、卸载统一清理', () => {
    const s = readCode('src/components/chat/AiWorkspace.vue')
    const idx = s.indexOf('async function morphCapsule')
    expect(idx).toBeGreaterThanOrEqual(0)
    const block = s.slice(idx, s.indexOf('function submitQuery', idx))
    expect(block).toContain('morphToken')
    expect(block).toContain("addEventListener('transitionend'")
    // 固定 420ms 收尾已废弃（与真实动画时长脱节，inline 样式覆盖过久）
    expect(block).not.toContain('420')
    expect(s).toContain('for (const cleanup of [...morphCleanups]) cleanup()')
  })
})
