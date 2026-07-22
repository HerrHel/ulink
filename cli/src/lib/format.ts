/**
 * 输出格式化工具
 * 支持表格和 JSON 两种输出格式
 */
import chalk from 'chalk'
import Table from 'cli-table3'
import type { OutputFormat } from '../types.js'

/** 格式化密码字段 */
export function formatPassword(password: string | { encrypted: true } | null | undefined): string {
  if (!password) return ''
  if (typeof password === 'object' && password.encrypted) return '***ENCRYPTED***'
  if (typeof password === 'string' && password.length > 0) return '***ENCRYPTED***'
  return ''
}

/** 格式化时间戳 */
export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** 截断字符串 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

/** 格式化属性 */
export function formatAttributes(attrs: Record<string, boolean> | null | undefined): string {
  if (!attrs || typeof attrs !== 'object') return ''
  return Object.entries(attrs)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ')
}

/** 输出数据 */
export function output(
  data: Record<string, unknown>[],
  columns: { key: string; header: string; width?: number }[],
  format: OutputFormat = 'table'
): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (data.length === 0) {
    console.log(chalk.yellow('暂无数据'))
    return
  }

  const table = new Table({
    head: columns.map((c) => chalk.cyan(c.header)),
    style: { head: [], border: [] },
    colWidths: columns.map((c) => c.width ?? null),
  })

  for (const row of data) {
    const line = columns.map((c) => {
      const val = row[c.key]
      return val != null ? String(val) : ''
    })
    table.push(line)
  }

  console.log(table.toString())
  console.log(chalk.gray(`\n共 ${data.length} 条记录`))
}

/** 输出成功消息 */
export function success(msg: string): void {
  console.log(chalk.green('✓ ') + msg)
}

/** 输出错误消息 */
export function error(msg: string): void {
  console.error(chalk.red('✗ ') + msg)
}

/** 输出警告消息 */
export function warn(msg: string): void {
  console.log(chalk.yellow('⚠ ') + msg)
}

/** 输出信息消息 */
export function info(msg: string): void {
  console.log(chalk.blue('ℹ ') + msg)
}
