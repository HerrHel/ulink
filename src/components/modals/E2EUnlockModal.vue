<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="解锁数据" :class="{ open }" @click.self="onCancel">
    <div class="modal modal-sm">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ mode === 'reset' ? '重置主密码' : '解锁数据' }}</span>
      </div>
      <div class="modal-body">
        <!-- 解锁模式 -->
        <template v-if="mode === 'unlock'">
          <div class="e2e-info">
            <p>输入主密码以解密您的数据</p>
          </div>
          <div v-if="e2e.isBiometricEnrolled.value && bioAvailable" class="form-group">
            <button class="btn btn-primary btn-block" :disabled="bioLoading" @click="onBiometricUnlock">
              <span aria-hidden="true">🔐</span> {{ bioLoading ? '验证中…' : '指纹解锁' }}
            </button>
            <div class="e2e-separator" style="display:flex;align-items:center;gap:10px;margin:12px 0;color:var(--text-muted);font-size:0.8rem">
              <span style="flex:1;height:1px;background:var(--border)"></span>
              <span>或</span>
              <span style="flex:1;height:1px;background:var(--border)"></span>
            </div>
          </div>
          <div class="form-group">
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-unlock-password" v-model="masterPw" placeholder="主密码" @keydown.enter="onUnlock" autofocus>
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div class="e2e-link" @click="enterReset">忘记主密码？使用 Recovery Key 重置</div>
        </template>

        <!-- 重置模式 -->
        <template v-else>
          <div class="e2e-info e2e-warn">
            <p>使用 Recovery Key 设置新的主密码。原主密码将被替换。</p>
            <p style="margin-top:6px">⚠️ 重设后会用新主密码派生新密钥，此前用旧主密码加密且本地无明文副本的数据将无法解密。</p>
          </div>
          <div class="form-group">
            <label class="form-label">Recovery Key</label>
            <div class="pw-input-wrap">
              <input :type="showRk ? 'text' : 'password'" class="form-input" v-model="recoveryKey" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" @keydown.enter="onReset" autocomplete="off">
              <button class="pw-toggle" @click="showRk = !showRk" v-html="showRk ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input" v-model="newPw" placeholder="输入新主密码（至少 8 位）" @keydown.enter="onReset">
              <button class="pw-toggle" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">确认新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showPw2 ? 'text' : 'password'" class="form-input" v-model="newPw2" placeholder="再次输入新主密码" @keydown.enter="onReset">
              <button class="pw-toggle" @click="showPw2 = !showPw2" v-html="showPw2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div v-else-if="newPw.length > 0 && newPw.length < 8" class="e2e-error" style="background:transparent;padding:4px 8px;font-size:0.75rem">还需 {{ 8 - newPw.length }} 位（至少 8 位）</div>
          <div class="e2e-link" @click="enterUnlock">← 返回解锁</div>
        </template>
      </div>
      <div class="modal-foot">
        <template v-if="mode === 'unlock'">
          <button class="btn btn-primary" data-testid="lv-e2e-unlock-submit" :disabled="!masterPw" @click="onUnlock">解锁</button>
          <button class="btn btn-secondary" @click="onCancel">跳过</button>
        </template>
        <template v-else>
          <button class="btn btn-primary" :disabled="!canReset || loading" @click="onReset">{{ loading ? '重置中…' : '重置主密码' }}</button>
          <button class="btn btn-secondary" @click="onCancel">取消</button>
        </template>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { I } from '../../config/icons.js'
import { useE2E } from '../../composables/domain/useE2E.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; unlocked: [] }>()

const e2e = useE2E()
const mode = ref<'unlock' | 'reset'>('unlock')
const masterPw = ref('')
const recoveryKey = ref('')
const newPw = ref('')
const newPw2 = ref('')
const showPw = ref(false)
const showPw2 = ref(false)
const showRk = ref(false)
const error = ref('')
const loading = ref(false)
const bioAvailable = ref(false)
const bioLoading = ref(false)

const canReset = computed(() =>
  recoveryKey.value.trim().length > 0 &&
  newPw.value.length >= 8 &&
  newPw.value === newPw2.value
)

watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    mode.value = 'unlock'
    masterPw.value = ''
    recoveryKey.value = ''
    newPw.value = ''
    newPw2.value = ''
    showPw.value = false
    showPw2.value = false
    showRk.value = false
    error.value = ''
    loading.value = false
    bioLoading.value = false
  } else {
    bioAvailable.value = e2e.isBiometricAvailable()
    if (e2e.isBiometricEnrolled.value && bioAvailable.value) {
      nextTick(() => onBiometricUnlock())
    }
  }
})

function enterReset() {
  mode.value = 'reset'
  error.value = ''
}

function enterUnlock() {
  mode.value = 'unlock'
  error.value = ''
}

async function onUnlock() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  const ok = await e2e.unlock(masterPw.value)
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = '主密码错误'
  }
}

async function onReset() {
  if (loading.value) return
  error.value = ''
  if (recoveryKey.value.trim().length === 0) { error.value = '请输入 Recovery Key'; return }
  if (newPw.value.length < 8) { error.value = '新主密码至少 8 位'; return }
  if (newPw.value !== newPw2.value) { error.value = '两次新主密码不一致'; return }
  loading.value = true
  const ok = await e2e.resetWithRecoveryKey(recoveryKey.value.trim(), newPw.value)
  loading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = 'Recovery Key 错误或重置失败'
  }
}

function onCancel() {
  emit('close')
}

async function onBiometricUnlock() {
  if (bioLoading.value || loading.value) return
  bioLoading.value = true
  error.value = ''
  const pw = await e2e.unlockWithBiometric()
  if (!pw) {
    bioLoading.value = false
    // 用户取消静默，不设 error；失败带提示
    return
  }
  const ok = await e2e.unlock(pw)
  bioLoading.value = false
  if (ok) {
    emit('unlocked')
    emit('close')
  } else {
    error.value = '指纹解锁失败，请手动输入主密码'
  }
}
</script>
