/**
 * pow.js — 无感人机验证（工作量证明）挑战签发与校验
 *
 * 设计（Friendly Captcha / ALTCHA 式）：
 * - 服务端签发挑战：{ challenge, difficulty, exp, jti, signature }，HMAC-SHA256 防伪造/降难度。
 * - 客户端解题：找 nonce 使 SHA-256(challenge + ':' + nonce) 的前导零位数 ≥ difficulty
 *   （纯本地计算，用户完全无感）。
 * - 服务端校验：签名（timing-safe）→ 未过期 → 难度达标；jti 由调用方用 consume_rate_limit
 *   做一次性消费防重放。
 *
 * 难度 15 bit ≈ 期望 32768 次哈希 ≈ 现代浏览器 100~300ms；脚本机器人每次提交都要付
 * 等价算力成本。强度边界如实：有算力的攻击者可以硬算——故 PoW 是主闸，图形验证码
 * （captcha）是 PoW 失败/缺失时的兜底，限流是最后闸门（纵深防御）。
 */

const crypto = require('crypto')

const MIN_DIFFICULTY = 8
const MAX_DIFFICULTY = 22
const DEFAULT_DIFFICULTY = 15
const DEFAULT_TTL_MS = 2 * 60 * 1000

function hmacSign(secret, payload) {
  return crypto.createHmac('sha256', String(secret)).update(payload, 'utf8').digest('hex')
}

/** 十六进制摘要的前导零位数（大端语义，与前端 miner 一致） */
function leadingZeroBitsFromHex(hex) {
  let bits = 0
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i], 16)
    if (Number.isNaN(v)) break
    if (v === 0) { bits += 4; continue }
    if (v < 2) bits += 3
    else if (v < 4) bits += 2
    else if (v < 8) bits += 1
    break
  }
  return bits
}

/** 签发挑战（HMAC 绑定难度与有效期，客户端无法伪造简单题） */
function issuePowChallenge(secret, opts) {
  const o = opts || {}
  const difficulty = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Number(o.difficulty) || DEFAULT_DIFFICULTY))
  const ttlMs = Number(o.ttlMs) > 0 ? Number(o.ttlMs) : DEFAULT_TTL_MS
  const jti = crypto.randomBytes(8).toString('hex')
  const exp = Date.now() + ttlMs
  const challenge = crypto.randomBytes(16).toString('hex')
  const signature = hmacSign(secret, `${challenge}.${difficulty}.${exp}.${jti}`)
  return { challenge, difficulty, exp, jti, signature }
}

/**
 * 校验解答。sol = { challenge, difficulty, exp, jti, signature, nonce }
 * 任一环节不符返回 false（调用方据此回落图形验证码，fail-closed）。
 */
function verifyPowSolution(secret, sol) {
  if (!sol || typeof sol !== 'object') return false
  const { challenge, difficulty, exp, jti, signature, nonce } = sol
  if (typeof challenge !== 'string' || !/^[a-f0-9]{16,64}$/.test(challenge)) return false
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false
  if (typeof nonce !== 'string' || !/^[0-9]{1,12}$/.test(nonce)) return false
  const diff = Number(difficulty)
  if (!Number.isInteger(diff) || diff < MIN_DIFFICULTY || diff > MAX_DIFFICULTY) return false
  const expN = Number(exp)
  if (!Number.isFinite(expN) || Date.now() > expN) return false
  if (typeof jti !== 'string' || !/^[a-f0-9]{8,32}$/.test(jti)) return false

  const expected = hmacSign(secret, `${challenge}.${diff}.${expN}.${jti}`)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false

  const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`, 'utf8').digest('hex')
  return leadingZeroBitsFromHex(digest) >= diff
}

module.exports = { issuePowChallenge, verifyPowSolution, leadingZeroBitsFromHex }
