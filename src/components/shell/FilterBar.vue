<template>
  <div class="filter-row" :class="{ 'focus-active': store.focusedGroupId }">
    <!-- Focus mode tools -->
    <span v-if="store.focusedGroupId" class="focus-tools">
      <button class="ft-sb-btn" @click="$emit('exit-focus')" title="返回">
        <span aria-hidden="true" aria-hidden="true" v-html="I.back"></span>
      </button>
      <span class="focus-tools-spacer"></span>
      <button class="ft-sb-btn" :class="{ disabled: !focusCanUndo }" @mousedown.prevent @click.stop="$emit('focus-undo')" title="撤销">
        <span aria-hidden="true" aria-hidden="true" v-html="I.undo"></span>
      </button>
      <button class="ft-sb-btn" :class="{ disabled: !focusCanRedo }" @mousedown.prevent @click.stop="$emit('focus-redo')" title="重做">
        <span aria-hidden="true" aria-hidden="true" v-html="I.redo"></span>
      </button>
      <button class="ft-sb-btn" @click="$emit('focus-add-bm', $event)" title="添加书签或组">
        <span aria-hidden="true" aria-hidden="true" v-html="I.plus"></span>
      </button>
    </span>
    <!-- Normal tools -->
    <span v-show="!store.focusedGroupId" class="filter-tools" id="filterTools">
      <div class="attr-filter-wrap">
        <button class="btn btn-ghost btn-sm" id="btnAttrFilter" @click="$emit('toggle-attr-filter')">属性</button>
        <AttrDropdown />
        <AttrChips />
      </div>
    </span>
    <span v-show="!store.focusedGroupId" class="add-wrap" id="addWrap" @click.stop>
      <button class="btn btn-primary btn-sm" id="btnAdd" @click="onAddClick" title="添加">
        <span aria-hidden="true" aria-hidden="true" v-html="I.plus" class="icon-sm"></span>
      </button>
      <div class="add-dropdown ctx-menu" v-show="store.overlays.addDropdown">
        <button class="ctx-item" @click.stop="$emit('add-bookmark')">新建书签</button>
        <button class="ctx-item" @click.stop="$emit('add-group')">新建组</button>
      </div>
    </span>
    <button v-show="!store.focusedGroupId" class="btn btn-secondary btn-sm" id="btnBatchHeader" :class="{ active: store.batchMode }" @click.stop="toggleBatch" title="批量管理">
      <span aria-hidden="true" aria-hidden="true" v-html="I.listCheck" class="icon-sm"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useUndoStore } from '../../stores/undo.js'
import { I } from '../../config/icons.js'
import AttrChips from './AttrChips.vue'
import AttrDropdown from '../overlays/AttrDropdown.vue'
import { toggleBatchMode } from '../../composables/domain/useBatch.js'

const store = useAppStore()
const undo = useUndoStore()
const emit = defineEmits(['exit-focus', 'focus-add-bm', 'focus-edit-group', 'focus-undo', 'focus-redo', 'toggle-attr-filter', 'add-bookmark', 'add-group'])

const focusCanUndo = computed(() => !!store.focusedGroupId && !!undo.canUndo(store.focusedGroupId))
const focusCanRedo = computed(() => !!store.focusedGroupId && !!undo.canRedo(store.focusedGroupId))

const toggleBatch = toggleBatchMode
function onAddClick() { store.overlays.addDropdown = !store.overlays.addDropdown }
</script>
