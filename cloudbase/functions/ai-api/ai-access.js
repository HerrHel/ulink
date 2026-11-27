/**
 * ai-api 的 AI 访问权判断（2026-11-21）。独立模块：index.js 一加载就会监听端口，无法直接单测。
 * 只依赖传入的 db（@cloudbase/node-sdk rdb 客户端，仅用到 db.rpc）。
 */
'use strict'

/**
 * AI 访问权（2026-11-21）：大模型能力为 PRO 专属，免费用户按终身试用次数（ai.trial.total）。
 *   PRO  → consume_ai_access 放行后，再计入 PRO 每日请求数 ai.requests.daily
 *   免费 → consume_ai_access 原子扣 1 次试用
 * 返回 { allowed, consumed: 'trial'|'daily'|null, reason }。任何 RPC 故障 fail-closed（allowed=false）：
 * extract 退化为只读 HTML（免费能力照常可用），candidates 直接拒绝。
 */
async function checkAiAccess(db, uid) {
  if (!uid) return { allowed: false, consumed: null, reason: 'login_required' }
  try {
    const a = await db.rpc('consume_ai_access', { p_uid: uid })
    if (a.error) {
      console.error('[ai-api] consume_ai_access failed (fail-closed):', String(a.error))
      return { allowed: false, consumed: null, reason: 'quota_unavailable' }
    }
    const d = a.data || {}
    if (d.ok !== true) return { allowed: false, consumed: null, reason: 'ai_trial_exhausted' }
    if (d.tier === 'trial') return { allowed: true, consumed: 'trial', reason: null }
    const daily = await db.rpc('consume_daily_feature_quota', {
      p_uid: uid, p_feature: 'ai.requests.daily', p_key_prefix: 'ai:req:',
    })
    if (daily.error) {
      console.error('[ai-api] daily quota failed (fail-closed):', String(daily.error))
      return { allowed: false, consumed: null, reason: 'quota_unavailable' }
    }
    if (!daily.data || daily.data.ok !== true) {
      // scope=monthly：PRO 每月次数（主限额）用完；否则为每日防滥用上限
      const reason = daily.data && daily.data.scope === 'monthly' ? 'monthly_exhausted' : 'daily_exhausted'
      return { allowed: false, consumed: null, reason }
    }
    return { allowed: true, consumed: 'daily', reason: null }
  } catch (err) {
    console.error('[ai-api] ai access check threw (fail-closed):', String(err))
    return { allowed: false, consumed: null, reason: 'quota_unavailable' }
  }
}

/** 本次未真正产出 AI 结果（上游失败 / 被跳过）时退还已扣次数 */
async function refundAiAccess(db, uid, consumed) {
  try {
    if (consumed === 'trial') await db.rpc('refund_ai_trial', { p_uid: uid })
    else if (consumed === 'daily') await db.rpc('refund_daily_feature_quota', { p_uid: uid, p_feature: 'ai.requests.daily' })
  } catch (err) {
    console.warn('[ai-api] refund failed:', String(err))
  }
}

module.exports = { checkAiAccess, refundAiAccess }
