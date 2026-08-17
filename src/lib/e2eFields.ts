/**
 * e2eFields.ts — E2E 加密字段清单（从 composables/domain/useE2E.ts 抽取）
 *
 * 纯常量 / 类型，无运行时副作用，便于 syncPush / crypto 复用与单测不变量校验
 * （TECH_DEBT A 类：加解密纯定义 vs 状态编排分离）。
 */
import type { EntityType } from '../types.js'

// ── 需要加密的字段 ──
// E2E 启用时由全局 CryptoKey 加密的字段。
// 加密范围已收窄：title/url/notes/分组名/分类名/属性名 改存云端明文，
// 仅 username（真凭证字段）留密文。这样锁定态（无 key）也能同步只改了
// title/url/notes 的书签——push 走明文覆盖、pull 走 LEGACY_DECRYPT_FIELDS
// 还原旧密文，几轮同步后云端自然全量明文化。
// password 不在此列：它有独立加密路径——useBookmark.saveBm 在 E2E 解锁时用
// e2eStore.cryptoKey（unlock 一次性派生的 global cryptoKey）调 crypto.encrypt 输出
// salt.iv.data 三段串，再拆回 EncryptedPassword 对象存本地。其中 salt 是 encrypt 内部
// 随机生成的占位盐——展示链路 crypto.decryptPasswordWithKey 解密只用 iv + data +
// 同一把 global cryptoKey，不依赖 salt、也不重新派生（与加密侧同 key）。若把 password
// 放进 ENCRYPT_FIELDS（即用全局 key 经 encryptItem 重新加密成三段串再存云端）：
//   - 对 EncryptedPassword 对象：encryptItem 因 typeof !== 'string' 跳过（碰巧无害）
//   - 对历史 string 密码：encryptItem 会用全局 key 加密成三段串存云端，回程被
//     _parseRemotePassword 还原成 EncryptedPassword 对象，但该对象的 data 是用
//     全局 key 加密的，autoMigratePassword 对象分支用「独立 salt + 主密码」派生出
//     不同的 key 解 → GCM 认证失败 → 二次损坏（autoMigratePassword 与
//     decryptPasswordWithKey 走两把不同 key，前者为迁移旧数据、后者为运行时展示）。
// 故 password 显式排除，保持它原样在云端传输（saveBm 加密态或旧 base64）。
//
// 扩展端经 AUDIT-R19+R44 方向 E：原扩展 crypto.autoDecryptPassword 对 EncryptedPassword
// 对象误用占位 salt + 主密码派生 key（即 autoMigratePassword 那条独立路径），与主项目
// global cryptoKey 不一致 → 扩展端 sidepanel 显示密码解不开（pre-existing bug，非主项目
// 数据损坏）。修复后扩展端从 user_security.master_canary 读 canaryData（含 salt + it）
// 重建同一把 global cryptoKey，经 decryptWithGlobalKey 复用 decryptPasswordWithKey 语义
// 解 EncryptedPassword 对象/三段串，与主项目展示链路一致。主项目本文件零代码改。
export const ENCRYPT_FIELDS = {
  bookmark: ['username'] as const,
  group: [] as const,
  category: [] as const,
  attribute: [] as const,
}

// ── 旧密文遗留字段（legacy 解密专用，不再加密）──
// 这些字段云端现已改存明文，但历史数据里仍是 E2E 密文。pull/Realtime 进来时
// 对它们也跑一次 decryptField：真密文（三段且 key 匹配）解回明文，明文/解不开
// 的原样返回（见 crypto.decrypt 的优雅降级）。push 侧不再加密它们，几轮同步后
// 云端密文被明文覆盖，完成单向迁移。含义上与 ENCRYPT_FIELDS 互斥。
export const LEGACY_DECRYPT_FIELDS: Record<EntityType, readonly string[]> = {
  bookmark: ['title', 'url', 'notes'] as const,
  group: ['name', 'notes'] as const,
  category: ['name'] as const,
  attribute: ['name'] as const,
}

export interface E2ECanaryMismatch {
  mismatch: boolean
  hasLocal: boolean
  hasCloud: boolean
  /** 云端 canary 带 prev_*（其他设备主动改过主密码）→ 应走跟随迁移而非多设备冲突 */
  upgraded: boolean
}
