<template>
  <div class="modal-mask" data-testid="lv-bm-modal" role="dialog" aria-modal="true" aria-label="书签编辑" :class="{ open: bmForm.isOpen }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head">
        <h2>{{ bmForm.isEdit ? '编辑书签' : bmForm.addToGroupMode ? '新建书签并添加到组' : bmForm.parentId ? '添加子书签' : '添加书签' }}</h2>
        <button class="modal-close" @click="onClose" title="关闭" aria-label="关闭" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" for="bmUrl">网址 *</label>
          <input type="text" class="form-input" id="bmUrl" data-testid="lv-bm-url" v-model="bmForm.url" placeholder="例如：github.com" @input="onUrlInput" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="bmTitle">网站名称</label>
          <input type="text" class="form-input" id="bmTitle" data-testid="lv-bm-title" v-model="bmForm.title" placeholder="留空将自动识别" ref="titleRef">
        </div>
        <div v-if="aiSuggestionText" class="ai-suggest-bar">
          <span class="ai-suggest-icon">✨</span>
          <span class="ai-suggest-text">{{ aiSuggestionText }}</span>
          <button class="btn btn-xs btn-primary" @click="onApplyAi">采纳</button>
          <button class="btn btn-xs btn-ghost" @click="onDismissAi">忽略</button>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmUsername">账户</label>
            <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintAccount" @hint-click="onE2EHintClick">
              <input type="text" class="form-input" id="bmUsername" v-model="bmForm.username" placeholder="用户名">
            </E2ELockOverlay>
          </div>
          <div class="form-group">
            <label class="form-label" for="bmPassword">密码</label>
            <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintPassword" @hint-click="onE2EHintClick">
              <div class="pw-wrap">
                <input :type="bmForm.showPassword ? 'text' : 'password'" class="form-input pw-input" id="bmPassword" v-model="bmForm.password" placeholder="密码">
                <button class="pw-toggle" type="button" :title="bmForm.showPassword ? '隐藏密码' : '显示密码'" @click="bmForm.showPassword = !bmForm.showPassword" v-html="bmForm.showPassword ? I.eyeOff : I.eye"></button>
              </div>
            </E2ELockOverlay>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmNotes">备注</label>
          <textarea class="form-textarea" id="bmNotes" v-model="bmForm.notes" placeholder="备注…"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmIcon">自定义图标</label>
          <div class="icon-input-row">
            <input type="url" class="form-input" id="bmIcon" v-model="bmForm.icon" placeholder="https://… 输入图标URL" @input="onPreviewIconUrl">
            <div class="icon-thumbs" v-show="bmForm.logoPreviewVisible || bmForm.iconPreviewVisible">
              <img v-if="bmForm.logoPreviewVisible" :src="bmForm.logoPreviewUrl" class="icon-thumb" :class="{ active: bmForm.icon === bmForm.logoPreviewUrl }" @click="useFaviconAsIcon" title="点击使用网站图标">
              <img v-if="bmForm.iconPreviewVisible && bmForm.iconPreviewUrl !== bmForm.logoPreviewUrl" :src="bmForm.iconPreviewUrl" class="icon-thumb active" title="当前自定义图标">
            </div>
          </div>
          <button class="btn btn-ghost btn-sm mt-1" v-show="bmForm.clearIconVisible" @click="onClearIcon">清除图标</button>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmCategoryId">分类</label>
            <select class="form-select" id="bmCategoryId" v-model="bmForm.categoryId">
              <option value="">未分类</option>
              <option v-for="cat in categoryOptions" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="bmParentId">父级（子网站）</label>
            <select class="form-select" id="bmParentId" v-model="bmForm.parentId">
              <option :value="null">无</option>
              <option v-for="b in parentOptions" :key="b.id" :value="b.id">{{ b.title }}</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">属性标记</label>
          <div class="check-group">
            <label v-for="attr in selectableAttrs" :key="attr.id" class="check-chip" :class="{ 'ai-highlight': bmForm.aiSuggestAttrIds.includes(attr.id) }">
              <input type="checkbox" :checked="bmForm.attributes[attr.id]"
                     @change="toggleAttr(attr.id, $event)">
              {{ attr.name }}
            </label>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="onClose">取消</button>
        <button class="btn btn-primary" data-testid="lv-bm-save" :disabled="saving" @click="onSave">{{ bmForm.isEdit ? '更新' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { bmForm, closeBmModal, saveBm, isBmSaving, previewIconUrl, clearIcon, autoFetchFromUrl, applyAiCategory, applyAiAttributes, dismissAiSuggestions } from '../../composables/domain/useBookmark.js'
import { I } from '../../config/icons.js'
import { ATTR_IS_GROUP } from '../../config/constants.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import E2ELockOverlay from '../ui/E2ELockOverlay.vue'

const store = useAppStore()
const titleRef = ref<HTMLInputElement | null>(null)
const e2e = useE2E()
// A6-004：仅「已启用且已解锁」才开放字段；hint 区分 setup / unlock
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
    store.modals.e2eUnlock = true
  } else if (!e2e.isE2EEnabled.value) {
    store.modals.e2eSetup = true
  }
}
// A2-004：按钮禁用；isBmSaving 非响应式，用本地 saving 包一层
const saving = ref(false)

const categoryOptions = computed(() => store.selectableCategories)
// A2-007：不展示软删属性
const selectableAttrs = computed(() =>
  (store.selectableAttributes || store.customAttributes.filter(a => !a.deletedAt))
    .filter(a => a.id !== ATTR_IS_GROUP)
)
const parentOptions = computed(() =>
  store.bookmarks.filter(b => !b.parentId && b.id !== bmForm.id)
)

const aiSuggestionText = computed(() => {
  const parts: string[] = []
  if (bmForm.aiSuggestCatId) {
    const cat = store.categoryMap[bmForm.aiSuggestCatId]
    if (cat) parts.push(`建议分类「${cat.name}」`)
  }
  if (bmForm.aiSuggestAttrIds.length) {
    const names = bmForm.aiSuggestAttrIds
      .map(id => store.attributeMap[id]?.name)
      .filter(Boolean)
    if (names.length) parts.push(`建议标签「${names.join('」「')}」`)
  }
  return parts.length ? parts.join('，') : ''
})

function toggleAttr(attrId: string, event: Event) {
  const target = event.target as HTMLInputElement
  if (target.checked) bmForm.attributes[attrId] = true
  else delete bmForm.attributes[attrId]
}

function onClose() { closeBmModal() }
async function onSave() {
  if (saving.value || isBmSaving()) return
  saving.value = true
  try { await saveBm() } finally { saving.value = false }
}
function onPreviewIconUrl() { previewIconUrl() }
function onClearIcon() { clearIcon() }
function onUrlInput() { autoFetchFromUrl() }
function useFaviconAsIcon() {
  bmForm.icon = bmForm.logoPreviewUrl
  bmForm.iconPreviewVisible = true
  bmForm.iconPreviewUrl = bmForm.logoPreviewUrl
  bmForm.clearIconVisible = true
}
function onApplyAi() {
  applyAiCategory()
  applyAiAttributes()
}
function onDismissAi() { dismissAiSuggestions() }

// Auto-focus title input when modal opens
watch(() => bmForm.isOpen, (open) => {
  if (open) nextTick(() => titleRef.value?.focus())
})
</script>
