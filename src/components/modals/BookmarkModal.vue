<template>
  <div class="modal-mask" data-testid="lv-bm-modal" role="dialog" aria-modal="true" :aria-label="t('modal.bookmark.ariaLabel')" :class="{ open: bmForm.isOpen, 'has-child-modal': childModalOpen }" @mousedown="onMaskMouseDown" @click="onMaskClick">
    <div class="modal">
      <div class="modal-head">
        <h2>{{ bmForm.isEdit ? t('ctx.editBookmark') : bmForm.addToGroupMode ? t('modal.bookmark.addToGroupNew') : bmForm.parentId ? t('modal.bookmark.addChildBm') : t('ctx.addBookmark') }}</h2>
        <button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <div class="bm-url-header">
            <label class="form-label" for="bmUrl">{{ t('ctx.url') }} *</label>
            <button
              v-if="canAiFetch"
              type="button"
              class="btn-ai-fetch"
              :class="{ loading: bmForm.isAiFetching, success: bmForm.aiFetchedSuccess }"
              :disabled="bmForm.isAiFetching"
              @click="onTriggerAiFetch"
              :title="t('modal.bookmark.aiFetchHint')"
            >
              <span class="ai-sparkle-icon" v-html="bmForm.aiFetchedSuccess ? I.check : I.sparkle"></span>
              <span>{{ bmForm.isAiFetching ? t('modal.bookmark.aiFetching') : (bmForm.aiFetchedSuccess ? t('modal.bookmark.aiFetched') : t('modal.bookmark.aiFetchBtn')) }}</span>
            </button>
          </div>
          <input type="text" class="form-input" id="bmUrl" data-testid="lv-bm-url" v-model="bmForm.url" :placeholder="t('modal.bookmark.urlPlaceholder')" @input="onUrlInput" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="bmTitle">{{ t('modal.bookmark.siteName') }}</label>
          <input type="text" class="form-input" id="bmTitle" data-testid="lv-bm-title" v-model="bmForm.title" :placeholder="t('modal.bookmark.titlePlaceholder')" @input="onTitleInput" ref="titleRef">
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
            <div v-if="bmForm.candidateUsernames && bmForm.candidateUsernames.length > 1" class="candidate-users-row">
              <span class="cu-hint">{{ t('modal.bookmark.multiAccounts') }}:</span>
              <button
                v-for="uname in bmForm.candidateUsernames"
                :key="uname"
                type="button"
                class="cu-chip"
                :class="{ active: bmForm.username === uname }"
                @click="bmForm.username = uname"
              >
                {{ uname }}
              </button>
            </div>
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
          <textarea class="form-textarea" id="bmNotes" v-model="bmForm.notes" :placeholder="t('modal.bookmark.notesPlaceholder')" @input="onNotesInput"></textarea>
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
        <div class="form-group">
          <label class="form-label" for="bmIconDark">{{ t('modal.bookmark.customIconDark') }}</label>
          <div class="icon-input-row">
            <input type="url" class="form-input" id="bmIconDark" v-model="bmForm.iconDark" :placeholder="t('modal.bookmark.iconDarkUrlPlaceholder')">
            <div class="icon-thumbs" v-show="bmForm.iconDark">
              <img :src="bmForm.iconDark" class="icon-thumb active" :title="t('modal.bookmark.currentDarkIcon')">
            </div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="bmCategoryId">{{ t('modal.bookmark.category') }}</label>
            <select class="form-select" id="bmCategoryId" v-model="bmForm.categoryId" @change="onCategoryChange">
              <option v-for="cat in categoryOptions" :key="cat.id" :value="cat.id">{{ displayText(cat.name) }}</option>
            </select>
          </div>
          <!-- 父级书签可搜索下拉框 -->
          <div class="form-group parent-select-wrap" ref="parentDropdownRef">
            <label class="form-label">{{ t('modal.bookmark.parent') }}</label>
            <button
              ref="parentTriggerRef"
              type="button"
              class="form-select parent-trigger"
              :class="{ 'is-open': parentDropdownOpen }"
              @click="toggleParentDropdown"
              :aria-expanded="parentDropdownOpen"
              aria-haspopup="listbox"
            >
              <span class="parent-trigger-text">{{ selectedParentLabel }}</span>
              <span class="parent-chevron" aria-hidden="true" v-html="I.chevronDown" />
            </button>
            <Teleport to="body">
              <div
                v-if="parentDropdownOpen"
                ref="parentMenuRef"
                class="parent-dropdown"
                :style="parentDropdownStyle"
                role="listbox"
              >
                <div class="parent-search-wrap">
                  <input
                    ref="parentSearchRef"
                    type="text"
                    class="parent-search-input"
                    v-model="parentSearchQuery"
                    :placeholder="t('modal.bookmark.parentSearchPlaceholder')"
                    @keydown="onParentKeydown"
                    autocomplete="off"
                  />
                </div>
                <div class="parent-options-list" ref="parentListRef">
                  <!-- 「无」选项 -->
                  <div
                    class="parent-option"
                    :class="{ 'is-selected': !bmForm.parentId, 'is-active': parentActiveIdx === 0 }"
                    data-opt-idx="0"
                    @click="selectParent(null)"
                    @mouseenter="parentActiveIdx = 0"
                    role="option"
                    :aria-selected="!bmForm.parentId"
                  >
                    <span class="parent-opt-title">{{ t('common.none') }}</span>
                  </div>
                  <!-- 排序+过滤后的父级列表 -->
                  <div
                    v-for="(b, idx) in filteredParentOptions"
                    :key="b.id"
                    class="parent-option"
                    :class="{ 'is-selected': bmForm.parentId === b.id, 'is-active': parentActiveIdx === idx + 1 }"
                    :data-opt-idx="idx + 1"
                    @click="selectParent(b.id)"
                    @mouseenter="parentActiveIdx = idx + 1"
                    role="option"
                    :aria-selected="bmForm.parentId === b.id"
                  >
                    <img
                      v-if="b.icon"
                      :src="b.icon"
                      class="parent-opt-icon"
                      alt=""
                      loading="lazy"
                      @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                    />
                    <span v-else class="parent-opt-icon-placeholder" />
                    <div class="parent-opt-info">
                      <span class="parent-opt-title">{{ displayText(b.title) || b.url }}</span>
                      <span v-if="b.url && isValidUrl(b.url)" class="parent-opt-domain">{{ new URL(b.url).hostname }}</span>
                    </div>
                    <span v-if="bmForm.parentId === b.id" class="parent-opt-check" v-html="I.check" />
                  </div>
                  <div v-if="filteredParentOptions.length === 0 && parentSearchQuery" class="parent-no-results">
                    {{ t('common.noResults') }}
                  </div>
                </div>
              </div>
            </Teleport>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('modal.bookmark.attributes') }}</label>
          <div class="check-group">
            <label v-for="attr in selectableAttrs" :key="attr.id" class="check-chip" :class="{ 'ai-highlight': bmForm.aiSuggestAttrIds.includes(attr.id) }">
              <input type="checkbox" :checked="bmForm.attributes[attr.id]"
                     @change="toggleAttr(attr.id, $event)">
              {{ displayText(attr.name) }}
            </label>
          </div>
        </div>
        <!-- 子书签列表（仅编辑模式且有子书签时显示） -->
        <div v-if="childBookmarks.length > 0" class="form-group">
          <label class="form-label">{{ t('modal.bookmark.childCount', { n: childBookmarks.length }) }}</label>
          <div class="child-bookmarks-list">
            <span v-for="child in childBookmarks" :key="child.id" class="group-inline-card">
              <img v-if="child.icon" :src="child.icon" alt="">
              <span class="gic-name" :title="displayText(child.title) || child.url">{{ displayText(child.title) || child.url }}</span>
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
import { computed, watch, nextTick, ref, onBeforeUnmount } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { displayText } from '../../utils.js'
import { bmForm, closeBmModal, saveBm, isBmSaving, previewIconUrl, clearIcon, autoFetchFromUrl, triggerAiFetch, applyAiCategory, applyAiAttributes, dismissAiSuggestions, deleteBookmarkWithUndo } from '../../composables/domain/useBookmark.js'
import { I } from '../../config/icons.js'
import { ATTR_IS_GROUP } from '../../config/constants.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import E2ELockOverlay from '../ui/E2ELockOverlay.vue'
import ChildBookmarkEditModal from './ChildBookmarkEditModal.vue'
import { e2eFieldsOpen as e2eFieldsOpenLogic, e2eHintAccount as e2eHintAccountLogic, e2eHintPassword as e2eHintPasswordLogic } from './e2eHintText.js'
import { selectableParents, selectableChildren, sortedParents, filterParents } from './bookmarkFormFilters.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
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
const parentOptions = computed(() => selectableParents(store.bookmarks, bmForm.id, bmForm.parentId))

// ── 父级书签可搜索下拉框 ──
const parentSearchQuery = ref('')
const parentDropdownOpen = ref(false)
const parentSearchRef = ref<HTMLInputElement | null>(null)
const parentDropdownRef = ref<HTMLElement | null>(null)
const parentTriggerRef = ref<HTMLButtonElement | null>(null)
const parentMenuRef = ref<HTMLElement | null>(null)
const parentListRef = ref<HTMLElement | null>(null)
const parentActiveIdx = ref(-1)
const parentDropdownStyle = ref<Record<string, string>>({})

const sortedParentOptions = computed(() => sortedParents(parentOptions.value))
const filteredParentOptions = computed(() => filterParents(sortedParentOptions.value, parentSearchQuery.value))

const selectedParentLabel = computed(() => {
  if (!bmForm.parentId) return t('common.none')
  const found = parentOptions.value.find(b => b.id === bmForm.parentId)
  return found ? (displayText(found.title) || found.url) : t('common.none')
})

function isValidUrl(url: string): boolean {
  try { new URL(url); return true } catch { return false }
}

function updateParentDropdownPos() {
  const trigger = parentTriggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(Math.max(rect.width, 240), vw - 16)
  const left = Math.max(8, Math.min(rect.left, vw - width - 8))
  const spaceBelow = vh - rect.bottom - 8
  const spaceAbove = rect.top - 8
  const preferUp = spaceBelow < 260 && spaceAbove > spaceBelow
  const style: Record<string, string> = {
    left: `${left}px`,
    width: `${width}px`,
  }
  if (preferUp) {
    style.bottom = `${vh - rect.top + 4}px`
    style.maxHeight = `${Math.max(140, Math.min(280, spaceAbove - 4))}px`
  } else {
    style.top = `${rect.bottom + 4}px`
    style.maxHeight = `${Math.max(140, Math.min(280, spaceBelow - 4))}px`
  }
  parentDropdownStyle.value = style
}

function openParentDropdown() {
  updateParentDropdownPos()
  parentDropdownOpen.value = true
  parentSearchQuery.value = ''
  parentActiveIdx.value = -1
  nextTick(() => parentSearchRef.value?.focus())
}

function toggleParentDropdown() {
  if (parentDropdownOpen.value) closeParentDropdown()
  else openParentDropdown()
}

function closeParentDropdown() {
  parentDropdownOpen.value = false
  parentSearchQuery.value = ''
  parentActiveIdx.value = -1
}

function selectParent(id: string | null) {
  bmForm.parentId = id
  onParentChange()
  closeParentDropdown()
}

function scrollActiveOptionIntoView() {
  nextTick(() => {
    const el = parentListRef.value?.querySelector(`[data-opt-idx="${parentActiveIdx.value}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onParentKeydown(e: KeyboardEvent) {
  const opts = filteredParentOptions.value
  const total = opts.length + 1 // +1 for "无" option
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    parentActiveIdx.value = Math.min(parentActiveIdx.value + 1, total - 1)
    scrollActiveOptionIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    parentActiveIdx.value = Math.max(parentActiveIdx.value - 1, 0)
    scrollActiveOptionIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (parentActiveIdx.value === 0) selectParent(null)
    else if (parentActiveIdx.value > 0 && opts[parentActiveIdx.value - 1]) selectParent(opts[parentActiveIdx.value - 1].id)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeParentDropdown()
    parentTriggerRef.value?.focus()
  }
}

watch(parentSearchQuery, () => {
  parentActiveIdx.value = -1
})

function onParentOutsideClick(e: MouseEvent) {
  const target = e.target as Node
  if (parentDropdownRef.value?.contains(target) || parentMenuRef.value?.contains(target)) return
  closeParentDropdown()
}

watch(parentDropdownOpen, (open) => {
  if (open) {
    document.addEventListener('click', onParentOutsideClick, true)
    window.addEventListener('resize', updateParentDropdownPos)
  } else {
    document.removeEventListener('click', onParentOutsideClick, true)
    window.removeEventListener('resize', updateParentDropdownPos)
  }
})

// 当前书签的子书签列表（仅编辑模式显示）
const childBookmarks = computed(() => {
  if (!bmForm.isEdit || !bmForm.id) return []
  return selectableChildren(store.bookmarks, bmForm.id)
})

const aiSuggestionText = computed(() => {
  const parts: string[] = []
  if (bmForm.aiSuggestCatId && bmForm.categoryId !== bmForm.aiSuggestCatId) {
    const cat = store.categoryMap[bmForm.aiSuggestCatId]
    if (cat) parts.push(t('modal.bookmark.aiSuggestCat', { name: displayText(cat.name) }))
  }
  if (bmForm.aiSuggestAttrIds.length) {
    const names = bmForm.aiSuggestAttrIds
      .filter(id => !bmForm.attributes[id])
      .map(id => displayText(store.attributeMap[id]?.name))
      .filter(Boolean)
    if (names.length) parts.push(t('modal.bookmark.aiSuggestAttrs', { names: names.join(t('modal.bookmark.aiSuggestAttrSep')) }))
  }
  return parts.length ? parts.join(t('modal.bookmark.aiSuggestSep')) : ''
})

function toggleAttr(attrId: string, event: Event) {
  const target = event.target as HTMLInputElement
  if (target.checked) bmForm.attributes[attrId] = true
  else delete bmForm.attributes[attrId]
  bmForm._userEditedAttrs = true
}

function onClose() { closeBmModal() }
const { onMaskMouseDown, onMaskClick } = useMaskClose(onClose)
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
  deleteBookmarkWithUndo(childId, true)
}

function onPreviewIconUrl() { previewIconUrl() }
function onClearIcon() { clearIcon() }
function onCategoryChange() {
  bmForm._userEditedCategory = true
}
function onParentChange() {
  bmForm._userEditedParent = true
}
function onTitleInput() {
  if (bmForm.title.trim() !== (bmForm._autoTitle || '').trim()) {
    bmForm._userEditedTitle = true
  }
  if (!bmForm.title.trim()) {
    bmForm._userEditedTitle = false
  }
}
function onNotesInput() {
  if (bmForm.notes.trim() !== (bmForm._autoNotes || '').trim()) {
    bmForm._userEditedNotes = true
  }
  if (!bmForm.notes.trim()) {
    bmForm._userEditedNotes = false
  }
}
function onUrlInput() { autoFetchFromUrl() }
const canAiFetch = computed(() => {
  const u = bmForm.url.trim()
  return u.length >= 4 && (u.startsWith('http://') || u.startsWith('https://') || u.includes('.'))
})
function onTriggerAiFetch() { triggerAiFetch(undefined, true) }
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
// 组件由 App.vue 的 v-if 在打开瞬间创建，isOpen 在 setup 时已为 true，必须 immediate。
watch(() => bmForm.isOpen, (open) => {
  if (open) nextTick(() => titleRef.value?.focus())
  else closeParentDropdown()
}, { immediate: true })

onBeforeUnmount(() => {
  if (bmForm._fetchTimer) {
    clearTimeout(bmForm._fetchTimer)
    bmForm._fetchTimer = null
  }
  document.removeEventListener('click', onParentOutsideClick, true)
  window.removeEventListener('resize', updateParentDropdownPos)
})
</script>
