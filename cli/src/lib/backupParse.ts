/**
 * 备份文件解析纯函数（不依赖 supabase / fs / CLI heavy deps）。
 *
 * 修复 BG-9：原 backup.ts `list` action 在 `files.map(...)` 内对每个备份文件
 * 直接 `JSON.parse(fs.readFileSync(...))`，任一备份文件损坏（写一半被 kill /
 * 磁盘满 / 系统崩溃致半截 JSON）抛错冒泡到外层 catch → `format.error` +
 * `process.exit(1)` → **单个损坏备份让整个 `backup list` 全断退出，所有可用
 * 备份无法列出**。`restore` 同样在 parse 前直接 JSON.parse 单点失败。
 *
 * 新 `parseBackup` 包 try/catch 容错，返回 `{ ok, data | error }` discriminated
 * union。list 路径据此对损坏文件降级显示（filename + size 仍可显示、其他字段
 * fallback），不再让一个坏文件瘫痪整表。restore 路径据 ok 分支校验后继续，
 * 错误消息带具体失败原因而非泛化 JSON.parse stack。
 */

/** 备份 JSON 解析后所需的最小结构（list / restore 各取所需字段） */
export interface ParsedBackup {
  version?: string
  createdAt?: string
  userId?: string
  // 元素类型为可 spread 的对象 record，让 restore 路径 `...cat`/`...bm`/`...group`
  // 能合法取属性（备份文件内每行都是对象），同时保留对未知字段的宽松接受。
  bookmarks?: Record<string, unknown>[]
  siblingGroups?: Record<string, unknown>[]
  categories?: Record<string, unknown>[]
  [key: string]: unknown
}

/** 解析结果：成功带 data，失败带 error */
export type ParseBackupResult =
  | { ok: true; data: ParsedBackup }
  | { ok: false; error: string }

/**
 * 安全解析备份 JSON 文本，捕获解析异常转结构化错误。
 * - 空内容返回 ok:false + '空文件' 而非抛错。
 * - JSON.parse 抛错（SyntaxError）转 ok:false + 错误消息（含首段内容片段定位）。
 * - 解析出非对象（如裸 number/string/array）按 ok:false 拒绝（备份必须是对象）。
 */
export function parseBackup(content: string): ParseBackupResult {
  if (content === '' || content === null || content === undefined) {
    return { ok: false, error: '空文件' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    const msg = (err as Error).message || 'JSON 解析失败'
    const snippet = content.slice(0, 40).replace(/\s+/g, ' ')
    return { ok: false, error: `${msg}（开头片段: "${snippet}"）` }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '根节点不是 JSON 对象' }
  }

  return { ok: true, data: parsed as ParsedBackup }
}
