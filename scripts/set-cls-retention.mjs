#!/usr/bin/env node
/**
 * 设置 CLS 日志主题保留期（默认 210 天）。
 *
 * 背景：365 天 → 210 天。210 天 > 6 个自然月最长天数（31+28+31+30+31+30 = 181），
 * 因而仍满足《网络安全法》第 21 条与自评估报告承诺的「不少于六个月」；
 * 同时把长期滚动的存储量压到 365 天的 58%。
 *
 * 注意：缩短保留期后，超过新期限的历史日志会被 CLS 清理且不可恢复。
 *
 * 用法：
 *   node scripts/set-cls-retention.mjs          # 设为 210 天
 *   node scripts/set-cls-retention.mjs 180      # 设为 180 天（不推荐：不满 6 自然月）
 *   node scripts/set-cls-retention.mjs --check  # 只查询当前值
 *
 * 前提：腾讯云账户不能处于欠费隔离状态，否则所有 CLS 接口返回
 *      OperationDenied.AccountIsolate。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash, createHmac } from 'node:crypto'

const HOST = 'cls.ap-shanghai.tencentcloudapi.com'
const SERVICE = 'cls'
const VERSION = '2020-10-16'
const REGION = 'ap-shanghai'
/** 日志集 ulink-logs 下的主题 ulink-audit */
const TOPIC_ID = '95e77d9e-89d4-41e2-8793-d158b01b1b14'

function loadCredential() {
  const raw = readFileSync(resolve(homedir(), '.config/.cloudbase/auth.json'), 'utf8')
  const c = JSON.parse(raw).credential
  if (!c?.secretId || !c?.secretKey) {
    throw new Error('未找到腾讯云凭证，请先执行 tcb login')
  }
  return { secretId: c.secretId, secretKey: c.secretKey }
}

async function callApi({ secretId, secretKey }, action, payload) {
  const ts = Math.floor(Date.now() / 1000)
  const date = new Date(ts * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const ct = 'application/json; charset=utf-8'
  const canonical = `POST\n/\n\ncontent-type:${ct}\nhost:${HOST}\n\ncontent-type;host\n`
  const hashed = createHash('sha256').update(body).digest('hex')
  const canonicalHash = createHash('sha256').update(canonical + hashed).digest('hex')
  const scope = `${date}/${SERVICE}/tc3_request`
  const toSign = `TC3-HMAC-SHA256\n${ts}\n${scope}\n${canonicalHash}`
  const kDate = createHmac('sha256', 'TC3' + secretKey).update(date).digest()
  const kService = createHmac('sha256', kDate).update(SERVICE).digest()
  const kSigning = createHmac('sha256', kService).update('tc3_request').digest()
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex')

  const res = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      Host: HOST,
      'X-TC-Action': action,
      'X-TC-Version': VERSION,
      'X-TC-Timestamp': String(ts),
      'X-TC-Region': REGION,
      'Content-Type': ct,
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    },
    body,
  })
  const json = await res.json()
  const resp = json.Response || {}
  if (resp.Error) {
    const err = new Error(`${action} 失败：${resp.Error.Code} — ${resp.Error.Message}`)
    err.code = resp.Error.Code
    throw err
  }
  return resp
}

async function readPeriod(cred) {
  const resp = await callApi(cred, 'DescribeTopics', { Filters: [{ Key: 'topicId', Values: [TOPIC_ID] }] })
  const topic = (resp.Topics || []).find((t) => t.TopicId === TOPIC_ID) || (resp.Topics || [])[0]
  if (!topic) throw new Error('未找到主题 ulink-audit')
  return { period: topic.Period, name: topic.TopicName }
}

async function main() {
  const arg = process.argv[2]
  const checkOnly = arg === '--check'
  const period = checkOnly ? null : Number(arg || 210)

  if (!checkOnly && (!Number.isInteger(period) || period < 1)) {
    console.error('✖ 天数必须是正整数')
    process.exit(1)
  }

  const cred = loadCredential()
  const before = await readPeriod(cred)
  console.log(`当前：主题 ${before.name}（${TOPIC_ID}）保留 ${before.period} 天`)

  if (checkOnly) return

  if (before.period === period) {
    console.log(`✓ 已经是 ${period} 天，无需修改`)
    return
  }

  console.log(`→ 修改为 ${period} 天…`)
  await callApi(cred, 'ModifyTopic', { TopicId: TOPIC_ID, Period: period })

  const after = await readPeriod(cred)
  if (after.period === period) {
    console.log(`✓ 已生效：${after.period} 天`)
  } else {
    console.error(`⚠ 接口成功但读回仍为 ${after.period} 天，请到控制台确认`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('✖', e.message)
  if (String(e.code || '').includes('AccountIsolate')) {
    console.error('  原因：腾讯云账户欠费被隔离，所有写操作都会被拒绝。请先充值。')
  }
  process.exit(1)
})
