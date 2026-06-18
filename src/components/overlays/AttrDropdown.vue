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
           class="attr-drop-item" :class="{ active: isActive(a.id), excluded: isExcluded(a.id) }">
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

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { toggleAttrFilter, toggleAttrExclude, addAttrQuick } from '../../composables/domain/useAttrFilter.js'
import { toastAPI, setAttrDropdownAPI } from '../../composables/bridge.js'
import { I } from '../../config/icons.js'

const store = useAppStore()
const isOpen = ref(false)
const query = ref('')
const searchInputRef = ref(null)

const filteredAttrs = computed(() => {
  const q = query.value.toLowerCase()
  return store.customAttributes.filter(a => a.name.toLowerCase().indexOf(q) !== -1)
})

function isActive(id) { return store.activeAttrs.indexOf(id) !== -1 }
function isExcluded(id) { return store.excludedAttrs.indexOf(id) !== -1 }

function onToggleFilter(id) {
  toggleAttrFilter(id)
}

function onToggleExclude(id) {
  toggleAttrExclude(id)
}

function onAddAttr() {
  const name = query.value.trim()
  if (!name) return
  if (addAttrQuick(name)) {
    query.value = ''
    toastAPI?.toast('属性已添加')
  } else {
    toastAPI?.toast('属性已存在', false)
  }
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
