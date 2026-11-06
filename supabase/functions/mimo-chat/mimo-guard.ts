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

/** 递归估算任意值的文本规模（字符数），用于 token 预算；图片内容块不计入文本字符预算 */
export function textLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce((n: number, item) => n + textLength(item), 0)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // 多模态媒体块（data URL / 长 URL 都很大）：不计入文本预算，改用独立媒体预算
    if (obj.type === 'image_url' || obj.type === 'image') return 0
    if (obj.type === 'video_url' || obj.type === 'input_audio' || obj.type === 'audio_url') return 0
    return Object.values(obj).reduce<number>((n, item) => n + textLength(item), 0)
  }
  return 0
}

/** 统计请求中的图片数量（区分内联 base64 与远程 URL）以及 data URL 总字符数 */
export function imageStats(value: unknown): {
  inlineCount: number
  remoteCount: number
  inlineChars: number
} {
  let inlineCount = 0
  let remoteCount = 0
  let inlineChars = 0
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const obj = node as Record<string, unknown>
    if (obj.type === 'image_url' || obj.type === 'image') {
      const image = (obj.image_url || obj.image) as Record<string, unknown> | undefined
      const url = image && typeof image.url === 'string' ? image.url : ''
      if (url.startsWith('data:')) {
        inlineCount += 1
        inlineChars += url.length
      } else if (/^https?:\/\//i.test(url)) {
        remoteCount += 1
      }
      return
    }
    for (const item of Object.values(obj)) visit(item)
  }
  visit(value)
  return { inlineCount, remoteCount, inlineChars }
}

/**
 * 统计视频/音频块数量与载荷规模（多模态独立预算）。
 *
 * - 视频走 `video_url`（远程 URL，模型端自行拉取，不受请求体大小影响）
 * - 音频走 `input_audio`：**优先远程 URL**（云函数侧物化为 base64 再转上游），
 *   兼容旧的 base64 `data`。
 *
 * `chars` 只统 base64 `data` 长度——URL 体积可忽略，混进来会误触文本预算。
 */
export function mediaStats(value: unknown): {
  video: number
  audio: number
  chars: number
  audioUrls: string[]
  audioInlineBytes: number
} {
  let video = 0
  let audio = 0
  let chars = 0
  const audioUrls: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const obj = node as Record<string, unknown>
    if (obj.type === 'video_url') {
      video += 1
      return
    }
    if (obj.type === 'input_audio' || obj.type === 'audio_url') {
      const a = (obj.input_audio || obj.audio_url) as Record<string, unknown> | undefined
      audio += 1
      const data = a && typeof a.data === 'string' ? a.data : ''
      const url = a && typeof a.url === 'string' ? a.url : ''
      chars += data.length
      if (url) audioUrls.push(url)
      return
    }
    for (const item of Object.values(obj)) visit(item)
  }
  visit(value)
  // base64 字符合法载荷上限：12,000,000 字符 ≈ 8.9MB 源文件
  // （MiMo 实测可处理 8.53MB mp3 / 11.9M 字符，44 秒完成）
  return { video, audio, chars, audioUrls, audioInlineBytes: chars }
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

  // ── 多模态图片预算 ──
  // 1. 内联 data URL 图片（进请求体）：最多 4 张，且总字符 ≤ 400,000（对齐 CloudBase 网关 512KB 入站上限）
  // 2. 远程 https URL 图片（由模型端拉取，如长视频关键帧）：放宽至 24 张，单张仅 ~26 tokens，不占网关入站体积
  const images = imageStats(b.messages)
  if (images.inlineCount > 4) {
    return { ok: false, status: 413, error: 'Too many images (max 4)' }
  }
  if (images.inlineChars > 400_000) {
    return { ok: false, status: 413, error: 'Images too large (max 400000 chars)' }
  }
  if (images.inlineCount + images.remoteCount > 24) {
    return { ok: false, status: 413, error: 'Too many images (max 24)' }
  }

  // ── 多模态音视频预算 ──
  // 实测结论（2026-11-03 curl 直测）：
  //   · video_url 由模型端拉取，10 秒视频约 600 video_tokens，且**音轨同样被解析**
  //   · image_url 支持远程 URL
  //   · input_audio **只认 base64**，但 MiMo 能处理 8.53MB 源文件（11.9M 字符，44s）
  //   · CloudBase HTTP 访问服务入站 body 上限约 512KB~1MB（实测 511KB 通过、1023KB 失败）
  // 因此 base64 不能由前端传：前端只传存储 URL，由云函数物化。这里保留内联兜底。
  const media = mediaStats(b.messages)
  if (media.video > 1) {
    return { ok: false, status: 413, error: 'Too many videos (max 1)' }
  }
  if (media.audio > 1) {
    return { ok: false, status: 413, error: 'Too many audio clips (max 1)' }
  }
  for (const u of media.audioUrls) {
    if (!/^https:\/\//i.test(u)) {
      return { ok: false, status: 400, error: 'audio url must be https' }
    }
    if (u.length > 2048) {
      return { ok: false, status: 400, error: 'audio url too long' }
    }
  }
  // 对齐前端 10MB 源文件上限：10MiB → base64 = ceil(10485760/3)*4 = 13,981,016 字符。
  // 取 14,500,000 留余量；若按 12M 卡，实际只放行 8.7MB，与 UI 承诺的 10MB 不符。
  if (media.chars > 14_500_000) {
    return { ok: false, status: 413, error: 'Audio too large (max 14500000 chars)' }
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
  return allowed.length > 0 && allowed.some((o) => o.trim() === origin)
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
