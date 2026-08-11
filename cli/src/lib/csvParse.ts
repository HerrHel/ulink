/**
 * CSV 解析纯函数（不依赖 supabase / async / CLI heavy deps）。
 *
 * RFC 4180 兼容状态机，**跨行引号字段在一行内累积不会被打断**——
 * 修复 BG-8：原 io.ts 用 `content.split('\n').filter(line => line.trim())`
 * 先按裸换行切行再逐行 parseCsvLine，含 `\n` 的引号字段被切成两段，
 * 且引号状态不跨行，导致 cli export csv 产出的带换行 notes 字段自导入必坏
 * （cli 自 round-trip 数据损坏）。新 parseCsv 整体按字符迭代维护跨行引号状态，
 * 嵌引号字段内的换行不分行、逗号不分列、双引号转义还原为单引号。
 */

/**
 * 解析整个 CSV 文本为二维字段数组（rows × fields）。
 * - 字段以逗号分隔，行以未在引号内的换行（\n 或 \r\n）分隔。
 * - 引号字段可跨行，内部裸逗号不分列、裸换行不分行。
 * - 引号字段内双引号（""）转义为单个双引号。
 * - 末尾换行不产生空尾行。
 */
export function parseCsv(content: string): string[][] {
  if (!content) return []
  const rows: string[][] = []
  const currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  const pushRow = () => {
    rows.push([...currentRow])
    currentRow.length = 0
    currentField = ''
  }

  for (let i = 0; i < content.length; i++) {
    const char = content[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < content.length && content[i + 1] === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
      continue
    }

    // 非引号状态
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      currentRow.push(currentField.trim())
      currentField = ''
    } else if (char === '\r' || char === '\n') {
      currentRow.push(currentField.trim())
      pushRow()
      if (char === '\r' && i + 1 < content.length && content[i + 1] === '\n') i++
    } else {
      currentField += char
    }
  }

  // 末尾行（不由换行收尾）：仅当有未提交字段或前置逗号已 push 进 currentRow 时入栈
  // （换行收尾的行已在 pushRow 处理，currentRow 空且 currentField 空时不入空尾行）
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    rows.push([...currentRow])
  }

  return rows
}
