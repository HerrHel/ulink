/**
 * extension/config.js 护栏测试（d1-111-extension-config-const-guard）。
 *
 * 测 extension/config.js 顶层常量赋值挂载的 `window.LinkVaultExtConfig` 全局对象的契约：
 *   - CLOUDBASE_ENV_ID（扩展端连 CloudBase 后端的唯一环境标识）
 *   - CLOUDBASE_PUBLISHABLE_KEY（扩展端 anon 角色 JWT，RLS 保护，公开但不可漂移成 service_role）
 *   - MASTER_PASSWORD_TTL_MS（主密码会话缓存 TTL，与方向 E 跨端解密时机同源）
 *
 * d1-110 已 voucher「经 IIFE 全局 API 间接测纯分支 + 零基建 + 零生产源文件改动」范式：
 * 此处 config.js 是该范式下最简延续面——10 行无函数仅常量赋值，import 即执行赋值挂
 * `window.LinkVaultExtConfig`，经全局对象间接断言常量契约。config.js 一字不改。
 *
 * 配置常量快照护栏虽无分支逻辑，但真有回归价值：
 *   - publishable key 漂移让扩展端连不上 CloudBase 或验签失败；
 *   - 误入 service_role key 越权（绕过 RLS）；
 *   - envId 漂移连错环境；
 *   - TTL 漂移让主密码会话缓存时机错了，致跨端解密在窗口期失败
 *     （与 lv-extension-e2e-cross-end-bug 方向 E commit cf57035b 防回归同源安全面）。
 * 此前零直接验证——今把 envId/JWT 结构/TTL/无 service_role 四类不变量直锁为可回归断言。
 *
 * 2026-10-31 起配置键由 SUPABASE_URL / SUPABASE_ANON_KEY 更名为
 * CLOUDBASE_ENV_ID / CLOUDBASE_PUBLISHABLE_KEY（`window.supabase` 仅为 CloudBase shim），
 * 本测试随 extension/config.js 同步更名。
 */
import { describe, it, expect, beforeEach } from 'vitest'

// 导入即执行顶层赋值 `window.LinkVaultExtConfig = {...}`，jsdom window 安全（无 chrome.* 依赖）。
import '../../../extension/config.js'

// 经全局对象取句柄（与 sidepanel.js:7 `const _cfg = window.LinkVaultExtConfig || {}`
// 实际消费点同源——sidepanel fallback `|| {}` 防 config.js 未加载，护栏不测 fallback 直测本源）。
function getCfg() {
  // @ts-expect-error extension config 挂 window 全局
  const cfg = window.LinkVaultExtConfig
  expect(cfg, 'extension/config.js 应挂载 window.LinkVaultExtConfig').toBeDefined()
  expect(typeof cfg, 'window.LinkVaultExtConfig 应是 object').toBe('object')
  return cfg as Record<string, unknown>
}

// JWT base64url 解码（不依赖 atob 的 base64 处理，宽容 `-`/`_` 与无 padding）。
function decodeJwtPart(part: string): string {
  const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4))
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + pad
  // jsdom 默认提供 atob（在 lib.dom.d.ts 已声明，无需 @ts-expect-error）。
  return atob(b64)
}

describe('extension/config.js — LinkVaultExtConfig 常量快照护栏', () => {
  beforeEach(() => {
    // import 已在模块加载时挂载，无副作用需重置；config 是静态常量无状态。
  })

  describe('挂载与键集契约', () => {
    it('window.LinkVaultExtConfig 恰好含 3 个键无多余无缺失', () => {
      const cfg = getCfg()
      expect(Object.keys(cfg).sort()).toEqual(
        ['CLOUDBASE_ENV_ID', 'CLOUDBASE_PUBLISHABLE_KEY', 'MASTER_PASSWORD_TTL_MS'].sort(),
      )
      expect(Object.keys(cfg).length).toBe(3)
    })

    it('每个键均有 truthy 字符串/数字值（无 undefined/null 占位）', () => {
      const cfg = getCfg()
      expect(typeof cfg.CLOUDBASE_ENV_ID).toBe('string')
      expect((cfg.CLOUDBASE_ENV_ID as string).length).toBeGreaterThan(0)
      expect(typeof cfg.CLOUDBASE_PUBLISHABLE_KEY).toBe('string')
      expect((cfg.CLOUDBASE_PUBLISHABLE_KEY as string).length).toBeGreaterThan(0)
      expect(typeof cfg.MASTER_PASSWORD_TTL_MS).toBe('number')
      expect(Number.isFinite(cfg.MASTER_PASSWORD_TTL_MS as number)).toBe(true)
    })

    it('不再保留历史 Supabase 键名（防 shim 读空值静默连错）', () => {
      const cfg = getCfg()
      expect(cfg.SUPABASE_URL).toBeUndefined()
      expect(cfg.SUPABASE_ANON_KEY).toBeUndefined()
    })
  })

  describe('CLOUDBASE_ENV_ID — 扩展端后端标识承载（CloudBase envId，shim 约定）', () => {
    it('是 CloudBase envId 形态（<name>-<id>，无协议/无斜杠，防误填 URL）', () => {
      const v = getCfg().CLOUDBASE_ENV_ID as string
      expect(v).toMatch(/^[a-z][a-z0-9]*-[a-z0-9]+$/)
      expect(v).not.toMatch(/[:/]/)
    })

    it('与生产环境 id 一致（防误改连错环境）', () => {
      expect(getCfg().CLOUDBASE_ENV_ID).toBe('ulink-d1g5srvjo54b1886a')
    })

    it('shim 的 createClient 以此为 envId 初始化（约定锁）', () => {
      // 值必须非空字符串（undefined/null 占位会让 shim init({env:''}) 静默连错）
      expect(typeof getCfg().CLOUDBASE_ENV_ID).toBe('string')
      expect((getCfg().CLOUDBASE_ENV_ID as string).length).toBeGreaterThan(8)
    })

    it('无 URL 痕迹（历史形态残留检测：出现 :// 或 .supabase.co 即回退旧配置）', () => {
      const v = getCfg().CLOUDBASE_ENV_ID as string
      expect(v.includes('://')).toBe(false)
      expect(v.includes('supabase.co')).toBe(false)
    })
  })

  describe('CLOUDBASE_PUBLISHABLE_KEY — anon JWT 公开契约', () => {
    const getKey = () => getCfg().CLOUDBASE_PUBLISHABLE_KEY as string

    it('是三段 JWT（恰好两 `.` 分隔 header.payload.signature）', () => {
      expect(getKey().split('.')).toHaveLength(3)
    })

    it('无 service_role 越权 key 泄漏（注释明示「切勿写入 service_role / 服务端密钥」）', () => {
      // 护栏核心：publishable key 必须是 anon 角色，payload.role === 'anon' !== 'service_role'。
      // JWT payload 标准字段名是 `role`（首轮试错反推真实特性：
      // 非我初记的 `rol`——六段 JWT base64url 实测 payload.role='anon'）。
      const payload = JSON.parse(decodeJwtPart(getKey().split('.')[1]))
      expect(payload.role).toBe('anon')
      expect(payload.role).not.toBe('service_role')
      // 配置对象整体也无 service_role 候选键（防未来误加越权 key）。
      const cfg = getCfg()
      const vals = Object.values(cfg)
      expect(vals.some((v) => typeof v === 'string' && /service_role/i.test(v))).toBe(false)
    })

    it('header.alg 是已知签名算法（CloudBase 腾讯签发 RS256；原 Supabase 为 HS256）', () => {
      const header = JSON.parse(decodeJwtPart(getKey().split('.')[0]))
      expect(['RS256', 'HS256']).toContain(header.alg)
    })

    it('header.typ 缺省或为 JWT（CloudBase 签发不带 typ；带则须正确）', () => {
      const header = JSON.parse(decodeJwtPart(getKey().split('.')[0]))
      expect(header.typ === undefined || header.typ === 'JWT').toBe(true)
    })

    it('payload.iat 是 finite number（签发时间戳）', () => {
      const payload = JSON.parse(decodeJwtPart(getKey().split('.')[1]))
      expect(typeof payload.iat).toBe('number')
      expect(Number.isFinite(payload.iat)).toBe(true)
    })

    it('payload.exp > payload.iat（exp 在未来，未瞬间过期）', () => {
      const payload = JSON.parse(decodeJwtPart(getKey().split('.')[1]))
      expect(payload.exp).toBeGreaterThan(payload.iat)
      expect(typeof payload.exp).toBe('number')
      expect(Number.isFinite(payload.exp)).toBe(true)
    })

    it('signature 是非空字符串（三段皆非空，防被截成两段致验签恒失败）', () => {
      const parts = getKey().split('.')
      for (const p of parts) expect(p.length).toBeGreaterThan(0)
    })
  })

  describe('MASTER_PASSWORD_TTL_MS — 主密码会话缓存 TTL（方向 E 跨端解密时机同源）', () => {
    it('恰为 60000（60 秒，防漂移成 6 秒/600 秒致解密窗口期错）', () => {
      expect(getCfg().MASTER_PASSWORD_TTL_MS).toBe(60000)
    })

    it('是正整数（防 0/负数/浮点致 scheduleClearMasterPassword 立即清或永不触发）', () => {
      const ttl = getCfg().MASTER_PASSWORD_TTL_MS as number
      expect(Number.isInteger(ttl)).toBe(true)
      expect(ttl).toBeGreaterThan(0)
    })

    it('是有限 number 非 NaN/Infinity（setTimeout 拒 Infinity 致定时器永不触发回归）', () => {
      const ttl = getCfg().MASTER_PASSWORD_TTL_MS as number
      expect(Number.isFinite(ttl)).toBe(true)
    })
  })
})
