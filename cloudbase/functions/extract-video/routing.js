/**
 * routing.js — extract-video 云函数的纯路由 / 降级判定函数（无网络、无状态、可单测）
 *
 * 抽出来只为一件事：index.js 里这些判定直接决定「返回什么 source/provider、是否降级、
 * 降级原因」，线上出问题时这些值就是排障第一现场。放进纯函数文件后才能用 node 直接
 * require 跑断言，不用起 http、不碰数据库。
 *
 * 约束：CommonJS（云函数目录是独立部署单元，运行期只认 require），不 require 任何文件，
 * 平台域名清单由 index.js 从 video-platforms.json 读入后作为参数传入（单一真源不在这里复制）。
 */

/** 平台风控空壳页的通用标题：不能当真实内容返回给大模型 */
const MEANINGLESS_TITLES = [
  '记录美好生活',
  '在抖音记录美好生活',
  '抖音-记录美好生活',
  '你的生活指南',
  '小红书-你的生活指南',
  'Make Your Day',
]

/** 标题/简介是否是平台空壳文案（空、极短、或平台通用 Slogan） */
function isMeaningfulText(text) {
  const t = String(text || '').trim()
  if (!t || t.length <= 2) return false
  return !MEANINGLESS_TITLES.some((p) => t === p || t.includes(p))
}

/** 平台错误页 / 已删除页：worker 抓到这种页面时不得当成功内容返回 */
const DEAD_PAGE_PATTERNS = [
  /出错啦/,
  /页面不存在/,
  /页面找不到了/,
  /视频去哪了/,
  /视频不见了/,
  /稿件已被删除/,
  /该稿件已被隐藏/,
  /视频已被删除/,
  /视频不存在/,
  /访问异常/,
  /请求过于频繁/,
  /\b404\s*(not\s*found|错误|error)?\b/i,
  /this\s+page\s+could\s+not\s+be\s+found/i,
  /\bvideo\s+unavailable\b/i,
  /this\s+video\s+has\s+been\s+removed/i,
]

/** 任一段文本命中错误页特征即判定为死页 */
function isDeadPageText(...texts) {
  const combined = texts.filter(Boolean).join(' ')
  if (!combined) return false
  return DEAD_PAGE_PATTERNS.some((re) => re.test(combined))
}

/**
 * 是否交给 yt-dlp worker 处理。
 * 只处理视频/直播/图文笔记站点；普通网页仍走 r.jina.ai 全文抓取
 * （worker 对普通页面只能给标题/摘要，反而劣于 jina 的正文）。
 *
 * @param {URL|null} parsed 目标 URL（已跟随短链）
 * @param {string[]} hosts 平台域名清单（index.js 从 video-platforms.json 读入，单一真源）
 */
function shouldUseWorker(parsed, hosts) {
  if (!parsed || !Array.isArray(hosts) || hosts.length === 0) return false
  const host = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '')
  if (!host) return false
  return hosts.some((h) => {
    const bare = String(h || '').toLowerCase().replace(/^www\./, '')
    return !!bare && (host === bare || host.endsWith('.' + bare))
  })
}

/** worker 返回的 extractor 名归一成客户端约定的 source 标识 */
function normalizeWorkerSource(source) {
  const s = String(source || '').toLowerCase()
  if (s.includes('douyin')) return 'douyin'
  if (s.includes('tiktok')) return 'tiktok'
  if (s.includes('xiaohongshu') || s.includes('rednote')) return 'xiaohongshu'
  if (s.includes('bilibili') || s.includes('bili')) return 'bilibili'
  if (s.includes('youtube') || s.includes('youtu')) return 'youtube'
  if (s.includes('twitter') || s === 'x') return 'x'
  return 'generic'
}

/**
 * 落到 r.jina.ai 兜底时，给客户端一个机器可读的降级原因（前端据此选择提示文案）。
 * 枚举固定为四个，新增值必须同步前端披露文案。
 *
 * @param {object} status
 * @param {'no_proxy'|'unavailable'|null} [status.workerSkipped]
 *        worker 被主动跳过：no_proxy=YouTube 无 API key 且 worker 没配代理（P0 快速失败）；
 *        unavailable=/health 不可达，按 worker 不可用处理
 * @param {boolean} [status.workerTimedOut] worker 请求超时（时长本身就是排障信号，优先暴露）
 * @param {boolean} [status.adapterAttempted] 目标命中了平台专用适配器（B站 / 有 key 的 YouTube）
 */
function pickFallbackReason(status) {
  const s = status || {}
  if (s.workerSkipped === 'no_proxy') return 'worker_no_proxy'
  if (s.workerSkipped === 'unavailable') return 'worker_unavailable'
  if (s.workerTimedOut) return 'timeout'
  if (s.adapterAttempted) return 'adapter_empty'
  return 'worker_unavailable'
}

/** 深度任务 id：worker 生成 uuid，格式不符直接拒绝（避免拼进 URL / 作为日志注入面） */
const JOB_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

function isValidJobId(jobId) {
  return typeof jobId === 'string' && JOB_ID_RE.test(jobId.trim())
}

module.exports = {
  isMeaningfulText,
  isDeadPageText,
  shouldUseWorker,
  normalizeWorkerSource,
  pickFallbackReason,
  isValidJobId,
}
