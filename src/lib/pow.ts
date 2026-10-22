/**
 * pow.ts — 无感 PoW 前端解题器（Friendly Captcha / ALTCHA 式）
 *
 * 流程：从 send-feedback 拿 HMAC 签名挑战 → 本地找 nonce 使
 * SHA-256(challenge + ':' + nonce) 前导零位数 ≥ difficulty → 随反馈提交。
 * 纯本地计算（无第三方、无网络依赖），用户全程无感；脚本机器人每次提交
 * 都要付等价算力成本。
 *
 * SHA-256 为纯 TS 实现（Web Crypto 的 digest 单次调用开销大，不适合万次级
 * 挖掘循环）。正确性由单测对拍 node:crypto 锤死——**改此文件必须跑 pow.test.ts**。
 * 语义与 cloudbase/functions/send-feedback/pow.js 严格一致（同一哈希输入
 * `challenge:nonce`、同一前导零位数定义）。
 */

/** SHA-256 轮常量 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

/** SHA-256（纯 TS）。返回 32 字节摘要。 */
export function sha256Bytes(msg: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const l = msg.length
  // 填充：0x80 + k 个 0，使 (l + 1 + k) % 64 === 56，再接 64 位大端 bit 长度
  const k = (56 - ((l + 1) % 64) + 64) % 64
  const total = l + 1 + k + 8
  const buf = new Uint8Array(total)
  buf.set(msg)
  buf[l] = 0x80
  const dv = new DataView(buf.buffer)
  const bitLen = l * 8
  dv.setUint32(total - 8, Math.floor(bitLen / 4294967296))
  dv.setUint32(total - 4, bitLen >>> 0)

  const w = new Uint32Array(64)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]
      const w2 = w[i - 2]
      const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0
      const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i])
  return out
}

const HEX = '0123456789abcdef'

export function sha256Hex(input: string): string {
  const bytes = sha256Bytes(new TextEncoder().encode(input))
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15]
  return s
}

/** 十六进制摘要的前导零位数（与服务端 pow.js 同语义） */
export function leadingZeroBitsFromHex(hex: string): number {
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

/**
 * 挖掘解答：返回满足难度的 nonce（十进制字符串），maxIters 内未找到返回 null。
 * 每 2^13 次哈希让出一次主线程（setTimeout 0），保持 UI 可响应。
 */
export async function solvePow(challenge: string, difficulty: number, maxIters = 500_000): Promise<string | null> {
  const prefix = challenge + ':'
  const d = Math.max(1, difficulty | 0)
  // 随机起点：多标签页同时打开时不重复劳动
  let nonce = Math.floor(Math.random() * 1_000_000)
  for (let i = 0; i < maxIters; i++, nonce++) {
    if (leadingZeroBitsFromHex(sha256Hex(prefix + nonce)) >= d) return String(nonce)
    if ((i & 0x1fff) === 0x1fff) await new Promise<void>((r) => setTimeout(r, 0))
  }
  return null
}
