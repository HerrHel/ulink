export function safeAtob(s: string): string { try { return atob(s) } catch (_) { return s } }

export function safeDecodePassword(storedPassword: string): string {
  if (!storedPassword) return ''
  try { return atob(storedPassword) } catch (_) { return storedPassword }
}
