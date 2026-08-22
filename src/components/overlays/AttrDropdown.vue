<template>
  <div class="attr-dropdown" id="attrDropdown" v-show="attrDrp.open" @click.stop>
    <div class="attr-drop-search">
      <input type="text" class="attr-search-input" id="attrSearchInput"
             :placeholder="t('attr.searchCreatePlaceholder')" :aria-label="t('attr.searchPlaceholder')" v-model="query" @click.stop ref="searchInputRef">
      <button class="attr-search-add" @click.stop="onAddAttr" :title="t('attr.newAttribute')" v-html="I.plus"></button>
    </div>
    <div class="attr-drop-list" id="attrDropList">
      <div v-if="!filteredAttrs.length" class="drop-empty">
        {{ t('attr.noMatch') }}
      </div>
      <div v-for="a in filteredAttrs" :key="a.id"
           class="attr-drop-item" :class="{ active: isActive(a.id), excluded: isExcluded(a.id) }"
           @contextmenu.prevent="onItemContext(a.id, $event)"
           @touchstart.passive="onTouchStart(a.id, $event)"
           @touchend="onTouchEnd"
           @touchmove.passive="onTouchMove">
        <span class="attr-drop-main" @click="onToggleFilter(a.id)" :title="t('attr.include')">
          <span class="attr-dot"></span>{{ a.name }}
        </span>
        <button class="attr-drop-exclude" :class="{ on: isExcluded(a.id) }"
                @click="onToggleExclude(a.id)"
                :title="isExcluded(a.id) ? t('attr.unexclude') : t('attr.exclude')"
                v-html="I.ban">
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { toggleAttrFilter, toggleAttrExclude, addAttrQuick } from '../../composables/domain/useAttrFilter.js'
import { I } from '../../config/icons.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'
import { isMobile } from '../../utils.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const attrDrp = useAttrDropdownStore()
const query = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

const filteredAttrs = computed(() => {
  const q = query.value.toLowerCase()
  // A2-001：只用未软删属性——软删（进回收站）的属性应立即从列表消失，而非等回收站清除
  const userAttrs = store.selectableAttributes.filter(a => a.name.toLowerCase().indexOf(q) !== -1)
  return userAttrs
})

function isActive(id: string) { return store.activeAttrs.indexOf(id) !== -1 }
function isExcluded(id: string) { return store.excludedAttrs.indexOf(id) !== -1 }

function onToggleFilter(id: string) {
  toggleAttrFilter(id)
}

function onToggleExclude(id: string) {
  toggleAttrExclude(id)
}

function onAddAttr() {
  const name = query.value.trim()
  if (!name) return
  if (addAttrQuick(name)) {
    query.value = ''
    toast(t('attr.addedToast'))
  } else {
    toast(t('attr.existsToast'), false)
  }
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as Node
  const dropdown = document.getElementById('attrDropdown')
  const toggleBtn = document.getElementById('btnAttrFilter')
  if (!dropdown || !attrDrp.open) return
  if (dropdown.contains(target)) return
  if (toggleBtn?.contains(target)) return
  attrDrp.close()
}

onMounted(() => document.addEventListener('click', onDocumentClick, true))
onUnmounted(() => document.removeEventListener('click', onDocumentClick, true))

// 长按/右键菜单
let _longPressTimer: ReturnType<typeof setTimeout> | null = null
let _longPressFired = false
let _touchStartId: string | null = null

function onItemContext(attrId: string, e: MouseEvent) {
  e.preventDefault()
  if (!isMobile()) {
    useContextMenuStore().show(e, 'attr', attrId)
  } else {
    showAttrActions(attrId)
  }
}

function onTouchStart(attrId: string, e: TouchEvent) {
  _longPressFired = false
  _touchStartId = attrId
  _longPressTimer = setTimeout(() => {
    _longPressFired = true
    showAttrActions(attrId)
  }, 500)
}

function onTouchEnd(e: TouchEvent) {
  if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null }
  if (_longPressFired) { e.preventDefault(); _longPressFired = false }
  _touchStartId = null
}

function onTouchMove() {
  if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null }
  _touchStartId = null
}

function showAttrActions(attrId: string) {
  const attr = store.attributeMap[attrId]
  if (!attr) return
  useActionSheetStore().showActions([
    { label: t('ctx.renameAttr'), action: () => onRenameAttr(attrId) },
    { label: t('attr.deleteAttribute'), action: () => onDeleteAttr(attrId), danger: true },
  ])
}

function onRenameAttr(attrId: string) {
  const attr = store.attributeMap[attrId]
  if (!attr) return
  const input = window.prompt(t('ctx.renameAttrPrompt'), attr.name)
  if (input && input.trim() && input.trim() !== attr.name) {
    const dataStore = useDataStore()
    dataStore.renameAttribute(attrId, input.trim())
    store.save()
  }
}

async function onDeleteAttr(attrId: string) {
  const attr = store.attributeMap[attrId]
  if (!attr) return
  const ok = await showConfirm(t('attr.confirmDelete', { name: attr.name }))
  if (!ok) return
  const dataStore = useDataStore()
  dataStore.deleteAttribute(attrId)
  store.save()
}

// 已通过 useAttrDropdownStore 暴露给其他模块</script>
