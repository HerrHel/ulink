/**
 * siteIntents.ts — 站内指令意图解析层（自 dispatchSiteCommand 纯搬运拆出）
 *
 * 职责边界（2026-10-24 收窄）：
 * 1. 仅做「正则匹配 + 参数提取」，不做任何副作用（不碰 Store / UI / 网络）；
 * 2. **只管封闭集合**：零参数意图（切主题 / 清回收站 / 查重 / 体检…）与显式 /slash 指令。
 *    带参数的自然语言一律交大模型——意图是封闭集合（可穷举），参数是开放集合（无法穷举），
 *    拿正则做后者只能猜边界，猜错就是灾难：「把 X 移到 Y」家族累计 6 处误判，
 *    「新建分类 Z」曾真的建出名叫「来放工作用的东西」的分类。
 * 3. 唯二例外：parseBatchMoveIntent（依赖 UI 勾选状态，模型看不见这份信息）、
 *    parseSimilarSiteIntent（LLM 侧没有 find-similar 工具，删掉是功能损失）。
 * 4. 每个解析函数与调度层一个意图块一一对应，匹配顺序即调度层短路顺序。
 */

// ── 1. 帮助说明 (/help, /?, 帮助) ──
export function parseHelpIntent(query: string): boolean {
  return (
    /^\/(?:help|\?)$/i.test(query) ||
    /^(?:help|\/\?|\/help|帮助|指南|使用指南|你能做什么|怎么用|有哪些命令|指令列表|命令列表|站内指令|支持哪些操作)$/i.test(
      query,
    )
  )
}

// ── 2. 主题外观 (/theme, 切换深色/浅色) ──
export type ThemeIntent =
  | { kind: 'slash'; mode: string | undefined }
  | { kind: 'nl-dark' }
  | { kind: 'nl-light' }
  | { kind: 'nl-auto' }
  | { kind: 'nl-toggle' }

export function parseThemeIntent(query: string): ThemeIntent | null {
  const themeSlashMatch = query.match(/^\/theme(?:\s+(dark|light|auto))?$/i)
  if (themeSlashMatch) {
    return { kind: 'slash', mode: themeSlashMatch[1]?.toLowerCase() }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:深色|暗黑|暗色|夜间|黑暗|黑夜)(?:模式|主题)?$/i.test(
      query,
    ) ||
    /^(?:switch\s+to\s+)?(?:dark\s+mode|dark\s+theme)$/i.test(query.trim())
  ) {
    return { kind: 'nl-dark' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:浅色|白天|明亮|日间|白色)(?:模式|主题)?$/i.test(
      query,
    ) ||
    /^(?:switch\s+to\s+)?(?:light\s+mode|light\s+theme)$/i.test(query.trim())
  ) {
    return { kind: 'nl-light' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启)?\s*(?:跟随系统|自动主题|系统主题|自动模式)(?:模式|主题)?$/i.test(
      query,
    ) ||
    /^(?:switch\s+to\s+)?(?:system\s+theme|auto\s+theme|auto\s+mode)$/i.test(query.trim())
  ) {
    return { kind: 'nl-auto' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换主题|换个主题|反转主题)$/i.test(query) ||
    /^(?:toggle\s+theme|change\s+theme|switch\s+theme)$/i.test(query.trim())
  ) {
    return { kind: 'nl-toggle' }
  }

  return null
}

// ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
export type ViewIntent =
  | { kind: 'slash'; mode: string | undefined }
  | { kind: 'list' }
  | { kind: 'grid' }
  | { kind: 'compact' }

export function parseViewIntent(query: string): ViewIntent | null {
  const viewSlashMatch = query.match(/^\/view(?:\s+(grid|list|compact|mini-grid))?$/i)
  if (viewSlashMatch) {
    return { kind: 'slash', mode: viewSlashMatch[1]?.toLowerCase() }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:列表视图|列表模式|清单视图)$/i.test(query) ||
    /^(?:switch\s+to\s+)?(?:list\s+view|list\s+mode)$/i.test(query.trim())
  ) {
    return { kind: 'list' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:网格视图|宫格视图|网格模式|大宫格)$/i.test(query) ||
    /^(?:switch\s+to\s+)?(?:grid\s+view|grid\s+mode)$/i.test(query.trim())
  ) {
    return { kind: 'grid' }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:紧凑视图|紧凑模式|小宫格|迷你宫格)$/i.test(query) ||
    /^(?:switch\s+to\s+)?(?:compact\s+view|compact\s+mode)$/i.test(query.trim())
  ) {
    return { kind: 'compact' }
  }

  return null
}

// ── 4. 分类管理 (/cat, 新建分类) ──
export type CatIntent = { kind: 'list' } | { kind: 'add'; name: string | undefined }

export function parseCatIntent(query: string): CatIntent | null {
  if (/^\/cat\s+list$/i.test(query) || /^(?:分类列表|查看分类|所有分类)$/i.test(query)) {
    return { kind: 'list' }
  }

  const catSlashMatch = query.match(/^\/cat(?:\s+add)?\s+(.+)$/i)
  // 只认显式 /cat 指令。自然语言的「新建分类 XX」交大模型：
  // 「帮我创建分类来放工作用的东西」需要理解意图，不是抠个名字就够（曾真的建出
  // 一个叫「来放工作用的东西」的分类）。用户打了斜杠 = 明确指定，直接信任。
  const catName = catSlashMatch ? catSlashMatch[1]?.trim() : null
  if (catName === null) {
    return null
  }
  return { kind: 'add', name: catName }
}

// ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
export function parseTrashIntent(query: string): 'clear' | 'open' | null {
  if (
    /^\/trash\s+(?:clear|empty)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清空|清掉|清理|倒空|倒掉)(?:回收站|垃圾桶)$/i.test(query) ||
    /^(?:empty\s+trash|clear\s+trash)$/i.test(query.trim())
  ) {
    return 'clear'
  }

  if (/^\/trash$/i.test(query) || /^(?:请?帮?我?)?(?:打开|查看|进入)?回收站$/i.test(query)) {
    return 'open'
  }

  return null
}

// ── 6. 查重巡检 (/dedup, 查找重复书签) ──
export function parseDedupIntent(query: string): boolean {
  return (
    /^\/dedup(?:\s+find)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:查重|查找重复书签|检查重复|有哪些重复书签|重复书签|重复链接)$/i.test(query) ||
    /^(?:find\s+duplicates|check\s+duplicates|dedup|find\s+dups)$/i.test(query.trim())
  )
}

// ── 6.5 主题工作台生成 (/pack <主题名>) ──
export function parsePackIntent(query: string): { rawTopic: string | undefined } | null {
  // 只认显式 /pack 指令。自然语言的「帮我搭建 XX 工作台」交大模型：
  // 「搭建一个前端学习工作台」用正则抠出来的主题会带量词（「一个前端学习」），
  // 拿它去云端检索只会得到偏题的结果。
  const packSlashMatch = query.match(/^\/pack(?:\s+(.+))?$/i)
  if (!packSlashMatch) {
    return null
  }
  return { rawTopic: packSlashMatch[1]?.trim() }
}

// ── 7. 死链检测与自愈 (/deadlink, 检查死链, 死链自愈) ──
export function parseDeadlinkIntent(query: string): boolean {
  return (
    /^\/deadlinks?(?:\s+(?:heal|check|fix))?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:检查死链|死链检测|死链巡检|检测失效链接|检测死链|修复死链|死链自愈)$/i.test(
      query,
    )
  )
}

// ── 8. 数据导出备份 (/export, 导出数据) ──
export function parseExportIntent(query: string): boolean {
  return (
    /^\/export(?:\s+data)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:导出数据|备份书签|导出备份|全量备份|下载备份)$/i.test(query)
  )
}

// ── 9. 全库统计 (/stats, 书签统计) ──
export function parseStatsIntent(query: string): boolean {
  return (
    /^\/stats$/i.test(query) ||
    /^(?:请?帮?我?)?(?:书签统计|数据统计|库状态|书签总数|有多少书签)$/i.test(query) ||
    /^(?:vault\s+stats|bookmark\s+stats|statistics)$/i.test(query.trim())
  )
}

// ── 9.1 全库资产体检中心 (/health, 资产体检) ──
export function parseHealthIntent(query: string): boolean {
  return (
    /^\/health$/i.test(query) ||
    /^(?:请?帮?我?)?(?:资产体检|健康体检|全库体检|资产健康度|体检报告|健康诊断|书签体检|全面体检)$/i.test(
      query,
    ) ||
    /^(?:health\s+check|vault\s+audit|audit\s+vault|check\s+health)$/i.test(query.trim())
  )
}

// ── 9.2 收件箱清零与智能归拢 (/inbox, 智能归类) ──
export function parseInboxIntent(query: string): boolean {
  return (
    /^\/inbox(?:\s+(?:zero|clean|organize))?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:收件箱清零|智能归类|整理未分类|归拢未分类|未分类整理|清空未分类|归类书签)$/i.test(
      query,
    ) ||
    /^(?:inbox\s+zero|clean\s+inbox|organize\s+inbox)$/i.test(query.trim())
  )
}

// ── 10. 上下文感知：批量移动选中的书签 ──
export function parseBatchMoveIntent(query: string): { targetName: string } | null {
  const batchMoveMatch = query.match(
    /^(?:把|将)?(?:选中的|这些)?(?:书签)?(?:全部)?(?:移动到?|移到|放到|归入|归到)\s*[:：]?\s*(.+)$/i,
  )
  if (!batchMoveMatch) {
    return null
  }
  const targetName = batchMoveMatch[1]!.trim().replace(/^到\s*/, '')
  // 目标不像分类名（「移到合适的分类去，并补上合适标签」）→ 交回大模型
  if (!looksLikeCategoryName(targetName)) return null
  return { targetName }
}

// ── 11. 批量整理未分类 (/move uncategorized <分类名>) ──
export function parseMoveIntent(query: string): { targetCategoryRaw: string | undefined } | null {
  // 只认显式 /move uncategorized <名称>。自然语言的「把所有未分类移到 X」
  // 交大模型（它能把「移到合适的分类」这种需要判断的请求做对）。
  const moveSlashMatch = query.match(/^\/move\s+uncategorized\s+(.+)$/i)
  if (!moveSlashMatch) {
    return null
  }
  return { targetCategoryRaw: moveSlashMatch[1]?.trim().replace(/^到\s*/, '') }
}

// ── 共享：分类名形似度判定 ──
// 带参数的自然语言指令已整体交回大模型（见文件头「职责边界」），本判定当前只剩
// 「把这些书签移到 X」（parseBatchMoveIntent）一处使用——它依赖 UI 勾选状态，
// 是大模型看不见的信息优势，故保留。

/** 分类名不该出现的标点 / 连词 / 模糊限定词：出现即说明用户在描述「做什么」，而非「分类叫什么」 */
const CATEGORY_STOPWORD_RE =
  /[，,、。；;：:！!？?\n]|并|然后|同时|以及|还有|接着|顺便|最后|合适|适当|相应|正确|相关|对应|匹配|任意|某个|某些|随便|之类|等等/

/** 分类名长度上限（按码点计）：超过基本是一句口语而不是名称 */
const CATEGORY_NAME_MAX_LEN = 12

/** 泛化/指代性目标（「像这样的工具」里的「这样」不是实体名） */
const GENERIC_TARGET_RE = /^(?:这样|这种|那样|那种|这些|那些|这个|那个|此|它|它们|类似|同类|其他|别的|什么|啥|一样)/

/**
 * 目的小句起始词：「创建分类来放工作用的东西」捕获到的「来放工作用的东西」是补语而非名称。
 * 刻意只匹配「来/去 + 具体动作词」，避免误伤「去中心化资源」这类真实分类名。
 */
const CLAUSE_LEADING_RE =
  /^(?:来(?:放|存|整理|管理|收集|保存|记录|做|处理|装|区分)|去(?:放|存|整理|管理|收集|保存|记录|做|处理|装)|用于|用来|方便|以便|然后把|并(?:把|将|且)|让我|让你|专门用)/

/**
 * 判断一段文本是否「像分类名」。
 *
 * 原则：宁可漏判（走 LLM，最差也只是多问一句），也不许错判
 * （把整句口语当分类名查库，用户会收到「未找到名称包含『合适的分类去…』的分类」）。
 */
export function looksLikeCategoryName(raw: string): boolean {
  const name = raw.trim()
  if (!name) return false
  if ([...name].length > CATEGORY_NAME_MAX_LEN) return false
  if (CATEGORY_STOPWORD_RE.test(name)) return false
  // 目的小句（「来放工作用的东西」「用于整理书签」）不是名称
  if (CLAUSE_LEADING_RE.test(name)) return false
  // 句末语气/趋向词：「…分类去」「…吧」不是名称
  if (/[的吧呢啊哦呀去]$/.test(name)) return false
  return true
}

// ── 12. 上下文感知：当前分类查询 ──
export function parseCurrentCatIntent(query: string): boolean {
  return /^(?:当前在看什么分类|当前分类|当前分类有多少书签|所在分类)$/i.test(query)
}

// ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
export function parseUndoIntent(query: string): boolean {
  return (
    /^\/(?:undo|revert)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:撤销|撤销操作|撤销刚才的操作|撤销上一步|恢复原样|回退|回退上一步|undo)$/i.test(
      query,
    )
  )
}

// ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
export function parseCleanIntent(query: string): boolean {
  return (
    /^\/clean(?:\s+orphans)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清理孤立数据|清理孤儿|数据自检|自检清理)$/i.test(query)
  )
}

// ── 15. 打开设置面板 (/settings, 打开设置) ──
export function parseSettingsIntent(query: string): boolean {
  return (
    /^\/settings$/i.test(query) ||
    /^(?:请?帮?我?)?(?:打开设置|查看设置|设置面板|进入设置)$/i.test(query)
  )
}

// ── 16. 类似网站与平替查询意图 ──
export function parseSimilarSiteIntent(query: string): { target: string } | null {
  const match = query.match(
    /^(?:请?帮?我?)?(?:有(?:没有|无)|找|推荐)?(?:几个|一些)?(?:类似|像|平替|替代)\s*([a-zA-Z0-9\u4e00-\u9fa5\.-]+)\s*(?:一样)?(?:的)?(?:工具|网站|软件|应用|产品|平替)?\s*[?？]?$/i,
  )
  if (!match) return null
  const target = match[1].trim()
  if (!target || target === '这' || target === '这个') return null
  // 泛化/指代性目标（「像这样的工具」→ 捕获到「这样的工具」）不是实体名，交回大模型
  if (GENERIC_TARGET_RE.test(target)) return null
  return { target }
}
