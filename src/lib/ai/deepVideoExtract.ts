/**
 * deepVideoExtract.ts — 视频深度解析（口播 ASR + 画面 OCR 网址）客户端
 *
 * 接口契约唯一真源：docs/VIDEO_DEEP_EXTRACT.md §2/§4。
 * 深度任务是分钟级异步任务，不复用同步接口：
 *   1. submitDeepVideo(url)  → POST extract-video { action:'deep', url }，返回 job_id / eta；
 *   2. pollDeepVideo(jobId)  → 轮询 { action:'deep_status', job_id }，2s 间隔、240s 上限，
 *      通过 onProgress(stage, progress) 把阶段反馈给聊天步骤。
 *
 * 错误一律映射为结构化 DeepVideoError（不静默降级到 r.jina.ai）：
 * 401 login_required / 429 deep_quota_exceeded / 503 deep_unavailable / 超时 / 取消 / 网络。
 * 静默降级等于绕过用户配额与隐私披露，故本模块绝不返回「假成功」。
 */
import { supabase, isSupabaseConfigured } from '../supabase.js'
import { isCloudBaseBackend, edgeFnUrl } from '../cloudbase.js'
import { getApiToken } from '../authDriver.js'
import { t } from '../../i18n/index.js'

export type DeepVideoStage = 'download' | 'asr' | 'ocr' | 'aggregate' | 'done'
export type DeepVideoStatus = 'queued' | 'running' | 'done' | 'failed'

export interface DeepVideoTranscriptSegment {
  start: number
  end: number
  text: string
}

export interface DeepVideoTranscript {
  /** 转写全文 */
  text: string
  segments?: DeepVideoTranscriptSegment[]
  /** faster_whisper / http */
  provider?: string
  language?: string
}

/** 画面中识别出的网址（跨帧投票聚合） */
export interface DeepVideoOnScreenUrl {
  url: string
  confidence?: number
  frames?: number
}

export interface DeepVideoResult {
  success: boolean
  source?: string
  url?: string
  title?: string
  /** 视频时长（秒） */
  duration?: number
  uploader?: string
  transcript?: DeepVideoTranscript
  on_screen_urls?: DeepVideoOnScreenUrl[]
  /** 任务是否在降级条件下完成（如 ASR 不可用只做了 OCR） */
  degraded?: boolean
}

/** 提交深度任务后的立即响应 */
export interface DeepVideoJob {
  job_id: string
  status: DeepVideoStatus
  eta_seconds?: number
}

/** 轮询返回的任务状态 */
export interface DeepVideoJobStatus {
  job_id: string
  status: DeepVideoStatus
  /** 0~1 */
  progress?: number
  stage?: DeepVideoStage
  result?: DeepVideoResult
  error?: { code: string; message?: string } | null
  /** 失败任务是否已自动退回本次体验额度（服务端幂等退款结果） */
  quota_refunded?: boolean
}

export type DeepVideoErrorCode =
  | 'invalid_url'
  | 'login_required'
  | 'deep_quota_exceeded'
  | 'deep_unavailable'
  | 'timeout'
  | 'aborted'
  | 'network'

/** 结构化深度解析错误：调用方据此给用户明确文案（不做静默降级） */
export class DeepVideoError extends Error {
  readonly code: DeepVideoErrorCode
  /** 429 时服务端给出的每日上限 */
  readonly limit?: number
  constructor(code: DeepVideoErrorCode, message: string, extra: { limit?: number } = {}) {
    super(message)
    this.name = 'DeepVideoError'
    this.code = code
    if (extra.limit != null) this.limit = extra.limit
  }
}

export function isDeepVideoError(err: unknown): err is DeepVideoError {
  return err instanceof DeepVideoError
}

/** 深度解析后端是否可用（未配置后端 / 未拼出函数地址时由调用方如实拒绝） */
export function isDeepVideoAvailable(): boolean {
  if (!edgeFnUrl('extract-video')) return false
  return isCloudBaseBackend() || isSupabaseConfigured
}

/** 单次提交请求超时（云函数侧 POST worker 为 15s，这里留 5s 余量） */
const SUBMIT_TIMEOUT_MS = 20000
/** 单次轮询请求超时（云函数侧 GET worker 为 10s） */
const POLL_TIMEOUT_MS = 15000
/** 轮询默认间隔（契约 §4） */
export const DEFAULT_POLL_INTERVAL_MS = 2000
/** 轮询默认总时长上限（契约 §4；worker 单任务上限 300s，留 60s 余量） */
export const DEFAULT_POLL_MAX_MS = 240000

/** 阶段 → 用户可见文案键（内部枚举不直接展示） */
const STAGE_LABEL_KEYS: Record<DeepVideoStage, string> = {
  download: 'ai.deepStageDownload',
  asr: 'ai.deepStageAsr',
  ocr: 'ai.deepStageOcr',
  aggregate: 'ai.deepStageAggregate',
  done: 'ai.deepStageDone',
}

/** 深度阶段的中文标签（未知阶段回落「处理中」，不泄露内部枚举） */
export function deepStageLabel(stage: string | undefined | null): string {
  return t(STAGE_LABEL_KEYS[stage as DeepVideoStage] || 'ai.deepProcessing')
}

/** 组装鉴权头：CloudBase 与 Supabase 两种后端口径与 videoExtract 保持一致 */
async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (isCloudBaseBackend()) {
    try {
      const token = await getApiToken()
      return token ? { Authorization: `Bearer ${token}` } : {}
    } catch {
      return {}
    }
  }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return {}
    return {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
    }
  } catch {
    return {}
  }
}

function clampProgress(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  // 契约是 0~1；兼容服务端误发百分比（0~100）
  return raw > 1 ? Math.min(raw / 100, 1) : Math.min(raw, 1)
}

function normalizeStatus(status: unknown): DeepVideoStatus {
  const s = String(status || '')
  if (s === 'queued' || s === 'running' || s === 'done' || s === 'failed') return s
  // 未知状态按 running 继续轮询，最终由总时长上限兜底（避免误判成功/失败）
  return 'running'
}

/** 把云函数错误响应映射成结构化错误（不吞掉服务端文案） */
function mapErrorResponse(status: number, data: Record<string, unknown> | null): DeepVideoError {
  const code = typeof data?.code === 'string' ? data.code : ''
  const message =
    (typeof data?.error === 'string' && data.error) ||
    (typeof data?.message === 'string' && data.message) ||
    ''

  if (status === 401 || code === 'login_required') {
    return new DeepVideoError('login_required', message || t('ai.deepLoginRequired'))
  }
  if (status === 429 || code === 'deep_quota_exceeded') {
    const quota = (data?.quota || null) as { limit?: unknown } | null
    const limit = quota && typeof quota.limit === 'number' ? quota.limit : undefined
    return new DeepVideoError(
      'deep_quota_exceeded',
      message || (limit != null ? t('ai.deepQuotaExceeded', { limit }) : t('ai.deepQuotaExceededUnknown')),
      { limit },
    )
  }
  if (status === 503 || code === 'deep_unavailable') {
    return new DeepVideoError('deep_unavailable', message || t('ai.deepUnavailable'))
  }
  return new DeepVideoError('network', message || t('ai.deepRequestFailed', { status }))
}

/**
 * 调用 extract-video 云函数（deep / deep_status 共用）：
 * 带超时与外部 AbortSignal，错误统一映射为 DeepVideoError。
 */
async function postExtractVideo(
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<Record<string, unknown>> {
  const endpoint = edgeFnUrl('extract-video')
  if (!endpoint) throw new DeepVideoError('deep_unavailable', t('ai.deepUnavailable'))

  const headers = await buildAuthHeaders()
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs)
  const onAbort = () => timeoutController.abort()
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId)
      throw new DeepVideoError('aborted', t('ai.stopped'))
    }
    options.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw mapErrorResponse(res.status, data)
    return data && typeof data === 'object' ? data : {}
  } catch (err) {
    if (err instanceof DeepVideoError) throw err
    // 区分「用户取消」与「客户端超时」，两者文案不同
    if (options.signal?.aborted) throw new DeepVideoError('aborted', t('ai.stopped'))
    if (timeoutController.signal.aborted) throw new DeepVideoError('timeout', t('ai.deepTimeout'))
    throw new DeepVideoError('network', t('ai.deepRequestFailedNetwork'))
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** 可取消的等待（轮询间隔；AbortSignal 取消时立刻 reject） */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeepVideoError('aborted', t('ai.stopped')))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DeepVideoError('aborted', t('ai.stopped')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 提交视频深度解析任务（异步）。
 * 成功返回 { job_id, status, eta_seconds }；配额/登录/服务不可用抛结构化 DeepVideoError。
 */
export async function submitDeepVideo(
  url: string,
  options: { signal?: AbortSignal } = {},
): Promise<DeepVideoJob> {
  const clean = String(url || '').trim()
  if (!/^https?:\/\//i.test(clean)) {
    throw new DeepVideoError('invalid_url', t('ai.deepReadNeedVideoUrl'))
  }
  if (!isDeepVideoAvailable()) {
    throw new DeepVideoError('deep_unavailable', t('ai.deepUnavailable'))
  }

  const data = await postExtractVideo(
    { action: 'deep', url: clean },
    { signal: options.signal, timeoutMs: SUBMIT_TIMEOUT_MS },
  )
  const jobId = typeof data.job_id === 'string' ? data.job_id : ''
  if (!jobId) throw new DeepVideoError('deep_unavailable', t('ai.deepUnavailable'))
  return {
    job_id: jobId,
    status: normalizeStatus(data.status === undefined ? 'queued' : data.status),
    ...(typeof data.eta_seconds === 'number' ? { eta_seconds: data.eta_seconds } : {}),
  }
}

/**
 * 轮询深度任务直到 done/failed（或超时/取消）。
 * onProgress 每次拿到最新状态时回调（stage 已做过校验，progress 归一到 0~1）。
 */
export async function pollDeepVideo(
  jobId: string,
  options: {
    signal?: AbortSignal
    onProgress?: (stage: DeepVideoStage | undefined, progress: number) => void
    intervalMs?: number
    maxMs?: number
  } = {},
): Promise<DeepVideoJobStatus> {
  const id = String(jobId || '').trim()
  if (!id) throw new DeepVideoError('invalid_url', t('ai.deepUnavailable'))

  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const maxMs = options.maxMs ?? DEFAULT_POLL_MAX_MS
  const deadline = Date.now() + maxMs

  for (;;) {
    if (options.signal?.aborted) throw new DeepVideoError('aborted', t('ai.stopped'))

    const data = await postExtractVideo(
      { action: 'deep_status', job_id: id },
      { signal: options.signal, timeoutMs: POLL_TIMEOUT_MS },
    )
    const status = normalizeStatus(data.status)
    const progress = clampProgress(data.progress)
    const stage = (
      ['download', 'asr', 'ocr', 'aggregate', 'done'] as const
    ).includes(data.stage as DeepVideoStage)
      ? (data.stage as DeepVideoStage)
      : undefined
    options.onProgress?.(stage, progress)

    const jobStatus: DeepVideoJobStatus = {
      job_id: typeof data.job_id === 'string' && data.job_id ? data.job_id : id,
      status,
      progress,
      ...(stage ? { stage } : {}),
      ...(data.result && typeof data.result === 'object'
        ? { result: data.result as DeepVideoResult }
        : {}),
      ...(data.error && typeof data.error === 'object'
        ? { error: data.error as DeepVideoJobStatus['error'] }
        : {}),
    }
    if (status === 'done' || status === 'failed') return jobStatus

    // 已到总时长上限：如实超时，不伪造完成
    if (Date.now() + intervalMs > deadline) {
      throw new DeepVideoError('timeout', t('ai.deepTimeout'))
    }
    await sleep(intervalMs, options.signal)
  }
}
