/**
 * downloadFile — Blob 触发浏览器下载（统一 revoke）
 */
export function downloadFile(filename: string, content: string | Blob, mime = 'application/octet-stream'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** YYYY-MM-DD（UTC 日期戳，导出文件名用） */
export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
