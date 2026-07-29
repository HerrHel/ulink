// 历史版本预览文本规范化纯函数
// 从 HistoryPanel.vue 抽出（C-1 highlight 同口径：抽独立纯模块补护栏，逻辑逐字保留零行为变化）。
// 作用：从历史快照对象按 title||name||url 优先级取首个 truthy 字段，toString() 后 slice(0,50) 截断，
// 作为版本历史列表项的预览文本（HistoryPanel.vue:50 模板文本插值 {{ getPreview(v.data) }} 消费）。

/**
 * 从历史快照数据取预览文本。
 * 规则：d.title || d.name || d.url，取首个 truthy 字段，toString() 字符串化后截断到 50 字符。
 * 全空返回 ''。data 非对象（数组/null/primitive）经 Record cast 后字段 undefined 走兜底返回 ''。
 */
export function getPreview(data: unknown): string {
  const d = data as Record<string, unknown>
  return (d.title || d.name || d.url || '').toString().slice(0, 50)
}
