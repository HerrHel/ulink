<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="uiStore.panels.settings"
        class="settings-modal-wrap settings-drawer-wrap"
        role="dialog"
        aria-modal="true"
        :aria-label="t('settings.title')"
        @mousedown="onMaskMouseDown" @click="onMaskClick" @keydown.esc="uiStore.panels.settings = false"
      >
        <div class="settings-dialog settings-drawer" data-testid="lv-settings-drawer" @click.stop>
          <!-- 弹窗顶栏 -->
          <div class="settings-dialog-head settings-drawer-head">
            <div class="settings-dialog-title-row">
              <span class="settings-dialog-icon" aria-hidden="true" v-html="I.settings"></span>
              <h2 class="settings-dialog-title settings-drawer-title">{{ t('settings.title') }}</h2>
            </div>
            <div class="settings-dialog-actions">
              <button class="sp-help-btn" @click.stop="onOpenShortcutHelp" :aria-label="t('settings.shortcutHelp')" :title="t('settings.shortcutHelp')">?</button>
              <button class="modal-close" @click="uiStore.panels.settings = false" :aria-label="t('settings.closeSettings')">&times;</button>
            </div>
          </div>

          <!-- 弹窗主体：左侧分类导航 + 右侧设置内容 -->
          <div class="settings-dialog-body settings-drawer-body">
            <!-- 左侧导航选项卡（无 emoji） -->
            <nav class="settings-nav" aria-label="Settings navigation">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                class="settings-nav-item"
                :class="{ active: currentTab === tab.id }"
                :data-testid="'settings-tab-' + tab.id"
                @click="currentTab = tab.id"
              >
                <span class="nav-item-icon" aria-hidden="true" v-html="tab.icon"></span>
                <span class="nav-item-label">{{ t(tab.labelKey) }}</span>
                <span v-if="tab.badge" class="nav-item-badge">{{ tab.badge }}</span>
              </button>
            </nav>

            <!-- 右侧设置内容主视窗 -->
            <div class="settings-content-pane">
              <!-- Tab 1: 账号与安全 -->
              <div v-show="currentTab === 'account'" class="settings-tab-panel" data-testid="settings-panel-account">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabAccount') }}</h3>
                  <p class="sp-tab-desc">管理您的云端账户、同步状态与端到端安全加密保护</p>
                </div>

                <!-- 账号与同步卡片 -->
                <div class="sp-card">
                  <div class="sp-card-head">{{ t('settings.syncSecurity') }}</div>
                  <template v-if="auth.isLoggedIn">
                    <div class="sp-card-row sp-user-main-row">
                      <div class="sp-user-avatar">
                        <span v-if="auth.avatar" class="sp-user-emoji">{{ auth.avatar }}</span>
                        <span v-else class="sp-user-initial">{{ userInitial }}</span>
                      </div>
                      <div class="sp-user-details">
                        <div class="sp-user-name-row">
                          <span class="sp-user-name">{{ auth.displayName || userDisplay }}</span>
                          <button class="btn btn-ghost btn-xs sp-edit-profile-btn" @click.stop="toggleProfileEditor">
                            <span aria-hidden="true" v-html="I.edit"></span>
                            {{ isEditingProfile ? t('userPopover.closeEdit') : t('userPopover.editProfile') }}
                          </button>
                        </div>
                        <span class="sp-user-email">{{ auth.userEmail }}</span>
                      </div>
                    </div>

                    <!-- 云端多端同步 -->
                    <div class="sp-card-row sp-sync-card-row">
                      <div class="sp-row-meta">
                        <div class="sp-sync-title-row">
                          <span class="sp-row-title">{{ t('settings.cloudMultiSync') }}</span>
                          <span class="sp-sync-status" data-testid="lv-sync-label" :class="syncState.level">
                            <span class="sp-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
                          </span>
                        </div>
                        <span class="sp-row-desc">{{ syncDetailDesc }}</span>
                        <!-- 异常与错误明细提示 -->
                        <div v-if="syncErrorMessage" class="sp-sync-error-banner" :class="{ 'is-quota': syncState.level === 'quota' }" data-testid="lv-sync-error-banner">
                          <span class="sp-error-icon" aria-hidden="true" v-html="I.alert"></span>
                          <div class="sp-error-text">
                            <div class="sp-error-summary">{{ syncErrorSummary }}</div>
                            <div v-if="syncErrorDetail" class="sp-error-detail">{{ syncErrorDetail }}</div>
                          </div>
                        </div>
                      </div>
                      <div class="sp-row-ctrl sp-sync-actions">
                        <button
                          v-if="sync.syncErrorKind.value === 'auth'"
                          class="btn btn-primary btn-sm"
                          data-testid="sp-reauth-btn"
                          @click.stop="onOpenAuthModal"
                        >
                          <span aria-hidden="true" v-html="I.login"></span>
                          {{ t('sync.reauth') }}
                        </button>
                        <button
                          class="btn btn-secondary btn-sm"
                          data-testid="sp-retry-sync-btn"
                          :disabled="isSyncing || isResyncing"
                          @click.stop="onManualSync"
                          :title="isSyncing ? t('sync.syncing') : (canRetrySync ? t('sync.retrySync') : t('sync.syncNow'))"
                        >
                          <span aria-hidden="true" v-html="I.refresh" :class="{ 'icon-spin': isSyncing }"></span>
                          {{ isSyncing ? t('sync.syncing') : (canRetrySync ? t('sync.retrySync') : t('sync.syncNow')) }}
                        </button>
                        <button
                          v-if="syncState.level === 'conflict'"
                          class="btn btn-ghost btn-sm"
                          data-testid="sp-view-conflicts-btn"
                          @click.stop="onViewConflicts"
                        >
                          <span aria-hidden="true" v-html="I.alert"></span>
                          {{ t('sync.viewConflicts') }}
                        </button>
                        <button
                          class="btn btn-ghost btn-sm"
                          data-testid="sp-resync-all-btn"
                          :disabled="isSyncing || isResyncing"
                          @click.stop="onResyncAll"
                          :title="t('sync.resyncAllHint')"
                        >
                          <span aria-hidden="true" v-html="I.cloud"></span>
                          {{ isResyncing ? t('sync.resyncing') : t('sync.resyncAll') }}
                        </button>
                      </div>
                    </div>

                    <!-- 个人资料编辑卡片 -->
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

                    <div class="sp-card-row">
                      <div class="sp-row-meta">
                        <span class="sp-row-title">{{ t('settings.setPassword') }}</span>
                        <span class="sp-row-desc">设置或修改您的独立登录密码，方便在其他设备快捷登录</span>
                      </div>
                      <div class="sp-row-ctrl">
                        <button class="btn btn-secondary btn-sm" id="spSetPasswordBtn" @click.stop="onOpenSetPassword">
                          <span aria-hidden="true" v-html="I.password"></span>
                          {{ t('settings.setPassword') }}
                        </button>
                      </div>
                    </div>

                    <div class="sp-card-row">
                      <div class="sp-row-meta">
                        <span class="sp-row-title">{{ t('userPopover.signOut') }}</span>
                        <span class="sp-row-desc">退出当前设备的登录态，本地数据仍将安全保存在本机</span>
                      </div>
                      <div class="sp-row-ctrl">
                        <button class="btn btn-ghost btn-sm text-danger" @click.stop="onLogout">
                          <span aria-hidden="true" v-html="I.logout"></span>
                          {{ t('userPopover.signOut') }}
                        </button>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="sp-card-row">
                      <div class="sp-row-meta">
                        <span class="sp-row-title">账号登录与多端同步</span>
                        <span class="sp-row-desc">{{ t('settings.loginHint') }}</span>
                      </div>
                      <div class="sp-row-ctrl">
                        <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">{{ t('settings.loginRegister') }}</button>
                      </div>
                    </div>
                  </template>
                </div>

                <!-- 端到端加密卡片 -->
                <div class="sp-card">
                  <div class="sp-card-head">{{ t('userPopover.e2eTitle') }}</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <div class="sp-row-title-with-badge">
                        <span class="sp-row-title">{{ t('userPopover.e2eTitle') }}</span>
                        <span class="sp-sync-status" data-testid="lv-e2e-status" :class="e2eEnabled ? (e2eUnlocked ? 'ok' : 'pending') : 'error'">
                          {{ e2eEnabled ? (e2eUnlocked ? t('settings.e2eUnlocked') : t('settings.e2eLocked')) : t('settings.e2eDisabled') }}
                        </span>
                      </div>
                      <span class="sp-row-desc">{{ t('settings.e2eHint') }}<span v-if="!auth.isLoggedIn">（{{ t('settings.e2eHintLocalOnly') }}）</span></span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button
                        v-if="!e2eEnabled"
                        class="btn btn-primary btn-sm"
                        data-testid="lv-e2e-setup-btn"
                        @click.stop="onOpenE2ESetup"
                      >
                        {{ t('userPopover.enableE2E') }}
                      </button>
                      <button
                        v-else-if="!e2eUnlocked"
                        class="btn btn-primary btn-sm"
                        data-testid="lv-e2e-unlock-btn"
                        @click.stop="onOpenE2EUnlock"
                      >
                        {{ e2e.isBiometricEnrolled.value ? (t('settings.biometricUnlock') || '指纹解密') : t('userPopover.decrypt') }}
                      </button>
                      <button
                        v-else
                        class="btn btn-secondary btn-sm"
                        data-testid="lv-e2e-lock-btn"
                        @click.stop="onE2ELock"
                      >
                        {{ t('userPopover.lock') }}
                      </button>
                    </div>
                  </div>
                  <div v-if="e2eEnabled && e2eUnlocked" class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">主密钥与生物识别安全</span>
                      <span class="sp-row-desc">更换加密密码或管理指纹/面容无感解密</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button class="btn btn-ghost btn-sm" data-testid="lv-e2e-changepw-btn" @click.stop="onOpenE2EChangePw">
                        <span aria-hidden="true" v-html="I.edit"></span> {{ t('settings.changeMasterPassword') }}
                      </button>
                      <button v-if="e2e.isBiometricEnrolled.value" class="btn btn-ghost btn-sm text-danger" data-testid="lv-e2e-biometric-remove" @click.stop="onRemoveBiometric">
                        {{ t('settings.removeBiometric') }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- 账号注销卡片 -->
                <div v-if="auth.isLoggedIn" class="sp-card sp-danger-card">
                  <div class="sp-card-head text-danger">{{ t('settings.danger') }}</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title text-danger">注销账号</span>
                      <span class="sp-row-desc">根据《个人信息保护法》第47条行使删除权，永久抹除云端所有数据与关联关系</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button
                        type="button"
                        class="btn btn-danger btn-sm"
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

              <!-- Tab: 会员与账单 -->
              <div v-show="currentTab === 'billing'" class="settings-tab-panel" data-testid="settings-panel-billing">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabBilling') }}</h3>
                  <p class="sp-tab-desc">{{ t('settings.tabBillingDesc') }}</p>
                </div>

                <!-- 会员与权益卡片 -->
                <div class="sp-card">
                  <div class="sp-card-head">{{ t('settings.membership') }}</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.currentPlan') }}</span>
                      <span class="sp-row-desc" v-if="entitlement.isPaid && entitlement.expiresAt">
                        {{ t('settings.expiresAt') }}: {{ formatExpiry(entitlement.expiresAt) }}
                      </span>
                      <span class="sp-row-desc" v-else>享受无限制书签归档、本地闪电检索与基础同步</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <span class="sp-sync-status" data-testid="lv-entitlement-plan">{{ entitlementLabel }}</span>
                      <span v-if="entitlement.isPaid && entitlement.expiresAt" class="hidden" data-testid="lv-entitlement-expiry">{{ entitlement.expiresAt }}</span>
                    </div>
                  </div>
                  <!-- 本月 AI 用量进度条（enforce 拦截前用户可见的消耗） -->
                  <div v-if="aiQuota && aiQuota.limit > 0" class="sp-card-row" data-testid="lv-ai-quota">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.aiQuota') }}</span>
                      <span class="sp-row-desc">{{ t('settings.aiQuotaUsed', { used: aiQuota.used, limit: aiQuota.limit }) }}</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-quota-bar" role="progressbar" :aria-valuenow="quotaPct" aria-valuemin="0" aria-valuemax="100">
                        <div class="sp-quota-fill" :class="{ warn: quotaPct >= 80 }" :style="{ width: quotaPct + '%' }"></div>
                      </div>
                    </div>
                  </div>
                  <!-- 在线订阅入口：价格与套餐来自服务端 plans 表，前端不硬编码 -->
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('purchase.title') }}</span>
                      <span class="sp-row-desc">{{ t('purchase.subtitle') }}</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm sp-upgrade-btn"
                        data-testid="lv-upgrade-btn"
                        @click="showPurchase = true"
                      >
                        {{ entitlement.isPaid ? t('purchase.renew') : t('purchase.upgrade') }}
                      </button>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">激活兑换码</span>
                      <span class="sp-row-desc">输入专属兑换码以升级至 PRO 会员权益</span>
                    </div>
                    <div class="sp-row-ctrl sp-redeem-ctrl">
                      <input
                        class="form-input sp-redeem-input"
                        type="text"
                        v-model="redeemInput"
                        :placeholder="t('settings.redeemPlaceholder')"
                        maxlength="64"
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
                </div>

                <!-- 交易记录卡片 -->
                <div v-if="auth.isLoggedIn" class="sp-card sp-card-transactions" data-testid="lv-transactions-card">
                  <div class="sp-card-head sp-tx-card-head">
                    <div class="sp-tx-title-group">
                      <span class="sp-tx-title">{{ t('settings.transactions') }}</span>
                      <span class="sp-tx-subtitle">{{ t('settings.transactionsDesc') }}</span>
                    </div>
                    <div class="sp-tx-head-actions">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs sp-tx-refresh-btn"
                        :class="{ 'is-spinning': loadingTx }"
                        :disabled="loadingTx"
                        :title="t('settings.txRefresh')"
                        :aria-label="t('settings.txRefresh')"
                        @click.stop="fetchTransactions()"
                      >
                        <span aria-hidden="true" v-html="I.refresh"></span>
                      </button>
                    </div>
                  </div>

                  <!-- 空状态 -->
                  <div v-if="!loadingTx && transactions.length === 0" class="sp-tx-empty">
                    <span class="sp-tx-empty-icon" aria-hidden="true" v-html="I.history"></span>
                    <div class="sp-tx-empty-title">{{ t('settings.txEmpty') }}</div>
                    <div class="sp-tx-empty-desc">{{ t('settings.txEmptyDesc') }}</div>
                  </div>

                  <!-- 交易明细表格 -->
                  <div v-else class="sp-tx-table-wrapper">
                    <table class="sp-tx-table">
                      <thead>
                        <tr>
                          <th>{{ t('settings.txTime') }}</th>
                          <th>{{ t('settings.txOrderNo') }}</th>
                          <th>{{ t('settings.txAmount') }}</th>
                          <th>{{ t('settings.txType') }}</th>
                          <th>{{ t('settings.txChannel') }}</th>
                          <th>{{ t('settings.txStatus') }}</th>
                          <th>{{ t('settings.txNotes') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="tx in transactions" :key="tx.orderId">
                          <td class="sp-tx-cell-time">{{ formatTxTime(tx.paidAt || tx.createdAt) }}</td>
                          <td class="sp-tx-cell-order">
                            <div class="sp-tx-order-box">
                              <span class="sp-tx-order-id" :title="tx.orderId">{{ tx.orderId }}</span>
                              <button
                                type="button"
                                class="btn btn-ghost btn-xs sp-tx-copy-btn"
                                :title="copiedTxOrderId === tx.orderId ? t('settings.txCopied') : t('common.copy')"
                                :aria-label="t('common.copy')"
                                @click.stop="copyOrderNo(tx.orderId)"
                              >
                                <span aria-hidden="true" v-html="copiedTxOrderId === tx.orderId ? I.check : I.copy"></span>
                              </button>
                            </div>
                          </td>
                          <td class="sp-tx-cell-amount">
                            <span class="sp-tx-amount" :class="{ 'is-zero': tx.amountCents === 0 }">
                              {{ tx.amountCents > 0 ? `¥ ${tx.amountYen}` : '¥ 0.00' }}
                            </span>
                          </td>
                          <td class="sp-tx-cell-type">
                            <span class="sp-tx-type-tag" :class="'type-' + tx.type">{{ tx.typeLabel }}</span>
                          </td>
                          <td class="sp-tx-cell-channel">{{ tx.channelLabel }}</td>
                          <td class="sp-tx-cell-status">
                            <span class="sp-tx-badge" :class="'status-' + tx.status">
                              <span class="sp-tx-badge-dot"></span>
                              {{ tx.statusLabel }}
                            </span>
                          </td>
                          <td class="sp-tx-cell-notes" :title="tx.notes || '-'">{{ tx.notes || '-' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <!-- 分页条 -->
                  <div v-if="totalTx > 0" class="sp-tx-pagination">
                    <span class="sp-tx-total">{{ t('settings.txTotal', { total: totalTx }) }}</span>
                    <div class="sp-tx-pager">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs sp-tx-page-btn"
                        :disabled="!hasPrevTx || loadingTx"
                        @click="prevTxPage"
                        aria-label="Previous page"
                      >
                        &lt;
                      </button>
                      <span class="sp-tx-page-box">{{ txPage }}</span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs sp-tx-page-btn"
                        :disabled="!hasNextTx || loadingTx"
                        @click="nextTxPage"
                        aria-label="Next page"
                      >
                        &gt;
                      </button>
                      <span class="sp-tx-page-size">{{ t('settings.txPerPage', { n: txPageSize }) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab 2: 外观与视图 -->
              <div v-show="currentTab === 'appearance'" class="settings-tab-panel" data-testid="settings-panel-appearance">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabAppearance') }}</h3>
                  <p class="sp-tab-desc">自定义界面色彩、卡片排布密度与书签排序模式</p>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">色彩与主题</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.theme') }}</span>
                      <span class="sp-row-desc">选择浅色明亮或深色低对比护眼模式</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-seg">
                        <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'light' }" @click.stop="onSetThemeColor('light', $event)">
                          <span aria-hidden="true" v-html="I.sun" class="sp-icon"></span>{{ t('settings.themeLight') }}
                        </button>
                        <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'dark' }" @click.stop="onSetThemeColor('dark', $event)">
                          <span aria-hidden="true" v-html="I.moon" class="sp-icon"></span>{{ t('settings.themeDark') }}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">设计风格</span>
                      <span class="sp-row-desc">效率模式注重紧凑信息密度，舒适模式具有更柔和的留白</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-seg">
                        <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click.stop="onSetThemeStyle('premium')">{{ t('settings.themePremium') }}</button>
                        <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click.stop="onSetThemeStyle('comfortable')">{{ t('settings.themeComfortable') }}</button>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row" @click.stop="onToggleAutoTheme" style="cursor: pointer;">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.followSystem') }}</span>
                      <span class="sp-row-desc">根据操作系统的外观自动在深色与浅色之间切换</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-toggle-pill" :class="{ active: uiStore.themeMode === 'auto' }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">视图与排序</div>
                  <div class="sp-card-row" v-if="!uiStore.isMobile">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.layout') }}</span>
                      <span class="sp-row-desc">切换主视图书签卡片的大网格、紧凑列表或小宫格</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-seg">
                        <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" @click="onSetLayout('grid')" :title="t('settings.gridView')"><span aria-hidden="true" v-html="I.grid"></span> {{ t('settings.gridView') }}</button>
                        <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" @click="onSetLayout('list')" :title="t('settings.listView')"><span aria-hidden="true" v-html="I.list"></span> {{ t('settings.listView') }}</button>
                        <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'mini-grid' }" @click="onSetLayout('mini-grid')" :title="t('settings.miniGridView')"><span aria-hidden="true" v-html="I.miniGrid"></span> {{ t('settings.miniGridView') }}</button>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.sort') }}</span>
                      <span class="sp-row-desc">选择卡片默认的排列次序</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-seg sp-seg-wrap">
                        <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn" :class="{ active: uiStore.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ t(s.labelKey) }}</button>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row" @click="onToggleGroupsOnTop" style="cursor: pointer;">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.groupsOnTop') }}</span>
                      <span class="sp-row-desc">总是将含有多书签的聚合笔记组卡片优先置顶于分类前列</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-toggle-pill" :class="{ active: uiStore.groupsOnTop }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="sp-card" data-testid="lv-lang-switch">
                  <div class="sp-card-head">{{ t('settings.language') }}</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.language') }}</span>
                      <span class="sp-row-desc">切换软件界面的操作语言 / Switch application interface language</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-seg">
                        <button class="sp-seg-btn" :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">简体中文</button>
                        <button class="sp-seg-btn" :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">English</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab 3: AI 与智能 -->
              <div v-show="currentTab === 'ai'" class="settings-tab-panel" data-testid="settings-panel-ai">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabAi') }}</h3>
                  <p class="sp-tab-desc">配置智能书签提炼、自然语言意图检索与智能工作流</p>
                </div>

                <div class="sp-card" data-testid="lv-search-fill-section">
                  <div class="sp-card-head">智能特性与工作流</div>
                  <div class="sp-card-row" @click="onToggleAiRail" style="cursor: pointer;">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.aiRail') }}</span>
                      <span class="sp-row-desc">{{ t('settings.aiRailHint') }}</span>
                    </div>
                    <div class="sp-row-ctrl" data-testid="lv-ai-rail-toggle">
                      <div class="sp-toggle-pill" :class="{ active: uiStore.aiRailEnabled }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row" @click="onToggleSmartFill" style="cursor: pointer;">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">
                      {{ t('settings.smartFill') }}
                      <span class="sp-pro-tag">PRO</span>
                    </span>
                      <span class="sp-row-desc">{{ t('settings.smartFillHint') }}</span>
                    </div>
                    <div class="sp-row-ctrl" data-testid="lv-smart-fill-toggle">
                      <div class="sp-toggle-pill" :class="{ active: uiStore.smartFillEnabled }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row" @click="onToggleSemanticSearch" style="cursor: pointer;">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">
                        {{ t('settings.semanticSearch') }}
                        <span class="sp-pro-tag">PRO</span>
                      </span>
                      <span class="sp-row-desc">{{ t('settings.semanticSearchHint') }}</span>
                    </div>
                    <div class="sp-row-ctrl" data-testid="lv-semantic-search-toggle">
                      <div class="sp-toggle-pill" :class="{ active: uiStore.semanticSearchEnabled && isPro }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              <!-- Tab 4: 维护与分享 -->
              <div v-show="currentTab === 'maintenance'" class="settings-tab-panel" data-testid="settings-panel-maintenance">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabMaintenance') }}</h3>
                  <p class="sp-tab-desc">扫描书签库健康状态，集中管理所有对公分享的卡片与网页</p>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">{{ t('settings.maintenance') }}</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.checkDeadLinks') }}</span>
                      <span class="sp-row-desc">扫描所有书签的可访问性，自动标记失效或超时地址</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button class="btn btn-secondary btn-sm" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
                        <span aria-hidden="true" v-html="I.radar"></span>
                        <span>{{ dlChecking ? t('settings.checking') : t('settings.checkDeadLinks') }}</span>
                        <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
                        <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
                      </button>
                      <button v-if="deadCount + blockedCount > 0" class="btn btn-ghost btn-sm" @click.stop="onViewDeadLinks">
                        {{ t('settings.view') }}
                      </button>
                    </div>
                  </div>
                  <div v-if="dlChecking && dlProgress.total > 0" class="sp-progress-box">
                    <div class="sp-progress-track">
                      <div class="sp-progress-bar" :style="{ width: (dlProgress.done / dlProgress.total * 100) + '%' }"></div>
                    </div>
                    <span class="sp-progress-label">{{ dlProgress.done }}/{{ dlProgress.total }}</span>
                    <span v-if="dlProgress.truncated > 0" class="sp-progress-extra">{{ t('settings.dlScanLimited', { n: dlProgress.truncated }) }}</span>
                  </div>
                  <div class="sp-card-row" @click="onToggleAutoDeadCheck" style="cursor: pointer;">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">
                        {{ t('settings.autoDeadCheckWeekly') }}
                        <span class="sp-pro-tag">PRO</span>
                      </span>
                      <span class="sp-row-desc">{{ t('settings.autoDeadCheckWeeklyDesc') }}</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-toggle-pill" :class="{ active: dlAutoEnabled, locked: !dlAutoAllowed }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="sp-card sp-section-shares">
                  <div class="sp-card-head sp-shares-header">
                    <div class="sp-shares-head-title">
                      <span>{{ t('settings.shareManagement') }}</span>
                      <span v-if="allPublicShares.length > 0" class="sp-shares-count">({{ allPublicShares.length }})</span>
                    </div>
                    <button
                      v-if="allPublicShares.length > 1"
                      class="sp-shares-stop-all"
                      :title="t('settings.stopAllShares')"
                      @click.stop="onStopAllShares"
                    >
                      {{ t('settings.stopAllShares') }}
                    </button>
                  </div>
                  <p class="sp-desc" style="padding: 10px 16px 4px;">{{ t('settings.publicSharesDesc') }}</p>
                  <div v-if="allPublicShares.length > 0" class="sp-shares-list-wrap">
                    <div v-for="item in allPublicShares" :key="item.type + ':' + item.id" class="sp-share-item">
                      <div class="sp-share-info">
                        <span class="sp-share-badge" :class="'sp-share-badge--' + item.type">
                          {{ item.type === 'group' ? t('settings.shareTypeGroup') : t('settings.shareTypeCategory') }}
                        </span>
                        <span class="sp-share-title" :title="item.title">{{ item.title }}</span>
                      </div>
                      <div class="sp-share-actions">
                        <button type="button" class="sp-share-btn" :title="t('modal.share.copyLink')" @click.stop="onCopyShare(item.url)" v-html="I.link"></button>
                        <a :href="item.url" target="_blank" rel="noopener noreferrer" class="sp-share-btn" :title="t('modal.share.preview')" @click.stop v-html="I.external"></a>
                        <button type="button" class="sp-share-btn sp-share-btn--danger" :title="t('modal.share.stopShare')" @click.stop="onStopShareItem(item)" v-html="I.close"></button>
                      </div>
                    </div>
                  </div>
                  <div v-else class="sp-shares-empty">
                    {{ t('settings.noPublicShares') }}
                  </div>
                </div>
              </div>

              <!-- Tab 5: 数据与备份 -->
              <div v-show="currentTab === 'data'" class="settings-tab-panel" data-testid="settings-panel-data">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabData') }}</h3>
                  <p class="sp-tab-desc">查看存储容量配额、备份还原及外部书签数据导入导出</p>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">存储配额与快照</div>
                  <div v-if="storageInfo" class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.storageOccupied') }}</span>
                      <span class="sp-row-desc">已使用 {{ storageInfo.label }}（约占可用配额 {{ storageInfo.percent }}%）</span>
                    </div>
                    <div class="sp-row-ctrl sp-storage-ctrl">
                      <div class="sp-storage-track">
                        <div class="sp-storage-bar" :style="{ width: storageInfo.percent + '%', background: storageBarColor }"></div>
                      </div>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.trash') }}</span>
                      <span class="sp-row-desc">已删除的书签与分组可在回收站内随时撤销还原</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button class="btn btn-secondary btn-sm" @click.stop="onOpenTrash">
                        <span aria-hidden="true" v-html="trashIcon"></span>
                        {{ t('settings.trash') }}
                      </button>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.historyMax') }}</span>
                      <span class="sp-row-desc">每个书签保留的历史版本深度（当前: {{ uiStore.historyMax }} 条）</span>
                    </div>
                    <div class="sp-row-ctrl sp-range-ctrl">
                      <input type="range" class="sp-range" min="5" max="30" step="1" v-model.number="uiStore.historyMax" @change="onHistoryMaxChange" />
                      <span class="sp-range-hint">{{ uiStore.historyMax }}</span>
                    </div>
                  </div>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">备份与数据迁移</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.import') }}</span>
                      <span class="sp-row-desc">从 Chrome、Edge 导出的 HTML 书签或 JSON 备份导入</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button class="btn btn-secondary btn-sm" @click.stop="onTriggerImport">
                        <span aria-hidden="true" v-html="I.import"></span>
                        {{ t('settings.import') }}
                      </button>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.export') }}</span>
                      <span class="sp-row-desc">将书签完整导出为 JSON 快照、HTML 或 CSV 表格</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-export-dropdown" @click.stop>
                        <button class="btn btn-secondary btn-sm" @click="exportMenuOpen = !exportMenuOpen">
                          <span aria-hidden="true" v-html="I.export"></span>
                          {{ t('settings.export') }}
                          <span class="sp-caret" :class="{ open: exportMenuOpen }">›</span>
                        </button>
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
                  </div>
                  <div class="sp-card-row" @click="onToggleExportKeepSensitive" style="cursor: pointer;" data-testid="lv-export-sensitive-toggle">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.exportKeepSensitive') }}</span>
                      <span class="sp-row-desc">{{ t('settings.exportKeepSensitiveHint') }}</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <div class="sp-toggle-pill" :class="{ active: exportKeepSensitive }">
                        <span class="sp-switch"></span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="sp-card sp-danger-card">
                  <div class="sp-card-head text-danger">{{ t('settings.danger') }}</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title text-danger">{{ t('settings.resetData') }}</span>
                      <span class="sp-row-desc">清空本地存储的所有书签、自定义分组与偏好设置，恢复初始化状态</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button class="btn btn-danger btn-sm" @click.stop="onResetData">
                        <span aria-hidden="true" v-html="I.trash"></span>
                        {{ t('settings.resetData') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Tab 6: 关于与帮助 -->
              <div v-show="currentTab === 'about'" class="settings-tab-panel" data-testid="settings-panel-about">
                <div class="sp-tab-header">
                  <h3 class="sp-tab-title">{{ t('settings.tabAbout') }}</h3>
                  <p class="sp-tab-desc">查看版本发布信息、快捷键速查及法律协议条款</p>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">应用信息</div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.version') }}</span>
                      <span class="sp-row-desc">{{ t('settings.buildTime') }}: {{ buildTimeText }}</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <span class="sp-version-badge" data-testid="lv-app-version">v{{ APP_VERSION }}</span>
                      <span class="hidden" data-testid="lv-build-time">{{ buildTimeText }}</span>
                    </div>
                  </div>
                  <div class="sp-card-row">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.shortcutHelp') }}</span>
                      <span class="sp-row-desc">查看全局快捷键表以获得最佳键盘操作体验</span>
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
                      <span class="sp-row-desc">遇到使用问题或功能建议？直接向我们反馈</span>
                    </div>
                    <div class="sp-row-ctrl">
                      <button class="btn btn-primary btn-sm" @click.stop="onFeedback">{{ t('settings.feedback') }}</button>
                    </div>
                  </div>
                </div>

                <div class="sp-card">
                  <div class="sp-card-head">{{ t('settings.legalDocs') }}</div>
                  <div class="sp-card-row" @click="showLegal = !showLegal" style="cursor: pointer;" data-testid="lv-legal-toggle">
                    <div class="sp-row-meta">
                      <span class="sp-row-title">{{ t('settings.legalDocs') }}</span>
                      <span class="sp-row-desc">查看用户使用协议、个人隐私保护政策与退款细则</span>
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
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 反馈 / 建议 弹窗：直接填写内容提交到企业邮箱（保留复制 / mailto 兜底） -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="uiStore.overlays.feedback" class="modal-mask open" role="dialog" aria-modal="true" :aria-label="t('settings.feedback')" @mousedown="onFeedbackMaskMouseDown" @click="onFeedbackMaskClick">
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
  <!-- 购买弹窗：挂在最外层，避免被 drawer 的 overflow 裁切 -->
  <PurchaseModal :visible="showPurchase" :current-plan-id="entitlement.planId" @close="showPurchase = false" @paid="onPurchasePaid" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
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
import { LEGAL_DOC_LINKS } from '../../config/aiProviders.js'
import { purgeAccount } from '../../composables/domain/useAccountDeletion.js'
import { ICP_NUMBER, MPS_NUMBER, MIIT_URL, mpsQueryUrl } from '../../config/site.js'
import PurchaseModal from '../modals/PurchaseModal.vue'
import { dbRpc } from '../../lib/dbApi.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'
import {
  redeemCode,
  type MyEntitlement,
  type RedeemError,
} from '../../composables/domain/useRedeem.js'
import { PRESET_AVATAR_EMOJIS } from '../../lib/avatar.js'
import { useTransactions } from '../../composables/domain/useTransactions.js'
import { t, tN, useI18n } from '../../i18n/index.js'

// 语言切换：locale 为响应式 computed，切语言后本面板与全局文案立即更新
export type SettingsTab = 'account' | 'billing' | 'appearance' | 'ai' | 'maintenance' | 'data' | 'about'
const currentTab = ref<SettingsTab>('account')

const { locale, setLocale } = useI18n()

// 用户交易明细与记录
const {
  transactions,
  loading: loadingTx,
  total: totalTx,
  page: txPage,
  pageSize: txPageSize,
  hasPrev: hasPrevTx,
  hasNext: hasNextTx,
  fetchTransactions,
  nextPage: nextTxPage,
  prevPage: prevTxPage,
  formatTxTime,
} = useTransactions()

const copiedTxOrderId = ref<string | null>(null)
let copyTxTimer: ReturnType<typeof setTimeout> | null = null

async function copyOrderNo(orderId: string) {
  if (!orderId) return
  await copyToClipboard(orderId)
  copiedTxOrderId.value = orderId
  toast(t('settings.txCopied'))
  if (copyTxTimer) clearTimeout(copyTxTimer)
  copyTxTimer = setTimeout(() => {
    copiedTxOrderId.value = null
  }, 2000)
}


function triggerImport() { const el = document.getElementById('importFile') as HTMLInputElement | null; if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() } }

function onOpenShortcutHelp() { pushNavState(); uiStore.panels.shortcutHelp = true; uiStore.panels.settings = false }

const uiStore = useUIStore()
const { onMaskMouseDown, onMaskClick } = useMaskClose(() => {
  uiStore.panels.settings = false
})
const { onMaskMouseDown: onFeedbackMaskMouseDown, onMaskClick: onFeedbackMaskClick } = useMaskClose(() => {
  uiStore.overlays.feedback = false
})
const dataStore = useDataStore()
const appStore = useAppStore()

const storageInfo = computed(() => {
  try { return appStore.getStorageInfo() } catch { return null }
})
const storageBarColor = computed(() => storageBarColorFor(storageInfo.value?.percent))
const auth = useAuth()
const sync = useCloudSync()
const syncState = useSyncState()
const dl = useDeadLinkChecker()
const e2e = useE2E()

const isResyncing = ref(false)
const isManualSyncing = ref(false)
const isSyncing = computed(() => syncState.value.level === 'syncing' || isManualSyncing.value)

const canRetrySync = computed(() =>
  syncState.value.level === 'error' ||
  syncState.value.level === 'offline' ||
  syncState.value.level === 'quota',
)

async function onManualSync() {
  if (isSyncing.value || isResyncing.value) return
  isManualSyncing.value = true
  toast(t('sync.startSync'))
  try {
    const ok = await sync.fullSync()
    if (ok) {
      toast('同步完成', true)
    } else {
      toast(sync.syncError.value || '同步失败', false)
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : '同步失败', false)
  } finally {
    isManualSyncing.value = false
  }
}

async function onResyncAll() {
  if (isResyncing.value || isSyncing.value) return
  isResyncing.value = true
  toast(t('sync.startSync'))
  try {
    const ok = await sync.resyncAllToCloud()
    toast(ok ? t('sync.resyncAllDone') : t('sync.resyncAllFailed'), ok)
  } catch (err) {
    toast(err instanceof Error ? err.message : t('sync.resyncAllFailed'), false)
  } finally {
    isResyncing.value = false
  }
}

function onViewConflicts() {
  sync.resetConflictBannerDismissed()
  toast(t('sync.viewConflicts'))
}

function onOpenAuthModal() {
  uiStore.panels.settings = false
  auth.authModalOpen = true
}

const syncDetailDesc = computed(() => {
  if (sync.lastSyncAt.value) {
    const diff = Date.now() - sync.lastSyncAt.value
    let timeStr = '刚刚'
    if (diff >= 3600000) {
      timeStr = Math.floor(diff / 3600000) + ' 小时前'
    } else if (diff >= 60000) {
      timeStr = Math.floor(diff / 60000) + ' 分钟前'
    }
    return '上次同步于 ' + timeStr + ' · 云端多端自动保持实时一致'
  }
  return '书签、分组与个性化设置自动实时加密同步至云端'
})

const syncErrorMessage = computed(() => {
  if (syncState.value.level === 'quota') {
    return '云端存储空间已满，你的数据已安全保存在本机，不受影响；空间恢复后点「强制全量重传」自动追平。'
  }
  if (sync.syncErrorKind.value === 'auth') {
    return '账号登录状态已失效或凭证已过期，请重新登录以恢复多端同步。'
  }
  if (sync.syncErrorKind.value === 'network') {
    return '网络连接失败或当前处于离线状态，恢复网络连接后将自动同步。'
  }
  if (syncState.value.level === 'error' && sync.syncError.value) {
    return sync.syncError.value
  }
  return ''
})

const syncErrorSummary = computed(() => {
  if (syncState.value.level === 'quota') return '云端存储空间已满'
  if (sync.syncErrorKind.value === 'auth') return '登录凭证已失效'
  if (sync.syncErrorKind.value === 'network') return '网络连接异常'
  return '同步遇到问题'
})

const syncErrorDetail = computed(() => {
  if (syncState.value.level === 'quota') {
    return '本地数据完整且安全，可清理空间后点击「强制全量重传」恢复推送。'
  }
  if (sync.syncErrorKind.value === 'auth') {
    return '凭证失效通常由于长时间未登录或在其他设备修改了密码，点击「重新登录」即可。'
  }
  if (sync.syncErrorKind.value === 'network') {
    return '请检查当前网络连接或代理，网络恢复后系统会自动重新建立连接。'
  }
  return sync.syncError.value || '部分数据未能成功同步至云端，可尝试点击「重试同步」或「强制全量重传」。'
})

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

// 法律协议（可展开区块）
const showLegal = ref(false)
const legalDocs = LEGAL_DOC_LINKS

// 账号注销
const deletingAccount = ref(false)

/** 备案信息：ICP 号链接工信部，公安联网备案号链接公安平台；号为空则整块不渲染 */
const beianLinks = computed(() => {
  const out: { text: string; href: string }[] = []
  if (ICP_NUMBER) out.push({ text: ICP_NUMBER, href: MIIT_URL })
  if (MPS_NUMBER) out.push({ text: MPS_NUMBER, href: mpsQueryUrl() })
  return out
})

// 会员权益与兑换码
const entService = useEntitlement()
const isPro = entService.isPro
const entitlement = ref<MyEntitlement>({
  planId: 'free',
  planName: 'free',
  status: 'active',
  expiresAt: null,
  features: {},
  isPaid: false,
})
const redeemInput = ref('')
const redeeming = ref(false)

/** 本月 AI 用量（设置面板进度条；enforce 门控的数据源同一 RPC） */
const aiQuota = ref<{ used: number; limit: number } | null>(null)
const quotaPct = computed(() => {
  const q = aiQuota.value
  if (!q || q.limit <= 0) return 0
  return Math.min(100, Math.round((q.used / q.limit) * 100))
})
async function loadAiQuota(): Promise<void> {
  const uid = (auth as { user?: { id?: string } }).user?.id
  if (!auth.isLoggedIn || !uid) {
    aiQuota.value = null
    return
  }
  try {
    const { data, error } = await dbRpc('ai_quota_check', { p_uid: uid })
    if (error || !data) return
    const d = data as { used_tokens?: number; limit_tokens?: number }
    aiQuota.value = {
      used: Math.round(Number(d.used_tokens) || 0),
      limit: Math.round(Number(d.limit_tokens) || 0),
    }
  } catch {
    /* 静默：进度条只是信息展示，不影响主流程 */
  }
}

/** 购买弹窗开关 */
const showPurchase = ref(false)

/** 支付成功后刷新权益（后端发货已幂等，这里只负责把最新权益拉回来） */
async function onPurchasePaid() {
  try {
    await entService.refresh()
    void loadAiQuota()
    void fetchTransactions(1)
  } catch {
    /* 刷新失败不影响支付结果本身，下次打开设置会重新拉 */
  }
  void loadAiQuota()
}

/** 有效期格式化：ISO → 本地可读（例：2026/10/31 11:12） */
function formatExpiry(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const entitlementLabel = computed(() => {
  if (!entitlement.value.isPaid) return t('settings.freePlan')
  const map: Record<string, string> = {
    pro_monthly: t('settings.planPlusMonthly'),
    pro_yearly: t('settings.planPlusYearly'),
    pro_quarterly: 'PRO 季付',
    plus_monthly: t('settings.planPlusMonthly'),
    plus_yearly: t('settings.planPlusYearly'),
  }
  // 优先服务端 plan_name（测试档等非内置套餐也能显示名称），再退内置映射，最后退 planId
  return map[entitlement.value.planId] || entitlement.value.planName || entitlement.value.planId
})

async function refreshEntitlement() {
  if (!auth.isLoggedIn) {
    entService.clear()
    await dl.refreshAutoCheckAllowed(entitlement.value)
    return
  }
  await entService.refresh()
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
      void fetchTransactions(1)
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

// dl and e2e initialized at top
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

function onToggleSmartFill() {
  uiStore.smartFillEnabled = !uiStore.smartFillEnabled
  uiStore.saveUIState()
  toast(uiStore.smartFillEnabled ? t('settings.smartFillOnToast') : t('settings.smartFillOffToast'), true)
}

function onToggleSemanticSearch() {
  if (!isPro.value) {
    toast(t('settings.semanticSearchNeedsPro'), false)
    showPurchase.value = true
    return
  }
  uiStore.semanticSearchEnabled = !uiStore.semanticSearchEnabled
  uiStore.saveUIState()
  toast(uiStore.semanticSearchEnabled ? t('settings.semanticSearchOnToast') : t('settings.semanticSearchOffToast'), true)
}

function onToggleAiRail() {
  uiStore.aiRailEnabled = !uiStore.aiRailEnabled
  if (!uiStore.aiRailEnabled && uiStore.activeView === 'ai') {
    uiStore.activeView = 'bookmarks'
  }
  uiStore.saveUIState()
  toast(uiStore.aiRailEnabled ? t('settings.aiRailOnToast') : t('settings.aiRailOffToast'), true)
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
    showPurchase.value = true
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
  if (open) {
    if (uiStore.settingsInitialTab) {
      currentTab.value = uiStore.settingsInitialTab as SettingsTab
      uiStore.settingsInitialTab = ''
    }
    loadUserCategoryShares()
    if (auth.isLoggedIn) {
      void refreshEntitlement()
      if (currentTab.value === 'billing' || currentTab.value === 'account') {
        void fetchTransactions()
        void loadAiQuota()
      }
    }
  }
})

watch(() => currentTab.value, (tab) => {
  if ((tab === 'billing' || tab === 'account') && uiStore.panels.settings && auth.isLoggedIn) {
    void fetchTransactions()
    void refreshEntitlement()
    void loadAiQuota()
  }
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





const tabs = computed(() => [
  {
    id: 'account' as SettingsTab,
    labelKey: 'settings.tabAccount',
    icon: I.user,
    badge: syncState.value?.level === 'error' ? '!' : undefined,
    group: 'account',
  },
  {
    id: 'billing' as SettingsTab,
    labelKey: 'settings.tabBilling',
    icon: I.creditCard || I.sparkles,
    group: 'account',
  },
  {
    id: 'appearance' as SettingsTab,
    labelKey: 'settings.tabAppearance',
    icon: I.sun,
    group: 'experience',
  },
  {
    id: 'ai' as SettingsTab,
    labelKey: 'settings.tabAi',
    icon: I.sparkles,
    group: 'experience',
  },
  {
    id: 'maintenance' as SettingsTab,
    labelKey: 'settings.tabMaintenance',
    icon: I.radar,
    badge: (deadCount.value + blockedCount.value > 0)
      ? String(deadCount.value + blockedCount.value)
      : (allPublicShares.value.length > 0 ? String(allPublicShares.value.length) : undefined),
    group: 'system',
  },
  {
    id: 'data' as SettingsTab,
    labelKey: 'settings.tabData',
    icon: I.database || I.import,
    group: 'system',
  },
  {
    id: 'about' as SettingsTab,
    labelKey: 'settings.tabAbout',
    icon: I.info,
    group: 'system',
  },
])

</script>
