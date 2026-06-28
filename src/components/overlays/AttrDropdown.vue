<template>
  <div class="attr-dropdown" id="attrDropdown" v-show="isOpen" @click.stop>
    <div class="attr-drop-search">
      <input type="text" class="attr-search-input" id="attrSearchInput"
             placeholder="搜索/创建属性…" aria-label="搜索属性" v-model="query" @click.stop ref="searchInputRef">
      <button class="attr-search-add" @click.stop="onAddAttr" title="新建属性" v-html="I.plus"></button>
    </div>
    <div class="attr-drop-list" id="attrDropList">
      <div v-if="!filteredAttrs.length" class="drop-empty">
        无匹配属性
      </div>
      <div v-for="a in filteredAttrs" :key="a.id"
           class="attr-drop-item" :class="{ active: isActive(a.id), excluded: isExcluded(a.id) }"
           @contextmenu.prevent="onItemContext(a.id, $event)"
           @touchstart.passive="onTouchStart(a.id, $event)"
           @touchend="onTouchEnd"
           @touchmove.passive="onTouchMove">
        <span class="attr-drop-main" @click="onToggleFilter(a.id)" title="包含此属性">
          <span class="attr-dot"></span>{{ a.name }}
        </span>
        <button class="attr-drop-exclude" :class="{ on: isExcluded(a.id) }"
                @click="onToggleExclude(a.id)"
                :title="isExcluded(a.id) ? '取消排除' : '排除此属性'"
                v-html="I.ban">
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { toggleAttrFilter, toggleAttrExclude, addAttrQuick } from '../../composables/domain/useAttrFilter.js'
import { setAttrDropdownAPI, actionSheetAPI } from '../../composables/bridge.js'
import { I } from '../../config/icons.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { isMobile } from '../../utils.js'

const store = useAppStore()
const isOpen = ref(false)
const query = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

const filteredAttrs = computed(() => {
  const q = query.value.toLowerCase()
  const userAttrs = store.customAttributes.filter(a => a.name.toLowerCase().indexOf(q) !== -1)
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
    toast('属性已添加')
  } else {
    toast('属性已存在', false)
  }
}

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
  const dataStore = useDataStore()
  const attr = store.customAttributes.find(a => a.id === attrId)
  if (!attr) return
  actionSheetAPI?.show([
    { label: '重命名', action: () => onRenameAttr(attrId) },
    { label: '删除属性', action: () => onDeleteAttr(attrId), danger: true },
  ])
}

function onRenameAttr(attrId: string) {
  const attr = store.customAttributes.find(a => a.id === attrId)
  if (!attr) return
  const input = window.prompt('重命名属性', attr.name)
  if (input && input.trim() && input.trim() !== attr.name) {
    const dataStore = useDataStore()
    dataStore.renameAttribute(attrId, input.trim())
    store.save()
  }
}

async function onDeleteAttr(attrId: string) {
  const attr = store.customAttributes.find(a => a.id === attrId)
  if (!attr) return
  const ok = await showConfirm('删除属性「' + attr.name + '」？')
  if (!ok) return
  const dataStore = useDataStore()
  dataStore.deleteAttribute(attrId)
  store.save()
}

function toggle() {
  if (isOpen.value) {
    close()
  } else {
    query.value = ''
    isOpen.value = true
    nextTick(() => searchInputRef.value?.focus())
  }
}

function close() {
  isOpen.value = false
  query.value = ''
}

// 暴露给其他模块（通过 bridge.js）
onMounted(() => setAttrDropdownAPI({ toggle, close }))
onUnmounted(() => setAttrDropdownAPI(null))
</script>
