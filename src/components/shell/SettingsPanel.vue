<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="uiStore.panels.settings" class="settings-drawer-wrap" @click.self="uiStore.panels.settings = false">
        <div class="settings-drawer" data-testid="lv-settings-drawer" @click.stop>
          <div class="settings-drawer-head">
            <h2 class="settings-drawer-title">{{ t('settings.title') }}</h2>
            <button class="sp-help-btn" @click.stop="onOpenShortcutHelp" :aria-label="t('settings.shortcutHelp')" :title="t('settings.shortcutHelp')">?</button>
            <button class="modal-close" @click="uiStore.panels.settings = false" :aria-label="t('settings.closeSettings')">&times;</button>
          </div>
          <div class="settings-drawer-body">
            <!-- 同步与安全（置顶，提升账户优先级） -->
            <div class="sp-section sp-section-sync-hero">
              <span class="sp-section-title">{{ t('settings.syncSecurity') }}</span>
              <template v-if="auth.isLoggedIn">
                <div class="sp-user-card">
                  <div class="sp-user-main">
                    <div class="sp-user-avatar">
                      <span v-if="auth.avatar" class="sp-user-emoji">{{ auth.avatar }}</span>
                      <span v-else class="sp-user-initial">{{ userInitial }}</span>
                    </div>
                    <div class="sp-user-info">
                      <div class="sp-user-name-row">
                        <span class="sp-user-name">{{ auth.displayName || userDisplay }}</span>
                        <button class="up-edit-btn" @click.stop="toggleProfileEditor" :title="isEditingProfile ? t('userPopover.closeEdit') : t('userPopover.editProfile')">
                          <span aria-hidden="true" v-html="I.edit"></span>
                          <span>{{ isEditingProfile ? t('userPopover.closeEdit') : t('userPopover.editProfile') }}</span>
                        </button>
                      </div>
                      <span class="sp-user-email">{{ auth.userEmail }}</span>
                      <div class="sp-sync-badge-row">
                        <span class="sp-sync-status" data-testid="lv-sync-label" :class="syncState.level">
                          <span class="sp-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 个人资料编辑卡片（展开态，与侧边栏气泡样式完全一致） -->
                  <div v-if="isEditingProfile" class="up-edit-box sp-profile-edit-box">
                    <div class="up-field">
                      <label class="up-label">{{ t('settings.nickname') }}</label>
                      <input
                        v-model="profileForm.nickname"
                        type="text"
                        maxlength="20"
                        class="up-input"
                        :placeholder="t('settings.nicknamePlaceholder')"
                        @keydown.enter="onSaveProfile"
                      />
                    </div>
                    <div class="up-field">
                      <label class="up-label">{{ t('settings.avatar') }}</label>
                      <div class="up-emoji-grid">
                        <button
                          v-for="emoji in PRESET_AVATAR_EMOJIS"
                          :key="emoji"
                          type="button"
                          class="up-emoji-btn"
                          :class="{ active: profileForm.avatar === emoji }"
                          @click="profileForm.avatar = emoji"
                        >
                          {{ emoji }}
                        </button>
                      </div>
                      <div class="up-reset-row">
                        <button
                          v-if="profileForm.avatar"
                          type="button"
                          class="up-link-btn"
                          @click="profileForm.avatar = ''"
                        >
                          {{ t('settings.resetToDefaultAvatar') }}
                        </button>
                        <span v-else class="up-hint">{{ t('settings.defaultAvatarTip') }}</span>
                      </div>
                    </div>
                    <div class="up-edit-actions">
                      <button
                        class="btn btn-primary btn-sm up-action-btn"
                        :disabled="savingProfile"
                        @click="onSaveProfile"
                      >
                        {{ savingProfile ? (t('common.saving') || '保存中…') : t('common.save') }}
                      </button>
                      <button
                        class="btn btn-ghost btn-sm up-action-btn"
                        @click="isEditingProfile = false"
                      >
                        {{ t('common.cancel') }}
                      </button>
                    </div>
                  </div>

                  <!-- 账号密码：老用户从「验证码登录」迁到「密码登录」的入口。
                       表单本身放在 SetPasswordModal 弹窗里 —— 这里只有 ~330px 宽，
                       验证码 + 发送按钮 + 密码规则挤在面板内联展开时很局促。 -->
                  <div class="sp-logout-wrap">
                    <button class="up-menu-item sp-logout-btn" id="spSetPasswordBtn" @click.stop="onOpenSetPassword">
                      <div class="up-item-left">
                        <span class="up-item-icon" aria-hidden="true" v-html="I.password"></span>
                        <span class="up-item-title">{{ t('settings.setPassword') }}</span>
                      </div>
                    </button>
                  </div>

                  <div class="sp-logout-wrap">
                    <button class="up-menu-item up-danger-item sp-logout-btn" @click.stop="onLogout">
                      <div class="up-item-left">
                        <span class="up-item-icon" aria-hidden="true" v-html="I.logout"></span>
                        <span class="up-item-title">{{ t('userPopover.signOut') }}</span>
                      </div>
                    </button>
                  </div>
                </div>
                <div v-if="syncState.level === 'error' && sync.syncError.value" class="sp-sync-error">{{ sync.syncError.value }}</div>
              </template>
              <template v-else>
                <div class="sp-row">
                  <span class="sp-hint">{{ t('settings.loginHint') }}</span>
                </div>
                <div class="sp-row">
                  <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">{{ t('settings.loginRegister') }}</button>
                </div>
              </template>
              <div class="sp-divider"></div>
              <!-- 数据解密状态与控制卡片（对齐侧边栏气泡解密样式） -->
              <div class="sp-e2e-card">
                <div class="sp-e2e-left">
                  <span class="sp-e2e-icon" aria-hidden="true" v-html="I.password"></span>
                  <div class="sp-e2e-text">
                    <div class="sp-e2e-title-row">
                      <span class="sp-e2e-title">{{ t('userPopover.e2eTitle') }}</span>
                      <span class="sp-sync-status" data-testid="lv-e2e-status" :class="e2eEnabled ? (e2eUnlocked ? 'ok' : 'pending') : 'error'">
                        {{ e2eEnabled ? (e2eUnlocked ? t('settings.e2eUnlocked') : t('settings.e2eLocked')) : t('settings.e2eDisabled') }}
                      </span>
                    </div>
                    <span class="sp-e2e-desc">{{ t('settings.e2eHint') }}<span v-if="!auth.isLoggedIn">（{{ t('settings.e2eHintLocalOnly') }}）</span></span>
                  </div>
                </div>
                <div class="sp-e2e-right">
                  <button
                    v-if="!e2eEnabled"
                    class="up-tag tag-disabled"
                    data-testid="lv-e2e-setup-btn"
                    @click.stop="onOpenE2ESetup"
                  >
                    {{ t('userPopover.enableE2E') }}
                  </button>
                  <button
                    v-else-if="!e2eUnlocked"
                    class="up-tag tag-locked"
                    data-testid="lv-e2e-unlock-btn"
                    @click.stop="onOpenE2EUnlock"
                  >
                    {{ e2e.isBiometricEnrolled.value ? (t('settings.biometricUnlock') || '指纹解密') : t('userPopover.decrypt') }}
                  </button>
                  <button
                    v-else
                    class="up-tag tag-unlocked"
                    data-testid="lv-e2e-lock-btn"
                    @click.stop="onE2ELock"
                  >
                    {{ t('userPopover.lock') }}
                  </button>
                </div>
              </div>

              <!-- 已解密状态下的附属操作：修改密码 / 移除指纹 -->
              <div v-if="e2eEnabled && e2eUnlocked" class="sp-e2e-sub-actions">
                <button class="btn btn-ghost btn-xs" data-testid="lv-e2e-changepw-btn" @click.stop="onOpenE2EChangePw">
                  <span aria-hidden="true" v-html="I.edit"></span> {{ t('settings.changeMasterPassword') }}
                </button>
                <button v-if="e2e.isBiometricEnrolled.value" class="btn btn-ghost btn-xs" data-testid="lv-e2e-biometric-remove" @click.stop="onRemoveBiometric">
                  {{ t('settings.removeBiometric') }}
                </button>
              </div>
            </div>
            <!-- Theme -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.theme') }}</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'light' }" @click="onSetThemeColor('light', $event)">
                    <span aria-hidden="true" v-html="I.sun" class="sp-icon"></span>{{ t('settings.themeLight') }}
                  </button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'dark' }" @click="onSetThemeColor('dark', $event)">
                    <span aria-hidden="true" v-html="I.moon" class="sp-icon"></span>{{ t('settings.themeDark') }}
                  </button>
                </div>
              </div>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click="onSetThemeStyle('premium')">{{ t('settings.themePremium') }}</button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click="onSetThemeStyle('comfortable')">{{ t('settings.themeComfortable') }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.themeMode === 'auto' }" @click="onToggleAutoTheme">
                <span aria-hidden="true" v-html="I.sun" class="sp-icon auto-icon-sun"></span>
                <span aria-hidden="true" v-html="I.moon" class="sp-icon auto-icon-moon"></span>
                <span class="sp-toggle-label">{{ t('settings.followSystem') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- Layout -->
            <div class="sp-section sp-section-layout">
              <span class="sp-section-title">{{ t('settings.layout') }}</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button v-if="!uiStore.isMobile" class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" @click="onSetLayout('grid')" :title="t('settings.gridView')"><span aria-hidden="true" v-html="I.grid"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" @click="onSetLayout('list')" :title="t('settings.listView')"><span aria-hidden="true" v-html="I.list"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'mini-grid' }" @click="onSetLayout('mini-grid')" :title="t('settings.miniGridView')"><span aria-hidden="true" v-html="I.miniGrid"></span></button>
                </div>
              </div>
            </div>
            <!-- Sort -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.sort') }}</span>
              <div class="sp-row">
                <div class="sp-seg sp-seg-wrap">
                  <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn"
                          :class="{ active: uiStore.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ t(s.labelKey) }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.groupsOnTop }" @click="onToggleGroupsOnTop">
                <span class="sp-toggle-label">{{ t('settings.groupsOnTop') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 检索与填充 -->
            <div class="sp-section" data-testid="lv-search-fill-section">
              <span class="sp-section-title">{{ t('settings.searchAndFill') }}</span>
              <div
                class="sp-toggle-row"
                :class="{ active: uiStore.semanticSearchEnabled }"
                @click="onToggleSemanticSearch"
                data-testid="lv-semantic-search-toggle"
              >
                <span class="sp-toggle-label">
                  {{ t('settings.semanticSearch') }}
                  <span class="sp-toggle-sub">{{ t('settings.semanticSearchHint') }}</span>
                </span>
                <span class="sp-switch"></span>
              </div>
            </div>

            <!-- 维护 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.maintenance') }}</span>
              <div class="sp-actions">
                <button class="sp-action" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
                  <span aria-hidden="true" v-html="I.radar"></span>
                  <span>{{ dlChecking ? t('settings.checking') : t('settings.checkDeadLinks') }}</span>
                  <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
                  <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
                </button>
                <div v-if="dlChecking && dlProgress.total > 0" class="sp-check-progress">
                  <div class="sp-check-progress-bar" :style="{ width: (dlProgress.done / dlProgress.total * 100) + '%' }"></div>
                  <span class="sp-check-progress-text">{{ dlProgress.done }}/{{ dlProgress.total }}</span>
                </div>
                <button v-if="deadCount + blockedCount > 0" class="sp-action sp-action-sm" @click.stop="onViewDeadLinks">
                  <span aria-hidden="true" v-html="I.link"></span>
                  <span>{{ t('settings.view') }}</span>
                </button>
              </div>
              <div class="sp-toggle-row" :class="{ active: dlAutoEnabled, locked: !dlAutoAllowed }" @click="onToggleAutoDeadCheck">
                <span class="sp-toggle-label">
                  {{ t('settings.autoDeadCheckWeekly') }}
                  <span v-if="!dlAutoAllowed" class="sp-plus-tag">{{ t('settings.plusTag') }}</span>
                </span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 公开分享管理 -->
            <div class="sp-section sp-section-shares">
              <div class="sp-section-head">
                <span class="sp-section-title">
                  {{ t('settings.shareManagement') }}
                  <span v-if="allPublicShares.length > 0" class="sp-shares-count">({{ allPublicShares.length }})</span>
                </span>
                <button
                  v-if="allPublicShares.length > 1"
                  class="sp-shares-stop-all"
                  :title="t('settings.stopAllShares')"
                  @click.stop="onStopAllShares"
                >
                  {{ t('settings.stopAllShares') }}
                </button>
              </div>
              <p class="sp-desc">{{ t('settings.publicSharesDesc') }}</p>

              <div v-if="allPublicShares.length > 0" class="sp-shares-list">
                <div
                  v-for="item in allPublicShares"
                  :key="item.type + ':' + item.id"
                  class="sp-share-item"
                >
                  <div class="sp-share-info">
                    <span
                      class="sp-share-badge"
                      :class="'sp-share-badge--' + item.type"
                    >
                      {{ item.type === 'group' ? t('settings.shareTypeGroup') : t('settings.shareTypeCategory') }}
                    </span>
                    <span class="sp-share-title" :title="item.title">{{ item.title }}</span>
                  </div>
                  <div class="sp-share-actions">
                    <button
                      type="button"
                      class="sp-share-btn"
                      :title="t('modal.share.copyLink')"
                      :aria-label="t('modal.share.copyLink')"
                      @click.stop="onCopyShare(item.url)"
                      v-html="I.link"
                    ></button>
                    <a
                      :href="item.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="sp-share-btn"
                      :title="t('modal.share.preview')"
                      :aria-label="t('modal.share.preview')"
                      @click.stop
                      v-html="I.external"
                    ></a>
                    <button
                      type="button"
                      class="sp-share-btn sp-share-btn--danger"
                      :title="t('modal.share.stopShare')"
                      :aria-label="t('modal.share.stopShare')"
                      @click.stop="onStopShareItem(item)"
                      v-html="I.close"
                    ></button>
                  </div>
                </div>
              </div>
              <div v-else class="sp-shares-empty">
                {{ t('settings.noPublicShares') }}
              </div>
            </div>
            <!-- 数据 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.data') }}</span>
              <!-- 存储占用指示条（从侧边栏移入，归位数据管理） -->
              <div v-if="storageInfo" class="sp-storage-card">
                <div class="sp-row">
                  <span class="sp-row-label">{{ t('settings.storageOccupied') }}</span>
                  <span class="sp-range-value">{{ storageInfo.label }} ({{ storageInfo.percent }}%)</span>
                </div>
                <div class="sp-storage-track">
                  <div class="sp-storage-bar" :style="{ width: storageInfo.percent + '%', background: storageBarColor }"></div>
                </div>
              </div>
              <div class="sp-actions">
                <button class="sp-action" @click.stop="onOpenTrash"><span v-html="trashIcon"></span>{{ t('settings.trash') }}</button>
              </div>
              <div class="sp-actions sp-actions--split">
                <button class="sp-action" @click.stop="onTriggerImport"><span aria-hidden="true" v-html="I.import"></span>{{ t('settings.import') }}</button>
                <div class="sp-export-wrap" @click.stop>
                  <button class="sp-action" @click="exportMenuOpen = !exportMenuOpen"><span aria-hidden="true" v-html="I.export"></span>{{ t('settings.export') }}</button>
                  <div v-if="exportMenuOpen" class="sp-export-menu">
                    <button class="sp-export-item" @click="onExport('json')">
                      <span class="sp-export-name">{{ t('settings.exportJson') }}</span>
                      <span class="sp-export-hint">{{ t('settings.exportJsonHint') }}</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('html')">
                      <span class="sp-export-name">{{ t('settings.exportHtml') }}</span>
                      <span class="sp-export-hint">{{ t('settings.exportHtmlHint') }}</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('csv')">
                      <span class="sp-export-name">{{ t('settings.exportCsv') }}</span>
                      <span class="sp-export-hint">{{ t('settings.exportCsvHint') }}</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('raindrop')">
                      <span class="sp-export-name">Raindrop.io</span>
                      <span class="sp-export-hint">{{ t('settings.exportRaindropHint') }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-toggle-row" :class="{ active: exportKeepSensitive }" @click="onToggleExportKeepSensitive" data-testid="lv-export-sensitive-toggle">
                <span class="sp-toggle-label">
                  {{ t('settings.exportKeepSensitive') }}
                  <span class="sp-toggle-sub">{{ t('settings.exportKeepSensitiveHint') }}</span>
                </span>
                <span class="sp-switch"></span>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.historyMax') }}</span>
                <span class="sp-range-value">{{ t('settings.historyMaxValue', { n: uiStore.historyMax }) }}</span>
              </div>
              <div class="sp-row">
                <input type="range" class="sp-range" min="5" max="30" step="1"
                       v-model.number="uiStore.historyMax" @change="onHistoryMaxChange">
                <span class="sp-range-hint">5–30</span>
              </div>
            </div>
            <!-- 关于 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.about') }}</span>
              <!-- 语言切换属低频偏好，收在「关于」区顶部，避免占据高频设置位 -->
              <div class="sp-row" data-testid="lv-lang-switch">
                <span class="sp-row-label">{{ t('settings.language') }}</span>
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">中文</button>
                  <button class="sp-seg-btn" :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">English</button>
                </div>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.version') }}</span>
                <span class="sp-sync-status" data-testid="lv-app-version">v{{ APP_VERSION }}</span>
              </div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.buildTime') }}</span>
                <span class="sp-sync-status" data-testid="lv-build-time">{{ buildTimeText }}</span>
              </div>

              <!-- AI 服务商清单：《隐私政策》3.3 的接收方告知入口 -->
              <button type="button" class="sp-row sp-row-btn" data-testid="lv-ai-providers-toggle" @click.stop="showAiProviders = !showAiProviders">
                <span class="sp-row-label">{{ t('settings.aiProviders') }}</span>
                <span class="sp-row-value">
                  <span class="sp-sync-status">{{ showAiProviders ? '' : aiProvidersSummary }}</span>
                  <span class="sp-caret" :class="{ open: showAiProviders }" aria-hidden="true">›</span>
                </span>
              </button>
              <div v-if="showAiProviders" class="sp-sub-panel" data-testid="lv-ai-providers">
                <p class="sp-sub-hint">{{ t('settings.aiProvidersHint') }}</p>
                <div v-for="p in aiProviders" :key="p.id" class="sp-provider">
                  <div class="sp-provider-name">{{ p.name }}</div>
                  <div class="sp-provider-meta">{{ p.product }}</div>
                  <div class="sp-provider-meta">{{ p.filing }}</div>
                  <a class="sp-provider-link" :href="p.website" target="_blank" rel="noopener noreferrer">{{ p.website }}</a>
                </div>
                <div class="sp-provider-updated">{{ t('settings.aiProvidersUpdated', { d: aiProvidersUpdatedAt }) }}</div>
              </div>

              <div class="sp-divider"></div>

              <!-- 法律协议：协议/隐私/退款政策的正文入口 -->
              <button type="button" class="sp-row sp-row-btn" data-testid="lv-legal-toggle" @click.stop="showLegal = !showLegal">
                <span class="sp-row-label">{{ t('settings.legalDocs') }}</span>
                <span class="sp-row-value">
                  <span class="sp-sync-status">{{ showLegal ? '' : t('settings.legalDocsView') }}</span>
                  <span class="sp-caret" :class="{ open: showLegal }" aria-hidden="true">›</span>
                </span>
              </button>
              <div v-if="showLegal" class="sp-sub-panel" data-testid="lv-legal-docs">
                <a v-for="d in legalDocs" :key="d.key" class="sp-legal-link" :href="d.path" target="_blank" rel="noopener noreferrer">
                  {{ t(d.labelKey) }}
                </a>
              </div>

              <button class="sp-action" @click.stop="onFeedback">{{ t('settings.feedback') }}</button>
            </div>
            <!-- 会员与权益 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.membership') }}</span>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.currentPlan') }}</span>
                <span class="sp-sync-status" data-testid="lv-entitlement-plan">{{ entitlementLabel }}</span>
              </div>
              <div v-if="entitlement.isPaid && entitlement.expiresAt" class="sp-row">
                <span class="sp-row-label">{{ t('settings.expiresAt') }}</span>
                <span class="sp-sync-status" data-testid="lv-entitlement-expiry">{{ entitlement.expiresAt }}</span>
              </div>
              <div class="sp-redeem-row">
                <input
                  class="form-input sp-redeem-input"
                  type="text"
                  v-model="redeemInput"
                  :placeholder="t('settings.redeemPlaceholder')"
                  maxlength="16"
                  autocomplete="off"
                  spellcheck="false"
                  @keyup.enter="onRedeem"
                />
                <button
                  class="btn btn-primary btn-sm"
                  data-testid="lv-redeem-btn"
                  :disabled="redeeming || !redeemInput.trim()"
                  @click.stop="onRedeem"
                >
                  {{ redeeming ? t('settings.redeeming') : t('settings.redeem') }}
                </button>
              </div>
            </div>
            <!-- Danger -->
            <div class="sp-section sp-danger">
              <span class="sp-section-title">{{ t('settings.danger') }}</span>
              <button class="sp-danger-btn" @click.stop="onResetData">
                <span aria-hidden="true" v-html="I.trash"></span>{{ t('settings.resetData') }}
              </button>
              <!-- 账号注销：PIPL 第 47 条删除权的自助实现 -->
              <button
                v-if="auth.isLoggedIn"
                type="button"
                class="sp-danger-btn sp-danger-btn-outline"
                data-testid="lv-delete-account"
                :disabled="deletingAccount"
                @click.stop="onDeleteAccount"
              >
                {{ deletingAccount ? t('settings.deleteAccountDoing') : t('settings.deleteAccount') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 反馈 / 建议 弹窗：直接填写内容提交到企业邮箱（保留复制 / mailto 兜底） -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="uiStore.overlays.feedback" class="modal-mask open" role="dialog" aria-modal="true" :aria-label="t('settings.feedback')" @click.self="uiStore.overlays.feedback = false">
        <div class="modal modal-sm">
          <div class="modal-body">
            <div class="confirm-msg">{{ t('settings.feedbackFormHint') }}</div>
            <textarea
              class="form-textarea sp-feedback-text"
              rows="5"
              maxlength="2000"
              :placeholder="t('settings.feedbackPlaceholder')"
              :aria-label="t('settings.feedback')"
              v-model="feedbackText"
            ></textarea>
            <label class="sp-feedback-label" for="lv-feedback-contact">{{ t('settings.feedbackContact') }}</label>
            <input
              id="lv-feedback-contact"
              class="form-input sp-feedback-contact"
              type="text"
              maxlength="200"
              :placeholder="t('settings.feedbackContactPlaceholder')"
              v-model="feedbackContact"
            />
            <!-- honeypot：真人看不到也填不到，机器人填了就在服务端被静默丢弃 -->
            <input class="sp-feedback-hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" v-model="feedbackHoneypot" />
            <!-- 图形人机验证（CloudBase auth captcha，按需挑战：服务端回 captcha_required 才出现） -->
            <div v-if="captcha.visible" class="sp-feedback-captcha">
              <div class="sp-feedback-captcha-label">{{ t('settings.captchaPrompt') }}</div>
              <div class="sp-feedback-captcha-row">
                <img
                  v-if="captcha.imageData"
                  :src="captcha.imageData"
                  class="sp-feedback-captcha-img"
                  :alt="t('settings.captchaPrompt')"
                  @click="refreshCaptcha"
                />
                <input
                  id="lv-feedback-captcha"
                  v-model="captcha.input"
                  class="form-input sp-feedback-captcha-input"
                  type="text"
                  maxlength="8"
                  autocomplete="off"
                  :placeholder="t('settings.captchaPlaceholder')"
                  @keyup.enter="submitCaptchaAndRetry"
                />
              </div>
              <button type="button" class="sp-feedback-link" :disabled="captcha.busy" @click="refreshCaptcha">
                {{ t('settings.captchaRefresh') }}
              </button>
            </div>
            <div class="sp-feedback-meta">
              <!-- 按钮被禁用时必须给出原因：只显示计数的话，用户不知道还差几个字 -->
              <span :class="{ 'sp-feedback-short': feedbackTooShort }">
                {{ feedbackTooShort ? t('settings.feedbackTooShort') : t('settings.feedbackCount', { n: feedbackText.length }) }}
              </span>
              <span>{{ t('settings.feedbackOrEmail') }}
                <button class="sp-feedback-link" @click="openFeedbackMail">{{ FEEDBACK_EMAIL }}</button>
              </span>
            </div>
          </div>
          <div class="modal-foot confirm-foot">
            <button class="btn btn-secondary" @click="copyFeedbackEmail">{{ t('settings.copyEmail') }}</button>
            <button class="btn btn-primary" :disabled="!canSendFeedback" @click="captcha.visible ? submitCaptchaAndRetry() : submitFeedback()">
              {{ feedbackSending ? t('settings.feedbackSending') : t('settings.feedbackSend') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useUIStore, type ThemeStyle, type SortMode, type LayoutMode } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { storageBarColorFor } from './storageBarColor.js'
import { setThemeStyle as themeSetStyle } from '../../lib/theme.js'
import { exportData, exportHTML, exportCSV, exportRaindrop, resetToDefaults, getExportKeepSensitive, setExportKeepSensitive } from '../../composables/domain/useDataIO.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { isCloudBaseBackend, invokeCbFunction, getCbFnBase, getCbAuth } from '../../lib/cloudbase.js'
import { solvePow } from '../../lib/pow.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { I } from '../../config/icons.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { copyToClipboard } from '../../utils.js'
import { stopShareGroup, stopShareCategory, stopAllUserShares, fetchUserCategoryShares } from '../../composables/domain/useDataShare.js'
import { SHARE_BASE } from '../../config/urls.js'
import { CATEGORY_SHARE_PATH } from '../../composables/domain/syncShare.js'
import { APP_VERSION, BUILD_TIME } from '../../version.js'
import { AI_PROVIDERS, AI_PROVIDERS_UPDATED_AT, LEGAL_DOC_LINKS } from '../../config/aiProviders.js'
import { purgeAccount } from '../../composables/domain/useAccountDeletion.js'
import {
  fetchMyEntitlement,
  redeemCode,
  type MyEntitlement,
  type RedeemError,
} from '../../composables/domain/useRedeem.js'
import { PRESET_AVATAR_EMOJIS } from '../../lib/avatar.js'
import { t, tN, useI18n } from '../../i18n/index.js'

// 语言切换：locale 为响应式 computed，切语言后本面板与全局文案立即更新
const { locale, setLocale } = useI18n()


function triggerImport() { const el = document.getElementById('importFile') as HTMLInputElement | null; if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() } }

function onOpenShortcutHelp() { pushNavState(); uiStore.panels.shortcutHelp = true; uiStore.panels.settings = false }

const uiStore = useUIStore()
const dataStore = useDataStore()
const appStore = useAppStore()

const storageInfo = computed(() => {
  try { return appStore.getStorageInfo() } catch { return null }
})
const storageBarColor = computed(() => storageBarColorFor(storageInfo.value?.percent))
const auth = useAuth()
const sync = useCloudSync()

const userInitial = computed(() => {
  const name = auth.displayName || auth.userEmail
  if (!name) return 'U'
  return name.charAt(0).toUpperCase()
})

const userDisplay = computed(() => {
  if (!auth.userEmail) return ''
  return auth.userEmail.split('@')[0]
})

const isEditingProfile = ref(false)
const savingProfile = ref(false)

// AI 服务商清单 / 法律协议（可展开区块）
const showAiProviders = ref(false)
const showLegal = ref(false)
const aiProviders = AI_PROVIDERS
const aiProvidersUpdatedAt = AI_PROVIDERS_UPDATED_AT
const legalDocs = LEGAL_DOC_LINKS
const aiProvidersSummary = computed(() =>
  AI_PROVIDERS.length > 1
    ? t('settings.aiProvidersCount', { n: AI_PROVIDERS.length })
    : AI_PROVIDERS[0]?.name || '',
)

// 账号注销
const deletingAccount = ref(false)

// 会员权益与兑换码
const entitlement = ref<MyEntitlement>({
  planId: 'free',
  status: 'active',
  expiresAt: null,
  features: {},
  isPaid: false,
})
const redeemInput = ref('')
const redeeming = ref(false)

const entitlementLabel = computed(() => {
  if (!entitlement.value.isPaid) return t('settings.freePlan')
  const map: Record<string, string> = {
    plus_monthly: t('settings.planPlusMonthly'),
    plus_yearly: t('settings.planPlusYearly'),
  }
  return map[entitlement.value.planId] || entitlement.value.planId
})

async function refreshEntitlement() {
  if (!auth.isLoggedIn) {
    entitlement.value = { planId: 'free', status: 'active', expiresAt: null, features: {}, isPaid: false }
    await dl.refreshAutoCheckAllowed(entitlement.value)
    return
  }
  entitlement.value = await fetchMyEntitlement()
  // 权益变化会影响「自动全量检测」是否可用（Plus 专属）
  await dl.refreshAutoCheckAllowed(entitlement.value)
}

function redeemErrKey(e?: RedeemError): string {
  switch (e) {
    case 'not_found':
      return 'settings.redeemErrNotFound'
    case 'already_used':
      return 'settings.redeemErrUsed'
    case 'plan_inactive':
      return 'settings.redeemErrInactive'
    case 'unauthorized':
      return 'settings.redeemErrAuth'
    case 'rate_limited':
      return 'settings.redeemErrRate'
    default:
      return 'settings.redeemErrNetwork'
  }
}

async function onRedeem() {
  const code = redeemInput.value.trim()
  if (!code || redeeming.value) return
  if (!auth.isLoggedIn) {
    toast(t('settings.redeemErrAuth'), false)
    return
  }
  redeeming.value = true
  try {
    const r = await redeemCode(code)
    if (r.ok) {
      toast(t('settings.redeemSuccess', { plan: r.planName || '', date: r.expiresAt || '' }))
      redeemInput.value = ''
      await refreshEntitlement()
    } else {
      toast(t(redeemErrKey(r.error)), false)
    }
  } finally {
    redeeming.value = false
  }
}

// 权益随登录态刷新（必须声明在 entitlement / refreshEntitlement 之后：
// immediate 回调会同步执行，否则会撞上暂时性死区）
watch(
  () => auth.isLoggedIn,
  () => {
    void refreshEntitlement()
  },
  { immediate: true },
)

async function onDeleteAccount() {
  if (deletingAccount.value) return
  const ok = await showConfirm(t('settings.deleteAccountConfirm'))
  if (!ok) return
  deletingAccount.value = true
  try {
    const r = await purgeAccount()
    if (r.ok) {
      toast(t('settings.deleteAccountDone'))
      // 重新加载，确保内存里的 store 也被清空
      setTimeout(() => location.reload(), 1200)
    } else {
      toast(t('settings.deleteAccountFailed'), false)
    }
  } finally {
    deletingAccount.value = false
  }
}
const profileForm = reactive({
  nickname: '',
  avatar: '',
})

function toggleProfileEditor() {
  if (!isEditingProfile.value) {
    profileForm.nickname = auth.displayName !== userDisplay.value ? (auth.customNickname || auth.displayName) : (auth.customNickname || '')
    profileForm.avatar = auth.avatar || ''
    isEditingProfile.value = true
  } else {
    isEditingProfile.value = false
  }
}

async function onSaveProfile() {
  savingProfile.value = true
  try {
    await auth.updateProfile({
      nickname: profileForm.nickname,
      avatar: profileForm.avatar,
    })
    toast(t('settings.profileSavedToast'))
    isEditingProfile.value = false
  } catch (err) {
    console.error('Failed to save profile', err)
  } finally {
    savingProfile.value = false
  }
}

const dl = useDeadLinkChecker()
const e2e = useE2E()
const e2eEnabled = computed(() => e2e.isE2EEnabled.value)
const e2eUnlocked = computed(() => e2e.isUnlocked.value)

function onE2ELock() { e2e.lock(); toast(t('settings.lockedToast')) }
function onRemoveBiometric() { e2e.removeBiometric(); toast(t('settings.biometricRemovedToast')) }
function onOpenE2ESetup() { uiStore.modals.e2eSetup = true; uiStore.panels.settings = false }
function onOpenE2EUnlock() { uiStore.e2eUnlockInitialMode = 'unlock'; uiStore.modals.e2eUnlock = true; uiStore.panels.settings = false }
function onOpenE2EChangePw() {
  uiStore.e2eUnlockInitialMode = 'changePw'
  uiStore.modals.e2eUnlock = true
  uiStore.panels.settings = false
}

const trashCount = computed(() => dataStore.trashCount)
const trashIcon = computed(() => trashCount.value > 0 ? I.trashFull : I.trash)
const syncState = useSyncState()
// 构建时间本地化显示（__BUILD_TIME__ 为 UTC ISO 串 → 本地时区）；define 未注入时兜底
const buildTimeText = computed(() => {
  if (!BUILD_TIME) return ''
  const d = new Date(BUILD_TIME)
  if (Number.isNaN(d.getTime())) return BUILD_TIME
  return d.toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false })
})
const dlChecking = computed(() => dl.checking.value)
const dlProgress = computed(() => dl.progress.value)
const deadCount = computed(() => dl.deadCount.value)
const blockedCount = computed(() => dl.blockedCount.value)
const dlAutoEnabled = computed(() => dl.autoCheckEnabled.value)
const dlAutoAllowed = computed(() => dl.autoCheckAllowed.value)

const sortModes: { id: SortMode; labelKey: string }[] = [
  { id: 'order', labelKey: 'settings.sortCustom' },
  { id: 'title', labelKey: 'settings.sortTitle' },
  { id: 'dateDesc', labelKey: 'settings.sortDateDesc' },
  { id: 'dateAsc', labelKey: 'settings.sortDateAsc' },
  { id: 'useCount', labelKey: 'settings.sortUseCount' },
]

function onSetThemeColor(val: 'light' | 'dark', e?: MouseEvent) {
  uiStore.setThemeColor(val, e)
}

function onSetThemeStyle(style: ThemeStyle) {
  themeSetStyle(style)
  uiStore.themeStyle = style
}

function onToggleAutoTheme() {
  uiStore.toggleAutoTheme()
}

// 抽屉展开时确保深浅主题与当前实际 DOM 保持同步
watch(() => uiStore.panels.settings, (open) => {
  if (open) uiStore.syncThemeFromDOM()
})

function onSetLayout(mode: LayoutMode) {
  if (uiStore.focusedGroupId) return
  // 移动端不可用 grid：拦截
  if (uiStore.isMobile && mode === 'grid') return
  uiStore.layoutMode = mode
  if (uiStore.isMobile && (mode === 'list' || mode === 'mini-grid')) {
    uiStore._mobileLayoutMode = mode
  }
  // A4-005：即时落盘，不依赖 beforeunload
  uiStore.saveUIState()
}

function onSetSortMode(mode: SortMode) {
  uiStore.sortMode = mode
  uiStore.saveUIState()
}

function onToggleGroupsOnTop() {
  uiStore.groupsOnTop = !uiStore.groupsOnTop
  uiStore.saveUIState()
}

function onToggleSemanticSearch() {
  uiStore.semanticSearchEnabled = !uiStore.semanticSearchEnabled
  uiStore.saveUIState()
  toast(uiStore.semanticSearchEnabled ? t('settings.semanticSearchOnToast') : t('settings.semanticSearchOffToast'), true)
}

function onHistoryMaxChange() {
  uiStore.historyMax = Math.min(30, Math.max(5, uiStore.historyMax))
  uiStore.saveUIState()
}

function onOpenTrash() { pushNavState(); uiStore.panels.trash = true; uiStore.panels.settings = false }
function onTriggerImport() { triggerImport(); uiStore.panels.settings = false }

const exportMenuOpen = ref(false)
function onExport(fmt: 'json' | 'html' | 'csv' | 'raindrop') {
  if (fmt === 'json') exportData()
  else if (fmt === 'html') exportHTML()
  else if (fmt === 'csv') exportCSV()
  else if (fmt === 'raindrop') exportRaindrop()
  exportMenuOpen.value = false
  uiStore.panels.settings = false
}

// 导出是否保留敏感内容（username/password）：默认关闭，分类导出/完整备份按此开关清洗
const exportKeepSensitive = ref(getExportKeepSensitive())
function onToggleExportKeepSensitive() {
  exportKeepSensitive.value = !exportKeepSensitive.value
  setExportKeepSensitive(exportKeepSensitive.value)
  toast(exportKeepSensitive.value ? t('settings.exportSensitiveOn') : t('settings.exportSensitiveOff'))
}
function _closeExportMenu(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (!t.closest('.sp-export-wrap')) exportMenuOpen.value = false
}
onMounted(() => { document.addEventListener('click', _closeExportMenu); e2e.checkE2EStatus() })
onBeforeUnmount(() => document.removeEventListener('click', _closeExportMenu))
function onResetData() { resetToDefaults(); uiStore.panels.settings = false }

async function onOpenLogin() {
  auth.authModalOpen = true
  uiStore.panels.settings = false
}

async function onLogout() {
  const ok = await auth.signOut()
  if (ok) await sync.resetSyncState()
}

// ── 设置/修改密码：表单在 SetPasswordModal 里，面板只负责唤起 ──
// 与 onOpenE2ESetup / onOpenE2EUnlock 一致：开弹窗就先收起面板，避免两层遮罩叠加。
function onOpenSetPassword() {
  uiStore.modals.setPassword = true
  uiStore.panels.settings = false
}

function onCheckDeadLinks() {
  if (dl.checking.value) return
  toast(t('settings.checkDeadLinksStart'))
  dl.checkAll(5, 200).then(() => {
    const ds = dataStore
    let dead = 0
    let blocked = 0
    for (const b of ds.bookmarks) {
      if (b.attributes?.['dead-link']) dead++
      if (b.attributes?.['gfw-blocked']) blocked++
    }
    if (dead > 0 && blocked > 0) {
      toast(t('settings.deadCheckDoneMixed', { dead, blocked }))
    } else if (dead > 0) {
      toast(tN('settings.deadCheckDoneDead', dead))
    } else if (blocked > 0) {
      toast(tN('settings.deadCheckDoneBlocked', blocked))
    } else {
      toast(t('settings.deadCheckAllOk'))
    }
  })
}

function onViewDeadLinks() {
  pushNavState()
  uiStore.overlays.deadLinks = true
  uiStore.panels.settings = false
}

async function onToggleAutoDeadCheck() {
  if (dl.autoCheckEnabled.value) {
    dl.stopAutoCheck()
    return
  }
  // 自动全量检测是成本最高的路径（请求数与书签数成正比），需 Plus 权益
  const allowed = await dl.refreshAutoCheckAllowed()
  if (!allowed) {
    toast(t('settings.autoDeadCheckNeedsPlus'), false)
    return
  }
  dl.startAutoCheck()
}

// ── 公开分享管理 ──
interface PublicShareItem {
  type: 'group' | 'category'
  id: string
  shareId?: string
  title: string
  icon?: string
  color?: string
  url: string
}

const userCategoryShares = ref<Array<{ id: string; category_id: string }>>([])
const loadingCategoryShares = ref(false)

async function loadUserCategoryShares() {
  if (!auth.isLoggedIn || !navigator.onLine) {
    userCategoryShares.value = []
    return
  }
  loadingCategoryShares.value = true
  try {
    userCategoryShares.value = await fetchUserCategoryShares()
  } catch {
    userCategoryShares.value = []
  } finally {
    loadingCategoryShares.value = false
  }
}

watch(() => uiStore.panels.settings, (open) => {
  if (open) loadUserCategoryShares()
})

watch(() => auth.isLoggedIn, (logged) => {
  if (logged && uiStore.panels.settings) {
    loadUserCategoryShares()
  }
})

if (uiStore.panels.settings) {
  loadUserCategoryShares()
}

const publicGroupItems = computed<PublicShareItem[]>(() => {
  return dataStore.siblingGroups
    .filter(g => g.isPublic && !g.deletedAt)
    .map(g => ({
      type: 'group' as const,
      id: g.id,
      title: g.name || t('cards.unnamedGroup'),
      icon: g.icon,
      url: `${SHARE_BASE}/${g.id}`,
    }))
})

const publicCategoryItems = computed<PublicShareItem[]>(() => {
  return userCategoryShares.value.map(c => {
    const cat = dataStore.categoryMap[c.category_id]
    return {
      type: 'category' as const,
      id: c.category_id,
      shareId: c.id,
      title: cat?.name || c.id,
      icon: cat?.icon,
      color: cat?.color,
      url: `${SHARE_BASE}/${CATEGORY_SHARE_PATH}/${c.id}`,
    }
  })
})

const allPublicShares = computed<PublicShareItem[]>(() => [
  ...publicGroupItems.value,
  ...publicCategoryItems.value,
])

function onCopyShare(url: string) {
  copyToClipboard(url, t('msg.shareLinkLabel'))
}

async function onStopShareItem(item: PublicShareItem) {
  const ok = await showConfirm(t('modal.share.stopConfirm'))
  if (!ok) return
  if (item.type === 'group') {
    const success = await stopShareGroup(item.id)
    if (success) {
      toast(t('modal.share.stopped'), true)
    } else {
      toast(t('common.failed'), false)
    }
  } else {
    const success = await stopShareCategory(item.id)
    if (success) {
      toast(t('modal.share.stopped'), true)
      await loadUserCategoryShares()
    } else {
      toast(t('common.failed'), false)
    }
  }
}

async function onStopAllShares() {
  const ok = await showConfirm(t('settings.stopAllSharesConfirm'))
  if (!ok) return
  const success = await stopAllUserShares()
  if (success) {
    toast(t('settings.allSharesStopped'), true)
    await loadUserCategoryShares()
  } else {
    toast(t('common.failed'), false)
  }
}

// ── 反馈（A4-007：状态进 overlays.feedback，支持 Esc / popstate）──
const FEEDBACK_EMAIL = 'support@ulink.ren'
/** 反馈接口 = Supabase Edge Function（--no-verify-jwt，凭 anon key 调用）。 */
const FEEDBACK_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/send-feedback`
const FEEDBACK_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')

/** 服务端错误码 → 提示文案键（未列出的错误统一走 feedbackFailed）。 */
const FEEDBACK_ERROR_KEYS: Record<string, string> = {
  message_too_short: 'settings.feedbackTooShort',
  message_too_long: 'settings.feedbackTooLong',
  rate_limited: 'settings.feedbackRateLimited',
}

const feedbackText = ref('')
const feedbackContact = ref('')
const feedbackHoneypot = ref('')
const feedbackSending = ref(false)

/**
 * 图形人机验证（CloudBase auth captcha，按需挑战）。
 * 流程：首次提交放行 → 服务端回 captcha_required → 弹验证码 →
 * verifyCaptchaData 通过拿 captcha_token → 带 token 重交。
 * token 由网关签发（opaque + expires_in），服务端做一次性消费防重放。
 */
const captcha = reactive({
  visible: false,
  imageData: '',
  input: '',
  busy: false,
})
/** createCaptchaData 的 token（verifyCaptchaData 入参） */
let captchaChallengeToken = ''
/** verifyCaptchaData 通过后的 captcha_token（提交携带） */
let captchaVerifiedToken = ''

/**
 * PoW 无感验证（客户端后台解题，用户零感知）。
 * 流程：开弹窗即预取挑战并后台解题（~200ms）→ 提交携带解答 → 服务端验签+难度，
 * jti 一次性消费。**有效 PoW 直接放行**（跳过图形验证码）；缺失/失效才回落
 * captcha_required 图形验证码兜底。
 */
type PowChallenge = { challenge: string; difficulty: number; exp: number; jti: string; signature: string }
type PowSolution = PowChallenge & { nonce: string }
let powStash: PowSolution | null = null

async function fetchPowChallenge(): Promise<PowChallenge | null> {
  try {
    const base = getCbFnBase()
    if (!base) return null
    const res = await fetch(`${base}/send-feedback`, { method: 'GET' })
    const d = (await res.json().catch(() => ({}))) as { pow?: PowChallenge }
    return d?.pow?.challenge ? d.pow : null
  } catch {
    return null
  }
}

async function solvePowChallenge(ch: PowChallenge): Promise<PowSolution | null> {
  const nonce = await solvePow(ch.challenge, ch.difficulty)
  return nonce ? { ...ch, nonce } : null
}

/** 取一份 PoW 解答；stash 用后即清（jti 一次性，服务端防重放） */
async function ensurePowSolution(): Promise<PowSolution | null> {
  if (!isCloudBaseBackend()) return null
  if (powStash) {
    const s = powStash
    powStash = null
    return s
  }
  const ch = await fetchPowChallenge()
  return ch ? solvePowChallenge(ch) : null
}

/** 后台预解题（开弹窗时调用，提交时零等待）；失败静默——提交时现解或回落图形验证 */
async function primePow(): Promise<void> {
  try {
    const ch = await fetchPowChallenge()
    if (!ch) return
    powStash = await solvePowChallenge(ch)
  } catch {
    /* 预解失败静默 */
  }
}

/** 正文最小长度（与 Edge Function 的 MIN_MESSAGE 保持一致）。 */
const MIN_FEEDBACK = 5

const canSendFeedback = computed(
  () =>
    feedbackText.value.trim().length >= MIN_FEEDBACK &&
    !feedbackSending.value &&
    (!captcha.visible || captcha.input.trim().length > 0),
)

/** 已输入但未达最小长度——此时按钮是禁用的，必须让用户知道原因。 */
const feedbackTooShort = computed(() => {
  const n = feedbackText.value.trim().length
  return n > 0 && n < MIN_FEEDBACK
})

function onFeedback() {
  pushNavState()
  feedbackText.value = ''
  feedbackContact.value = ''
  feedbackHoneypot.value = ''
  captcha.visible = false
  captcha.imageData = ''
  captcha.input = ''
  captchaChallengeToken = ''
  captchaVerifiedToken = ''
  uiStore.overlays.feedback = true
  uiStore.panels.settings = false
  // 后台预解 PoW：用户打字期间解题完成，提交时零等待、零感知
  void primePow()
}

// ── 图形人机验证（CloudBase auth captcha）──
type CbAuthCaptcha = {
  createCaptchaData: (p: { state?: string }) => Promise<{ data?: string; token?: string }>
  verifyCaptchaData: (p: { token: string; key: string }) => Promise<{ data?: { captcha_token?: string }; captcha_token?: string }>
}

/** 拉起图形验证码（服务端 captcha_required 或主动挑战） */
async function startCaptcha(): Promise<void> {
  try {
    const auth = getCbAuth() as CbAuthCaptcha | null
    if (!auth?.createCaptchaData) throw new Error('captcha unavailable')
    const r = await auth.createCaptchaData({ state: 'feedback' })
    if (!r?.data || !r?.token) throw new Error('captcha empty')
    captchaChallengeToken = r.token
    captcha.imageData = r.data
    captcha.input = ''
    captcha.visible = true
    nextTick(() => document.getElementById('lv-feedback-captcha')?.focus())
  } catch {
    toast(t('settings.feedbackFailed'), false)
  }
}

/** 刷新验证码图（看不清换一张） */
async function refreshCaptcha(): Promise<void> {
  if (captcha.busy) return
  captcha.busy = true
  try {
    const auth = getCbAuth() as CbAuthCaptcha | null
    if (!auth?.createCaptchaData) throw new Error('captcha unavailable')
    const r = await auth.createCaptchaData({ state: 'feedback' })
    if (!r?.data || !r?.token) throw new Error('captcha empty')
    captchaChallengeToken = r.token
    captcha.imageData = r.data
    captcha.input = ''
  } catch {
    toast(t('settings.captchaWrong'), false)
  } finally {
    captcha.busy = false
  }
}

/** 验证图形码 → 拿 captcha_token → 带 token 重交反馈 */
async function submitCaptchaAndRetry(): Promise<void> {
  if (!canSendFeedback.value || captcha.busy) return
  const key = captcha.input.trim()
  if (!key) return
  captcha.busy = true
  feedbackSending.value = true
  try {
    const auth = getCbAuth() as CbAuthCaptcha | null
    if (!auth?.verifyCaptchaData) throw new Error('captcha unavailable')
    const res = await auth.verifyCaptchaData({ token: captchaChallengeToken, key })
    const verified = res?.data?.captcha_token || res?.captcha_token
    if (!verified) throw new Error('verify failed')
    captchaVerifiedToken = verified
    captcha.visible = false
    await submitFeedback()
  } catch {
    toast(t('settings.captchaWrong'), false)
    captcha.input = ''
    captcha.busy = false
    await refreshCaptcha()
  } finally {
    captcha.busy = false
    feedbackSending.value = false
  }
}

async function copyFeedbackEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
    toast(t('settings.emailCopied'), true)
  } catch {
    // clipboard API 不可用（旧浏览器/非安全上下文）：提示手动选中复制
    toast(t('settings.copyEmailFailed'), false)
  }
  uiStore.overlays.feedback = false
}

function openFeedbackMail() {
  window.open('mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(t('settings.feedbackSubject')), '_blank')
  uiStore.overlays.feedback = false
}

async function submitFeedback() {
  if (!canSendFeedback.value) return
  feedbackSending.value = true
  try {
    // PoW 无感解答（预解过则零等待）；有效 PoW 服务端直接放行
    const pow = isCloudBaseBackend() ? await ensurePowSolution() : null
    const payload: Record<string, unknown> = {
      message: feedbackText.value.trim(),
      contact: feedbackContact.value.trim(),
      locale: locale.value,
      appVersion: APP_VERSION,
      captcha_token: captchaVerifiedToken,
      website: feedbackHoneypot.value,
    }
    if (pow) payload.pow = pow
    let ok = false
    let errCode = ''
    if (isCloudBaseBackend()) {
      if (!getCbFnBase()) { toast(t('settings.feedbackFailed'), false); return }
      // 服务端成功回 {ok:true}（honeypot 也回 ok——对机器人保持静默）；失败回 {error:'...'}。
      // 非 2xx 时 invokeCbFunction 仍读 body，所以错误码在 data.error 里。
      let r = await invokeCbFunction('send-feedback', payload)
      let d = (r.data || {}) as { error?: string; ok?: boolean; pow?: PowChallenge }
      // PoW 失效（过期/重放）且服务端附新挑战 → 自动重解重交一次（仍无感）
      if (d.error === 'pow_required' && d.pow) {
        const retried = await solvePowChallenge(d.pow)
        if (retried) {
          payload.pow = retried
          r = await invokeCbFunction('send-feedback', payload)
          d = (r.data || {}) as { error?: string; ok?: boolean; pow?: PowChallenge }
        }
      }
      // 图形人机验证兜底（PoW 失败/缺失时）：弹验证码，验证后带 captcha_token 重交
      if (d.error === 'captcha_required' && !captcha.visible) {
        feedbackSending.value = false
        await startCaptcha()
        return
      }
      ok = !r.error || d.ok === true
      errCode = d.error || ''
    } else {
      if (!FEEDBACK_ENDPOINT || !FEEDBACK_ANON_KEY) { toast(t('settings.feedbackFailed'), false); return }
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: FEEDBACK_ANON_KEY },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      ok = res.ok
      errCode = data.error || ''
    }
    if (!ok) {
      toast(t(FEEDBACK_ERROR_KEYS[errCode] || 'settings.feedbackFailed'), false)
      return
    }
    toast(t('settings.feedbackSent'), true)
    feedbackText.value = ''
    feedbackContact.value = ''
    uiStore.overlays.feedback = false
  } catch {
    toast(t('settings.feedbackFailed'), false)
  } finally {
    feedbackSending.value = false
  }
}
</script>
