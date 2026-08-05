/**
 * 行为契约护栏：e2eHintText 三态门控 hint 文案 + 字段开放判定
 *
 * 两消费方 BookmarkModal.vue + ChildBookmarkEditModal.vue 此前内联同形重复实现，
 * 抽纯模块后此测锁单一真相源。三态 (enabled × unlocked) 全组合：
 *   (false, false) disabled+locked   隐藏禁用 → fieldsOpen=false, hint「开启 E2E 后可存储 X」
 *   (false, true)  disabled+unlocked  E2E 未开却已解锁（理论可达：未开 E2E 时 unlocked 也通常 false，
 *                  但函数契约应独立处理——disabled 一律「开启 E2E」引导，不看 unlocked）→ fieldsOpen=false, hint「开启 E2E」
 *   (true,  false) enabled+locked    → fieldsOpen=false, hint「点击解锁后可编辑 X」（引导解锁非线性重置）
 *   (true,  true)  enabled+unlocked  → fieldsOpen=true,  hint 不展示但返回值走 else「开启 E2E」(无关)
 *
 * 安全引导价值：错配 hint 会让用户误判「不能编辑=没开 E2E」去重置主密码丢已加密数据
 *              或「不能编辑=没解锁」误判去开启 E2E 覆盖已有加密态。三态文案精准是关键。
 */
import { describe, it, expect } from 'vitest'
import { e2eFieldsOpen, e2eHintAccount, e2eHintPassword } from '../../components/modals/e2eHintText.js'

describe('e2eHintText 三态门控 hint 护栏', () => {
  describe('e2eFieldsOpen 字段开放判定', () => {
    it('disabled + locked → false（字段不开放）', () => {
      expect(e2eFieldsOpen({ enabled: false, unlocked: false })).toBe(false)
    })
    it('disabled + unlocked → false（disabled 一律不开放，无论解锁态）', () => {
      expect(e2eFieldsOpen({ enabled: false, unlocked: true })).toBe(false)
    })
    it('enabled + locked → false（已开但未解锁，账户/密码字段仍遮罩）', () => {
      expect(e2eFieldsOpen({ enabled: true, unlocked: false })).toBe(false)
    })
    it('enabled + unlocked → true（仅此唯一组合字段开放）', () => {
      expect(e2eFieldsOpen({ enabled: true, unlocked: true })).toBe(true)
    })
    it('enabled 是门控主导：unlocked=true 但 enabled=false 仍 false（核心契约：未开 E2E 不开放）', () => {
      // 防误判把 unlocked 当主导门控——unlocked 单 true 不开字段
      expect(e2eFieldsOpen({ enabled: false, unlocked: true })).toBe(false)
    })
  })

  describe('e2eHintAccount 账户文案', () => {
    it('disabled + locked → 「开启 E2E 后可存储账户」（引导去开启）', () => {
      expect(e2eHintAccount({ enabled: false, unlocked: false })).toBe('开启 E2E 后可存储账户')
    })
    it('disabled + unlocked → 「开启 E2E 后可存储账户」（不管解锁态，disabled 一律引导开启）', () => {
      expect(e2eHintAccount({ enabled: false, unlocked: true })).toBe('开启 E2E 后可存储账户')
    })
    it('enabled + locked → 「点击解锁后可编辑账户」（引导去解锁非线性重置）', () => {
      expect(e2eHintAccount({ enabled: true, unlocked: false })).toBe('点击解锁后可编辑账户')
    })
    it('enabled + unlocked → else 分支「开启 E2E」（此态 hint 不展示，文案值非用户可见）', () => {
      // 字段已开放遮罩移除，hint 不展示但函数仍返 else 值——锁真实行为
      expect(e2eHintAccount({ enabled: true, unlocked: true })).toBe('开启 E2E 后可存储账户')
    })
    it('三态穷举：仅 enabled+locked 返「点击解锁」其余全「开启 E2E」', () => {
      // 完整三态表锁全组合不漂移
      const cases: Array<[boolean, boolean, string]> = [
        [false, false, '开启 E2E 后可存储账户'],
        [false, true, '开启 E2E 后可存储账户'],
        [true, false, '点击解锁后可编辑账户'],
        [true, true, '开启 E2E 后可存储账户'],
      ]
      for (const [en, un, expected] of cases) {
        expect(e2eHintAccount({ enabled: en, unlocked: un })).toBe(expected)
      }
    })
  })

  describe('e2eHintPassword 密码文案（与 account 同形仅末词账户→密码）', () => {
    it('disabled + locked → 「开启 E2E 后可存储密码」', () => {
      expect(e2eHintPassword({ enabled: false, unlocked: false })).toBe('开启 E2E 后可存储密码')
    })
    it('disabled + unlocked → 「开启 E2E 后可存储密码」', () => {
      expect(e2eHintPassword({ enabled: false, unlocked: true })).toBe('开启 E2E 后可存储密码')
    })
    it('enabled + locked → 「点击解锁后可编辑密码」', () => {
      expect(e2eHintPassword({ enabled: true, unlocked: false })).toBe('点击解锁后可编辑密码')
    })
    it('enabled + unlocked → else「开启 E2E 后可存储密码」', () => {
      expect(e2eHintPassword({ enabled: true, unlocked: true })).toBe('开启 E2E 后可存储密码')
    })
    it('两 hint 文案末词差异直锁（防未来误统一两文案致「账户」「密码」串号）', () => {
      // enabled+locked 是 hint 实际展示态——两 hint 末词「账户」「密码」是用户可见差异
      // 串号会让用户账户区看到「点击解锁后可编辑密码」误导
      expect(e2eHintAccount({ enabled: true, unlocked: false })).toBe('点击解锁后可编辑账户')
      expect(e2eHintPassword({ enabled: true, unlocked: false })).toBe('点击解锁后可编辑密码')
    })
  })

  describe('纯函数幂等 + 边界', () => {
    it('同参多次调返值一致（纯）', () => {
      const s = { enabled: true, unlocked: false }
      const a1 = e2eHintAccount(s)
      const a2 = e2eHintAccount(s)
      expect(a1).toBe(a2)
    })
    it('enabled=false 时 unlocked 参数对 hint 无影响（disabled 一律引导开启，短路口径）', () => {
      // disabled 不看 unlocked——防误把判定改 enabled||unlocked 后 disabled 已解锁态误显「点击解锁」
      expect(e2eHintAccount({ enabled: false, unlocked: false }))
        .toBe(e2eHintAccount({ enabled: false, unlocked: true }))
    })
    it('e2eFieldsOpen 在 enabled+unlocked 全 true 时才 true，其余全 false（与 hint 反向）', () => {
      // fieldsOpen 与 hint 真实展示态反向：仅 enabled+unlocked 开放同时 hint 不展示
      const allFour = [
        { enabled: false, unlocked: false },
        { enabled: false, unlocked: true },
        { enabled: true, unlocked: false },
        { enabled: true, unlocked: true },
      ]
      expect(allFour.map(s => e2eFieldsOpen(s))).toEqual([false, false, false, true])
    })
  })
})
