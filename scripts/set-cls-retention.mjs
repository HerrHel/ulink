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
 *   node scripts/set-cls-retention.mjs 180 --force-below-181  # 强制低于 181 天（会二次警告，不推荐）
 *   node scripts/set-cls-retention.mjs --check  # 只查询当前值
 *
 * 安全护栏：保留期下限 181 天（6 个自然月最长天数）。低于该值会不可逆删除仍在
 * 合规留存期内的日志，必须显式 --force-below-181 且脚本会二次打印警告；ModifyTopic
 * 前还会明确打印将被不可逆清理的日志天数。
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

async function readTopic(cred) {
  const resp = await callApi(cred, 'DescribeTopics', { Filters: [{ Key: 'topicId', Values: [TOPIC_ID] }] })
  const topic = (resp.Topics || []).find((t) => t.TopicId === TOPIC_ID) || (resp.Topics || [])[0]
  if (!topic) throw new Error('未找到主题 ulink-audit')
  return {
    name: topic.TopicName,
    period: topic.Period,
    storageType: topic.StorageType,
    /** 1 = 迁移任务进行中；迁移期间 period/storage_type 会被锁定，重复修改报 InvalidParameter */
    migrationStatus: topic.MigrationStatus,
    newPeriod: topic.NewPeriod,
    taskId: topic.TopicAsyncTaskID,
  }
}

/** 6 个自然月最长天数（31+28+31+30+31+30）；低于它就会删掉合规承诺期内的日志 */
const MIN_PERIOD = 181

async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const forceBelow181 = args.includes('--force-below-181')
  const periodArg = args.find((a) => !a.startsWith('--'))
  const period = checkOnly ? null : Number(periodArg || 210)

  if (!checkOnly && (!Number.isInteger(period) || period < 1)) {
    console.error('✖ 天数必须是正整数')
    process.exit(1)
  }
  // 低于 181 天会不可逆清理合规日志：旧版 period<1 就放行，1 天也能改；这里必须显式 --force-below-181
  if (!checkOnly && period < MIN_PERIOD && !forceBelow181) {
    console.error(`✖ 保留期 ${period} 天低于下限 ${MIN_PERIOD} 天，会不可逆删除「不少于六个月」承诺期内的日志。`)
    console.error('  如确需缩短，请显式追加 --force-below-181（脚本会二次打印警告）。')
    process.exit(1)
  }
  // 第一次警告：强制低于下限时，提前告知不可逆后果
  if (!checkOnly && period < MIN_PERIOD && forceBelow181) {
    console.warn(`\n⚠⚠ 警告：目标 ${period} 天低于下限 ${MIN_PERIOD} 天，超期日志将被不可逆删除且无法恢复。`)
  }

  const cred = loadCredential()
  const before = await readTopic(cred)
  console.log(`当前：主题 ${before.name}（${TOPIC_ID}）保留 ${before.period} 天，存储 ${before.storageType}`)

  // 迁移中：修改已提交，正在执行，此时 period 是旧值、newPeriod 才是目标值
  if (before.migrationStatus === 1) {
    console.log(`⏳ 存储迁移任务进行中（task ${before.taskId}）`)
    console.log(`   目标：${before.newPeriod} 天 / ${before.storageType}`)
    console.log('   迁移期间 period 被锁定，重复提交会报 InvalidParameter，属正常现象。')
    console.log('   完成后 Period 会自动变为目标值，无需再操作。')
    return
  }

  if (checkOnly) return

  if (before.period === period) {
    console.log(`✓ 已经是 ${period} 天，无需修改`)
    return
  }

  console.log(`→ 修改为 ${period} 天…`)
  // 第二次警告：强制低于下限时再确认一次（与前面的首次警告构成「二次打印警告」）
  if (period < MIN_PERIOD && forceBelow181) {
    console.warn(`⚠⚠ 再次警告：目标 ${period} 天低于合规下限 ${MIN_PERIOD} 天，请确认已知悉不可逆清理风险。`)
  }
  // ModifyTopic 前明确打印将不可逆删除多少天前的日志
  if (period < before.period) {
    console.warn(`   ⚠ 本次缩短 ${before.period - period} 天：${period} 天前（原 ${before.period} 天内）的历史日志将被 CLS 不可逆清理、无法恢复。`)
  } else {
    console.log(`  保留期由 ${before.period} 天调整为 ${period} 天（未缩短，不触发历史日志清理）`)
  }
  await callApi(cred, 'ModifyTopic', { TopicId: TOPIC_ID, Period: period })

  const after = await readTopic(cred)
  if (after.period === period) {
    console.log(`✓ 已生效：${after.period} 天`)
  } else if (after.migrationStatus === 1) {
    console.log(`⏳ 已提交迁移：目标 ${after.newPeriod} 天（task ${after.taskId}），完成后自动生效`)
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
