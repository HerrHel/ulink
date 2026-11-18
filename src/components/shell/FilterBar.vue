<template>
  <div class="filter-row" :class="{ 'focus-active': store.focusedGroupId, 'share-readonly-row': shareMode }">
    <!-- Share readonly mode：全部写工具隐藏，只保留「返回我的库」 -->
    <template v-if="shareMode">
      <span class="share-filter-left">
        <button class="btn btn-ghost btn-sm" @click="onExitShare" :title="t('share.backToMine')">
          <span aria-hidden="true" v-html="I.back" class="icon-sm"></span>{{ t('share.backToMine') }}
        </button>
        <span class="share-filter-hint">{{ t('share.readonlyTitle') }}</span>
      </span>
    </template>
    <!-- Focus mode tools -->
    <span v-else-if="store.focusedGroupId" class="focus-tools">
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
    <!-- 「+」一步打开新建弹窗（与 Ctrl+N 一致）；书签/笔记在弹窗标题处切换 -->
    <span v-show="!store.focusedGroupId" class="add-wrap" id="addWrap">
      <button class="btn btn-primary btn-sm" id="btnAdd" data-testid="lv-add" @click="emit('add-bookmark')" :title="t('common.add')" :aria-label="t('common.add')">
        <span aria-hidden="true" v-html="I.plus" class="icon-sm"></span>
      </button>
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
import { useShareStore } from '../../stores/share.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const undo = useUndoStore()
const share = useShareStore()
const shareMode = computed(() => store.shareMode)
const emit = defineEmits(['exit-focus', 'focus-add-bm', 'focus-edit-group', 'focus-undo', 'focus-redo', 'toggle-attr-filter', 'add-bookmark'])

const focusCanUndo = computed(() => !!store.focusedGroupId && !!undo.canUndo(store.focusedGroupId))
const focusCanRedo = computed(() => !!store.focusedGroupId && !!undo.canRedo(store.focusedGroupId))

const toggleBatch = toggleBatchMode
function onExitShare() { share.exit() }
</script>

<style scoped>
.share-filter-left { display: flex; align-items: center; gap: 10px; }
.share-filter-hint { font-size:var(--fs-xs); color: var(--text-secondary, #888); }
</style>
