<template>
  <div class="modal-mask" data-testid="lv-bm-modal" role="dialog" aria-modal="true" :aria-label="t('modal.bookmark.ariaLabel')" :class="{ open: bmForm.isOpen, 'has-child-modal': childModalOpen }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head">
        <h2>{{ bmForm.isEdit ? t('ctx.editBookmark') : bmForm.addToGroupMode ? t('modal.bookmark.addToGroupNew') : bmForm.parentId ? t('modal.bookmark.addChildBm') : t('ctx.addBookmark') }}</h2>
        <button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" for="bmUrl">{{ t('ctx.url') }} *</label>
          <input type="text" class="form-input" id="bmUrl" data-testid="lv-bm-url" v-model="bmForm.url" :placeholder="t('modal.bookmark.urlPlaceholder')" @input="onUrlInput" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="bmTitle">{{ t('modal.bookmark.siteName') }}</label>
          <input type="text" class="form-input" id="bmTitle" data-testid="lv-bm-title" v-model="bmForm.title" :placeholder="t('modal.bookmark.titlePlaceholder')" ref="titleRef">
        </div>
        <div v-if="aiSuggestionText" class="ai-suggest-bar">
          <span class="ai-suggest-icon"></span>
          <span class="ai-suggest-text">{{ aiSuggestionText }}</span>
          <button class="btn btn-xs btn-primary" @click="onApplyAi">{{ t('modal.bookmark.applyAi') }}</button>
          <button class="btn btn-xs btn-ghost" @click="onDismissAi">{{ t('modal.bookmark.dismissAi') }}</button>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmUsername">{{ t('cards.account') }}</label>
            <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintAccount" @hint-click="onE2EHintClick">
              <input type="text" class="form-input" id="bmUsername" v-model="bmForm.username" :placeholder="t('modal.bookmark.username')">
            </E2ELockOverlay>
          </div>
          <div class="form-group">
            <label class="form-label" for="bmPassword">{{ t('cards.password') }}</label>
            <E2ELockOverlay :disabled="!e2eFieldsOpen" :hint="e2eHintPassword" @hint-click="onE2EHintClick">
              <div class="pw-wrap">
                <input :type="bmForm.showPassword ? 'text' : 'password'" class="form-input pw-input" id="bmPassword" v-model="bmForm.password" :placeholder="t('cards.password')">
                <button class="pw-toggle" type="button" :title="bmForm.showPassword ? t('cards.hidePassword') : t('cards.showPassword')" @click="bmForm.showPassword = !bmForm.showPassword" v-html="bmForm.showPassword ? I.eyeOff : I.eye"></button>
              </div>
            </E2ELockOverlay>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmNotes">{{ t('modal.bookmark.notes') }}</label>
          <textarea class="form-textarea" id="bmNotes" v-model="bmForm.notes" :placeholder="t('modal.bookmark.notesPlaceholder')"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="bmIcon">{{ t('modal.bookmark.customIcon') }}</label>
          <div class="icon-input-row">
            <input type="url" class="form-input" id="bmIcon" v-model="bmForm.icon" :placeholder="t('modal.bookmark.iconUrlPlaceholder')" @input="onPreviewIconUrl">
            <div class="icon-thumbs" v-show="bmForm.logoPreviewVisible || bmForm.iconPreviewVisible">
              <img v-if="bmForm.logoPreviewVisible" :src="bmForm.logoPreviewUrl" class="icon-thumb" :class="{ active: bmForm.icon === bmForm.logoPreviewUrl }" @click="useFaviconAsIcon" :title="t('modal.bookmark.useFavicon')">
              <img v-if="bmForm.iconPreviewVisible && bmForm.iconPreviewUrl !== bmForm.logoPreviewUrl" :src="bmForm.iconPreviewUrl" class="icon-thumb active" :title="t('modal.bookmark.currentIcon')">
            </div>
          </div>
          <button class="btn btn-ghost btn-sm mt-1" v-show="bmForm.clearIconVisible" @click="onClearIcon">{{ t('modal.bookmark.clearIcon') }}</button>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmCategoryId">{{ t('modal.bookmark.category') }}</label>
            <select class="form-select" id="bmCategoryId" v-model="bmForm.categoryId">
              <option v-for="cat in categoryOptions" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="bmParentId">{{ t('modal.bookmark.parent') }}</label>
            <select class="form-select" id="bmParentId" v-model="bmForm.parentId">
              <option :value="null">{{ t('common.none') }}</option>
              <option v-for="b in parentOptions" :key="b.id" :value="b.id">{{ b.title }}</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('modal.bookmark.attributes') }}</label>
          <div class="check-group">
            <label v-for="attr in selectableAttrs" :key="attr.id" class="check-chip" :class="{ 'ai-highlight': bmForm.aiSuggestAttrIds.includes(attr.id) }">
              <input type="checkbox" :checked="bmForm.attributes[attr.id]"
                     @change="toggleAttr(attr.id, $event)">
              {{ attr.name }}
            </label>
          </div>
        </div>
        <!-- 子书签列表（仅编辑模式且有子书签时显示） -->
        <div v-if="childBookmarks.length > 0" class="form-group">
          <label class="form-label">{{ t('modal.bookmark.childCount', { n: childBookmarks.length }) }}</label>
          <div class="child-bookmarks-list">
            <span v-for="child in childBookmarks" :key="child.id" class="group-inline-card">
              <img v-if="child.icon" :src="child.icon" alt="">
              <span class="gic-name" :title="child.title || child.url">{{ child.title || child.url }}</span>
              <span class="gic-edit-btn" :title="t('modal.bookmark.editChildBm')" @click.stop="onEditChild(child.id)" v-html="I.edit"></span>
              <span class="gic-remove" :title="t('modal.bookmark.deleteChildBm')" @click.stop="onDeleteChild(child.id)" v-html="I.trash"></span>
            </span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="onClose">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" data-testid="lv-bm-save" :disabled="saving" @click="onSave">{{ bmForm.isEdit ? t('modal.bookmark.update') : t('common.save') }}</button>
      </div>
    </div>
    <!-- 子书签编辑弹窗（在父弹窗右侧并排显示，整体居中） -->
    <ChildBookmarkEditModal v-if="childModalOpen" :child-id="childModalId" @close="childModalOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { bmForm, closeBmModal, saveBm, isBmSaving, previewIconUrl, clearIcon, autoFetchFromUrl, applyAiCategory, applyAiAttributes, dismissAiSuggestions, deleteBookmarkWithUndo } from '../../composables/domain/useBookmark.js'
import { I } from '../../config/icons.js'
import { ATTR_IS_GROUP } from '../../config/constants.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import E2ELockOverlay from '../ui/E2ELockOverlay.vue'
import ChildBookmarkEditModal from './ChildBookmarkEditModal.vue'
import { e2eFieldsOpen as e2eFieldsOpenLogic, e2eHintAccount as e2eHintAccountLogic, e2eHintPassword as e2eHintPasswordLogic } from './e2eHintText.js'
import { selectableParents, selectableChildren } from './bookmarkFormFilters.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const titleRef = ref<HTMLInputElement | null>(null)
const e2e = useE2E()
// A6-004：仅「已启用且已解锁」才开放字段；hint 区分 setup / unlock
// 三态判定+文案复用 e2eHintText 纯模块（与 ChildBookmarkEditModal 同源单一真相防漂移）
const e2eFieldsOpen = computed(() => e2eFieldsOpenLogic({ enabled: e2e.isE2EEnabled.value, unlocked: e2e.isUnlocked.value }))
const e2eHintAccount = computed(() => e2eHintAccountLogic({ enabled: e2e.isE2EEnabled.value, unlocked: e2e.isUnlocked.value }))
const e2eHintPassword = computed(() => e2eHintPasswordLogic({ enabled: e2e.isE2EEnabled.value, unlocked: e2e.isUnlocked.value }))
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
  store.selectableAttributes.filter(a => a.id !== ATTR_IS_GROUP)
)
const parentOptions = computed(() => selectableParents(store.bookmarks, bmForm.id))

// 当前书签的子书签列表（仅编辑模式显示）
const childBookmarks = computed(() => {
  if (!bmForm.isEdit || !bmForm.id) return []
  return selectableChildren(store.bookmarks, bmForm.id)
})

const aiSuggestionText = computed(() => {
  const parts: string[] = []
  if (bmForm.aiSuggestCatId) {
    const cat = store.categoryMap[bmForm.aiSuggestCatId]
    if (cat) parts.push(t('modal.bookmark.aiSuggestCat', { name: cat.name }))
  }
  if (bmForm.aiSuggestAttrIds.length) {
    const names = bmForm.aiSuggestAttrIds
      .map(id => store.attributeMap[id]?.name)
      .filter(Boolean)
    if (names.length) parts.push(t('modal.bookmark.aiSuggestAttrs', { names: names.join(t('modal.bookmark.aiSuggestAttrSep')) }))
  }
  return parts.length ? parts.join(t('modal.bookmark.aiSuggestSep')) : ''
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

// ── 子书签编辑/删除 ──
const childModalOpen = ref(false)
const childModalId = ref<string>('')

function onEditChild(childId: string) {
  childModalId.value = childId
  childModalOpen.value = true
}

function onDeleteChild(childId: string) {
  deleteBookmarkWithUndo(childId)
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
