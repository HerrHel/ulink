import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import AppHeader from '../../components/shell/AppHeader.vue'

describe('AppHeader 未登录入口：只在导航收成抽屉时出现', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('桌面端不重复给入口（左下角账户卡已承担）', async () => {
    const ui = useUIStore()
    ui.setMobile(false)
    const w = mount(AppHeader)
    await nextTick()
    expect(w.find('[data-testid="header-login-btn"]').exists()).toBe(false)
    w.unmount()
  })

  it('移动端导航收进抽屉，顶栏给出入口', async () => {
    const ui = useUIStore()
    ui.setMobile(true)
    const w = mount(AppHeader)
    await nextTick()
    expect(w.find('[data-testid="header-login-btn"]').exists()).toBe(true)
    w.unmount()
  })
})
