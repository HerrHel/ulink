/**
 * intentRouter.ts — AI Agent 意图准入路由器 (Intent Router & Tool Gate)
 *
 * 核心目标：
 * 终结 Agent 盲目抢跑工具（Eager Tool Invocation），在将请求派发给大模型前进行确定性意图分流：
 * 1. 明确操作指令 (OPERATIONAL)：挂载工具链（/slash 指令，或“帮我修复死链”、“扫描重复”、“清空回收站”等）；
 * 2. 纯对话 / 问答 / 分析 (CONVERSATIONAL)：
 *    - 用户仅粘贴长文本（引用、诊断结果、错误日志、网页片段）且无具体操作谓词；
 *    - 用户询问分析性/解释性质询（“这是什么意思”、“为什么”、“如何理解”、“符合预期吗”）；
 *    => 禁用具有全库副作用的操作类运维工具（enableTools = false），回归纯文本深度解析，杜绝答非所问；
 */

export type UserInteractionIntent = 'OPERATIONAL' | 'CONVERSATIONAL'

/** 显式声明的动作意图关键词模式（带祈使动词或专属运维动作） */
const OPERATIONAL_INTENT_PATTERNS: RegExp[] = [
  // 站内命令引导
  /^\/(?:dedup|health|inbox|trash|pack|deadlink|theme|view|export|help|clean|stats|move)\b/i,
  // 死链自愈明确指令（扩展失效链接/坏链接/打不开等自然表达）
  /(?:修复|处理|自愈|替换|检测|体检|扫描|排查|查找|找).*?(?:死链|失效书签|无效网址|失效链接|坏链接|失效的|无效链接)/,
  /(?:死链|失效书签|无效网址|失效链接|坏链接).*?(?:修复|处理|自愈|替换|检测|体检|扫描|排查|查找|找|清理)/,
  // 重复合并明确指令（支持查重/重复书签/哪些重复/合并重复等）
  /(?:查重|去重|合并|清理|排查|找|检测).*?(?:重复|冗余)/,
  /(?:重复|冗余).*?(?:合并|去重|清理|查重|书签|链接|项)/,
  // 收件箱清零整理与批量归类
  /(?:整理|清空|清零|归类|迁移|分类).*?(?:收件箱|未分类|inbox)/i,
  /(?:收件箱|未分类|inbox).*?(?:整理|清空|清零|归类|迁移|分类|清理)/i,
  /(?:整理|归类|分类).*?(?:所有书签|全库书签|我的书签|这些书签)/,
  // 全库体检与健康评估
  /(?:体检|全面体检|全库体检|健康评估|扫描资产|检查健康度|全库检查|检查书签库|资产体检|诊断书签|健康打分)/,
  // 工作台装配
  /(?:搭建|创建|组装|装配|建立).*?(?:工作台|笔记组|工作区|专栏)|(?:工作台|笔记组|工作区|专栏).*?(?:搭建|创建|组装|装配|建立)/,
  // 网页深度正文抓取/阅读分析意图（包含有效 http/https 链接且带阅读/总结/抓取谓词）
  /https?:\/\/[^\s]+.*?(?:总结|读一下|抓取|提取|分析|看下|看了什么|讲了什么|内容是|正文)/,
  /(?:总结|读一下|抓取|提取|分析|看下|看看|解析).*?https?:\/\/[^\s]+/,
  // 主题与视图切换
  /(?:切换|开启|改用).*?(?:深色模式|浅色模式|暗黑模式|视图|布局)/,
  // 数据导出
  /(?:导出|备份).*?(?:数据|书签|资产)|(?:数据|书签|资产).*?(?:导出|备份)/,
  // 复杂任务流规划
  /(?:规划|制定|生成).*?(?:流水线|步骤|任务流|计划|dag)/i,
  // 英文日常运维指令
  /\b(?:audit|inbox|dedup|duplicate|deadlink|clean|export|backup|workspace)\b/i,
]

/** 分析性质询、元对话与引用文本关键词（强阻断工具触发） */
const CONVERSATIONAL_META_PATTERNS: RegExp[] = [
  // 针对历史回答/系统输出的质询
  /(?:符合预期吗|这是什么意思|为什么会这样|怎么回事|如何理解|为什么说|你刚才|上面这[段句]|这个回答|评价一下|分析一下)/,
  // 概念性科普/原理询问（"什么是死链"、"死链怎么产生的"）
  /^(?:什么[是叫]|如何定义|为什么会出现|怎么产生的).*?(?:死链|重复|失效|收件箱)/,
  // 引用前代系统输出特有标志
  /(?:为你找到\s*\d+\s*个匹配站点|页面提示["“]视频不见了["”]|视频去哪了呢|AI\s*回答\s*给定内容|建议提供视频的完整简介)/,
  // 错误日志/栈追踪/代码输出片段
  /(?:Traceback\s*\(most\s*recent|Error:\s*|SyntaxError:|TypeError:|Exception in thread)/i,
]

/**
 * 判定用户输入的交互意图类型
 * @param promptText 用户原始输入或附加卡片后的复合 Prompt
 */
export function resolveUserInteractionIntent(promptText: string): UserInteractionIntent {
  const text = (promptText || '').trim()
  if (!text) return 'CONVERSATIONAL'

  // 1. 优先检查显式分析/元质询特征（如“符合预期吗”、“这是什么意思”、“什么是死链”）
  for (const re of CONVERSATIONAL_META_PATTERNS) {
    if (re.test(text)) {
      return 'CONVERSATIONAL'
    }
  }

  // 2. 检查是否有明确的操作/运维意图
  for (const re of OPERATIONAL_INTENT_PATTERNS) {
    if (re.test(text)) {
      return 'OPERATIONAL'
    }
  }

  // 3. 启发式防御：若长文本（≥60字）且没有任何操作指令动词（属于粘贴大段内容/对话），默认走纯文本对话
  if (text.length >= 60) {
    const hasActionVerb = /(?:帮我|请|为我|执行|一键|处理|修复|合并|整理|体检|切换|导出)/.test(text)
    if (!hasActionVerb) {
      return 'CONVERSATIONAL'
    }
  }

  // 4. 默认走语义对话与知识检索，不开破坏性/运维类工具
  return 'CONVERSATIONAL'
}
