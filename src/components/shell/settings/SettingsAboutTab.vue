<template>
  <div class="settings-tab-panel" data-testid="settings-panel-about">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabAbout') }}</h3>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.appInfo') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.version') }}</span>
          <span class="sp-row-desc">{{ t('settings.buildTime') }}: {{ buildTimeText }}<template v-if="GIT_COMMIT"> · {{ t('settings.buildCommit') }} {{ GIT_COMMIT }}
</template></span>
        </div>
        <div class="sp-row-ctrl">
          <span class="sp-version-badge" data-testid="lv-app-version">v{{ APP_VERSION }}</span>
          <span class="hidden" data-testid="lv-build-time">{{ buildTimeText }}</span>
          <span v-if="GIT_COMMIT" class="hidden" data-testid="lv-build-commit">{{ GIT_COMMIT }}</span>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.shortcutHelp') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button class="btn btn-secondary btn-sm" @click.stop="onOpenShortcutHelp">
            <span>{{ t('settings.shortcutHelp') }}</span>
          </button>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.feedback') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button class="btn btn-primary btn-sm" @click.stop="onFeedback">{{ t('settings.feedback') }}</button>
        </div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-row" @click="showLegal = !showLegal" style="cursor: pointer;" data-testid="lv-legal-toggle">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.legalDocs') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <span class="sp-sync-status">{{ showLegal ? '' : t('settings.legalDocsView') }}</span>
          <span class="sp-caret" :class="{ open: showLegal }" aria-hidden="true">›</span>
        </div>
      </div>
      <div v-if="showLegal" class="sp-legal-box" data-testid="lv-legal-docs">
        <a v-for="d in legalDocs" :key="d.key" class="sp-legal-link" :href="d.path" target="_blank" rel="noopener noreferrer">
          {{ t(d.labelKey) }}
        </a>
      </div>
      <!-- 备案信息：号为空则不渲染（见 src/config/site.ts 的说明） -->
      <div v-if="beianLinks.length" class="sp-beian" data-testid="lv-beian">
        <a v-for="b in beianLinks" :key="b.text" :href="b.href" target="_blank" rel="noopener noreferrer">{{ b.text }}</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 设置面板 ·「关于与帮助（版本 / 反馈入口 / 法律文本 / 备案信息）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { computed, ref } from 'vue'
import { useUIStore } from '../../../stores/ui.js'
import { pushNavState } from '../../../composables/interaction/useKeyboardOps.js'
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from '../../../version.js'
import { LEGAL_DOC_LINKS } from '../../../config/aiProviders.js'
import { ICP_NUMBER, MPS_NUMBER, MIIT_URL, mpsQueryUrl } from '../../../config/site.js'
import { t, useI18n } from '../../../i18n/index.js'
import { useSettingsContext } from './settingsContext.js'

const { onOpenShortcutHelp } = useSettingsContext()

const uiStore = useUIStore()

const { locale } = useI18n()

// 法律协议（可展开区块）
const showLegal = ref(false)

const legalDocs = LEGAL_DOC_LINKS

/** 备案信息：ICP 号链接工信部，公安联网备案号链接公安平台；号为空则整块不渲染 */
const beianLinks = computed(() => {
  const out: { text: string; href: string }[] = []
  if (ICP_NUMBER) out.push({ text: ICP_NUMBER, href: MIIT_URL })
  if (MPS_NUMBER) out.push({ text: MPS_NUMBER, href: mpsQueryUrl() })
  return out
})

// 构建时间本地化显示（__BUILD_TIME__ 为 UTC ISO 串 → 本地时区）；define 未注入时兜底
const buildTimeText = computed(() => {
  if (!BUILD_TIME) return ''
  const d = new Date(BUILD_TIME)
  if (Number.isNaN(d.getTime())) return BUILD_TIME
  return d.toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false })
})

function onFeedback() {
  pushNavState()
  uiStore.overlays.feedback = true
  uiStore.panels.settings = false
}
</script>
