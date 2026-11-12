/**
 * 会话搜索匹配（历史抽屉）
 *
 * 从 AiWorkspace 的 filteredHistorySessions 抽出，便于对「坏数据」做单元级回归
 * （审计 #17）：turns / title 来自 localStorage，旧版本或手改数据里可能是数字、
 * 对象甚至 null。直接 `.toLowerCase()` 会抛错，把整个抽屉列表渲染打断——
 * 这里统一做类型收窄，坏数据只表现为「搜不到」，不影响列表可用。
 */
export function matchesSessionQuery(
  session: { title?: unknown; turns?: unknown },
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const title = typeof session.title === 'string' ? session.title.toLowerCase() : ''
  if (title.includes(q)) return true
  const turns = Array.isArray(session.turns) ? session.turns : []
  return turns.some((turn) => {
    const content = (turn as { content?: unknown } | null)?.content
    return typeof content === 'string' && content.toLowerCase().includes(q)
  })
}
