<template>
  <div class="modal-mask" data-testid="lv-e2e-canary-conflict-modal" role="dialog" aria-modal="true" :aria-label="t('e2e.canaryAriaLabel')" :class="{ open }" @click.self="close">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.alert" class="sp-icon"></span> {{ isUpgraded ? t('e2e.followTitle') : t('e2e.conflictTitle') }}</span>
        <button class="modal-close" @click="close" :aria-label="t('common.close')">&times;</button>
      </div>
      <div class="modal-body">
        <!-- 升级模式：其他设备主动改过主密码 → 跟随迁移（同步修改） -->
        <template v-if="isUpgraded">
          <div class="e2e-info e2e-warn">
            <p><strong>{{ t('e2e.followDetected') }}</strong></p>
            <p v-html="t('e2e.followBody')"></p>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('e2e.currentDeviceMasterPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showOld ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-follow-old" v-model="oldPw" :placeholder="t('e2e.oldMasterPwPlaceholder')" @keydown.enter="onFollow">
              <button class="pw-toggle" @click="showOld = !showOld" v-html="showOld ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('e2e.newMasterPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showNew ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-follow-new" v-model="newPw" :placeholder="t('e2e.newMasterPwShortPlaceholder')" @keydown.enter="onFollow">
              <button class="pw-toggle" @click="showNew = !showNew" v-html="showNew ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">{{ t('e2e.confirmNewPwLabel') }}</label>
            <div class="pw-input-wrap">
              <input :type="showNew2 ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-follow-new2" v-model="newPw2" :placeholder="t('e2e.confirmNewPwPlaceholder')" @keydown.enter="onFollow">
              <button class="pw-toggle" @click="showNew2 = !showNew2" v-html="showNew2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div style="margin-top:8px">
            <button class="btn btn-primary" data-testid="lv-e2e-follow-confirm" :disabled="loading" @click="onFollow">{{ loading ? t('e2e.migrating') : t('e2e.followAndMigrate') }}</button>
            <button class="btn btn-secondary" :disabled="loading" @click="close">{{ t('common.cancel') }}</button>
          </div>
        </template>

        <!-- 冲突模式：各设各的主密码 → 统一 / 保留 -->
        <template v-else>
          <div class="e2e-info e2e-warn">
            <p><strong>{{ t('e2e.conflictDetected') }}</strong></p>
            <p>{{ t('e2e.conflictBody') }}</p>
          </div>

          <div class="e2e-info" style="margin-top:12px">
            <p><strong>{{ t('e2e.solution1Title') }}</strong></p>
            <p v-html="t('e2e.solution1Body')"></p>
            <p style="color:var(--danger);font-size:0.8rem;margin-bottom:8px">{{ t('e2e.solution1Warn') }}</p>
            <button class="btn btn-primary" data-testid="lv-e2e-conflict-adopt" :disabled="busy" @click="onAdopt">{{ busy ? t('e2e.switching') : t('e2e.unifyToCloudPw') }}</button>
          </div>

          <div class="e2e-info" style="margin-top:12px">
            <p><strong>{{ t('e2e.solution2Title') }}</strong></p>
            <p>{{ t('e2e.solution2Body') }}</p>
            <p style="color:var(--danger);font-size:0.8rem;margin-bottom:8px">{{ t('e2e.solution2Warn') }}</p>
            <button class="btn btn-secondary" data-testid="lv-e2e-conflict-keep" @click="close">{{ t('e2e.keepLocalMasterPw') }}</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { useUIStore } from '../../stores/ui.js'
import { toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const e2e = useE2E()
const ui = useUIStore()
// 升级模式（其他设备改过主密码 → 跟随迁移） vs 冲突模式（各设各的 → 统一/保留）
const isUpgraded = computed(() => ui.modals.e2eCanaryConflictUpgraded)
const busy = ref(false)
const oldPw = ref('')
const newPw = ref('')
const newPw2 = ref('')
const showOld = ref(false)
const showNew = ref(false)
const showNew2 = ref(false)
const error = ref('')
const loading = ref(false)

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    busy.value = false
    oldPw.value = ''
    newPw.value = ''
    newPw2.value = ''
    showOld.value = false
    showNew.value = false
    showNew2.value = false
    error.value = ''
    loading.value = false
  }
})

function close() { emit('close') }

/** 升级模式：跟随其他设备的主密码修改（同步迁移本机数据到同一把新 key） */
async function onFollow() {
  if (loading.value) return
  if (!oldPw.value) { error.value = t('e2e.enterCurrentDevicePw'); return }
  if (newPw.value.length < 8) { error.value = t('e2e.newMasterPwTooShort'); return }
  if (newPw.value !== newPw2.value) { error.value = t('e2e.newPwMismatch'); return }
  loading.value = true
  error.value = ''
  try {
    const ok = await e2e.followMasterPasswordChange(oldPw.value, newPw.value)
    if (!ok) { error.value = t('e2e.followFailed'); return }
    // 迁移后本机 canary 已切到云端新值，用新主密码完成解锁（key 已在内存，此处确认解锁态 + 补解密 store）
    await e2e.unlock(newPw.value)
    emit('close')
    toast(t('e2e.followedToast'), true)
  } finally {
    loading.value = false
  }
}

/** 冲突模式 ①：切到云端 canary，引导输入其他设备的原主密码解锁 */
async function onAdopt() {
  if (busy.value) return
  busy.value = true
  try {
    const ok = await e2e.adoptCloudCanary()
    if (!ok) { toast(t('e2e.adoptFailed'), false); return }
    emit('close')
    // 切换后本机已是锁定态（unlock 引导弹出），用原主密码解锁后与云端统一
    ui.e2eUnlockInitialMode = 'unlock'
    ui.modals.e2eUnlock = true
    toast(t('e2e.adoptedToast'), true)
  } finally {
    busy.value = false
  }
}
</script>
