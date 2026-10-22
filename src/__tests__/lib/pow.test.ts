/**
 * pow.test.ts — PoW 解题器与服务端校验的契约测试
 *
 * 核心职责：**锤死 SHA-256 纯 TS 实现与 node:crypto 逐位一致**（miner 挖出的
 * nonce 必须被服务端 pow.js 接受），以及前导零位数语义两侧一致、篡改/过期/
 * 降难度伪造全部拒绝。改 src/lib/pow.ts 或 cloudbase/functions/send-feedback/pow.js
 * 必须过本测试。
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { sha256Hex, leadingZeroBitsFromHex, solvePow } from '../../lib/pow.js'

const require = createRequire(import.meta.url)
// 服务端校验模块（CJS，真源本体）——与生产函数同文件
const powSrv = require('../../../cloudbase/functions/send-feedback/pow.js') as {
  issuePowChallenge: (secret: string, opts?: { difficulty?: number; ttlMs?: number }) => {
    challenge: string; difficulty: number; exp: number; jti: string; signature: string
  }
  verifyPowSolution: (secret: string, sol: Record<string, unknown> | null) => boolean
  leadingZeroBitsFromHex: (hex: string) => number
}

const nodeSha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('sha256Hex — 纯 TS 实现对拍 node:crypto', () => {
  const vectors = [
    '',
    'abc',
    'a',
    'The quick brown fox jumps over the lazy dog',
    '与链 · ulink 中文 Unicode 混合 input 🚀',
    'x'.repeat(1000),
    'y'.repeat(55), // 边界：55+1=56 字节（padding 边缘）
    'z'.repeat(56), // 边界：56+1 触发额外块
    'w'.repeat(64),
    '0123456789',
  ]
  for (const v of vectors) {
    it(`digest 与 node:crypto 一致（len=${v.length}）`, () => {
      expect(sha256Hex(v)).toBe(nodeSha256Hex(v))
    })
  }
})

describe('leadingZeroBitsFromHex — 两侧语义一致', () => {
  const cases: Array<[string, number]> = [
    ['00000000', 32],
    ['00000001', 31],
    ['0000000f', 28],
    ['00000080', 24],
    ['000000ff', 24],
    ['00000100', 23],
    ['00000800', 20],
    ['00008000', 16],
    ['00080000', 12],
    ['00800000', 8],
    ['08000000', 4],
    ['80000000', 0],
    ['a0000000', 0],
    ['f0000000', 0],
    ['20000000', 2],
    ['40000000', 1],
  ]
  for (const [hex, bits] of cases) {
    it(`${hex} → ${bits}`, () => {
      expect(leadingZeroBitsFromHex(hex)).toBe(bits)
      expect(powSrv.leadingZeroBitsFromHex(hex)).toBe(bits)
    })
  }
})

describe('solvePow ↔ verifyPowSolution 回环', () => {
  it('低难度挖掘出的解被服务端接受', async () => {
    const ch = powSrv.issuePowChallenge('test-secret', { difficulty: 8 })
    const nonce = await solvePow(ch.challenge, ch.difficulty)
    expect(nonce).not.toBeNull()
    expect(powSrv.verifyPowSolution('test-secret', { ...ch, nonce })).toBe(true)
    // 自证难度真实达标（防两侧语义漂移互认低难度解）
    expect(leadingZeroBitsFromHex(sha256Hex(ch.challenge + ':' + nonce))).toBeGreaterThanOrEqual(8)
  })

  it('默认难度（15）挖掘出的解被接受', async () => {
    const ch = powSrv.issuePowChallenge('test-secret')
    expect(ch.difficulty).toBe(15)
    const nonce = await solvePow(ch.challenge, ch.difficulty)
    expect(nonce).not.toBeNull()
    expect(powSrv.verifyPowSolution('test-secret', { ...ch, nonce })).toBe(true)
  }, 20_000)

  it('拒绝路径全覆盖', async () => {
    const ch = powSrv.issuePowChallenge('test-secret', { difficulty: 8 })
    const nonce = await solvePow(ch.challenge, ch.difficulty)
    const good = { ...ch, nonce }
    expect(powSrv.verifyPowSolution('test-secret', good)).toBe(true)

    // 错误密钥
    expect(powSrv.verifyPowSolution('other-secret', good)).toBe(false)
    // 签名篡改
    const badSig = { ...good, signature: good.signature.slice(0, -1) + (good.signature.endsWith('0') ? '1' : '0') }
    expect(powSrv.verifyPowSolution('test-secret', badSig)).toBe(false)
    // 过期
    expect(powSrv.verifyPowSolution('test-secret', { ...good, exp: Date.now() - 1 })).toBe(false)
    // 降难度伪造（改 difficulty 必破坏 HMAC）
    expect(powSrv.verifyPowSolution('test-secret', { ...good, difficulty: 1 })).toBe(false)
    // nonce 未达标（合法签名下用错误 nonce）
    expect(powSrv.verifyPowSolution('test-secret', { ...good, nonce: '0'.repeat(11) })).toBe(false)
    // 形状非法
    expect(powSrv.verifyPowSolution('test-secret', null)).toBe(false)
    expect(powSrv.verifyPowSolution('test-secret', { ...good, nonce: 'abc' })).toBe(false)
    expect(powSrv.verifyPowSolution('test-secret', { ...good, nonce: '1'.repeat(13) })).toBe(false)
    expect(powSrv.verifyPowSolution('test-secret', { ...good, jti: 'zz' })).toBe(false)
  })
})
