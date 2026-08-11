import { describe, it, expect } from 'vitest'
import { parseCsv } from '../lib/csvParse.js'

/**
 * BG-8 复现回归测：CLI CSV 解析跨行引号字段。
 *
 * Bug：原 io.ts 用 content.split('\n').filter(line => line.trim()) 切行 + 逐行 parseCsvLine，
 * 引号状态不跨行，含 `\n` 的引号字段被切成两段、引号永远不闭、字段错位——
 * CLI export csv 产出的带换行 notes 字段自导入必坏（自 round-trip 数据损坏）。
 * 修复后 parseCsv 整体按字符迭代维护跨行引号状态，与 escapeCsv 配对 round-trip 一致。
 */

// 还原 CLI escapeCsv 行为（与 io.ts escapeCsv 一致），用于构造 round-trip 测试输入
function escapeCsv(field: string): string {
  if (!field) return ''
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

describe('parseCsv (BG-8 跨行引号)', () => {
  it('基础单行：逗号分隔还原', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']])
  })

  it('多行无引号：逐行还原', () => {
    expect(parseCsv('a,b\n1,2\nx,y')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['x', 'y'],
    ])
  })

  it('引号字段含逗号：引号内逗号不分列', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']])
  })

  it('引号字段含双引号："" 转义还原为单引号', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']])
  })

  it('★ 跨行引号字段（Bug 核心）：引号内 \\n 不分行', () => {
    // 复现：notes 字段 line1\nline2，escapeCsv 会包引号产出 "line1\nline2"
    const csv = 'id,title\n"line1\nline2",x'
    const rows = parseCsv(csv)
    expect(rows).toEqual([
      ['id', 'title'],
      ['line1\nline2', 'x'],
    ])
  })

  it('★ CLI 自 round-trip：escapeCsv → parseCsv 还原其原值（含换行 + 逗号 + 引号）', () => {
    const notes = 'first line\nsecond, line, with "quotes"'
    const csvRow = `${escapeCsv('id')},${escapeCsv('title')},${escapeCsv(notes)}`
    const rows = parseCsv(csvRow)
    expect(rows[0]).toEqual(['id', 'title', notes])
  })

  it('CRLF 行尾：\\r\\n 视为单一换行', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('末尾换行：不产生空尾行', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']])
  })

  it('空字段（含末尾）保留占位空串', () => {
    // 末尾逗号产空字段
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']])
    // 中间空字段
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']])
  })

  it('空内容 / 仅空白：安全降级返回空数组', () => {
    expect(parseCsv('')).toEqual([])
    // note: 仅换行视作一行空字段——不算空内容，行为确定性优于 split filter 的「过滤」误删
    expect(parseCsv('\n')).toEqual([['']])
  })

  it('多孤儿场景以外的多字段行：7 字段（CSV 表头规模）完整解析', () => {
    // 模拟）io.ts CSV 表头：id,title,url,category,username,notes,use_count
    const header = 'id,title,url,category,username,notes,use_count'
    expect(parseCsv(header)).toEqual([
      ['id', 'title', 'url', 'category', 'username', 'notes', 'use_count'],
    ])
  })

  it('复杂行：含三种特殊字符同时出现的引号字段', () => {
    const field = 'line1\nline2, with "quotes" and ,more'
    const csv = `h1,h2,h3\n${escapeCsv('a')},${escapeCsv(field)},${escapeCsv('z')}`
    const rows = parseCsv(csv)
    expect(rows[1]).toEqual(['a', field, 'z'])
  })
})
