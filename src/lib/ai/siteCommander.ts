/**
 * siteCommander.ts — 与链站内指令调度器 (In-App AI Agent / CLI)
 * 职责：
 * 1. 解析侧边栏对话框中的斜杠快捷指令与自然语言意图；
 * 2. 直接操控站内 Store / UI / 主题 / 导出 / 整理操作；
 * 3. 若命中站内控制，执行操作并返回结构化反馈；若非站内控制，返回 handled: false，
 *    无缝回退至外部 Web 发现/平替/视频提取引擎。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { addNewCategory } from '../../utils.js'
import { exportData } from '../../composables/domain/useDataIO.js'
import { findDuplicateCandidates, isOfficialBookmark } from './localClustering.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Category } from '../../types.js'

export interface SiteCommandResult {
  handled: boolean
  reply: string
  action?: string
  success?: boolean
  details?: Record<string, unknown>
}

export interface SiteCommanderContext {
  ds?: ReturnType<typeof useDataStore>
  ui?: ReturnType<typeof useUIStore>
  app?: ReturnType<typeof useAppStore>
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
      reply: [
        '🧭 与链 站内操控指令 (In-App Agent)',
        '',
        '• 🎨 主题模式：',
        '  /theme dark | light | auto',
        '  （亦可说：“切换深色模式”、“切浅色”）',
        '',
        '• 📋 视图布局：',
        '  /view grid | list | compact',
        '  （亦可说：“切换列表视图”、“网格视图”）',
        '',
        '• 📁 分类管理：',
        '  /cat <名称> 或 /cat list',
        '  （亦可说：“新建分类 影音”、“查看分类”）',
        '',
        '• 🗑️ 回收站：',
        '  /trash clear 或 /trash',
        '  （亦可说：“清空回收站”、“打开回收站”）',
        '',
        '• 🔍 查重巡检：',
        '  /dedup 或“查找重复书签”',
        '',
        '• 🔗 死链检测：',
        '  /deadlink 或“检查死链”',
        '',
        '• 📦 数据备份：',
        '  /export 或“导出数据”、“备份书签”',
        '',
        '• 📊 全库统计：',
        '  /stats 或“书签统计”',
        '',
        '• 🚚 快速归类：',
        '  /move uncategorized <分类名>',
        '  （亦可说：“把未分类移动到 工作”）',
        '',
        '• 🧹 孤儿自检：',
        '  /clean 或“清理孤立数据”',
        '',
        '• ⚙️ 设置面板：',
        '  /settings 或“打开设置”',
        '',
        '💡 提示：输入网址或自然语言需求时，将自动为您检索全网发现与平替。',
      ].join('\n'),
    }
  }

  // ── 2. 主题外观 (/theme, 切换深色/浅色) ──
  const themeSlashMatch = query.match(/^\/theme(?:\s+(dark|light|auto))?$/i)
  if (themeSlashMatch) {
    const mode = themeSlashMatch[1]?.toLowerCase()
    if (mode === 'dark') {
      ui.setThemeColor('dark')
      return { handled: true, action: 'theme', reply: '已切换至深色模式 🌙' }
    } else if (mode === 'light') {
      ui.setThemeColor('light')
      return { handled: true, action: 'theme', reply: '已切换至浅色模式 ☀️' }
    } else if (mode === 'auto') {
      if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
      return { handled: true, action: 'theme', reply: '已开启跟随系统主题 🖥️' }
    } else {
      ui.toggleTheme()
      const current = ui.themeColor === 'dark' ? '深色 🌙' : '浅色 ☀️'
      return { handled: true, action: 'theme', reply: `已切换主题（当前为 ${current}）` }
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:深色|暗黑|暗色|夜间|黑暗|黑夜)(?:模式|主题)?$/i.test(
      query,
    )
  ) {
    ui.setThemeColor('dark')
    return { handled: true, action: 'theme', reply: '已切换至深色模式 🌙' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:浅色|白天|明亮|日间|白色)(?:模式|主题)?$/i.test(
      query,
    )
  ) {
    ui.setThemeColor('light')
    return { handled: true, action: 'theme', reply: '已切换至浅色模式 ☀️' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启)?\s*(?:跟随系统|自动主题|系统主题|自动模式)(?:模式|主题)?$/i.test(
      query,
    )
  ) {
    if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
    return { handled: true, action: 'theme', reply: '已开启跟随系统主题 🖥️' }
  }

  if (/^(?:请?帮?我?)?(?:切换主题|换个主题|反转主题)$/i.test(query)) {
    ui.toggleTheme()
    const current = ui.themeColor === 'dark' ? '深色 🌙' : '浅色 ☀️'
    return { handled: true, action: 'theme', reply: `已切换主题（当前为 ${current}）` }
  }

  // ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
  const viewSlashMatch = query.match(/^\/view(?:\s+(grid|list|compact|mini-grid))?$/i)
  if (viewSlashMatch) {
    const rawMode = viewSlashMatch[1]?.toLowerCase() || 'grid'
    const targetMode = rawMode === 'compact' ? 'mini-grid' : (rawMode as 'grid' | 'list' | 'mini-grid')
    ui.layoutMode = targetMode
    ui.saveUIState?.()
    const nameMap = { grid: '宫格视图 🔲', list: '列表视图 📋', 'mini-grid': '紧凑视图 📱' }
    return { handled: true, action: 'view', reply: `已切换至${nameMap[targetMode]}` }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:列表视图|列表模式|清单视图)$/i.test(query)
  ) {
    ui.layoutMode = 'list'
    ui.saveUIState?.()
    return { handled: true, action: 'view', reply: '已切换至列表视图 📋' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:网格视图|宫格视图|网格模式|大宫格)$/i.test(query)
  ) {
    ui.layoutMode = 'grid'
    ui.saveUIState?.()
    return { handled: true, action: 'view', reply: '已切换至宫格视图 🔲' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:紧凑视图|紧凑模式|小宫格)$/i.test(query)
  ) {
    ui.layoutMode = 'mini-grid'
    ui.saveUIState?.()
    return { handled: true, action: 'view', reply: '已切换至紧凑视图 📱' }
  }

  // ── 4. 分类管理 (/cat, 新建分类) ──
  if (/^\/cat\s+list$/i.test(query) || /^(?:分类列表|查看分类|所有分类)$/i.test(query)) {
    const activeCats = ds.categories.filter((c: Category) => !c.deletedAt)
    const lines = ['📁 当前全部分类：', '']
    for (const cat of activeCats) {
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === cat.id).length
      lines.push(`• ${cat.name} (${count} 个书签)`)
    }
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    lines.push(`• 未分类 (${uncatCount} 个书签)`)
    return { handled: true, action: 'category_list', reply: lines.join('\n') }
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
        reply: `分类「${trimmed}」已存在，无需重复创建 📁`,
      }
    }
    const created = addNewCategory(trimmed, app)
    if (created) {
      return {
        handled: true,
        action: 'category_add',
        success: true,
        reply: `分类「${trimmed}」创建成功！📁`,
      }
    }
    return { handled: true, action: 'category_add', success: false, reply: '创建分类失败。' }
  }

  // ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
  if (
    /^\/trash\s+(?:clear|empty)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清空|清掉|清理|倒空|倒掉)回收站|垃圾桶$/i.test(query)
  ) {
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats
    if (total === 0) {
      return { handled: true, action: 'trash_clear', reply: '回收站当前为空，无需清理 ✨' }
    }
    ds.emptyTrash()
    app.save()
    return {
      handled: true,
      action: 'trash_clear',
      reply: `已彻底清空回收站，共永久清理 ${total} 项数据（书签: ${bms}，笔记组: ${grps}，分类: ${cats}）🗑️`,
    }
  }

  if (/^\/trash$/i.test(query) || /^(?:请?帮?我?)?(?:打开|查看|进入)?回收站$/i.test(query)) {
    ui.panels.trash = true
    return { handled: true, action: 'trash_open', reply: '已为您打开回收站面板 🗑️' }
  }

  // ── 6. 查重巡检 (/dedup, 查找重复书签) ──
  if (
    /^\/dedup(?:\s+find)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:查重|查找重复书签|检查重复|有哪些重复书签|重复书签|重复链接)$/i.test(query)
  ) {
    const dups = findDuplicateCandidates(ds.bookmarks)
    if (!dups || dups.length === 0) {
      return { handled: true, action: 'dedup', reply: '书签库非常整洁，未发现重复链接 ✨' }
    }
    const dupCount = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
    const lines = [
      `🔍 查重检测：发现 ${dups.length} 组重复链接（共 ${dupCount} 个多余副本）：`,
      '',
    ]
    const previewItems = dups.slice(0, 5)
    for (let i = 0; i < previewItems.length; i++) {
      const d = previewItems[i]
      lines.push(`${i + 1}. ${d.primary.title || '无标题'}`)
      lines.push(`   链接: ${d.normalizedUrl}`)
      lines.push(`   副本: ${d.duplicates.length} 个（${d.duplicates.map((dup) => dup.title || '无标题').join(', ')}）`)
    }
    if (dups.length > 5) {
      lines.push(`...其余 ${dups.length - 5} 组已省略。`)
    }
    return { handled: true, action: 'dedup', reply: lines.join('\n') }
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
      reply: '已打开死链检测面板 🔗，正在检测书签存活状态。',
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
      reply: '正在为您生成全量 JSON 数据备份并触发下载 📦，请留意浏览器下载提示。',
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
      '📊 与链 书签库运行状态报表：',
      '',
      `• 活跃顶层书签：${topBookmarks} 个`,
      `• 子书签（附属）：${subBookmarks} 个`,
      `• 活跃笔记组：${groups} 组`,
      `• 分类体系：${cats} 个分类`,
      `• 待整理未分类：${uncat} 个`,
      `• 回收站待清理：${trashTotal} 项`,
      '',
      '整洁度评分：' + (uncat === 0 && trashTotal === 0 ? '⭐⭐⭐⭐⭐ 极致整洁' : '⭐⭐⭐⭐ 状态良好'),
    ].join('\n')

    return { handled: true, action: 'stats', reply }
  }

  // ── 10. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
  const moveSlashMatch = query.match(/^\/move\s+uncategorized\s+(.+)$/i)
  const moveNlMatch = query.match(
    /^(?:把|将)?(?:所有)?未分类(?:书签)?(?:全部)?(?:移动|归入|移到|放到)\s*[:：]?\s*(.+)$/i,
  )
  const targetCategoryRaw = moveSlashMatch
    ? moveSlashMatch[1]?.trim()
    : moveNlMatch
      ? moveNlMatch[1]?.trim()
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
        reply: `未找到分类「${targetCategoryRaw}」。您可以先输入「/cat ${targetCategoryRaw}」创建该分类 📁`,
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
        reply: `当前没有待整理的未分类书签 📂`,
      }
    }

    for (const b of uncatBms) {
      ds.updateBookmark(b.id, { categoryId: targetCat.id })
    }
    app.save()

    return {
      handled: true,
      action: 'move_uncategorized',
      success: true,
      reply: `已成功将 ${uncatBms.length} 个未分类书签移入「${targetCat.name}」分类 🚚`,
    }
  }

  // ── 11. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
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
        reply: `数据自检修复完成！修复了 ${fixedGroupRefs} 个笔记组无效引用，修正了 ${fixedParentRefs} 个孤立子书签父级关联 🧹`,
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      reply: '数据自检完成：所有笔记组与书签关联完整无误，无需修复 ✨',
    }
  }

  // ── 12. 打开设置面板 (/settings, 打开设置) ──
  if (
    /^\/settings$/i.test(query) ||
    /^(?:请?帮?我?)?(?:打开设置|偏好设置|系统设置|设置面板)$/i.test(query)
  ) {
    ui.panels.settings = true
    return { handled: true, action: 'settings', reply: '已为您打开设置面板 ⚙️' }
  }

  // ── 未命中站内命令，回退到原有外部 AI / 寻站 / 视频处理 ──
  return { handled: false, reply: '' }
}
