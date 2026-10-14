/**
 * siteCommander.ts — 与链站内指令调度器 (In-App AI Agent / CLI)
 * 职责：
 * 1. 解析侧边栏对话框中的斜杠快捷指令与自然语言意图；
 * 2. 直接操控站内 Store / UI / 主题 / 导出 / 整理操作；
 * 3. 增强透明度：提供工具调用执行轨迹 (steps) 与行动卡片 (actionCard)；
 * 4. 增强安全性与可逆性：危险操作强制二次确认 (HITL)，支持对话式撤销 (/undo)；
 * 5. 上下文感知：感知当前浏览分类与多选状态；
 * 6. 严守克制美学：杜绝浮夸 emoji，采用纯净、温润的文字与符号排版。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { useToastStore } from '../../stores/toast.js'
import { addNewCategory } from '../../utils.js'
import { exportData } from '../../composables/domain/useDataIO.js'
import { findDuplicateCandidates, isOfficialBookmark } from './localClustering.js'
import { CAT_UNCATEGORIZED, CAT_ALL } from '../../config/constants.js'
import { showConfirm } from '../toast.js'
import type { Category } from '../../types.js'
import type { ChatTurnStep, ChatActionCard } from './chatSessions.js'

export interface SiteCommandResult {
  handled: boolean
  reply: string
  action?: string
  success?: boolean
  details?: Record<string, unknown>
  steps?: ChatTurnStep[]
  actionCard?: ChatActionCard
}

export interface SiteCommanderContext {
  ds?: ReturnType<typeof useDataStore>
  ui?: ReturnType<typeof useUIStore>
  app?: ReturnType<typeof useAppStore>
}

export interface UndoableAction {
  type: string
  description: string
  revert: () => Promise<string> | string
}

let lastUndoableAction: UndoableAction | null = null

export function getLastUndoableAction(): UndoableAction | null {
  return lastUndoableAction
}

export function setLastUndoableAction(action: UndoableAction | null): void {
  lastUndoableAction = action
}

/**
 * 查重并一键合并所有重复项
 */
export function mergeDuplicateBookmarks(
  context?: SiteCommanderContext,
): { mergedCount: number; message: string } {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  const dups = findDuplicateCandidates(ds.bookmarks)
  if (!dups || dups.length === 0) {
    return { mergedCount: 0, message: '未发现可合并的重复书签。' }
  }

  let mergedCount = 0
  const deletedIds: string[] = []
  for (const cluster of dups) {
    for (const dup of cluster.duplicates) {
      if (dup.id && !dup.deletedAt) {
        ds.deleteBookmark(dup.id)
        deletedIds.push(dup.id)
        mergedCount++
      }
    }
  }

  if (mergedCount > 0) {
    app.save()
    lastUndoableAction = {
      type: 'merge_dedup',
      description: `合并 ${mergedCount} 个重复书签`,
      revert: () => {
        for (const id of deletedIds) {
          ds.restoreBookmark(id)
        }
        app.save()
        return `已撤销查重合并，${deletedIds.length} 个书签副本已从回收站还原。`
      },
    }
  }

  return {
    mergedCount,
    message: `已合并 ${mergedCount} 个重复书签副本，数据已移入回收站。`,
  }
}

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
  if (
    /^\/(?:help|\?)$/i.test(query) ||
    /^(?:help|\/\?|\/help|帮助|指南|使用指南|你能做什么|怎么用|有哪些命令|指令列表|命令列表|站内指令|支持哪些操作)$/i.test(
      query,
    )
  ) {
    return {
      handled: true,
      action: 'help',
      success: true,
      steps: [{ text: '获取支持的站内指令集', done: true }],
      reply: [
        '与链 站内操控指令 (In-App Agent)',
        '',
        '- 主题模式：',
        '  /theme dark | light | auto',
        '  （亦可说：“切换深色模式”、“切浅色”）',
        '',
        '- 视图布局：',
        '  /view grid | list | compact',
        '  （亦可说：“切换列表视图”、“网格视图”）',
        '',
        '- 分类管理：',
        '  /cat <名称> 或 /cat list',
        '  （亦可说：“新建分类 影音”、“查看分类”）',
        '',
        '- 回收站：',
        '  /trash clear 或 /trash',
        '  （亦可说：“清空回收站”、“打开回收站”）',
        '',
        '- 查找重复：',
        '  /dedup 或“查找重复书签”',
        '',
        '- 死链检测：',
        '  /deadlink 或“检查死链”',
        '',
        '- 导出备份：',
        '  /export 或“导出数据”、“备份书签”',
        '',
        '- 数据统计：',
        '  /stats 或“书签统计”',
        '',
        '- 批量归类：',
        '  /move uncategorized <分类名>',
        '  （亦可说：“把未分类移动到 工作”）',
        '',
        '- 撤销操作：',
        '  /undo 或“撤销刚才的操作”',
        '',
        '- 清理数据：',
        '  /clean 或“清理孤立数据”',
        '',
        '- 设置面板：',
        '  /settings 或“打开设置”',
        '',
        '提示：输入网址或自然语言需求时，将自动为您检索全网发现与平替。',
      ].join('\n'),
    }
  }

  // ── 2. 主题外观 (/theme, 切换深色/浅色) ──
  const themeSlashMatch = query.match(/^\/theme(?:\s+(dark|light|auto))?$/i)
  if (themeSlashMatch) {
    const mode = themeSlashMatch[1]?.toLowerCase()
    if (mode === 'dark') {
      ui.setThemeColor('dark')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '切换至深色模式', done: true }],
        reply: '已切换至深色模式。',
      }
    } else if (mode === 'light') {
      ui.setThemeColor('light')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '切换至浅色模式', done: true }],
        reply: '已切换至浅色模式。',
      }
    } else if (mode === 'auto') {
      if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '开启跟随系统主题', done: true }],
        reply: '已开启跟随系统主题。',
      }
    } else {
      ui.toggleTheme()
      const current = ui.themeColor === 'dark' ? '深色' : '浅色'
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '反转主题模式', done: true }],
        reply: `已切换主题（当前为 ${current}）。`,
      }
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:深色|暗黑|暗色|夜间|黑暗|黑夜)(?:模式|主题)?$/i.test(
      query,
    )
  ) {
    ui.setThemeColor('dark')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: '切换至深色模式', done: true }],
      reply: '已切换至深色模式。',
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:浅色|白天|明亮|日间|白色)(?:模式|主题)?$/i.test(
      query,
    )
  ) {
    ui.setThemeColor('light')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: '切换至浅色模式', done: true }],
      reply: '已切换至浅色模式。',
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启)?\s*(?:跟随系统|自动主题|系统主题|自动模式)(?:模式|主题)?$/i.test(
      query,
    )
  ) {
    if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: '开启跟随系统主题', done: true }],
      reply: '已开启跟随系统主题。',
    }
  }

  if (/^(?:请?帮?我?)?(?:切换主题|换个主题|反转主题)$/i.test(query)) {
    ui.toggleTheme()
    const current = ui.themeColor === 'dark' ? '深色' : '浅色'
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: '反转主题模式', done: true }],
      reply: `已切换主题（当前为 ${current}）。`,
    }
  }

  // ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
  const viewSlashMatch = query.match(/^\/view(?:\s+(grid|list|compact|mini-grid))?$/i)
  if (viewSlashMatch) {
    const rawMode = viewSlashMatch[1]?.toLowerCase() || 'grid'
    const targetMode = rawMode === 'compact' ? 'mini-grid' : (rawMode as 'grid' | 'list' | 'mini-grid')
    ui.layoutMode = targetMode
    ui.saveUIState?.()
    const nameMap = { grid: '宫格视图', list: '列表视图', 'mini-grid': '紧凑视图' }
    return {
      handled: true,
      action: 'view',
      steps: [{ text: `切换至${nameMap[targetMode]}`, done: true }],
      reply: `已切换至${nameMap[targetMode]}。`,
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:列表视图|列表模式|清单视图)$/i.test(query)
  ) {
    ui.layoutMode = 'list'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: '切换至列表视图', done: true }],
      reply: '已切换至列表视图。',
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:网格视图|宫格视图|网格模式|大宫格)$/i.test(query)
  ) {
    ui.layoutMode = 'grid'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: '切换至宫格视图', done: true }],
      reply: '已切换至宫格视图。',
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:紧凑视图|紧凑模式|小宫格|迷你宫格)$/i.test(query)
  ) {
    ui.layoutMode = 'mini-grid'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: '切换至紧凑视图', done: true }],
      reply: '已切换至紧凑视图。',
    }
  }

  // ── 4. 分类管理 (/cat, 新建分类) ──
  if (/^\/cat\s+list$/i.test(query) || /^(?:分类列表|查看分类|所有分类)$/i.test(query)) {
    const activeCats = ds.categories.filter((c: Category) => !c.deletedAt)
    const lines = ['当前全部分类：', '']
    for (const cat of activeCats) {
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === cat.id).length
      lines.push(`- ${cat.name} (${count} 个书签)`)
    }
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    lines.push(`- 未分类 (${uncatCount} 个书签)`)
    return {
      handled: true,
      action: 'category_list',
      steps: [{ text: '读取全库分类列表', done: true }],
      reply: lines.join('\n'),
    }
  }

  const catSlashMatch = query.match(/^\/cat(?:\s+add)?\s+(.+)$/i)
  const catNlMatch = query.match(/^(?:请?帮?我?)?(?:新建|创建|添加|增加)分类\s*[:：]?\s*(.+)$/i)
  const catName = catSlashMatch ? catSlashMatch[1]?.trim() : catNlMatch ? catNlMatch[1]?.trim() : null
  if (catName) {
    const trimmed = catName.trim()
    if (!trimmed) {
      return { handled: true, action: 'category_add', success: false, reply: '分类名称不能为空。' }
    }
    const exists = ds.categories.some(
      (c: Category) => !c.deletedAt && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exists) {
      return {
        handled: true,
        action: 'category_add',
        success: false,
        steps: [{ text: `检查分类「${trimmed}」是否已存在`, done: true }],
        reply: `分类「${trimmed}」已存在，无需重复创建。`,
      }
    }
    const created = addNewCategory(trimmed, app)
    if (created) {
      lastUndoableAction = {
        type: 'category_add',
        description: `新建分类「${trimmed}」`,
        revert: () => {
          ds.deleteCategory(created.id)
          app.save()
          return `已撤销新建分类「${trimmed}」。`
        },
      }
      return {
        handled: true,
        action: 'category_add',
        success: true,
        steps: [
          { text: '校验分类名称', done: true },
          { text: `创建分类「${trimmed}」`, done: true },
        ],
        reply: `分类「${trimmed}」创建成功。`,
      }
    }
    return { handled: true, action: 'category_add', success: false, reply: '创建分类失败。' }
  }

  // ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
  if (
    /^\/trash\s+(?:clear|empty)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清空|清掉|清理|倒空|倒掉)(?:回收站|垃圾桶)$/i.test(query)
  ) {
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats
    if (total === 0) {
      return {
        handled: true,
        action: 'trash_clear',
        steps: [{ text: '检查回收站状态', done: true }],
        reply: '回收站当前为空，无需清理。',
      }
    }

    // Agent 危险操作人机确认 (Human-in-the-Loop)
    const confirmed = await showConfirm(
      `危险操作确认：即将彻底清空回收站，永久删除 ${total} 项数据（书签: ${bms}，笔记组: ${grps}，分类: ${cats}）。\n此操作不可撤销，是否确认执行？`,
    )
    if (!confirmed) {
      return {
        handled: true,
        action: 'trash_clear',
        success: false,
        steps: [{ text: '用户取消清空回收站', done: true }],
        reply: '已取消清空回收站，所有数据均安全保留。',
      }
    }

    ds.emptyTrash()
    app.save()
    return {
      handled: true,
      action: 'trash_clear',
      steps: [
        { text: `核验待清理数据 (${total} 项)`, done: true },
        { text: '通过人机安全确认', done: true },
        { text: '彻底清空回收站', done: true },
      ],
      reply: `已彻底清空回收站，共永久清理 ${total} 项数据（书签: ${bms}，笔记组: ${grps}，分类: ${cats}）。`,
    }
  }

  if (/^\/trash$/i.test(query) || /^(?:请?帮?我?)?(?:打开|查看|进入)?回收站$/i.test(query)) {
    ui.panels.trash = true
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats

    return {
      handled: true,
      action: 'trash_open',
      steps: [{ text: '打开回收站面板', done: true }],
      actionCard:
        total > 0
          ? {
              type: 'trash',
              title: '清空回收站',
              desc: `当前积压 ${total} 项待清理数据（书签: ${bms}，组: ${grps}）`,
              buttonText: '彻底清空',
              actionName: 'trash_clear',
            }
          : undefined,
      reply: total > 0 ? `已为您打开回收站面板（当前共有 ${total} 项待清理）。` : '已为您打开回收站面板（当前为空）。',
    }
  }

  // ── 6. 查重巡检 (/dedup, 查找重复书签) ──
  if (
    /^\/dedup(?:\s+find)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:查重|查找重复书签|检查重复|有哪些重复书签|重复书签|重复链接)$/i.test(query)
  ) {
    const dups = findDuplicateCandidates(ds.bookmarks)
    if (!dups || dups.length === 0) {
      return {
        handled: true,
        action: 'dedup',
        steps: [
          { text: '扫描书签库全部链接', done: true },
          { text: '比对未发现重复项', done: true },
        ],
        reply: '书签库整洁，未发现重复链接。',
      }
    }
    const dupCount = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
    const lines = [
      `查重检测：发现 ${dups.length} 组重复链接（共 ${dupCount} 个多余副本）：`,
      '',
    ]
    const previewItems = dups.slice(0, 5)
    for (let i = 0; i < previewItems.length; i++) {
      const d = previewItems[i]
      lines.push(`${i + 1}. ${d.primary.title || '无标题'}`)
      lines.push(`   主链接: ${d.normalizedUrl}`)
      lines.push(`   重复副本: ${d.duplicates.length} 个（${d.duplicates.map((dup) => dup.title || '无标题').join(', ')}）`)
    }
    if (dups.length > 5) {
      lines.push(`...其余 ${dups.length - 5} 组已省略。`)
    }

    return {
      handled: true,
      action: 'dedup',
      steps: [
        { text: '扫描书签库全部链接', done: true },
        { text: `比对发现 ${dups.length} 组重复`, done: true },
      ],
      actionCard: {
        type: 'dedup',
        title: '合并重复书签',
        desc: `检测到 ${dups.length} 组重复链接，共 ${dupCount} 个多余副本`,
        buttonText: '一键合并重复项',
        actionName: 'merge_dedup',
      },
      reply: lines.join('\n'),
    }
  }

  // ── 7. 死链检测 (/deadlink, 检查死链) ──
  if (
    /^\/deadlinks?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:检查死链|死链检测|死链巡检|检测失效链接|检测死链)$/i.test(query)
  ) {
    ui.overlays.deadLinks = true
    return {
      handled: true,
      action: 'deadlinks',
      steps: [{ text: '打开死链检测巡检面板', done: true }],
      reply: '已打开死链检测面板，正在检测书签存活状态。',
    }
  }

  // ── 8. 数据导出备份 (/export, 导出数据) ──
  if (
    /^\/export(?:\s+data)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:导出数据|备份书签|导出备份|全量备份|下载备份)$/i.test(query)
  ) {
    exportData()
    return {
      handled: true,
      action: 'export',
      steps: [
        { text: '生成全量数据快照', done: true },
        { text: '触发浏览器下载', done: true },
      ],
      reply: '已生成全量 JSON 数据备份并触发下载，请留意浏览器下载提示。',
    }
  }

  // ── 9. 全库统计 (/stats, 书签统计) ──
  if (
    /^\/stats$/i.test(query) ||
    /^(?:请?帮?我?)?(?:书签统计|数据统计|库状态|书签总数|有多少书签)$/i.test(query)
  ) {
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
      '与链 书签库运行状态报表：',
      '',
      `- 活跃顶层书签：${topBookmarks} 个`,
      `- 子书签（附属）：${subBookmarks} 个`,
      `- 活跃笔记组：${groups} 组`,
      `- 分类体系：${cats} 个分类`,
      `- 待整理未分类：${uncat} 个`,
      `- 回收站待清理：${trashTotal} 项`,
      '',
      '整洁度评分：' + (uncat === 0 && trashTotal === 0 ? '优（无待处理项）' : '良好'),
    ].join('\n')

    return {
      handled: true,
      action: 'stats',
      steps: [{ text: '统计全库活跃书签与分类体系', done: true }],
      reply,
    }
  }

  // ── 10. 上下文感知：批量移动选中的书签 ──
  const batchMoveMatch = query.match(
    /^(?:把|将)?(?:选中的|这些)?(?:书签)?(?:全部)?(?:移动到?|移到|放到|归入|归到)\s*[:：]?\s*(.+)$/i,
  )
  if (batchMoveMatch && ui.batchMode && ui.batchSelected && ui.batchSelected.length > 0) {
    const targetName = batchMoveMatch[1].trim().replace(/^到\s*/, '')
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
        reply: `未找到目标分类「${targetName}」。请先输入「/cat ${targetName}」创建该分类。`,
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

      lastUndoableAction = {
        type: 'batch_move',
        description: `将 ${movedCount} 个选中的书签移入「${targetCat.name}」`,
        revert: () => {
          for (const item of previousMap) {
            ds.updateBookmark(item.id, { categoryId: item.prevCatId })
          }
          app.save()
          return `已撤销批量移动，${previousMap.length} 个书签已还原原分类。`
        },
      }

      return {
        handled: true,
        action: 'batch_move',
        success: true,
        steps: [
          { text: `感知到 ${movedCount} 个勾选书签`, done: true },
          { text: `批量移入「${targetCat.name}」分类`, done: true },
        ],
        reply: `已成功将选中的 ${movedCount} 个书签移入「${targetCat.name}」分类。`,
      }
    }
  }

  // ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
  const moveSlashMatch = query.match(/^\/move\s+uncategorized\s+(.+)$/i)
  const moveNlMatch = query.match(
    /^(?:把|将)?(?:所有)?未分类(?:书签)?(?:全部)?(?:移动到?|移到|放到|归入|归到)\s*[:：]?\s*(.+)$/i,
  )
  const targetCategoryRaw = moveSlashMatch
    ? moveSlashMatch[1]?.trim().replace(/^到\s*/, '')
    : moveNlMatch
      ? moveNlMatch[1]?.trim().replace(/^到\s*/, '')
      : null

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
        reply: `未找到分类「${targetCategoryRaw}」。您可以先输入「/cat ${targetCategoryRaw}」创建该分类。`,
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
        reply: `当前没有待整理的未分类书签。`,
      }
    }

    // 若未分类数量较大（例如 > 5 个），进行二次确认保护
    if (uncatBms.length > 5) {
      const confirmed = await showConfirm(
        `即将把 ${uncatBms.length} 个未分类书签批量移动至「${targetCat.name}」分类，是否继续？`,
      )
      if (!confirmed) {
        return {
          handled: true,
          action: 'move_uncategorized',
          success: false,
          steps: [{ text: '用户取消批量归类', done: true }],
          reply: '已取消批量归类操作。',
        }
      }
    }

    const previousMap = uncatBms.map((b) => ({ id: b.id, prevCatId: b.categoryId }))
    for (const b of uncatBms) {
      ds.updateBookmark(b.id, { categoryId: targetCat.id })
    }
    app.save()

    lastUndoableAction = {
      type: 'move_uncategorized',
      description: `将 ${uncatBms.length} 个未分类书签移入「${targetCat.name}」`,
      revert: () => {
        for (const item of previousMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId })
        }
        app.save()
        return `已撤销批量移动，${previousMap.length} 个书签已还原原分类。`
      },
    }

    return {
      handled: true,
      action: 'move_uncategorized',
      success: true,
      steps: [
        { text: `筛选未分类书签 (${uncatBms.length} 个)`, done: true },
        { text: `批量移入「${targetCat.name}」`, done: true },
      ],
      reply: `已成功将 ${uncatBms.length} 个未分类书签移入「${targetCat.name}」分类。`,
    }
  }

  // ── 12. 上下文感知：当前分类查询 ──
  if (/^(?:当前在看什么分类|当前分类|当前分类有多少书签|所在分类)$/i.test(query)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      const cat = ds.categories.find((c: Category) => c.id === ui.curCat)
      const catName = cat ? cat.name : (ui.curCat === CAT_UNCATEGORIZED ? '未分类' : ui.curCat)
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === ui.curCat).length
      return {
        handled: true,
        action: 'current_cat',
        steps: [{ text: '读取当前视图上下文', done: true }],
        reply: `当前正处于「${catName}」分类视图，该分类下共有 ${count} 个活跃书签。`,
      }
    }
    const totalCount = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    return {
      handled: true,
      action: 'current_cat',
      steps: [{ text: '读取全库视图上下文', done: true }],
      reply: `当前正处于「全部分类」主视图，共有 ${totalCount} 个顶层书签。`,
    }
  }

  // ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
  if (
    /^\/(?:undo|revert)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:撤销|撤销操作|撤销刚才的操作|撤销上一步|恢复原样|回退|回退上一步|undo)$/i.test(
      query,
    )
  ) {
    if (lastUndoableAction) {
      const msg = await lastUndoableAction.revert()
      lastUndoableAction = null
      return {
        handled: true,
        action: 'undo',
        success: true,
        steps: [{ text: '回退上一步站内修改', done: true }],
        reply: msg,
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
          steps: [{ text: '调用全局撤销动作', done: true }],
          reply: `已成功撤销操作（${msg}）。`,
        }
      }
    } catch {
      // Pinia 未初始化
    }

    return {
      handled: true,
      action: 'undo',
      success: false,
      reply: '当前没有可撤销的站内操作。',
    }
  }

  // ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
  if (
    /^\/clean(?:\s+orphans)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清理孤立数据|清理孤儿|数据自检|自检清理)$/i.test(query)
  ) {
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
          { text: '巡检笔记组引用关系', done: true },
          { text: '修复孤立数据引用', done: true },
        ],
        reply: `数据自检修复完成：修复了 ${fixedGroupRefs} 个笔记组无效引用，修正了 ${fixedParentRefs} 个孤立子书签父级关联。`,
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      steps: [{ text: '数据一致性自检通过', done: true }],
      reply: '数据自检完成：所有笔记组与书签关联完整无误，无需修复。',
    }
  }

  // ── 15. 打开设置面板 (/settings, 打开设置) ──
  if (
    /^\/settings$/i.test(query) ||
    /^(?:请?帮?我?)?(?:打开设置|查看设置|设置面板|进入设置)$/i.test(query)
  ) {
    ui.panels.settings = true
    return {
      handled: true,
      action: 'settings',
      steps: [{ text: '打开系统设置面板', done: true }],
      reply: '已为您打开设置面板。',
    }
  }

  return { handled: false, reply: '' }
}
