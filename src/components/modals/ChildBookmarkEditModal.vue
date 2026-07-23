<template>
  <div class="modal child-modal-modal" data-testid="lv-child-bm-modal" role="dialog" aria-modal="true" aria-label="编辑子书签">
    <div class="modal-head">
      <h2>编辑子书签</h2>
      <button class="modal-close" @click="onClose" title="关闭" aria-label="关闭" v-html="I.close"></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="cbmUrl">网址 *</label>
        <input type="text" class="form-input" id="cbmUrl" data-testid="lv-cbm-url" v-model="form.url" placeholder="例如：github.com">
      </div>
      <div class="form-group">
        <label class="form-label" for="cbmTitle">网站名称</label>
        <input type="text" class="form-input" id="cbmTitle" data-testid="lv-cbm-title" v-model="form.title" placeholder="留空将自动识别" ref="titleRef">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="cbmUsername">账户</label>
          <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintAccount" @hint-click="onE2EHintClick">
            <input type="text" class="form-input" id="cbmUsername" v-model="form.username" placeholder="用户名">
          </E2ELockOverlay>
        </div>
        <div class="form-group">
          <label class="form-label" for="cbmPassword">密码</label>
          <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintPassword" @hint-click="onE2EHintClick">
            <div class="pw-wrap">
              <input :type="form.showPassword ? 'text' : 'password'" class="form-input pw-input" id="cbmPassword" v-model="form.password" placeholder="密码">
              <button class="pw-toggle" type="button" :title="form.showPassword ? '隐藏密码' : '显示密码'" @click="form.showPassword = !form.showPassword" v-html="form.showPassword ? I.eyeOff : I.eye"></button>
            </div>
          </E2ELockOverlay>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="cbmNotes">备注</label>
        <textarea class="form-textarea" id="cbmNotes" v-model="form.notes" placeholder="备注…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="cbmIcon">自定义图标</label>
        <div class="icon-input-row">
          <input type="url" class="form-input" id="cbmIcon" v-model="form.icon" placeholder="https://… 输入图标URL">
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" @click="onClose">取消</button>
      <button class="btn btn-primary" data-testid="lv-cbm-save" :disabled="saving" @click="onSave">更新</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, nextTick } from 'vue'
import { I } from '../../config/icons.js'
import { useDataStore } from '../../stores/data.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData } from '../../stores/app.js'
import { fixUrl, domain } from '../../utils.js'
import { safeDecodePassword, encrypt, decrypt } from '../../crypto.js'
import type { EncryptedPassword } from '../../types.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { toast } from '../../lib/toast.js'
import E2ELockOverlay from '../ui/E2ELockOverlay.vue'

const props = defineProps<{ childId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const ds = useDataStore()
const e2eStore = useE2EStore()
const ui = useUIStore()
const e2e = useE2E()
const titleRef = ref<HTMLInputElement | null>(null)
const saving = ref(false)

const e2eFieldsOpen = computed(() => e2e.isE2EEnabled.value && e2e.isUnlocked.value)
const e2eHintAccount = computed(() =>
  e2e.isE2EEnabled.value && !e2e.isUnlocked.value
    ? '点击解锁后可编辑账户'
    : '开启 E2E 后可存储账户',
)
const e2eHintPassword = computed(() =>
  e2e.isE2EEnabled.value && !e2e.isUnlocked.value
    ? '点击解锁后可编辑密码'
    : '开启 E2E 后可存储密码',
)
function onE2EHintClick() {
  if (e2e.isE2EEnabled.value && !e2e.isUnlocked.value) {
    ui.modals.e2eUnlock = true
  } else if (!e2e.isE2EEnabled.value) {
    ui.modals.e2eSetup = true
  }
}

interface ChildFormState {
  url: string
  title: string
  username: string
  password: string
  notes: string
  icon: string
  showPassword: boolean
}
const form = reactive<ChildFormState>({
  url: '', title: '', username: '', password: '', notes: '', icon: '', showPassword: false,
})

// 打开时从 store 加载子书签（含 E2E 解密）
async function loadFromStore() {
  const bm = ds.bookmarkMap[props.childId]
  if (!bm) { emit('close'); return }
  form.url = bm.url || ''
  form.title = bm.title || ''
  form.username = bm.username || ''
  form.notes = bm.notes || ''
  form.icon = bm.icon || ''
  form.showPassword = false
  // 密码解密（与 saveBm 同流程）
  const pw = bm.password
  if (pw && typeof pw === 'object' && (pw as EncryptedPassword).encrypted) {
    if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
      try {
        const ep = pw as EncryptedPassword
        const raw = ep.salt + '.' + ep.iv + '.' + ep.data
        form.password = await decrypt(raw, e2eStore.cryptoKey as CryptoKey)
      } catch { form.password = '' }
    } else if (e2eStore.isE2EEnabled) {
      // 按需解锁
      const unlocked = await new Promise<boolean>(resolve => {
        e2eStore.pendingUnlock.push(resolve)
      })
      if (unlocked && e2eStore.cryptoKey) {
        try {
          const ep = pw as EncryptedPassword
          const raw = ep.salt + '.' + ep.iv + '.' + ep.data
          form.password = await decrypt(raw, e2eStore.cryptoKey as CryptoKey)
        } catch { form.password = '' }
      } else { form.password = '' }
    } else { form.password = '' }
  } else {
    form.password = safeDecodePassword(bm.password as string || '')
  }
}

function onClose() {
  form.password = ''
  emit('close')
}

async function onSave() {
  if (saving.value) return
  saving.value = true
  try {
    await doSave()
  } finally {
    saving.value = false
  }
}

async function doSave(): Promise<void> {
  const url = fixUrl(form.url)
  if (!url) { toast('请填写网址', false); return }
  const title = form.title.trim() || domain(url)

  // 密码处理（与 saveBm 一致）
  let storedPassword: string | EncryptedPassword = ''
  if (form.password) {
    if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
      try {
        const raw = await encrypt(form.password, e2eStore.cryptoKey as CryptoKey)
        const parts = raw.split('.')
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
          toast('密码加密失败：输出格式异常，已取消保存', false)
          return
        }
        storedPassword = { encrypted: true, salt: parts[0], iv: parts[1], data: parts[2] }
      } catch {
        toast('密码加密失败，请重试或稍后解锁 E2E 后再保存', false)
        return
      }
    } else if (e2eStore.isE2EEnabled) {
      // 按需解锁后重试保存
      const unlocked = await new Promise<boolean>(resolve => {
        e2eStore.pendingUnlock.push(resolve)
      })
      if (!unlocked) { toast('保存已取消', false); return }
      return await doSave()
    } else {
      storedPassword = btoa(form.password)
    }
  }

  ds.updateBookmark(props.childId, {
    title, url,
    username: form.username.trim(),
    password: storedPassword,
    notes: form.notes.trim(),
    icon: form.icon.trim(),
  })
  saveAppData()
  toast('子书签已更新')
  form.password = ''
  emit('close')
}

watch(() => props.childId, () => { loadFromStore() }, { immediate: true })
watch(() => e2eStore.isUnlocked, async (unlocked) => {
  // 解锁后若密码尚未解密成功，重新加载
  if (unlocked) await loadFromStore()
})

nextTick(() => titleRef.value?.focus())
</script>