import { describe, it, expect } from 'vitest'
import { _buildHighlightSegments, _extractHighlights } from '../lib/search.js'

// _buildHighlightSegments 与 _extractHighlights 此前仅经 searchWithHighlights 黑盒间接断言
// 「some(s => s.highlight)===true」浅层，命中/未命中段拼装顺序、cursor 推进、末尾兜底、
// M8 拼音 key 跳过保中文原文安全语义等纯度核心不变量零直接锁。本护栏直接断言拼装核行为契约。

describe('_buildHighlightSegments', () => {
  it('空 indices 数组 → 单段全未命中（length?...:兜底分支）', () => {
    const segs = _buildHighlightSegments('hello', [])
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ text: 'hello', highlight: false })
  })

  it('单区间从 0 起 → 无前导未命中（start===cursor 跳过 if start>cursor）', () => {
    const segs = _buildHighlightSegments('GitHub', [[0, 2]])
    // [0,2] start===cursor 跳过前导未命中段；命中 'Git'；cursor=3<6 → 末尾 'Hub' 未命中段
    expect(segs).toEqual([
      { text: 'Git', highlight: true },
      { text: 'Hub', highlight: false },
    ])
    expect(segs[0].highlight).toBe(true) // 首段即命中，无前导未命中
  })

  it('单区间中间起 → 前导未命中 + 命中两段', () => {
    const segs = _buildHighlightSegments('GitHub', [[3, 5]])
    expect(segs).toEqual([
      { text: 'Git', highlight: false },
      { text: 'Hub', highlight: true },
    ])
  })

  it('命中到末尾不留尾部未命中段（cursor===text.length 不进末尾兜底）', () => {
    const segs = _buildHighlightSegments('GitHub', [[0, 5]])
    expect(segs).toEqual([{ text: 'GitHub', highlight: true }])
    expect(segs[segs.length - 1].highlight).toBe(true)
  })

  it('命中后仍有原文 → 末尾 tail 未命中段（cursor<length 兜底分支）', () => {
    const segs = _buildHighlightSegments('GitHub Docs', [[0, 5]])
    expect(segs[segs.length - 1]).toEqual({ text: ' Docs', highlight: false })
  })

  it('两相邻区间 [0,1][2,3] → 中间不插空未命中段（第二区间 start===cursor 跳过 if start>cursor）', () => {
    const segs = _buildHighlightSegments('GitHub', [[0, 1], [2, 3]])
    // [0,1]→'Gi' 命中 cursor=2；[2,3] start===cursor 跳过未命中段直接 'tH' 命中 cursor=4；末尾 'Hub' 未命中
    expect(segs.map(s => s.text).join('')).toBe('GitHub')
    expect(segs.map(s => s.highlight)).toEqual([true, true, false])
    // 中间两个命中段之间不应出现 falsy 未命中段（守卫相邻命中不插空段这一易误分支）
    const hittingIndices = segs.map(s => s.highlight)
    expect(hittingIndices[0]).toBe(true)
    expect(hittingIndices[1]).toBe(true)
    // 末尾未命中段独占最后位置，非夹在两命中段之间
    expect(segs[segs.length - 1].highlight).toBe(false)
  })

  it('end+1 半开区间：闭区间 [start,end] 经 slice(start,end+1) 含 end 字符', () => {
    const segs = _buildHighlightSegments('ab', [[0, 1]])
    expect(segs[0]).toEqual({ text: 'ab', highlight: true })
  })

  it('重叠/逆序区间(start<=cursor)跳过插空未命中段，仅命中段', () => {
    // 第一区间 [0,3] 使 cursor=4；第二区间 [2,3] start<cursor，不插未命中段、仍 push 命中段
    const segs = _buildHighlightSegments('abcdef', [[0, 3], [2, 3]])
    // 第一段命中 'abcd'；第二段命中重叠 'cd'（不插中间未命中）；末尾 cursor=4 → 'ef'
    expect(segs.map(s => s.text).join('|')).toBe('abcd|cd|ef')
    expect(segs.map(s => s.highlight)).toEqual([true, true, false])
  })

  it('空 text + 空 indices → 兜底单空未命中段', () => {
    const segs = _buildHighlightSegments('', [])
    expect(segs).toEqual([{ text: '', highlight: false }])
  })

  it('返回恒为非空数组（indices 满足时含命中段，否则兜底单段）', () => {
    expect(_buildHighlightSegments('abc', []).length).toBeGreaterThanOrEqual(1)
    expect(_buildHighlightSegments('abc', [[0, 0]]).length).toBeGreaterThanOrEqual(1)
  })
})

describe('_extractHighlights', () => {
  // FuseResult 等价结构对象字面量直传（TS 结构化匹配，依赖函数签名，不显式 import 私有 type）
  const mk = (matches: any): any => ({ matches })

  it('matches 缺失 → 返回空对象不抛', () => {
    expect(_extractHighlights({} as any, {})).toEqual({})
    expect(_extractHighlights({ matches: undefined } as any, {})).toEqual({})
    expect(_extractHighlights({ matches: null } as any, {})).toEqual({})
  })

  it('match.key 缺失 → 跳过该 match 不报错（!match.key continue 分支）', () => {
    const out = _extractHighlights(mk([{ key: undefined, value: 'abc', indices: [[0, 0]] }]), {})
    expect(out).toEqual({})
  })

  it('match.indices 缺失/空 → 跳过该 match（!match.indices?.length continue 分支）', () => {
    const out1 = _extractHighlights(mk([{ key: 'title', value: 'abc', indices: undefined }]), {})
    const out2 = _extractHighlights(mk([{ key: 'title', value: 'abc', indices: [] }]), {})
    expect(out1).toEqual({})
    expect(out2).toEqual({})
  })

  it('M8 拼音 key 命中跳过段生成 — 保中文原文显示（match.key.endsWith Py continue）', () => {
    // 拼音 key（titlePy 等）命中时 Fuse 的 value 是拼音串，若生成段会把拼音字符渲染进建议项名称位置
    // 而非中文原文；M8 修复跳过 Py key 的段生成，仅保留原文字段命中。护栏直锁此安全不变量。
    const out = _extractHighlights(mk([
      { key: 'titlePy', value: 'kaiFaGongJu', indices: [[0, 3]] },
      { key: 'title', value: '开发工具', indices: [[0, 1]] },
    ]), { titlePy: 'title', title: 'title' })
    // titlePy match 跳过，仅 title 命中；两 match 同 label 'title' 但 Py 先跳过故 title 写入不被覆盖。
    // [0,1] 经 slice(0,2) 取 2 个 UTF-16 码元 = '开发'（中文 BMP 每字 1 码元）命中段，末尾 '工具' 未命中段。
    expect(out.title).toEqual([{ text: '开发', highlight: true }, { text: '工具', highlight: false }])
    expect(out.titlePy).toBeUndefined()
  })

  it('keyMap 命中 → 用映射值作 label（keyMap[match.key] 分支）', () => {
    const out = _extractHighlights(mk([{ key: 'title', value: 'abc', indices: [[0, 0]] }]), { title: '标题' })
    expect(out['标题']).toBeDefined()
    expect(out['标题'].length).toBeGreaterThanOrEqual(1)
  })

  it('keyMap 未命中 → 用原 match.key 作 label（|| match.key fallback 分支）', () => {
    const out = _extractHighlights(mk([{ key: 'url', value: 'abc', indices: [[0, 0]] }]), {})
    expect(Object.keys(out)).toContain('url')
    expect(out.url[0]).toEqual({ text: 'a', highlight: true })
  })

  it('多 match 各 label 独立', () => {
    const out = _extractHighlights(mk([
      { key: 'title', value: 'GitHub', indices: [[0, 2]] },
      { key: 'url', value: 'github.com', indices: [[0, 3]] },
    ]), {})
    expect(Object.keys(out).sort()).toEqual(['title', 'url'])
    expect(out.title[0]).toEqual({ text: 'Git', highlight: true })
    expect(out.url[0]).toEqual({ text: 'gith', highlight: true })
  })

  it('同 label 多 match → 后写覆盖前写（out[label]= 最后一次 wins）', () => {
    // 两非 Py match 经 keyMap 映射同 label '标题'，后者覆盖前者。
    // [0,0] 经 slice(0,1) 取 1 码元 = 'B' 命中段，末尾 'BBBBB' 未命中段 → 结果长 2。
    const out = _extractHighlights(mk([
      { key: 'title', value: 'AAAAAA', indices: [[0, 0]] },
      { key: 'title2', value: 'BBBBBB', indices: [[0, 0]] },
    ]), { title: '标题', title2: '标题' })
    expect(out['标题']).toHaveLength(2)
    expect(out['标题'][0]).toEqual({ text: 'B', highlight: true })
    expect(out['标题'][1]).toEqual({ text: 'BBBBB', highlight: false })
  })

  it('match.value 缺失 → 走 _buildHighlightSegments("", indices) 兜底（match.value || "" 分支）', () => {
    const out = _extractHighlights(mk([{ key: 'title', value: undefined, indices: [[0, 2]] }]), {})
    // value 缺失传 ''；空串 slice(0,3) 越界返 ''。indices 非空故 segments 有命中段，进第一分支不进兜底。
    expect(out.title).toEqual([{ text: '', highlight: true }])
  })
})
