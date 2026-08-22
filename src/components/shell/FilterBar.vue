<template>
  <div class="filter-row" :class="{ 'focus-active': store.focusedGroupId }">
    <!-- Focus mode tools -->
    <span v-if="store.focusedGroupId" class="focus-tools">
      <button class="ft-sb-btn" @click="$emit('exit-focus')" :title="t('common.back')">
        <span aria-hidden="true" v-html="I.back"></span>
      </button>
      <span class="focus-tools-spacer"></span>
      <button class="ft-sb-btn" :class="{ disabled: !focusCanUndo }" @mousedown.prevent @click.stop="$emit('focus-undo')" :title="t('common.undo')">
        <span aria-hidden="true" v-html="I.undo"></span>
      </button>
      <button class="ft-sb-btn" :class="{ disabled: !focusCanRedo }" @mousedown.prevent @click.stop="$emit('focus-redo')" :title="t('common.redo')">
        <span aria-hidden="true" v-html="I.redo"></span>
      </button>
      <button class="ft-sb-btn" @click="$emit('focus-add-bm', $event)" :title="t('filter.addBookmarkOrGroup')">
        <span aria-hidden="true" v-html="I.plus"></span>
      </button>
    </span>
    <!-- Normal tools -->
    <span v-show="!store.focusedGroupId" class="filter-tools" id="filterTools">
      <div class="attr-filter-wrap">
        <button class="btn btn-ghost btn-sm" id="btnAttrFilter" @click="$emit('toggle-attr-filter')">{{ t('filter.attributes') }}</button>
        <AttrDropdown />
        <AttrChips />
      </div>
    </span>
    <span v-show="!store.focusedGroupId" class="add-wrap" id="addWrap" @click.stop>
      <button class="btn btn-primary btn-sm" id="btnAdd" @click="onAddClick" :title="t('common.add')">
        <span aria-hidden="true" v-html="I.plus" class="icon-sm"></span>
      </button>
      <div class="add-dropdown ctx-menu" v-show="store.overlays.addDropdown">
        <button class="ctx-item" @click.stop="$emit('add-bookmark')">{{ t('filter.newBookmark') }}</button>
        <button class="ctx-item" @click.stop="$emit('add-group')">{{ t('filter.newGroup') }}</button>
      </div>
    </span>
    <button v-show="!store.focusedGroupId" class="btn btn-secondary btn-sm" id="btnBatchHeader" :class="{ active: store.batchMode }" @click.stop="toggleBatch" :title="t('filter.batchManage')">
      <span aria-hidden="true" v-html="I.listCheck" class="icon-sm"></span>
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
import { t } from '../../i18n/index.js'

const store = useAppStore()
const undo = useUndoStore()
defineEmits(['exit-focus', 'focus-add-bm', 'focus-edit-group', 'focus-undo', 'focus-redo', 'toggle-attr-filter', 'add-bookmark', 'add-group'])

const focusCanUndo = computed(() => !!store.focusedGroupId && !!undo.canUndo(store.focusedGroupId))
const focusCanRedo = computed(() => !!store.focusedGroupId && !!undo.canRedo(store.focusedGroupId))

const toggleBatch = toggleBatchMode
function onAddClick() { store.overlays.addDropdown = !store.overlays.addDropdown }
</script>
