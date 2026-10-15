/**
 * mimo-guard.ts — mimo-chat 转发层的纯逻辑守卫（零 Deno 依赖，可被 vitest 直测）
 *
 * 真源唯一：index.ts 只做编排（鉴权/限流/转发），所有校验、白名单、预算、
 * CORS 判定逻辑收敛于此（对齐 check-link/ssrf-guard.ts 的「纯逻辑单测」模式）。
 * 修改校验逻辑只改一处，测试覆盖 src/__tests__/mimo-guard.test.ts。
 */

export interface MimoGuardOptions {
  /** 服务端权威模型（secrets 配置） */
  defaultModel: string
  /** 允许的模型白名单（不含 defaultModel 时自动并入）；空数组 = 仅允许 defaultModel */
  allowedModels: string[]
  maxMessages?: number
  maxMessageChars?: number
  maxTotalChars?: number
  maxToolsChars?: number
}

export type GuardResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

export const MAX_MESSAGES_DEFAULT = 40
export const MAX_MESSAGE_CHARS_DEFAULT = 4000
export const MAX_TOTAL_CHARS_DEFAULT = 120000
export const MAX_TOOLS_CHARS_DEFAULT = 30000

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool'])
const ALLOWED_TOOL_CHOICES = new Set(['auto', 'none', 'required'])
/** 模型名字符白名单：防注入超长/控制字符到上游请求 */
const MODEL_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/

/** 递归估算任意值的文本规模（字符数），用于 token 预算 */
export function textLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce((n: number, item) => n + textLength(item), 0)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>((n, item) => n + textLength(item), 0)
  }
  return 0
}

/**
 * 校验并裁剪客户端请求体为上游安全 payload。
 *
 * 拒绝（fail-closed）：
 * - model 不在白名单 / 形状非法 → 400
 * - messages 非法（非数组/空/角色越界/单条超长）→ 400
 * - 总量超出预算（条数、字符数、tools 规模）→ 413
 * 收敛：
 * - temperature 非有限数字则丢弃，越界则钳制到 [0, 2]
 * - 只放行 model/messages/stream/temperature/tools/tool_choice 六个字段
 */
export function validateChatBody(
  body: unknown,
  opts: MimoGuardOptions,
): GuardResult<Record<string, unknown>> {
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES_DEFAULT
  const maxMessageChars = opts.maxMessageChars ?? MAX_MESSAGE_CHARS_DEFAULT
  const maxTotalChars = opts.maxTotalChars ?? MAX_TOTAL_CHARS_DEFAULT
  const maxToolsChars = opts.maxToolsChars ?? MAX_TOOLS_CHARS_DEFAULT

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid request body' }
  }
  const b = body as Record<string, unknown>

  // ── model 真白名单：未知模型直接拒绝，不静默改写也不放行 ──
  const allowed = new Set([opts.defaultModel, ...opts.allowedModels])
  let model = opts.defaultModel
  if (b.model !== undefined) {
    if (typeof b.model !== 'string' || !MODEL_NAME_RE.test(b.model) || !allowed.has(b.model)) {
      return { ok: false, status: 400, error: 'Model not allowed' }
    }
    model = b.model
  }

  // ── messages 预算：条数、单条、总量三层 ──
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, status: 400, error: 'messages must be a non-empty array' }
  }
  if (b.messages.length > maxMessages) {
    return { ok: false, status: 413, error: `Too many messages (max ${maxMessages})` }
  }

  let totalChars = 0
  for (const raw of b.messages as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, error: 'Invalid message entry' }
    }
    const m = raw as Record<string, unknown>
    if (typeof m.role !== 'string' || !ALLOWED_ROLES.has(m.role)) {
      return { ok: false, status: 400, error: 'Invalid message role' }
    }
    const size = textLength(m)
    if (size > maxMessageChars) {
      return { ok: false, status: 413, error: `Message too large (max ${maxMessageChars} chars)` }
    }
    totalChars += size
    if (totalChars > maxTotalChars) {
      return { ok: false, status: 413, error: `Conversation too large (max ${maxTotalChars} chars)` }
    }
  }

  const payload: Record<string, unknown> = {
    model,
    messages: b.messages,
    stream: b.stream !== false,
  }

  // ── temperature：非有限数字丢弃，越界钳制 ──
  if (typeof b.temperature === 'number' && Number.isFinite(b.temperature)) {
    payload.temperature = Math.min(2, Math.max(0, b.temperature))
  }

  // ── tools / tool_choice：规模预算 + 枚举白名单 ──
  if (b.tools !== undefined) {
    if (!Array.isArray(b.tools)) {
      return { ok: false, status: 400, error: 'tools must be an array' }
    }
    const toolsChars = textLength(b.tools)
    if (toolsChars > maxToolsChars) {
      return { ok: false, status: 413, error: `Tools too large (max ${maxToolsChars} chars)` }
    }
    payload.tools = b.tools
  }
  if (b.tool_choice !== undefined) {
    if (typeof b.tool_choice !== 'string' || !ALLOWED_TOOL_CHOICES.has(b.tool_choice)) {
      return { ok: false, status: 400, error: 'Invalid tool_choice' }
    }
    payload.tool_choice = b.tool_choice
  }

  return { ok: true, value: payload }
}

/** CORS 来源判定（S9 fail-closed：白名单未配置则拒绝跨域；无 Origin 的非浏览器请求不设 CORS 头） */
export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true
  return allowed.length > 0 && allowed.includes(origin)
}

export function buildCorsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (isOriginAllowed(origin, allowed) && origin) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}
