<template>
  <div v-if="isFocused" class="focus-card-wrap">
    <div class="card group-card group-card-focus" :data-group-id="group.id">
      <div class="group-card-accent"></div>
      <div class="group-card-head">
        <div class="card-logo group-card-icon" @click.stop="toggleFocus">
          <img v-if="group.icon" :src="group.icon" alt="">
          <span v-else v-html="noteIcon" class="display-contents"></span>
        </div>
        <div class="card-titlewrap" @dblclick.stop="onDblClick">
          <div class="card-titlewrap-text">
            <div class="card-name" :data-group-name="group.id"><span v-if="searchQuery" v-html="hlName"></span><template v-else>{{ groupDisplayName }}</template><span v-if="isPinned" class="pinned-badge" :title="t('cards.pinned')" v-html="I.pin"></span><span v-if="isPublic" class="public-badge" :title="t('cards.isPublic')" @click.stop="onPublicBadgeClick" v-html="I.share"></span></div>
            <div class="card-domain group-domain"></div>
          </div>
        </div>
      </div>
      <div class="card-body" :class="{'grp-scroll-body':ui.layoutMode!=='list' && !isShareReadonly}">
        <div class="card-scroll-wrap">
          <div class="card-tags" v-if="tagNames.length">
            <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i">{{ tag }}</span>
          </div>
          <!-- 聚焦态始终挂编辑器（分享态下 GroupEditor 以 editable:false 只读渲染） -->
          <GroupEditor :groupId="group.id" @ready="onEditorReady" />
          <!-- 分享态：展示组内收录的书签列表 -->
          <div v-if="isShareReadonly && fallbackEntries.length" class="group-bookmarks-section">
            <div class="section-header">
              <h2 class="section-title">{{ t('share.bookmarksInGroup') }}</h2>
              <span class="section-count">{{ fallbackEntries.length }}</span>
            </div>
            <div class="bm-grid">
            <a v-for="entry in fallbackEntries" :key="entry.b.id"
               :href="entry.safeUrl || '#'" :target="entry.safeUrl ? '_blank' : '_self'"
               :rel="entry.safeUrl ? 'noopener' : undefined"
               :class="['bm', { 'is-disabled': !entry.safeUrl, 'is-child': entry.isChild }]"
               @click="!entry.safeUrl ? $event.preventDefault() : null">
              <span class="bm-icon">
                <span class="bm-fb">{{ (displayText(entry.b.title) || entry.urlDomain || '?')[0].toUpperCase() }}</span>
                <img v-if="entry.icon" :src="entry.icon" alt="" referrerpolicy="no-referrer" loading="lazy" @error="markFbIconError" />
              </span>
              <span class="bm-info">
                <span class="bm-title">{{ displayText(entry.b.title) || entry.urlDomain }}</span>
                <span class="bm-url">{{ entry.urlDomain }}</span>
              </span>
              <span class="bm-arrow" aria-hidden="true" v-html="I.external"></span>
            </a>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!isShareReadonly" class="focus-toolbar-side">
      <button class="ft-sb-btn" :class="{ active: fmt.bold }" :title="t('editor.bold')" @click="fmtToggle('bold')"><strong>B</strong></button>
      <button class="ft-sb-btn" :class="{ active: fmt.underline }" :title="t('editor.underline')" @click="fmtToggle('underline')">
        <span aria-hidden="true" v-html="I.underline"></span>
      </button>
      <span class="ft-color-wrap">
        <button ref="colorBtnRef" class="ft-sb-btn ft-color-btn" :class="{ active: !!fmt.color }" :style="fmt.color ? { '--ft-color': fmt.color } : {}" :title="t('editor.textColor')" @click.stop="toggleColorPalette">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M9.5 4L5 16h1.8l1-3h8.3l1 3h1.8L14.5 4z"/></svg>
        </button>
      </span>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :class="{ active: fmt.h1 }" :title="t('editor.h1')" @click="fmtToggle('h1')">H1</button>
      <button class="ft-sb-btn" :class="{ active: fmt.h2 }" :title="t('editor.h2')" @click="fmtToggle('h2')">H2</button>
      <button class="ft-sb-btn" :class="{ active: fmt.h3 }" :title="t('editor.h3')" @click="fmtToggle('h3')">H3</button>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :class="{ active: fmt.ol }" :title="t('editor.ol')" @click="fmtToggle('ol')" v-html="I.ol"></button>
      <button class="ft-sb-btn" :class="{ active: fmt.ul }" :title="t('editor.ul')" @click="fmtToggle('ul')" v-html="I.ul"></button>
      <button class="ft-sb-btn" :class="{ active: fmt.task }" :title="t('editor.taskList')" @click="fmtToggle('task')" v-html="I.taskList"></button>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :title="t('editor.insertImage')" @click="pickImage" v-html="I.image"></button>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn ft-ai-btn" :title="t('editor.aiAsk')" @click="askAiAboutGroup">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 3 1.912 5.885a2 2 0 0 0 1.272 1.272L21 12l-5.816 1.843a2 2 0 0 0-1.272 1.272L12 21l-1.912-5.885a2 2 0 0 0-1.272-1.272L3 12l5.816-1.843a2 2 0 0 0 1.272-1.272L12 3z" />
        </svg>
      </button>
      <input ref="fileInputRef" type="file" accept="image/*" multiple hidden @change="onPickImage" />
    </div>
  </div>
  <div v-else :ref="setCardEl" class="card group-card" :class="{ 'group-expanded': isExpanded, 'batch-mode': ui.batchMode, 'card-tile': isTile }"
       role="listitem" :aria-label="groupDisplayName" :title="isTile ? tileTooltip : undefined"
       :data-group-id="group.id" :draggable="!ui.isMobile"
       :tabindex="listKeyboardNav || isTile ? 0 : undefined"
       @click="onCardClick" @keydown="onCardKeydown">
    <div v-if="!isTile" class="group-card-accent"></div>
    <input v-if="ui.batchMode" type="checkbox" class="batch-chk"
           :id="'batchChk_group:' + group.id" :checked="isSelected"
           @change.stop @click.stop="toggleSelect">
    <!-- 小宫格 = 图标启动器：组显示为文件夹（2×2 成员图标），点开进入聚焦视图 -->
    <template v-if="isTile">
      <div class="card-logo tile-icon tile-folder" :class="{ 'tile-folder-empty': !tileMembers.length }">
        <template v-if="tileMembers.length">
          <span v-for="m in tileMembers" :key="m.id" class="tile-folder-cell" :style="{ '--tile-hue': String(m.hue) }">
            <span class="tile-folder-fb">{{ m.initial }}</span>
            <img v-if="m.icon" :src="m.icon" alt="" :class="{ 'dark-invert': m.invert }" loading="lazy" decoding="async" @load="onTileMemberLoad" @error="onTileMemberError">
          </span>
        </template>
        <img v-else-if="group.icon" class="img-loaded" :src="group.icon" alt="">
        <span v-else v-html="noteIcon" class="display-contents"></span>
        <span v-if="isPinned" class="tile-badge tile-badge-pin" :title="t('cards.pinned')" v-html="I.pin"></span>
        <span v-if="memberCount" class="tile-badge tile-badge-count">{{ memberCount }}</span>
      </div>
      <div class="tile-name">
        <span v-if="searchQuery" v-html="hlName"></span>
        <template v-else>{{ groupDisplayName }}</template>
      </div>
    </template>
    <template v-else>
    <div class="group-card-head">
      <div class="card-logo group-card-icon" :title="t('cards.focusGroup')" @click.stop="onFocusClick">
        <img v-if="group.icon" :src="group.icon" alt="">
        <span v-else v-html="noteIcon" class="display-contents"></span>
      </div>
      <div class="card-titlewrap" :title="t('cards.focusGroup')" @click.stop="onFocusClick">
        <div class="card-titlewrap-text">
          <div class="card-name" :data-group-name="group.id"><span v-if="searchQuery" v-html="hlName"></span><template v-else>{{ groupDisplayName }}</template><span v-if="isPinned" class="pinned-badge" :title="t('cards.pinned')" v-html="I.pin"></span><span v-if="isPublic" class="public-badge" :title="t('cards.isPublic')" @click.stop="onPublicBadgeClick" v-html="I.share"></span></div>
          <div class="card-domain group-domain"></div>
        </div>
      </div>
      <div class="card-tags" v-if="tagNames.length && ui.layoutMode === 'list' && !detailMode">
        <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i" @click.stop="filterByTagName(tag)">{{ tag }}</span>
      </div>
      <!-- 上手指南：新手的导入入口（原欢迎弹窗的「从其他工具导入」移到这里） -->
      <button v-if="isGuide && !ui.batchMode && !isShareReadonly" type="button" class="guide-import-btn" data-testid="lv-guide-import" @click.stop="openImport">{{ t('cards.importBookmarks') }}</button>
      <div class="group-head-actions" v-if="!ui.batchMode && !isShareReadonly">
        <button class="btn-undo-group" :class="{ disabled: !hasUndo }" @click.stop="undo" :title="t('common.undo')" :aria-label="t('common.undo')" v-html="I.undo"></button>
        <button class="btn-redo-group" :class="{ disabled: !hasRedo }" @click.stop="redo" :title="t('common.redo')" :aria-label="t('common.redo')" v-html="I.redo"></button>
      </div>
    </div>
    <div class="card-body" :class="{'grp-scroll-body':showFullBody}">
      <div class="card-scroll-wrap">
        <div class="card-tags" v-if="tagNames.length && showFullBody">
          <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i" @click.stop="filterByTagName(tag)">{{ tag }}</span>
        </div>
        <!-- 辅助栏 / 分享只读态：只读 HTML（分享态不挂可编辑 TipTap，避免写本地库） -->
        <div v-if="detailMode || (isShareReadonly && hasBody)" class="group-body group-body-readonly" :class="{ 'can-edit': detailMode && !isShareReadonly }" :title="detailMode && !isShareReadonly ? t('cards.focusGroup') : undefined" @click.stop="onReadonlyClick" v-html="safeNotesHtml"></div>
        <!-- grid 折叠态 / list 展开态挂 TipTap；mini-grid 用纯文本摘要 -->
        <GroupEditor v-else-if="showEditor" :groupId="group.id" @ready="onEditorReady" />
        <div class="card-preview" v-else-if="previewText">{{ previewText }}</div>
      </div>
    </div>
    <div class="card-foot">
      <span class="card-stat">{{ tN('count.bookmarks', group.bookmarkIds?.length ?? (group as any).bookmark_ids?.length ?? 0) }}</span>
      <span class="card-actions" v-if="!isShareReadonly">
        <button class="btn-xs" @click.stop="addToGrp" :title="t('filter.addBookmarkOrGroup')" :aria-label="t('filter.addBookmarkOrGroup')" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="editGrp" :title="t('cards.editGroup')" :aria-label="t('cards.editGroup')" v-html="I.edit"></button>
        <button v-if="detailMode" class="btn-xs btn-danger" @click.stop="delGrp" :title="t('cards.deleteGroup')" :aria-label="t('cards.deleteGroup')" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="hasBody && ui.layoutMode === 'list' && !detailMode && !ui.batchMode && !ui.isMobile" class="list-expand-btn" @click.stop="toggleExpand" :title="isExpanded ? t('cards.collapse') : t('cards.expand')" :aria-label="isExpanded ? t('cards.collapse') : t('cards.expand')" :aria-expanded="isExpanded" v-html="I.chevronDown"></button>
    <button v-if="ui.layoutMode === 'list' && !detailMode && !ui.batchMode && ui.isMobile" class="card-menu-btn" @click.stop="openMenu" :title="t('cards.details')" :aria-label="t('cards.details')" v-html="I.dotsV"></button>
    <div v-if="ui.batchMode && ui.isMobile && ui.layoutMode !== 'mini-grid'" class="batch-drag-handle" v-html="I.grip"></div>
    </template>
  </div>
  <Teleport to="body">
    <Transition name="cpalette">
      <ColorPalette v-if="colorOpen && isFocused" class="cp-fixed" :style="paletteStyle" :activeColor="fmt.color" @apply="applyColor" />
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { getTagNames, stripEntranceAnim, sanitizeReadonlyHTML, displayText, extractGroupTitle, favicon, domain, getOfficialDarkIcon, isDarkInvertSite } from '../../utils.js'
import { useTileLayout, tileHue } from './tileLayout.js'
import { isThreePartCipher } from '../../crypto.js'
// PERF-1/5：异步分包 TipTap 编辑器，折叠态不加载
const GroupEditor = defineAsyncComponent(() => import('../editor/GroupEditor.vue'))
import ColorPalette from '../editor/ColorPalette.vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useUndoStore } from '../../stores/undo.js'
import { useCardOverflow } from '../../composables/ui/useCardOverflow.js'
import { I } from '../../config/icons.js'
import { EditorManager } from '../../lib/editor.js'
import { groupPreview } from '../../lib/preview.js'
import { buildShareEntries } from '../../views/buildShareEntries.js'
import { editGroup as _editGroup, toggleGroupFocus, saveGroupBody, deleteGroup as _deleteGroup } from '../../composables/domain/useGroup.js'
import { openDetail } from '../../composables/ui/useUI.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { performUndo, performRedo } from '../../composables/domain/useUndo.js'
import { useEditorFormat, type FormatKey } from '../../composables/ui/useEditorFormat.js'
import { uploadAndInsertImages, isImageFile } from '../../composables/domain/useImageUpload.js'
import { toast } from '../../lib/toast.js'
import { handleListCardKeydown } from '../../composables/interaction/listCardKeyboard.js'
import { useListNav } from '../../composables/useListNav.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark, SiblingGroup } from '../../types.js'
import { highlight } from './highlight.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'

const props = defineProps({
  group: { type: Object as () => SiblingGroup, required: true },
  // 辅助栏内复用：主网格可能是 list，但辅助栏强制 grid-view 样式；
  // 若不强制挂编辑器，GroupEditor 条件失败 + .grid-view .card-preview{display:none} → 空白
  detailMode: { type: Boolean, default: false },
})
const ui = useUIStore()
const ds = useDataStore()
const listNav = useListNav()

const cardEl = ref<HTMLElement | null>(null)
let _entranceCleanup: (() => void) | null = null
function setCardEl(el: any) {
  if (_entranceCleanup) { _entranceCleanup(); _entranceCleanup = null }
  cardEl.value = el as HTMLElement | null
  if (el) _entranceCleanup = stripEntranceAnim(el as HTMLElement)
}
// useCardOverflow 副作用：给 .card-body 加 .card-overflow 类驱动淡出遮罩，返回值此处不消费
useCardOverflow(cardEl)

const isFocused = computed(() => !props.detailMode && ui.focusedGroupId === props.group.id)
/** 分享只读态：任何分享态下组卡一律只读（组分享聚焦 / 分类分享网格内聚焦） */
const isShareReadonly = computed(() => !!ui.shareMode)
/** 示例数据里的「上手指南」笔记（固定 id，见 config/constants.ts） */
const isGuide = computed(() => props.group.id === 'sg_welcome')
function openImport() {
  const el = document.getElementById('importFile') as HTMLInputElement | null
  if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() }
}
const isExpanded = computed(() => ui.layoutMode === 'list' && ui.expandedIds.includes(props.group.id) && !ui.batchMode)
const isSelected = computed(() => (ui.batchSelected ?? []).includes('group:' + props.group.id))
const noteIcon = I.note
const hasBody = computed(() => !!(props.group.notes && props.group.notes.trim()))
// 辅助栏用只读 HTML；主网格宫格/列表展开挂 TipTap（分享态不挂可编辑编辑器）
const showEditor = computed(() => !props.detailMode && !isShareReadonly.value && (isExpanded.value || ui.layoutMode === 'grid'))
const showFullBody = computed(() => props.detailMode || ui.layoutMode !== 'list')
const safeNotesHtml = computed(() => {
  const n = props.group.notes || ''
  // E2E 锁定态遗留密文（整字段加密 → 整串三段 salt.iv.data）：不渲染，避免 v-html 显示
  // 乱码长串；解锁后 decryptStoreItems 还原明文自动恢复。明文 HTML 不受影响。
  if (isThreePartCipher(n)) return ''
  return sanitizeReadonlyHTML(n)
})

/**
 * 分享只读态书签列表：
 * 把组内书签以只读网格渲染在笔记下方，确保分享出去的组内书签均清晰可见。
 */
const fallbackBookmarks = computed(() => {
  if (!isShareReadonly.value) return []
  const ids = props.group.bookmarkIds || (props.group as any).bookmark_ids || []
  const result: Bookmark[] = []
  const visited = new Set<string>()

  const collectKids = (pid: string) => {
    const kids = ds.childrenMap[pid] || []
    for (const kid of kids) {
      if (kid && !kid.deletedAt && !visited.has(kid.id)) {
        visited.add(kid.id)
        result.push(kid)
        collectKids(kid.id)
      }
    }
  }

  for (const id of ids) {
    const bm = ds.bookmarkMap[id]
    if (bm && !bm.deletedAt && !visited.has(bm.id)) {
      visited.add(bm.id)
      result.push(bm)
      collectKids(bm.id)
    }
  }
  return result
})
/** 预计算安全 URL / 域名 / favicon（与分享页同口径，跨用户 url/icon 不可信） */
const fallbackEntries = computed(() => buildShareEntries(fallbackBookmarks.value))
function markFbIconError(e: Event) {
  const el = e.target as HTMLElement | null
  el?.classList?.add('img-error')
}

const groupDisplayName = computed(() => {
  return displayText(props.group.name) || extractGroupTitle('', props.group.notes) || t('cards.unnamedGroup')
})

const searchQuery = computed(() => (ui.searchQuery || '').trim())
const hlRegex = computed<RegExp | null>(() => {
  const q = searchQuery.value
  if (!q) return null
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'gi')
})
const hlName = computed(() => hlRegex.value ? highlight(groupDisplayName.value, hlRegex.value, searchQuery.value) : '')

const curCatName = computed(() => {
  if (!ui.curCat || ui.curCat === CAT_ALL) return ''
  const cat = ds.categoryMap[ui.curCat]
  if (cat?.name) return displayText(cat.name).trim()
  if (ui.curCat === CAT_UNCATEGORIZED) return t('cat.uncategorized').trim()
  return ''
})
const tagNames = computed(() => getTagNames(props.group, ds.customAttributes, curCatName.value))
const isPinned = computed(() => !!props.group.pinnedAt)
const isPublic = computed(() => !isShareReadonly.value && Boolean(props.group.isPublic))
function onPublicBadgeClick() {
  ui.openShareModal('group', props.group.id)
}

const previewText = computed(() => groupPreview(props.group))

// 小宫格（图标启动器）：仅主网格非虚拟渲染时生效
const tileLayout = useTileLayout()
const isTile = computed(() => tileLayout.value && !props.detailMode && !isFocused.value)
const memberCount = computed(() => props.group.bookmarkIds?.length ?? (props.group as any).bookmark_ids?.length ?? 0)
/** 文件夹预览：前 4 个成员（书签取 favicon，嵌套组取其图标；都没有时用首字母色块） */
const tileMembers = computed(() => {
  if (!isTile.value) return []
  const ids: string[] = props.group.bookmarkIds || (props.group as any).bookmark_ids || []
  const out: { id: string; icon: string; initial: string; hue: number; invert?: boolean }[] = []
  const dark = ui.themeColor === 'dark'
  for (const id of ids) {
    if (out.length >= 4) break
    const b = ds.bookmarkMap[id]
    if (b && !b.deletedAt) {
      const dm = domain(b.url)
      const name = displayText(b.title).trim() || dm || '?'
      // 深色主题与书签卡片同口径：官方深色图标优先，否则按像素分析结果反色暗色剪影
      const officialDark = dark ? (b.iconDark || getOfficialDarkIcon(b.url) || '') : ''
      const icon = officialDark || favicon(b.url, b.icon)
      const invert = dark && !officialDark && isDarkInvertSite(b.url, icon, b.attributes)
      out.push({ id, icon, invert, initial: Array.from(name)[0].toUpperCase(), hue: tileHue(dm || name) })
      continue
    }
    const g = ds.groupMap[id]
    if (g) {
      const name = displayText(g.name).trim() || '?'
      out.push({ id, icon: g.icon || '', initial: Array.from(name)[0].toUpperCase(), hue: tileHue(name) })
    }
  }
  return out
})
const tileTooltip = computed(() => [groupDisplayName.value, previewText.value].filter(Boolean).join('\n'))
function onTileMemberLoad(e: Event) { (e.target as HTMLImageElement).classList.add('img-loaded') }
function onTileMemberError(e: Event) { (e.target as HTMLImageElement).classList.add('img-error') }

const undoStore = useUndoStore()
const hasUndo = computed(() => !!undoStore.canUndo(props.group.id))
const hasRedo = computed(() => !!undoStore.canRedo(props.group.id))

const colorBtnRef = ref<HTMLElement | null>(null)
const paletteStyle = ref<Record<string, string>>({})
const { fmt, colorOpen, syncFmt, fmtToggle: _fmtToggle, applyColor: _applyColor } = useEditorFormat(() => EditorManager.get(props.group.id))

function onGlobalDocClick(e: MouseEvent) {
  if (!colorOpen.value) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.color-palette-popup') || target?.closest('.ft-color-btn')) return
  colorOpen.value = false
}

function onGlobalScroll() {
  if (colorOpen.value) colorOpen.value = false
}

watch(colorOpen, (open) => {
  if (open) {
    document.addEventListener('mousedown', onGlobalDocClick)
    window.addEventListener('scroll', onGlobalScroll, true)
    window.addEventListener('resize', onGlobalScroll)
  } else {
    document.removeEventListener('mousedown', onGlobalDocClick)
    window.removeEventListener('scroll', onGlobalScroll, true)
    window.removeEventListener('resize', onGlobalScroll)
  }
})

function toggleColorPalette() {
  if (colorOpen.value) { colorOpen.value = false; return }
  const btn = colorBtnRef.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  paletteStyle.value = { position: 'fixed', top: r.top + 'px', right: (window.innerWidth - r.left + 4) + 'px' }
  colorOpen.value = true
}

function fmtToggle(f: FormatKey) { _fmtToggle(f); saveGroupBody(props.group.id) }
function applyColor(hex: string) { _applyColor(hex); saveGroupBody(props.group.id) }

const fileInputRef = ref<HTMLInputElement | null>(null)

// 选图前端约束：10MB 上限 + 与 useImageUpload 一致的类型白名单，避免被静默过滤。
const MAX_IMAGE_SIZE_MB = 10
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024


function pickImage() {
  fileInputRef.value?.click()
}

function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = '' // 允许重复选择同一文件
  if (!files.length) return
  const focusGid = ui.focusedGroupId
  // 根因：聚焦组丢失时原实现仍静默上传/被过滤，用户拿不到任何反馈。
  if (!focusGid) {
    toast(t('msg.imageNeedFocus'), false)
    return
  }
  // 根因：uploadAndInsertImages 会静默过滤掉非白名单类型/超大文件，需前端先过滤并提示。
  const valid = files.filter(f => f.size <= MAX_IMAGE_SIZE && isImageFile(f))
  if (!valid.length) {
    toast(t('msg.imageInvalid', { n: MAX_IMAGE_SIZE_MB }), false)
    return
  }
  if (valid.length < files.length) {
    toast(t('msg.imageSkipped'), false)
  }
  void uploadAndInsertImages(focusGid, valid)
}

function askAiAboutGroup() {
  ui.attachCardToAi('group', props.group.id)
  const ed = EditorManager.get(props.group.id)
  let selectedText = ''
  if (ed && ed.state && ed.state.selection) {
    const { from, to } = ed.state.selection
    if (from < to) {
      selectedText = ed.state.doc.textBetween(from, to, ' ').trim()
    }
  }
  if (selectedText) {
    const prompt = selectedText.length > 80
      ? `关于「${selectedText.slice(0, 80)}…」：`
      : `关于「${selectedText}」：`
    ui.openAiAssistant(prompt)
  } else {
    ui.openAiAssistant()
  }
}

let _selHandler: (() => void) | null = null
function _attach() {
  _detach()
  const ed = EditorManager.get(props.group.id)
  if (!ed) return
  _selHandler = () => syncFmt()
  ed.on('selectionUpdate', _selHandler)
  syncFmt()
}
function _detach() {
  if (_selHandler) {
    const ed = EditorManager.get(props.group.id)
    if (ed) ed.off('selectionUpdate', _selHandler)
    _selHandler = null
  }
}

watch(isFocused, (v) => {
  if (v) _attach()
  else {
    _detach()
    colorOpen.value = false
  }
}, { immediate: true })
// GroupEditor 是异步组件，setup 阶段的 immediate watch 触发时编辑器尚未注册；
// 编辑器 ready 后再补一次绑定，否则格式栏按钮高亮永远不刷新。
function onEditorReady() {
  if (isFocused.value) _attach()
}
onBeforeUnmount(() => {
  _detach()
  if (_entranceCleanup) { _entranceCleanup(); _entranceCleanup = null }
  document.removeEventListener('mousedown', onGlobalDocClick)
  window.removeEventListener('scroll', onGlobalScroll, true)
  window.removeEventListener('resize', onGlobalScroll)
})

function toggleFocus() { toggleGroupFocus(props.group.id) }
function onDblClick(e: MouseEvent) { if ((e.target as HTMLElement).closest('button, input, [contenteditable], .gic-btn, .gic-remove')) return; toggleGroupFocus(props.group.id) }
function addToGrp(e: MouseEvent) { ui.addToGid = props.group.id; const btn = e.currentTarget as HTMLElement; if (btn) { const r = btn.getBoundingClientRect(); ui._addPopoverTrigger = { top: r.bottom, left: r.left, width: r.width } } else { ui._addPopoverTrigger = null } ui.overlays.addPopover = true }
function editGrp() { _editGroup(props.group.id) }
function delGrp() { _deleteGroup(props.group.id) }
function undo() { performUndo(props.group.id) }
function redo() { performRedo(props.group.id) }
function toggleSelect() { const id = 'group:' + props.group.id; const sel = ui.batchSelected; const idx = sel.indexOf(id); if (idx > -1) sel.splice(idx, 1); else sel.push(id) }
function filterByTagName(name: string) {
  const attr = ds.attributeByName[name]
  if (attr) toggleAttrFilter(attr.id)
}
function toggleExpand() { ui.toggleExpanded(props.group.id) }
function openMenu() { openDetail('group:' + props.group.id) }
function onReadonlyClick() {
  if (props.detailMode && !isShareReadonly.value) {
    toggleFocus()
  }
}
function onFocusClick() {
  if (ui.batchMode) { toggleSelect(); return }
  toggleFocus()
}
// 完整分区：PC 列表可键盘聚焦；Enter 聚焦组，Space 详情，→/← 展开收起；空白单击主操作（辅助栏内关闭）
const listKeyboardNav = computed(() => !props.detailMode && ui.layoutMode === 'list' && !ui.isMobile && !ui.batchMode)
const LIST_INTERACTIVE_SEL = 'button, input, .btn-xs, .card-actions, .card-logo, .card-titlewrap, [contenteditable="true"], .gic-btn, .gic-remove, .gic-name, .list-expand-btn, .card-menu-btn, .group-body, .card-tag, .group-head-actions'

function onCardClick(e: MouseEvent) {
  if (props.detailMode) return
  if (ui.batchMode) { toggleSelect(); return }
  if (ui.layoutMode === 'mini-grid') { toggleFocus(); return }
  if (ui.layoutMode !== 'list') return
  if ((e.target as HTMLElement).closest(LIST_INTERACTIVE_SEL)) return
  // 列表（PC/移动端一致）：展开态点空白收起；折叠态点空白 = 主操作（聚焦组）。
  // 与 mini-grid / 移动端行为对齐，详情改由「⋯」/右键/键盘 Space 显式触发。
  if (isExpanded.value) { toggleExpand(); return }
  toggleFocus()
  cardEl.value?.focus({ preventScroll: true })
}

function onCardKeydown(e: KeyboardEvent) {
  // 小宫格瓦片：Enter 主操作（打开网页 / 进入组）
  if (isTile.value) { if (e.key === 'Enter' && !ui.batchMode) { e.preventDefault(); toggleFocus() } return }
  if (!listKeyboardNav.value) return
  const action = handleListCardKeydown(e, cardEl.value, {
    canExpand: hasBody.value,
    expanded: isExpanded.value,
  }, listNav.value ?? undefined)
  if (action.type === 'primary') toggleFocus()
  else if (action.type === 'detail') openDetail('group:' + props.group.id)
  else if (action.type === 'expand' || action.type === 'collapse' || action.type === 'toggleExpand') toggleExpand()
}
</script>

<style scoped>
/* 分享态兜底书签列表（聚焦视图内，笔记下方） */
.share-fallback-list {
  display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--border, #e5e7eb);
}
.share-fallback-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border: 1px solid var(--border, #e5e7eb); border-radius: 10px;
  text-decoration: none; color: inherit;
  transition: border-color 0.15s, background 0.15s;
}
.share-fallback-item:hover { border-color: var(--accent, #3B82F6); background: var(--bg-alt, #f7f2ec); }
.share-fallback-item.is-disabled { opacity: 0.55; cursor: default; }
.share-fallback-ic {
  position: relative; width: 24px; height: 24px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-alt, #f3f4f6); border-radius: 6px; overflow: hidden;
}
.share-fallback-ic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.share-fallback-ic img.img-error { display: none; }
.share-fallback-ic:has(img:not(.img-error)) .share-fallback-fb { display: none; }
.share-fallback-fb { font-size:var(--fs-xs); font-weight: 700; color: var(--accent, #3B82F6); text-transform: uppercase; }
.share-fallback-title {
  flex: 1; min-width: 0; font-size:var(--fs-sm); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-fallback-url {
  flex-shrink: 0; max-width: 40%; font-size: 11px; color: var(--text-secondary, #888);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
