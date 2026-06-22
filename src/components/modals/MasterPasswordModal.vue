<template>
  <div class="modal-mask" :class="{ open: visible }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head">
        <h2>{{ mode === 'set' ? '设置主密码' : '解锁 LinkVault' }}</h2>
        <button class="modal-close" @click="onClose" title="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <template v-if="mode === 'set'">
          <p class="mp-hint">设置主密码以保护你的书签数据。密码仅存储在本地，不会上传。</p>
          <div class="form-group">
            <label class="form-label" for="mp-new">主密码</label>
            <div class="pw-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input pw-input" id="mp-new"
                     v-model="newPw" placeholder="输入主密码" @keydown.enter="onSet">
              <button class="pw-toggle" type="button" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="mp-confirm">确认密码</label>
            <input :type="showPw ? 'text' : 'password'" class="form-input" id="mp-confirm"
                   v-model="confirmPw" placeholder="再次输入" @keydown.enter="onSet">
          </div>
          <p class="mp-error" v-if="error">{{ error }}</p>
        </template>
        <template v-else>
          <p class="mp-hint">输入主密码解锁，或使用生物识别。</p>
          <div class="form-group">
            <div class="pw-wrap">
              <input :type="showPw ? 'text' : 'password'" class="form-input pw-input"
                     v-model="password" placeholder="主密码" ref="pwInput" @keydown.enter="onVerify" autofocus>
              <button class="pw-toggle" type="button" @click="showPw = !showPw" v-html="showPw ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <p class="mp-error" v-if="error">{{ error }}</p>
          <button v-if="bioAvailable && bioRegistered" class="btn btn-ghost mp-bio-btn" @click="onBiometric">
            <span v-html="I.finger"></span> 使用生物识别
          </button>
        </template>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button v-if="mode === 'set'" class="btn btn-primary" @click="onSet">设置</button>
        <button v-else class="btn btn-primary" @click="onVerify">解锁</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { I } from '../../config/icons.js'
import {
  hasMasterPassword, setMasterPassword, verifyMasterPassword,
  isWebAuthnAvailable, hasWebAuthnCredential, authenticateWebAuthn, registerWebAuthn,
} from '../../lib/master-password.js'
import { toast } from '../../lib/toast.js'

const visible = ref(false)
const mode = ref<'set' | 'verify'>('verify')
const password = ref('')
const newPw = ref('')
const confirmPw = ref('')
const showPw = ref(false)
const error = ref('')
const pwInput = ref<HTMLInputElement | null>(null)

const bioAvailable = isWebAuthnAvailable()
const bioRegistered = hasWebAuthnCredential()

let _resolve: ((ok: boolean) => void) | null = null

/**
 * 打开验证模态框，返回 Promise<boolean>
 */
function open(): Promise<boolean> {
  if (!hasMasterPassword()) {
    mode.value = 'set'
  } else {
    mode.value = 'verify'
  }
  password.value = ''
  newPw.value = ''
  confirmPw.value = ''
  error.value = ''
  showPw.value = false
  visible.value = true
  return new Promise(resolve => {
    _resolve = resolve
    if (mode.value === 'verify') nextTick(() => pwInput.value?.focus())
  })
}

function onClose() {
  visible.value = false
  if (_resolve) { _resolve(false); _resolve = null }
}

async function onSet() {
  error.value = ''
  if (newPw.value.length < 4) { error.value = '密码至少 4 个字符'; return }
  if (newPw.value !== confirmPw.value) { error.value = '两次密码不一致'; return }
  await setMasterPassword(newPw.value)
  toast('主密码已设置')
  visible.value = false
  if (_resolve) { _resolve(true); _resolve = null }
}

async function onVerify() {
  error.value = ''
  const ok = await verifyMasterPassword(password.value)
  if (!ok) { error.value = '密码错误'; return }
  visible.value = false
  if (_resolve) { _resolve(true); _resolve = null }
}

async function onBiometric() {
  error.value = ''
  const ok = await authenticateWebAuthn()
  if (!ok) { error.value = '生物识别验证失败'; return }
  visible.value = false
  if (_resolve) { _resolve(true); _resolve = null }
}

/**
 * 注册生物识别（在已验证密码后调用）
 */
async function promptRegisterBiometric(): Promise<void> {
  if (!bioAvailable || hasWebAuthnCredential()) return
  const ok = await registerWebAuthn()
  if (ok) toast('生物识别已启用')
}

watch(visible, (v) => {
  if (v && mode.value === 'verify') nextTick(() => pwInput.value?.focus())
})

defineExpose({ open, visible, promptRegisterBiometric, hasMasterPassword })
</script>
