/**
 * toolResult.ts — Agent 工具执行结果的语义状态与模型回传格式化。
 *
 * 背景：18 个工具里有 6 个只生成 HITL 行动卡片（用户点卡片后才真正落库），
 * 但历史实现把「已生成卡片」的纯文本原样回传 role:'tool'，模型据此会认为
 * 操作已完成并向用户宣称成功 —— system prompt 里「严禁在未见结果时宣称操作
 * 已完成」因此形同虚设。协议层必须区分 proposed / executed，而不是把 HITL
 * 打断闭环这件事瞒着模型。
 */

/** 工具执行语义状态 */
export type ToolExecStatus = 'executed' | 'proposed' | 'not_executed' | 'failed'

/** 仅生成待确认卡片、本身不产生副作用的工具（见 useAiChatAgent.ts 各分支） */
export const PROPOSE_ONLY_TOOLS = new Set([
  'audit_vault',
  'inbox_zero',
  'create_workspace',
  'plan_task_dag',
  'preview_draft_diff',
  'heal_deadlinks',
])

/** 后端能力已下线、调用恒为「未执行」的工具（保留分发分支仅为兼容旧会话） */
export const DISABLED_TOOLS = new Set(['deep_read_video'])

/**
 * Agent 工具分支里以中文硬编码（非 i18n）的「未执行 / 失败」文案统一在此登记。
 * 产出方 useAiChatAgent 引用同一份，判定方下方兜底匹配，防两侧漂移导致的
 * 「失败被判成 executed、模型虚假宣称成功」；含动态原因的用函数构造。
 */
export const HARDCODED_NOT_EXECUTED_TEXTS = {
  batchTagEmpty: '未提供待打标书签列表，未执行打标。',
  batchTagNone: '未匹配到可打标的书签。',
  deadlinkNotFound: (target: string) => `书签库中未找到与「${target}」相关的有效书签，未执行死链替换。`,
  readInvalidUrl: '读取失败：未提供有效公开网址（必须以 http:// 或 https:// 开头）。',
  readPrivateBlocked: '安全拦截：禁止读取私有局域网或环回地址。',
  readFailed: (reason: string) => `读取网页失败：${reason}`,
  fetchException: (reason: string) => `抓取网页异常：${reason}`,
}

/** 上述硬编码失败文案的前缀（覆盖含动态原因分支），供 inferToolExecStatus 兜底前缀匹配 */
export const NOT_EXECUTED_TEXT_PREFIXES: readonly string[] = [
  '未提供待打标书签列表，未执行打标。',
  '未匹配到可打标的书签。',
  '书签库中未找到与',
  '读取失败：',
  '安全拦截：',
  '读取网页失败：',
  '抓取网页异常：',
]

export interface ToolStatusInput {
  name: string
  args?: Record<string, any>
  argsParseFailed?: boolean
  resultText: string
  /** 调用层用 t() 生成的「未执行」文案集合，避免依赖具体语言包文本 */
  notExecutedTexts?: readonly string[]
  /** 工具函数抛异常 */
  threw?: boolean
}

/**
 * 推断一次工具调用的真实语义状态。
 * 判定顺序不可调换：异常/参数失败 > 明确的未执行文案 > 已下线 > 只出卡片 > 落地执行。
 */
export function inferToolExecStatus(input: ToolStatusInput): ToolExecStatus {
  if (input.threw || input.argsParseFailed) return 'failed'
  const text = (input.resultText || '').trim()
  if (input.notExecutedTexts?.some((s) => s && s === text)) return 'not_executed'
  // 兜底：硬编码失败文案（非 i18n、部分含动态原因）统一按前缀识别，
  // 避免落到默认 'executed' 让模型虚假宣称成功；旧会话回放无 status 时同样受益
  if (NOT_EXECUTED_TEXT_PREFIXES.some((p) => text.startsWith(p))) return 'not_executed'
  if (DISABLED_TOOLS.has(input.name)) return 'not_executed'
  if (PROPOSE_ONLY_TOOLS.has(input.name)) return 'proposed'
  // merge_duplicates 只有显式 confirm:true 才真的合并，否则只是出体检卡片
  if (input.name === 'merge_duplicates') return input.args?.confirm === true ? 'executed' : 'proposed'
  return 'executed'
}

const STATUS_NOTICE_ZH: Record<ToolExecStatus, string> = {
  executed: '已执行：该操作已真实落地，可据实向用户汇报结果。',
  proposed: '待确认：仅生成了行动卡片，操作尚未执行。严禁宣称已完成，请提示用户点击卡片确认。',
  not_executed: '未执行：本次调用没有产生任何效果。严禁宣称已完成，请如实说明原因。',
  failed: '执行失败：工具抛出异常。严禁宣称已完成，请如实说明失败。',
}

const STATUS_NOTICE_EN: Record<ToolExecStatus, string> = {
  executed: 'Executed: the operation has been applied. You may report the result truthfully.',
  proposed: 'Awaiting confirmation: only an action card was generated; nothing has been applied. Never claim completion. Ask the user to confirm by clicking the card.',
  not_executed: 'Not executed: this call had no effect. Never claim completion; explain why.',
  failed: 'Failed: the tool threw an error. Never claim completion; report the failure.',
}

/**
 * 把状态标记拼到 role:'tool' 回传内容开头。
 * 调用方应先对 resultText 过 sanitizeToolResult（脱敏/限长），再调本函数，
 * 保证标记不被截断或脱敏改写。
 */
export function formatToolResultForModel(
  resultText: string,
  status: ToolExecStatus,
  isZh = true,
): string {
  const notice = (isZh ? STATUS_NOTICE_ZH : STATUS_NOTICE_EN)[status]
  return `[工具结果状态 ${status}] ${notice}\n${resultText}`
}
