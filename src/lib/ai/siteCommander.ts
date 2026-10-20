/**
 * siteCommander.ts — 与链站内指令调度器 (In-App AI Agent / CLI)
 * 职责：
 * 1. 解析侧边栏对话框中的斜杠快捷指令与自然语言意图；
 * 2. 直接操控站内 Store / UI / 主题 / 导出 / 整理操作；
 * 3. 增强透明度：提供工具调用执行轨迹 (steps) 与行动卡片 (actionCard)；
 * 4. 增强安全性与可逆性：危险操作强制二次确认 (HITL)，支持对话式撤销 (/undo)；
 * 5. 上下文感知：感知当前浏览分类与多选状态；
 * 6. 严守克制美学：杜绝浮夸 emoji，采用纯净、温润的文字与符号排版。
 *
 * 拆分说明（只拆分、不改行为）：undo 事务栈在 siteUndoStack.ts，命令执行在 siteActions.ts，
 * HITL 确认与行动卡片构造在 siteHitl.ts，意图解析（正则/参数提取）在 siteIntents.ts；
 * siteCommands/ 目录的指令块拆分进行中（本步已外迁 1.帮助 / 2.主题 / 3.视图 / 15.设置面板四块，
 * 其余 14 块暂留本文件），SiteCommandResult 定义移至 siteCommands/types.ts 并在此 re-export；
 * 本文件保留 dispatchSiteCommand 编排（意图块顺序与短路语义不变）并 re-export 原公开符号。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { useToastStore } from '../../stores/toast.js'
import { addNewCategory } from '../../utils.js'
import { exportData } from '../../composables/domain/useDataIO.js'
import {
  findDuplicateCandidates,
  isOfficialBookmark,
  isUncategorized,
  calculateVaultHealth,
  clusterUncategorizedBookmarks,
  detectParentChildRelations,
} from './localClustering.js'
import { CAT_UNCATEGORIZED, CAT_ALL } from '../../config/constants.js'
import {
  askConfirm,
  buildTrashClearConfirmMessage,
  buildMoveConfirmMessage,
  buildTrashActionCard,
  buildDedupActionCard,
  buildPackActionCard,
  buildHealDeadlinkCard,
  buildHealthInboxCard,
  buildHealthDedupCard,
  buildHealthTrashCard,
  buildInboxZeroActionCard,
} from './siteHitl.js'
import { searchWebsitesByIntent, findSimilarWebsites } from './cloudAiClient.js'
import {
  pushUndoAction,
  popUndoAction,
  getUndoStackDepth,
} from './siteUndoStack.js'
import {
  parseCatIntent,
  parseTrashIntent,
  parseDedupIntent,
  parsePackIntent,
  parseDeadlinkIntent,
  parseExportIntent,
  parseStatsIntent,
  parseHealthIntent,
  parseInboxIntent,
  parseBatchMoveIntent,
  parseMoveIntent,
  parseCurrentCatIntent,
  parseUndoIntent,
  parseCleanIntent,
} from './siteIntents.js'
import { helpBlock } from './siteCommands/help.js'
import { themeBlock } from './siteCommands/theme.js'
import { viewBlock } from './siteCommands/view.js'
import { settingsBlock } from './siteCommands/settings.js'
import type { SiteCommandResult } from './siteCommands/types.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark, Category } from '../../types.js'
import type { ChatActionCard } from './chatSessions.js'
import type { SiteCommanderContext } from './siteActions.js'

// ── re-export：撤销事务栈（单例在 siteUndoStack.ts） ──
export {
  pushUndoAction,
  popUndoAction,
  getUndoStackDepth,
  clearUndoStack,
  getLastUndoableAction,
  setLastUndoableAction,
} from './siteUndoStack.js'
export type { UndoableAction } from './siteUndoStack.js'

// ── re-export：命令执行层（siteActions.ts） ──
export {
  mergeDuplicateBookmarks,
  applyInboxZeroClustering,
  createTopicWorkspace,
  healDeadlink,
} from './siteActions.js'
export type {
  SiteCommanderContext,
  CreateTopicWorkspaceResult,
  HealDeadlinkResult,
} from './siteActions.js'

// ── re-export：命令结果类型（定义在 siteCommands/types.ts） ──
export type { SiteCommandResult } from './siteCommands/types.js'

/**
 * 调度站内命令与意图
 */
export async function dispatchSiteCommand(
  rawInput: string,
  context?: SiteCommanderContext,
): Promise<SiteCommandResult> {
  const query = rawInput.trim()
  if (!query) {
    return { handled: false, reply: '' }
  }

  const ds = context?.ds ?? useDataStore()
  const ui = context?.ui ?? useUIStore()
  const app = context?.app ?? useAppStore()

  // ── 1. 帮助说明 (/help, /?, 帮助) ──
  const helpResult = await helpBlock({ query, ds, ui, app })
  if (helpResult !== null) return helpResult

  // ── 2. 主题外观 (/theme, 切换深色/浅色) ──
  const themeResult = await themeBlock({ query, ds, ui, app })
  if (themeResult !== null) return themeResult

  // ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
  const viewResult = await viewBlock({ query, ds, ui, app })
  if (viewResult !== null) return viewResult

  // ── 4. 分类管理 (/cat, 新建分类) ──
  const catIntent = parseCatIntent(query)
  if (catIntent?.kind === 'list') {
    const activeCats = ds.categories.filter((c: Category) => !c.deletedAt)
    const lines = [t('aiCmd.catListHeader'), '']
    for (const cat of activeCats) {
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === cat.id).length
      lines.push(tN('aiCmd.catListLine', count, { name: cat.name }))
    }
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    lines.push(tN('aiCmd.catListLine', uncatCount, { name: t('aiCmd.catListUncategorized') }))
    return {
      handled: true,
      action: 'category_list',
      steps: [{ text: t('aiCmd.stepReadCats'), done: true }],
      reply: lines.join('\n'),
    }
  }

  const catName = catIntent?.kind === 'add' ? catIntent.name : null
  if (catName) {
    const trimmed = catName.trim()
    if (!trimmed) {
      return { handled: true, action: 'category_add', success: false, reply: t('aiCmd.catNameEmpty') }
    }
    const exists = ds.categories.some(
      (c: Category) => !c.deletedAt && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exists) {
      return {
        handled: true,
        action: 'category_add',
        success: false,
        steps: [{ text: t('aiCmd.stepCheckCatExists', { name: trimmed }), done: true }],
        reply: t('aiCmd.catExists', { name: trimmed }),
      }
    }
    const created = addNewCategory(trimmed, app)
    if (created) {
      pushUndoAction({
        type: 'category_add',
        description: t('aiCmd.undoCatDesc', { name: trimmed }),
        revert: () => {
          ds.deleteCategory(created.id)
          app.save()
          return t('aiCmd.undoCatRevert', { name: trimmed })
        },
      })
      return {
        handled: true,
        action: 'category_add',
        success: true,
        steps: [
          { text: t('aiCmd.stepValidateCat'), done: true },
          { text: t('aiCmd.stepCreateCat', { name: trimmed }), done: true },
        ],
        reply: t('aiCmd.catCreated', { name: trimmed }),
      }
    }
    return { handled: true, action: 'category_add', success: false, reply: t('aiCmd.catCreateFailed') }
  }

  // ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
  const trashIntent = parseTrashIntent(query)
  if (trashIntent === 'clear') {
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats
    if (total === 0) {
      return {
        handled: true,
        action: 'trash_clear',
        steps: [{ text: t('aiCmd.stepCheckTrash'), done: true }],
        reply: t('aiCmd.trashEmpty'),
      }
    }

    // Agent 危险操作人机确认 (Human-in-the-Loop)
    const confirmed = await askConfirm(buildTrashClearConfirmMessage(total, bms, grps, cats))
    if (context?.signal?.aborted) {
      return { handled: true, action: 'trash_clear', success: false, reply: '' }
    }
    if (!confirmed) {
      return {
        handled: true,
        action: 'trash_clear',
        success: false,
        steps: [{ text: t('aiCmd.stepUserCancelTrash'), done: true }],
        reply: t('aiCmd.trashClearCancelled'),
      }
    }

    ds.emptyTrash()
    app.save()
    return {
      handled: true,
      action: 'trash_clear',
      steps: [
        { text: tN('aiCmd.stepVerifyTrash', total), done: true },
        { text: t('aiCmd.stepHitlPassed'), done: true },
        { text: t('aiCmd.stepDoEmptyTrash'), done: true },
      ],
      reply: tN('aiCmd.trashCleared', total, { total, bm: bms, grp: grps, cat: cats }),
    }
  }

  if (trashIntent === 'open') {
    ui.panels.trash = true
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats

    return {
      handled: true,
      action: 'trash_open',
      steps: [{ text: t('aiCmd.stepOpenTrash'), done: true }],
      actionCard:
        total > 0
          ? buildTrashActionCard({ total, bm: bms, grp: grps })
          : undefined,
      reply: total > 0 ? tN('aiCmd.trashOpened', total) : t('aiCmd.trashOpenedEmpty'),
    }
  }

  // ── 6. 查重巡检 (/dedup, 查找重复书签) ──
  if (parseDedupIntent(query)) {
    const dups = findDuplicateCandidates(ds.bookmarks)
    if (!dups || dups.length === 0) {
      return {
        handled: true,
        action: 'dedup',
        steps: [
          { text: t('aiCmd.stepScanUrls'), done: true },
          { text: t('aiCmd.stepNoDupFound'), done: true },
        ],
        reply: t('aiCmd.dedupClean'),
      }
    }
    const dupCount = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
    const lines = [
      tN('aiCmd.dedupReport', dupCount, { groups: dups.length, count: dupCount }),
      '',
    ]
    const previewItems = dups.slice(0, 5)
    for (let i = 0; i < previewItems.length; i++) {
      const d = previewItems[i]
      lines.push(`${i + 1}. ${d.primary.title || t('aiCmd.untitled')}`)
      lines.push(t('aiCmd.dedupMainUrl', { url: d.normalizedUrl }))
      lines.push(
        tN('aiCmd.dedupCopies', d.duplicates.length, {
          titles: d.duplicates.map((dup) => dup.title || t('aiCmd.untitled')).join(', '),
        }),
      )
    }
    if (dups.length > 5) {
      lines.push(tN('aiCmd.dedupMore', dups.length - 5))
    }

    return {
      handled: true,
      action: 'dedup',
      steps: [
        { text: t('aiCmd.stepScanUrls'), done: true },
        { text: tN('aiCmd.stepDupFound', dups.length), done: true },
      ],
      actionCard: buildDedupActionCard({ dupCount, groups: dups.length }),
      reply: lines.join('\n'),
    }
  }

  // ── 6.5 主题工作台生成 (/pack <主题名>, 帮我搭建XX工作台) ──
  const packIntent = parsePackIntent(query)
  if (packIntent) {
    const rawTopic = packIntent.rawTopic
    if (!rawTopic) {
      return {
        handled: true,
        action: 'pack_workspace',
        steps: [{ text: t('aiCmd.stepPackHint'), done: true }],
        reply: [
          t('aiCmd.packHelpTitle'),
          '',
          t('aiCmd.packHelpUsage'),
          t('aiCmd.packHelpExamplesLabel'),
          t('aiCmd.packHelpExample1'),
          t('aiCmd.packHelpExample2'),
          t('aiCmd.packHelpExample3'),
          '',
          t('aiCmd.packHelpDesc'),
        ].join('\n'),
      }
    }

    const topicName = rawTopic
    const candidates = await searchWebsitesByIntent(topicName, [], ds.categories, ds.customAttributes)
    const previewList = candidates.slice(0, 5)

    const lines = [
      tN('aiCmd.packPlan', candidates.length, { topic: topicName }),
      '',
    ]
    for (let i = 0; i < previewList.length; i++) {
      const c = previewList[i]
      lines.push(t('aiCmd.packItem', { i: i + 1, title: c.title, desc: c.notes || c.url }))
    }
    if (candidates.length > 5) {
      lines.push(tN('aiCmd.packMore', candidates.length - 5))
    }
    lines.push('')
    lines.push(t('aiCmd.packCta'))

    const cleanTopic =
      topicName.endsWith('工作台') || topicName.endsWith('工具箱')
        ? topicName
        : `${topicName} 工作台`

    return {
      handled: true,
      action: 'pack_workspace',
      steps: [
        { text: tN('aiCmd.stepPackSelect', candidates.length, { topic: topicName }), done: true },
        { text: t('aiCmd.stepPackPlan'), done: true },
      ],
      reply: lines.join('\n'),
      actionCard: buildPackActionCard({ cleanTopic, candidates }),
    }
  }

  // ── 7. 死链检测与自愈 (/deadlink, 检查死链, 死链自愈) ──
  if (parseDeadlinkIntent(query)) {
    const deadBookmarks = ds.bookmarks.filter(
      (b: Bookmark) =>
        !b.deletedAt && b.attributes?.['dead-link'] && !b.attributes?.['dead-link-ignored'],
    )

    if (deadBookmarks.length === 0) {
      ui.overlays.deadLinks = true
      return {
        handled: true,
        action: 'deadlinks',
        steps: [{ text: t('aiCmd.stepScanDeadlinks'), done: true }],
        reply: t('aiCmd.deadNone'),
      }
    }

    const firstDead = deadBookmarks[0]
    const alts = await findSimilarWebsites(
      firstDead.url,
      firstDead.title,
      [],
      ds.categories,
      ds.customAttributes,
    )
    const bestAlt = alts[0]

    const lines = [
      tN('aiCmd.deadReport', deadBookmarks.length),
      '',
    ]
    for (let i = 0; i < Math.min(3, deadBookmarks.length); i++) {
      const b = deadBookmarks[i]
      const wbUrl = `https://web.archive.org/web/*/${encodeURIComponent(b.url)}`
      lines.push(t('aiCmd.deadItem', { i: i + 1, title: b.title || t('aiCmd.untitled'), url: b.url }))
      lines.push(t('aiCmd.deadSnapshot', { url: wbUrl }))
    }
    if (deadBookmarks.length > 3) {
      lines.push(tN('aiCmd.deadMore', deadBookmarks.length - 3))
    }

    if (bestAlt) {
      lines.push('')
      lines.push(t('aiCmd.deadAltIntro', { title: firstDead.title }))
      lines.push(t('aiCmd.deadAltRec', { title: bestAlt.title, url: bestAlt.url }))
      lines.push(
        t('aiCmd.deadAltHighlight', {
          desc: bestAlt.notes || bestAlt.highlight || t('aiCmd.deadAltDefaultHighlight'),
        }),
      )
      lines.push('')
      lines.push(t('aiCmd.deadCta'))
    }

    let actionCard: ChatActionCard | undefined
    if (bestAlt) {
      actionCard = buildHealDeadlinkCard({
        deadBmId: firstDead.id,
        fromTitle: firstDead.title,
        toTitle: bestAlt.title,
        replacement: bestAlt,
      })
    }

    return {
      handled: true,
      action: 'deadlinks',
      steps: [
        { text: tN('aiCmd.stepDeadFound', deadBookmarks.length), done: true },
        { text: t('aiCmd.stepDeadSearchAlt', { title: firstDead.title }), done: true },
      ],
      reply: lines.join('\n'),
      actionCard,
    }
  }

  // ── 8. 数据导出备份 (/export, 导出数据) ──
  if (parseExportIntent(query)) {
    exportData()
    return {
      handled: true,
      action: 'export',
      steps: [
        { text: t('aiCmd.stepExportSnapshot'), done: true },
        { text: t('aiCmd.stepExportDownload'), done: true },
      ],
      reply: t('aiCmd.exportDone'),
    }
  }

  // ── 9. 全库统计 (/stats, 书签统计) ──
  if (parseStatsIntent(query)) {
    const topBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    const subBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && b.parentId).length
    const groups = ds.siblingGroups.filter((g) => !g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => !c.deletedAt).length
    const uncat = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    const trashTotal =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: Category) => c.deletedAt).length

    const reply = [
      t('aiCmd.statsTitle'),
      '',
      t('aiCmd.statsTop', { n: topBookmarks }),
      t('aiCmd.statsSub', { n: subBookmarks }),
      t('aiCmd.statsGroups', { n: groups }),
      t('aiCmd.statsCats', { n: cats }),
      t('aiCmd.statsUncat', { n: uncat }),
      t('aiCmd.statsTrash', { n: trashTotal }),
      '',
      t('aiCmd.statsTidiness') +
        (uncat === 0 && trashTotal === 0 ? t('aiCmd.statsTidinessGood') : t('aiCmd.statsTidinessFair')),
    ].join('\n')

    return {
      handled: true,
      action: 'stats',
      steps: [{ text: t('aiCmd.stepStats'), done: true }],
      reply,
    }
  }

  // ── 9.1 全库资产体检中心 (/health, 资产体检) ──
  if (parseHealthIntent(query)) {
    const groupedIds = new Set<string>()
    for (const g of ds.siblingGroups || []) {
      if (!g.deletedAt && g.bookmarkIds?.length) {
        for (const id of g.bookmarkIds) groupedIds.add(id)
      }
    }

    const healthStats = calculateVaultHealth(
      ds.bookmarks,
      ds.categories,
      groupedIds,
      ds.siblingGroups,
    )

    const activeBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && !isOfficialBookmark(b))
    const totalCount = activeBookmarks.length

    const tagCoveredCount = activeBookmarks.filter(
      (b) => b.attributes && Object.keys(b.attributes).length > 0,
    ).length
    const tagCoverage = totalCount > 0 ? Math.round((tagCoveredCount / totalCount) * 100) : 100

    const trashTotal =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: Category) => c.deletedAt).length

    // 计算综合健康指数 (0 ~ 100)
    let score = 100
    if (totalCount > 0) {
      score -= Math.min(30, healthStats.uncategorizedCount * 3)
      score -= Math.min(25, healthStats.duplicateCount * 5)
      if (tagCoverage < 50) score -= 15
      else if (tagCoverage < 75) score -= 5
      if (trashTotal > 15) score -= 10
      score = Math.max(10, Math.min(100, score))
    }

    const level =
      score >= 90
        ? t('aiCmd.levelExcellent')
        : score >= 75
          ? t('aiCmd.levelGood')
          : score >= 60
            ? t('aiCmd.levelFair')
            : t('aiCmd.levelPoor')

    const reply = [
      t('aiCmd.healthTitle'),
      '',
      t('aiCmd.healthScore', { score, level }),
      '',
      t('aiCmd.healthDetail'),
      t('aiCmd.healthTotal', { n: totalCount }),
      t('aiCmd.healthUncat', {
        n: healthStats.uncategorizedCount,
        hint: healthStats.uncategorizedCount > 0 ? t('aiCmd.healthUncatHint') : t('aiCmd.healthUncatOk'),
      }),
      t('aiCmd.healthDup', {
        n: healthStats.duplicateCount,
        hint: healthStats.duplicateCount > 0 ? t('aiCmd.healthDupHint') : t('aiCmd.healthDupOk'),
      }),
      t('aiCmd.healthTagCoverage', {
        pct: tagCoverage,
        hint: tagCoverage < 60 ? t('aiCmd.healthTagHint') : t('aiCmd.healthTagOk'),
      }),
      t('aiCmd.healthTrash', {
        n: trashTotal,
        hint: trashTotal > 10 ? t('aiCmd.healthTrashHint') : '',
      }),
      '',
      healthStats.uncategorizedCount > 0
        ? t('aiCmd.healthAdviceInbox')
        : healthStats.duplicateCount > 0
          ? t('aiCmd.healthAdviceDedup')
          : t('aiCmd.healthPraise'),
    ].join('\n')

    let actionCard: ChatActionCard | undefined
    if (healthStats.uncategorizedCount > 0) {
      actionCard = buildHealthInboxCard(healthStats.uncategorizedCount)
    } else if (healthStats.duplicateCount > 0) {
      actionCard = buildHealthDedupCard(healthStats.duplicateCount)
    } else if (trashTotal > 0) {
      actionCard = buildHealthTrashCard(trashTotal)
    }

    return {
      handled: true,
      action: 'health',
      steps: [
        { text: t('aiCmd.stepHealthScan'), done: true },
        { text: t('aiCmd.stepHealthScore'), done: true },
      ],
      reply,
      actionCard,
    }
  }

  // ── 9.2 收件箱清零与智能归拢 (/inbox, 智能归类) ──
  if (parseInboxIntent(query)) {
    const groupedIds = new Set<string>()
    for (const g of ds.siblingGroups || []) {
      if (!g.deletedAt && g.bookmarkIds?.length) {
        for (const id of g.bookmarkIds) groupedIds.add(id)
      }
    }

    // 同站子页从属关系：识别「同一站点下的子页」，归入其主页面下
    const uncatIds = new Set(
      ds.bookmarks.filter((b) => isUncategorized(b, groupedIds)).map((b) => b.id),
    )
    const relations = detectParentChildRelations(ds.bookmarks).filter((r) => uncatIds.has(r.childId))
    const nestedChildIds = new Set(relations.map((r) => r.childId))

    const clusters = clusterUncategorizedBookmarks(
      ds.bookmarks.filter((b) => !nestedChildIds.has(b.id)),
      ds.categories,
      groupedIds,
    )
    const assignableClusters = clusters.filter(
      (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
    )

    const totalToMove = assignableClusters.reduce((acc, c) => acc + c.bookmarks.length, 0)

    if (totalToMove === 0 && relations.length === 0) {
      return {
        handled: true,
        action: 'inbox_zero',
        steps: [{ text: t('aiCmd.stepScanUncat'), done: true }],
        reply: t('aiCmd.inboxZeroDone'),
      }
    }

    const lines: string[] = [
      t('aiCmd.inboxPlanHeader'),
      '',
    ]
    for (const c of assignableClusters) {
      const titles = c.bookmarks.slice(0, 3).map((b) => b.title || b.url).join(t('msg.listSeparator'))
      const more =
        c.bookmarks.length > 3
          ? t('aiCmd.inboxPlanMore', { n: c.bookmarks.length })
          : tN('aiCmd.inboxPlanCount', c.bookmarks.length)
      lines.push(t('aiCmd.inboxPlanLine', { cat: c.suggestedCategoryName, titles, more }))
    }
    if (relations.length > 0) {
      lines.push(tN('aiCmd.inboxNestPlanLine', relations.length))
    }
    lines.push('')
    lines.push(t('aiCmd.inboxCta'))

    const inboxSteps = [
      { text: tN('aiCmd.stepInboxDetected', totalToMove + relations.length), done: true },
      { text: t('aiCmd.stepInboxClustered'), done: true },
    ]
    if (relations.length > 0) {
      inboxSteps.push({ text: t('aiCmd.stepInboxNested'), done: true })
    }

    return {
      handled: true,
      action: 'inbox_zero',
      steps: inboxSteps,
      reply: lines.join('\n'),
      actionCard: buildInboxZeroActionCard(totalToMove + relations.length),
    }
  }

  // ── 10. 上下文感知：批量移动选中的书签 ──
  const batchMoveIntent = parseBatchMoveIntent(query)
  if (batchMoveIntent && ui.batchMode && ui.batchSelected && ui.batchSelected.length > 0) {
    const targetName = batchMoveIntent.targetName
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetName || c.name.toLowerCase() === targetName.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'batch_move',
        success: false,
        reply: t('aiCmd.batchMoveCatNotFound', { name: targetName }),
      }
    }

    const selectedIds = [...ui.batchSelected]
    const previousMap: Array<{ id: string; prevCatId?: string }> = []
    let movedCount = 0

    for (const id of selectedIds) {
      const bm = ds.bookmarkMap[id]
      if (bm && !bm.deletedAt) {
        previousMap.push({ id, prevCatId: bm.categoryId })
        ds.updateBookmark(id, { categoryId: targetCat.id })
        movedCount++
      }
    }

    if (movedCount > 0) {
      app.save()
      ui.batchMode = false
      ui.batchSelected = []

      pushUndoAction({
        type: 'batch_move',
        description: tN('aiCmd.undoBatchMoveDesc', movedCount, { cat: targetCat.name }),
        revert: () => {
          for (const item of previousMap) {
            ds.updateBookmark(item.id, { categoryId: item.prevCatId })
          }
          app.save()
          return tN('aiCmd.undoMoveRevert', previousMap.length)
        },
      })

      return {
        handled: true,
        action: 'batch_move',
        success: true,
        steps: [
          { text: tN('aiCmd.stepBatchDetected', movedCount), done: true },
          { text: t('aiCmd.stepBatchMove', { cat: targetCat.name }), done: true },
        ],
        reply: tN('aiCmd.batchMoveDone', movedCount, { cat: targetCat.name }),
      }
    }
  }

  // ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
  const moveIntent = parseMoveIntent(query)
  const targetCategoryRaw = moveIntent ? moveIntent.targetCategoryRaw : null

  if (targetCategoryRaw) {
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetCategoryRaw || c.name.toLowerCase() === targetCategoryRaw.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: false,
        reply: t('aiCmd.moveCatNotFound', { name: targetCategoryRaw }),
      }
    }

    const uncatBms = ds.bookmarks.filter(
      (b) =>
        !b.deletedAt &&
        (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) &&
        !b.parentId &&
        !isOfficialBookmark(b),
    )

    if (uncatBms.length === 0) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: true,
        reply: t('aiCmd.moveNone'),
      }
    }

    // 若未分类数量较大（例如 > 5 个），进行二次确认保护
    if (uncatBms.length > 5) {
      const confirmed = await askConfirm(
        buildMoveConfirmMessage(uncatBms.length, targetCat.name),
      )
      if (context?.signal?.aborted) {
        return { handled: true, action: 'move_uncategorized', success: false, reply: '' }
      }
      if (!confirmed) {
        return {
          handled: true,
          action: 'move_uncategorized',
          success: false,
          steps: [{ text: t('aiCmd.stepUserCancelMove'), done: true }],
          reply: t('aiCmd.moveCancelled'),
        }
      }
    }

    const previousMap = uncatBms.map((b) => ({ id: b.id, prevCatId: b.categoryId }))
    for (const b of uncatBms) {
      ds.updateBookmark(b.id, { categoryId: targetCat.id })
    }
    app.save()

    pushUndoAction({
      type: 'move_uncategorized',
      description: tN('aiCmd.undoMoveUncatDesc', uncatBms.length, { cat: targetCat.name }),
      revert: () => {
        for (const item of previousMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId })
        }
        app.save()
        return tN('aiCmd.undoMoveRevert', previousMap.length)
      },
    })

    return {
      handled: true,
      action: 'move_uncategorized',
      success: true,
      steps: [
        { text: tN('aiCmd.stepFilterUncat', uncatBms.length), done: true },
        { text: t('aiCmd.stepMoveUncat', { cat: targetCat.name }), done: true },
      ],
      reply: tN('aiCmd.moveDone', uncatBms.length, { cat: targetCat.name }),
    }
  }

  // ── 12. 上下文感知：当前分类查询 ──
  if (parseCurrentCatIntent(query)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      const cat = ds.categories.find((c: Category) => c.id === ui.curCat)
      const catName = cat ? cat.name : (ui.curCat === CAT_UNCATEGORIZED ? t('aiCmd.catListUncategorized') : ui.curCat)
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === ui.curCat).length
      return {
        handled: true,
        action: 'current_cat',
        steps: [{ text: t('aiCmd.stepReadContext'), done: true }],
        reply: tN('aiCmd.currentCat', count, { name: catName }),
      }
    }
    const totalCount = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    return {
      handled: true,
      action: 'current_cat',
      steps: [{ text: t('aiCmd.stepReadGlobalContext'), done: true }],
      reply: tN('aiCmd.currentAll', totalCount),
    }
  }

  // ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
  if (parseUndoIntent(query)) {
    // 「停止生成」后不再执行撤销副作用（popUndoAction 会改状态，必须前置校验）
    if (context?.signal?.aborted) {
      return { handled: true, action: 'undo', success: false, reply: '' }
    }
    const actionToRevert = popUndoAction()
    if (actionToRevert) {
      const msg = await actionToRevert.revert()
      const remaining = getUndoStackDepth()
      const suffix = remaining > 0 ? tN('aiCmd.undoRemaining', remaining) : ''
      return {
        handled: true,
        action: 'undo',
        success: true,
        steps: [{ text: t('aiCmd.stepRevertAction', { desc: actionToRevert.description }), done: true }],
        reply: `${msg}${suffix}`,
      }
    }

    try {
      const toastStore = useToastStore()
      if (toastStore.undoToast) {
        const msg = toastStore.undoToast.msg
        toastStore.undoToast.undoFn()
        toastStore.dismissUndo()
        return {
          handled: true,
          action: 'undo',
          success: true,
          steps: [{ text: t('aiCmd.stepGlobalUndo'), done: true }],
          reply: t('aiCmd.undoGlobalDone', { msg }),
        }
      }
    } catch {
      // Pinia 未初始化
    }

    return {
      handled: true,
      action: 'undo',
      success: false,
      reply: t('aiCmd.undoNone'),
    }
  }

  // ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
  if (parseCleanIntent(query)) {
    let fixedGroupRefs = 0
    let fixedParentRefs = 0

    // 检查组内的失效 bookmarkIds
    for (const grp of ds.siblingGroups) {
      if (!grp.bookmarkIds || grp.bookmarkIds.length === 0) continue
      const validIds = grp.bookmarkIds.filter(
        (id: string) => !!ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt,
      )
      if (validIds.length !== grp.bookmarkIds.length) {
        fixedGroupRefs += grp.bookmarkIds.length - validIds.length
        ds.updateGroup(grp.id, { bookmarkIds: validIds })
      }
    }

    // 检查书签中的失效 parentId
    for (const bm of ds.bookmarks) {
      if (bm.parentId && (!ds.bookmarkMap[bm.parentId] || ds.bookmarkMap[bm.parentId].deletedAt)) {
        fixedParentRefs++
        ds.updateBookmark(bm.id, { parentId: undefined })
      }
    }

    if (fixedGroupRefs > 0 || fixedParentRefs > 0) {
      app.save()
      return {
        handled: true,
        action: 'clean_orphans',
        steps: [
          { text: t('aiCmd.stepAuditGroupRefs'), done: true },
          { text: t('aiCmd.stepFixOrphans'), done: true },
        ],
        reply: t('aiCmd.cleanFixed', { grp: fixedGroupRefs, par: fixedParentRefs }),
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      steps: [{ text: t('aiCmd.stepConsistencyOk'), done: true }],
      reply: t('aiCmd.cleanOk'),
    }
  }

  // ── 15. 打开设置面板 (/settings, 打开设置) ──
  const settingsResult = await settingsBlock({ query, ds, ui, app })
  if (settingsResult !== null) return settingsResult

  return { handled: false, reply: '' }
}
