<template>
  <div class="modal child-modal-modal" data-testid="lv-child-bm-modal" role="dialog" aria-modal="true" :aria-label="t('modal.bookmark.editChildBm')">
    <div class="modal-head">
      <h2>{{ t('modal.bookmark.editChildBm') }}</h2>
      <button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="cbmUrl">{{ t('ctx.url') }} *</label>
        <input type="text" class="form-input" id="cbmUrl" data-testid="lv-cbm-url" v-model="form.url" :placeholder="t('modal.bookmark.urlPlaceholder')">
      </div>
      <div class="form-group">
        <label class="form-label" for="cbmTitle">{{ t('modal.bookmark.siteName') }}</label>
        <input type="text" class="form-input" id="cbmTitle" data-testid="lv-cbm-title" v-model="form.title" :placeholder="t('modal.bookmark.titlePlaceholder')" ref="titleRef">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="cbmUsername">{{ t('cards.account') }}</label>
          <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintAccount" @hint-click="onE2EHintClick">
            <input type="text" class="form-input" id="cbmUsername" v-model="form.username" :placeholder="t('modal.bookmark.username')">
          </E2ELockOverlay>
        </div>
        <div class="form-group">
          <label class="form-label" for="cbmPassword">{{ t('cards.password') }}</label>
          <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintPassword" @hint-click="onE2EHintClick">
            <div class="pw-wrap">
              <input :type="form.showPassword ? 'text' : 'password'" class="form-input pw-input" id="cbmPassword" v-model="form.password" :placeholder="t('cards.password')">
              <button class="pw-toggle" type="button" :title="form.showPassword ? t('cards.hidePassword') : t('cards.showPassword')" @click="form.showPassword = !form.showPassword" v-html="form.showPassword ? I.eyeOff : I.eye"></button>
            </div>
          </E2ELockOverlay>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="cbmNotes">{{ t('modal.bookmark.notes') }}</label>
        <textarea class="form-textarea" id="cbmNotes" v-model="form.notes" :placeholder="t('modal.bookmark.notesPlaceholder')"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="cbmIcon">{{ t('modal.bookmark.customIcon') }}</label>
        <div class="icon-input-row">
          <input type="url" class="form-input" id="cbmIcon" v-model="form.icon" :placeholder="t('modal.bookmark.iconUrlPlaceholder')">
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" @click="onClose">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" data-testid="lv-cbm-save" :disabled="saving" @click="onSave">{{ t('modal.bookmark.update') }}</button>
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
import { fixUrl, domain, displayText } from '../../utils.js'
import { safeDecodePassword, encrypt, decrypt, isThreePartCipher } from '../../crypto.js'
import type { EncryptedPassword } from '../../types.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { toast } from '../../lib/toast.js'
import E2ELockOverlay from '../ui/E2ELockOverlay.vue'
import { e2eFieldsOpen as e2eFieldsOpenLogic, e2eHintAccount as e2eHintAccountLogic, e2eHintPassword as e2eHintPasswordLogic } from './e2eHintText.js'
import { t } from '../../i18n/index.js'

const props = defineProps<{ childId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// 代际 token：防 childId 切换竞态致跨书签明文密码视觉泄漏。
// loadFromStore 内 await pendingUnlock 等用户解锁（秒级手动窗口）期间，用户可能在
// BookmarkModal 主窗口点另一子书签的 edit（onEditChild 改 childModalId 时 v-if 已真不
// re-mount，只触发 watch childId 跑新 loadFromStore）。旧 await 在 App.vue:151 全 resolve
// 队列解锁后仍按旧 bm = A 解密写入 form.password——此时 form 已属 childId B，A 的明文密码
// 显示在 B 的密码框（视觉泄漏，同 chunk3 bdPwShow 模式）；若进而保存则 B.password 被 A 加密覆盖
// （数据损坏）。代际 token 对齐 HistoryPanel _gen / bdPwShow _detailGen 模式：每次新
// loadFromStore 自增 gen 使旧 await 的写入短路。e2e.ts:19-22 B-2 注释证明多 await 可同挂
// pendingUnlock，此处缺失 guard 是可证明的不一致。
let _loadGen = 0

const ds = useDataStore()
const e2eStore = useE2EStore()
const ui = useUIStore()
const e2e = useE2E()
const titleRef = ref<HTMLInputElement | null>(null)
const saving = ref(false)

const e2eFieldsOpen = computed(() => e2eFieldsOpenLogic({ enabled: e2e.isE2EEnabled.value, unlocked: e2e.isUnlocked.value }))
const e2eHintAccount = computed(() => e2eHintAccountLogic({ enabled: e2e.isE2EEnabled.value, unlocked: e2e.isUnlocked.value }))
const e2eHintPassword = computed(() => e2eHintPasswordLogic({ enabled: e2e.isE2EEnabled.value, unlocked: e2e.isUnlocked.value }))
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
  // 取代际 token：本次调用闭包锁定 localGen，await 后写入 form 前若 _loadGen 已前进（被
  // 切 childId 触发的新 loadFromStore 或解锁 flush 超前）则短路 return，避免把旧 childId
  // 的明文密码写入已属于新 childId 的表单。
  const localGen = ++_loadGen
  const bm = ds.bookmarkMap[props.childId]
  if (!bm) { emit('close'); return }
  // E2E 密文（未解锁/解不开）不进表单：displayText 过滤为空，保存时 doSave 的密文检测阻止覆盖
  form.url = displayText(bm.url)
  form.title = displayText(bm.title)
  form.username = displayText(bm.username)
  form.notes = displayText(bm.notes)
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
        if (localGen !== _loadGen) return // await 后 gen 失效则不写错表单
      } catch { if (localGen !== _loadGen) return; form.password = '' }
    } else if (e2eStore.isE2EEnabled) {
      // 按需解锁
      const unlocked = await new Promise<boolean>(resolve => {
        e2eStore.pendingUnlock.push(resolve)
      })
      // 解锁秒级手动窗口期间 user 可能已切 childId 触发新 loadFromStore → _loadGen 前进 → 短路
      if (localGen !== _loadGen) return
      if (unlocked && e2eStore.cryptoKey) {
        try {
          const ep = pw as EncryptedPassword
          const raw = ep.salt + '.' + ep.iv + '.' + ep.data
          form.password = await decrypt(raw, e2eStore.cryptoKey as CryptoKey)
          if (localGen !== _loadGen) return // 二次 await 后再判一次 gen
        } catch { if (localGen !== _loadGen) return; form.password = '' }
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
  if (!url) { toast(t('modal.childBm.needUrl'), false); return }
  const title = form.title.trim() || domain(url)

  // 密码处理（与 saveBm 一致）
  let storedPassword: string | EncryptedPassword = ''
  if (form.password) {
    if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
      try {
        const raw = await encrypt(form.password, e2eStore.cryptoKey as CryptoKey)
        const parts = raw.split('.')
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
          toast(t('modal.childBm.encryptFail'), false)
          return
        }
        storedPassword = { encrypted: true, salt: parts[0], iv: parts[1], data: parts[2] }
      } catch {
        toast(t('modal.childBm.encryptFailHint'), false)
        return
      }
    } else if (e2eStore.isE2EEnabled) {
      // 按需解锁后重试保存
      const unlocked = await new Promise<boolean>(resolve => {
        e2eStore.pendingUnlock.push(resolve)
      })
      if (!unlocked) { toast(t('modal.childBm.saveCancelled'), false); return }
      return await doSave()
    } else {
      storedPassword = btoa(form.password)
    }
  }

  // E2E 密文保护：原书签含加密字段（未解锁/解不开保留的密文）时禁止保存——否则空表单
  // 会覆盖原密文并经 saveAppData/push 回写云端丢失。须先解锁（decryptStoreItems 解回明文）。
  const orig = ds.bookmarkMap[props.childId]
  if (orig && [orig.url, orig.title, orig.notes, orig.username].some(f => typeof f === 'string' && f && isThreePartCipher(f))) {
    toast(t('modal.childBm.encryptedBlocked'), false)
    return
  }

  ds.updateBookmark(props.childId, {
    title, url,
    username: form.username.trim(),
    password: storedPassword,
    notes: form.notes.trim(),
    icon: form.icon.trim(),
  })
  saveAppData()
  toast(t('modal.childBm.updated'))
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