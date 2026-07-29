import { describe, it, expect } from 'vitest'
// 同 syncMappingTables.test.ts 口径：相对路径 + .js 后缀，esbuild 解析到 .ts
import { highlight } from '../../components/cards/highlight.js'
// 用 esc 派生期望值，避免手敲 HTML 实体在编辑层被吞并（同 d1-10 recoveryKeyPDF 护栏设计升级）
import { esc } from '../../utils.js'

/**
 * C-1 护栏：BookmarkCard.vue 模板 v-html 渲染入口的 highlight 函数。
 *
 * 护栏双重价值：
 * 1. 安全相关（XSS 面）——输出串注入模板 v-html（hlTitle/hlDomain/hlNotes→模板 v-html 行 19/27/44），
 *    所有非匹配段必须经 esc 转义；回归一处漏转义即 XSS 面（与 D1-19 getCategoryIcon 同源）。
 * 2. 用户可见——搜索时列表卡标题/域名/笔记的高亮串。
 *
 * esc 转义五类（utils.ts:66）：& < > " '。
 *
 * 边界真实逻辑：复制 regex 防 lastIndex 共享污染、零长匹配 lastIndex++ 防死循环。
 *
 * 重要真实约束（生产不可达·注释论证而非断言锁定）：highlight 依赖 regex 带 g flag——exec 靠
 * lastIndex 推进；无 g flag 时 exec 恒返首个匹配、last 不推进、parts 无限 push 撑爆 heap（OOM）。
 * 生产 hlRegex 形如 `new RegExp(escaped_q, 'gi')` 恒带 gi，无 g 形态不可达；补无 g 用例会触发
 * OOM 崩溃（实测），故按守则不补该形态护栏。零长匹配防死循环分支同理：生产 query 非空经
 * escape 后 regex 必有 1+ 字符、永不纯零长，补 `x?`/`\b` 纯零长 regex 测试会触发 OOM，护栏
 * 价值为负，按守则不补。
 */
describe('BookmarkCard.highlight — v-html 高亮转义不变量', () => {
  // ===== XSS 安全面（最高优先）=====

  it('空 text 返空串（无注入面）', () => {
    expect(highlight('', /x/g)).toBe('')
  })

  it('非匹配段含 <script> 必须经 esc 转义，输出含实体 <script> 不得含未转义 <script>', () => {
    const out = highlight('hello<script>alert(1)</script>world', /ZZZ/g)
    // 无匹配 → 整串经 esc；用 esc 派生期望实体串，any 漏转义即不等
    expect(out).toBe(esc('hello<script>alert(1)</script>world'))
    // 不含未转义原始 <script> 与 </script>
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<mark')
  })

  it('匹配段尾随 <img onerror> 必须转义：abc 进 mark、尾部经 esc', () => {
    const out = highlight('abc<img onerror=evil>', /abc/g)
    // abc 进 <mark>，尾部 <img onerror=evil> 经 esc
    expect(out).toBe('<mark class="card-hl">abc</mark>' + esc('<img onerror=evil>'))
    expect(out).not.toContain('<img')
    expect(out).toContain(esc('<img'))
  })

  it('匹配前段含恶意 <b> 与属性引号，全段经 esc 不留未转义 <b', () => {
    const out = highlight('<b class="x">hi</b>target', /target/g)
    // target 进 <mark>；前段 <b class="x">hi</b> 经 esc
    expect(out).toBe(esc('<b class="x">hi</b>') + '<mark class="card-hl">target</mark>')
    expect(out).not.toContain('<b ')
    expect(out).not.toContain('<b>')
  })

  it('匹配段字符进 mark 也经 esc（query 含 < 时 mark 内是 < 实体非原始 <）', () => {
    // query '<' 本身被匹配时，进 <mark> 的是 esc 后转义态
    const out = highlight('a<b>c', /</g)
    expect(out).toBe(esc('a') + '<mark class="card-hl">' + esc('<') + '</mark>' + esc('b>c'))
    // 除 mark 标签自身外，整串不得有未转义 < 或 >（用 esc 派生参照：< 与 > 的实体形态）
    const stripped = out.split('<mark class="card-hl">').join('').split('</mark>').join('')
    expect(stripped).not.toContain('<')
    expect(stripped).not.toContain('>')
  })

  it('全角与 Unicode 普通文本不破坏 esc（非 ASCII 不需转义，仅 < > 转义）', () => {
    const out = highlight('中文测试<>', /中文/g)
    // 「中文」匹配进 mark，余「测试<>」在末尾经 esc（测试 不需转义，<> 转实体）
    expect(out).toBe('<mark class="card-hl">中文</mark>' + esc('测试<>'))
    expect(out).not.toContain('<>')
  })

  // ===== 边界行为契约 =====

  it('多匹配各段经 esc 且各匹配段包 <mark class="card-hl">', () => {
    const out = highlight('a1b2c3', /\d/g)
    expect(out).toBe(
      'a<mark class="card-hl">1</mark>b<mark class="card-hl">2</mark>c<mark class="card-hl">3</mark>'
    )
  })

  it('无匹配整串原样经 esc 返回，无任何 <mark>', () => {
    const out = highlight('plain text & <html>', /ZZZ/g)
    expect(out).toBe(esc('plain text & <html>'))
    expect(out).not.toContain('<mark')
  })

  it('首尾与中间匹配均正确（slice 边界）', () => {
    const out = highlight('headMIDtail', /MID/g)
    expect(out).toBe('head<mark class="card-hl">MID</mark>tail')
  })

  it('连续匹配不丢不重叠（last 取 m.index+m[0].length 推进）', () => {
    const out = highlight('aaaa', /aa/g)
    // 'aaaa' 尺寸 4：aa 匹配 0→2，再 2→4 结束
    expect(out).toBe('<mark class="card-hl">aa</mark><mark class="card-hl">aa</mark>')
  })

  // ===== lastIndex 共享污染防护 =====

  it('传入已被踩过 lastIndex 的 gi 正则，highlight 复制品不受污染、原 lastIndex 不被改', () => {
    const shared = /foo/gi
    shared.exec('foo bar foo') // 踩 lastIndex 到 3
    const before = shared.lastIndex
    // 用被污染的 shared 调 highlight，应从头匹配两个 foo
    const out = highlight('foo foo', shared)
    expect(out).toBe('<mark class="card-hl">foo</mark> <mark class="card-hl">foo</mark>')
    // 原 shared 的 lastIndex 不被 highlight 修改（复制品独立）
    expect(shared.lastIndex).toBe(before)
  })

  // ===== 与生产调用方对齐的 regex 形态 =====

  it('生产 hlRegex 形态（gi 全局不区分大小写 + 特殊字符转义 query）', () => {
    // BookmarkCard 内 hlRegex 形如 new RegExp(escaped_q, 'gi')，escaped 已转义 regex 特殊字符
    const rx = /app\.js/gi
    const out = highlight('See App.js and app.js here', rx)
    expect(out).toBe(
      'See <mark class="card-hl">App.js</mark> and <mark class="card-hl">app.js</mark> here'
    )
  })

  it('query 含 regex 特殊字符则由调用方负责转义；转义后的 . 字面不吞任意字符', () => {
    // 调用方 q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') 后 '.' 变 '\.'，highlight 仅按字面匹配
    const dotLiteral = /\./g
    const out = highlight('a.b.c', dotLiteral)
    expect(out).toBe('a<mark class="card-hl">.</mark>b<mark class="card-hl">.</mark>c')
  })

  it('含 & 字符优先转义防双重编码（esc 先替换 & 再替换 < 等）', () => {
    // "x&y<z" 中 y 匹配进 mark；前段「x&」经 esc（& 先转 &，x 原样）→ x&；
    // 后段「<z」经 esc（< 转 <）→ <z。证明 esc 顺序正确无双重编码
    const out = highlight('x&y<z', /y/g)
    expect(out).toBe(esc('x&') + '<mark class="card-hl">y</mark>' + esc('<z'))
  })
})
