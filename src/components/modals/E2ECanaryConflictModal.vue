<template>
  <div class="modal-mask" data-testid="lv-e2e-canary-conflict-modal" role="dialog" aria-modal="true" aria-label="多设备主密码处理" :class="{ open }" @click.self="close">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.alert" class="sp-icon"></span> {{ isUpgraded ? '主密码已在其他设备修改' : '多设备主密码不一致' }}</span>
        <button class="modal-close" @click="close" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body">
        <!-- 升级模式：其他设备主动改过主密码 → 跟随迁移（同步修改） -->
        <template v-if="isUpgraded">
          <div class="e2e-info e2e-warn">
            <p><strong>检测到其他设备已修改主密码。</strong></p>
            <p>为保持多设备互通，本机需同步迁移到新主密码。输入本机当前主密码与新主密码，本机数据将自动用新密钥重加密（与其他设备完全一致，<strong>不丢失数据</strong>）。</p>
          </div>
          <div class="form-group">
            <label class="form-label">本机当前主密码</label>
            <div class="pw-input-wrap">
              <input :type="showOld ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-follow-old" v-model="oldPw" placeholder="旧主密码" @keydown.enter="onFollow">
              <button class="pw-toggle" @click="showOld = !showOld" v-html="showOld ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showNew ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-follow-new" v-model="newPw" placeholder="新主密码（至少 8 位）" @keydown.enter="onFollow">
              <button class="pw-toggle" @click="showNew = !showNew" v-html="showNew ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">确认新主密码</label>
            <div class="pw-input-wrap">
              <input :type="showNew2 ? 'text' : 'password'" class="form-input" data-testid="lv-e2e-follow-new2" v-model="newPw2" placeholder="再次输入新主密码" @keydown.enter="onFollow">
              <button class="pw-toggle" @click="showNew2 = !showNew2" v-html="showNew2 ? I.eyeOff : I.eye"></button>
            </div>
          </div>
          <div v-if="error" class="e2e-error">{{ error }}</div>
          <div style="margin-top:8px">
            <button class="btn btn-primary" data-testid="lv-e2e-follow-confirm" :disabled="loading" @click="onFollow">{{ loading ? '迁移中…' : '同步并迁移' }}</button>
            <button class="btn btn-secondary" :disabled="loading" @click="close">取消</button>
          </div>
        </template>

        <!-- 冲突模式：各设各的主密码 → 统一 / 保留 -->
        <template v-else>
          <div class="e2e-info e2e-warn">
            <p><strong>该账号已在其他设备设置主密码，与本机主密码不同。</strong></p>
            <p>两端用不同密钥加密，云端同步的加密内容（用户名、备注、密码）在对方设备上都无法读取；且任一端在登录状态下修改主密码，会覆盖云端主密码，另一端设备一旦本地记录丢失即永久锁定。</p>
          </div>

          <div class="e2e-info" style="margin-top:12px">
            <p><strong>解决办法 ① 统一主密码（推荐，恢复多设备互通）</strong></p>
            <p>切换到云端主密码，之后所有设备使用同一主密码，加密数据互通。切换后需用其他设备的<strong>原主密码</strong>解锁本机。</p>
            <p style="color:var(--danger);font-size:0.8rem;margin-bottom:8px">注意：切换后，本机此前用本机主密码加密的数据将不可逆失效（显示为空）。若本机存有重要数据，请先导出备份。</p>
            <button class="btn btn-primary" data-testid="lv-e2e-conflict-adopt" :disabled="busy" @click="onAdopt">{{ busy ? '切换中…' : '统一到云端主密码' }}</button>
          </div>

          <div class="e2e-info" style="margin-top:12px">
            <p><strong>解决办法 ② 保留本机主密码</strong></p>
            <p>本机继续用当前主密码。加密字段（用户名、备注等）不再与云端互通，仅普通字段正常同步。</p>
            <p style="color:var(--danger);font-size:0.8rem;margin-bottom:8px">请勿在本机「修改主密码」或「重置」，否则会覆盖云端主密码，导致其他设备无法解锁。</p>
            <button class="btn btn-secondary" data-testid="lv-e2e-conflict-keep" @click="close">保留本机主密码</button>
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
  if (!oldPw.value) { error.value = '请输入本机当前主密码'; return }
  if (newPw.value.length < 8) { error.value = '新主密码至少 8 位'; return }
  if (newPw.value !== newPw2.value) { error.value = '两次新主密码不一致'; return }
  loading.value = true
  error.value = ''
  try {
    const ok = await e2e.followMasterPasswordChange(oldPw.value, newPw.value)
    if (!ok) { error.value = '迁移失败：请确认旧主密码正确，且云端主密码记录仍有效'; return }
    // 迁移后本机 canary 已切到云端新值，用新主密码完成解锁（key 已在内存，此处确认解锁态 + 补解密 store）
    await e2e.unlock(newPw.value)
    emit('close')
    toast('本机已同步到新主密码，多设备加密数据互通', true)
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
    if (!ok) { toast('切换失败，请检查网络后重试', false); return }
    emit('close')
    // 切换后本机已是锁定态（unlock 引导弹出），用原主密码解锁后与云端统一
    ui.e2eUnlockInitialMode = 'unlock'
    ui.modals.e2eUnlock = true
    toast('已切换至云端主密码，请用原主密码解锁', true)
  } finally {
    busy.value = false
  }
}
</script>
