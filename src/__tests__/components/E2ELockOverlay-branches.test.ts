/**
 * E2ELockOverlay-branches.test.ts — E2ELockOverlay.vue 端到端加密锁遮罩组件补测
 *
 * 锁 0% 起步全部 6 语句：① disabled=true 渲染 hint 块（v-if 分支）含图标 + 默认提示语
 *   ② disabled=true 自定义 hint 显示用户文案 ③ disabled=false 渲染 slot（v-else 分支）
 *   ④ hintClickable=true 联动 .clickable class（withDefaults 默认）⑤ hintClickable=false
 *   不加 .clickable class ⑥ onHintActivate 禁用态点击 emit 'hint-click' + keydown.enter/space
 *   触发同 emit ⑦ onHintActivate 非禁用态早退不 emit（守门 line 35 if(!disabled) return）
 *
 * 纯展示组件无 store 依赖，仅 props+emit，@vue/test-utils mount 直测。
 * 模板 v-html=I.password 注入 SVG 图标（icons.js getImg），不依赖真实 store。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import E2ELockOverlay from '../../components/ui/E2ELockOverlay.vue'

describe('E2ELockOverlay component branches', () => {
  it('disabled=true 渲染 hint 块含默认提示语与图标（v-if 分支）', () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true } })
    expect(w.find('.e2e-lock-hint').exists()).toBe(true)
    // 默认文案「开启端到端加密后才可使用此功能」
    expect(w.find('.e2e-lock-hint').text()).toContain('开启端到端加密后才可使用此功能')
    // 含图标 span（v-html 注入 SVG）
    expect(w.find('.e2e-lock-icon').exists()).toBe(true)
  })

  it('disabled=true 自定义 hint 显示用户文案', () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true, hint: '请先开启加密' } })
    expect(w.find('.e2e-lock-hint').text()).toContain('请先开启加密')
  })

  it('disabled=false 渲染 slot 内容不渲染 hint（v-else 分支）', () => {
    const w = mount(E2ELockOverlay, {
      props: { disabled: false },
      slots: { default: '<div data-test="slot-content">功能可用</div>' },
    })
    expect(w.find('.e2e-lock-hint').exists()).toBe(false)
    expect(w.find('[data-test="slot-content"]').exists()).toBe(true)
  })

  it('hintClickable 默认 true 联动 .clickable class（withDefaults 默认值）', () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true } })
    expect(w.find('.e2e-lock-hint.clickable').exists()).toBe(true)
  })

  it('hintClickable=false 不加 .clickable class', () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true, hintClickable: false } })
    expect(w.find('.e2e-lock-hint.clickable').exists()).toBe(false)
    // 该 hint 块仍存在（仅无 clickable 修饰）
    expect(w.find('.e2e-lock-hint').exists()).toBe(true)
  })

  it('disabled 态点击 hint 块 emit hint-click', async () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true } })
    // role=button 块的 @click 触发 onHintActivate
    await w.find('.e2e-lock-hint').trigger('click')
    expect(w.emitted('hint-click')).toBeTruthy()
    expect(w.emitted('hint-click')!.length).toBe(1)
  })

  it('disabled 态 keydown.enter 触发 onHintActivate emit hint-click', async () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true } })
    await w.find('.e2e-lock-hint').trigger('keydown.enter')
    expect(w.emitted('hint-click')).toBeTruthy()
  })

  it('disabled 态 keydown.space 触发 onHintActivate emit hint-click', async () => {
    const w = mount(E2ELockOverlay, { props: { disabled: true } })
    await w.find('.e2e-lock-hint').trigger('keydown.space')
    expect(w.emitted('hint-click')).toBeTruthy()
  })

  it('onHintActivate 非禁用态早退不 emit（line 35 if(!disabled) return 守门）', async () => {
    // disabled=false 时模板走 v-else slot 分支不渲染 hint 块，@click 不绑；line 35 `if(!disabled)
    // return` 守门分支经模板不可触达。经 `w.vm.$.setupState` 直接调 setup 顶层 onHintActivate
    // 覆盖该 return 分支：disabled=false 时不 emit。
    const w = mount(E2ELockOverlay, {
      props: { disabled: false },
      slots: { default: '<div>功能</div>' },
    })
    const fn = (w.vm as any).$.setupState.onHintActivate as ((p?: unknown) => void) | undefined
    expect(typeof fn).toBe('function')
    fn && fn()
    expect(w.emitted('hint-click')).toBeFalsy()  // 守门 return 未 emit
  })

  it('onHintActivate 禁用态守门 false 分支每点击只 emit 一次（line 36 emit 一次/调）', async () => {
    // 覆盖 onHintActivate false 分支（disabled=true 不 return 直接 emit）的「每调一次 emit 一次」契约：
    // 连续点击 3 次应 emit 3 次证纯转发非节流/去抖。
    const w = mount(E2ELockOverlay, { props: { disabled: true } })
    await w.find('.e2e-lock-hint').trigger('click')
    await w.find('.e2e-lock-hint').trigger('click')
    await w.find('.e2e-lock-hint').trigger('click')
    expect(w.emitted('hint-click')!.length).toBe(3)
  })
})
