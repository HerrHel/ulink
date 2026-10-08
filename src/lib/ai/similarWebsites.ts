/**
 * similarWebsites.ts — 本地类似网站知识图谱与外部竞品推荐
 * 纯前端离线运作，基于高频域名拓扑与分类原型推荐类似优秀工具与网站。
 */

export interface ExternalSimilarItem {
  title: string
  domain: string
  url: string
  description: string
  tags: string[]
}

/** 精选高质量外部同类站点知识图谱 */
const DOMAIN_SIMILAR_MAP: Record<string, ExternalSimilarItem[]> = {
  // ── AI 交互与工具 ──
  'chatgpt.com': [
    { title: 'Claude', domain: 'claude.ai', url: 'https://claude.ai', description: 'Anthropic 出品，逻辑推理与长文代码极佳的 AI 对话助手', tags: ['AI', '对话'] },
    { title: 'DeepSeek', domain: 'deepseek.com', url: 'https://chat.deepseek.com', description: '高性价比开源推理模型，代码与数学能力顶尖', tags: ['AI', '推理'] },
    { title: 'Perplexity', domain: 'perplexity.ai', url: 'https://www.perplexity.ai', description: '融合实时全网检索与引文验证的 AI 搜索引擎', tags: ['AI', '搜索'] },
    { title: 'Google Gemini', domain: 'gemini.google.com', url: 'https://gemini.google.com', description: 'Google 原生多模态大模型，长上下文理解优秀', tags: ['AI', '多模态'] },
  ],
  'claude.ai': [
    { title: 'ChatGPT', domain: 'chatgpt.com', url: 'https://chatgpt.com', description: 'OpenAI 旗舰 AI 模型，生态与通用能力标杆', tags: ['AI', '对话'] },
    { title: 'DeepSeek', domain: 'deepseek.com', url: 'https://chat.deepseek.com', description: '高性价比开源推理模型，逻辑推理极为扎实', tags: ['AI', '代码'] },
    { title: 'Kimi', domain: 'kimi.moonshot.cn', url: 'https://kimi.moonshot.cn', description: '月之暗面长文本 AI 助手，超长文档精读分析', tags: ['AI', '长文档'] },
  ],
  'deepseek.com': [
    { title: 'Claude', domain: 'claude.ai', url: 'https://claude.ai', description: 'Anthropic 出品的高智商代码与推理 AI', tags: ['AI', '逻辑'] },
    { title: 'ChatGPT', domain: 'chatgpt.com', url: 'https://chatgpt.com', description: 'OpenAI 广泛使用的通用智能对话平台', tags: ['AI', '通用'] },
    { title: '豆包', domain: 'doubao.com', url: 'https://www.doubao.com', description: '字节跳动推出的轻量敏捷中文 AI 伴侣', tags: ['AI', '实用'] },
  ],
  'midjourney.com': [
    { title: 'Stable Diffusion Web', domain: 'stability.ai', url: 'https://stability.ai', description: '开源图像生成与扩散模型领域的基石', tags: ['AI绘图', '开源'] },
    { title: 'Leonardo.Ai', domain: 'leonardo.ai', url: 'https://leonardo.ai', description: '面向游戏与创意设计的专业级 AI 图像生成工具', tags: ['AI绘图', '设计'] },
    { title: 'Civitai', domain: 'civitai.com', url: 'https://civitai.com', description: '开源 AI 绘画模型与 LoRA 社区平台', tags: ['模型社区', '开源'] },
  ],

  // ── 代码与开发 ──
  'github.com': [
    { title: 'GitLab', domain: 'gitlab.com', url: 'https://gitlab.com', description: '集成完整 CI/CD 与 DevSecOps 的代码协作平台', tags: ['代码托管', 'CI/CD'] },
    { title: 'Gitee', domain: 'gitee.com', url: 'https://gitee.com', description: '国内访问流畅的代码托管与研发协作平台', tags: ['开源社区', '协作'] },
    { title: 'Codeberg', domain: 'codeberg.org', url: 'https://codeberg.org', description: '非营利、注重隐私与开源伦理的 Git 代码托管平台', tags: ['独立开源', '隐私'] },
  ],
  'stackoverflow.com': [
    { title: 'Dev.to', domain: 'dev.to', url: 'https://dev.to', description: '活跃的全球开发者交流与经验分享社区', tags: ['开发者社区', '博客'] },
    { title: 'Hashnode', domain: 'hashnode.com', url: 'https://hashnode.com', description: '现代开发者博客与技术创作发布网络', tags: ['技术写作', '社区'] },
    { title: '掘金', domain: 'juejin.cn', url: 'https://juejin.cn', description: '国内高品质前端与技术开发者内容分享平台', tags: ['前端', '开发者'] },
  ],
  'codepen.io': [
    { title: 'CodeSandbox', domain: 'codesandbox.io', url: 'https://codesandbox.io', description: '云端快速全栈前端应用沙箱与原型开发环境', tags: ['在线IDE', '前端'] },
    { title: 'StackBlitz', domain: 'stackblitz.com', url: 'https://stackblitz.com', description: '在浏览器 WebContainer 中秒级运行 Node.js 的云端 IDE', tags: ['WebContainer', 'IDE'] },
    { title: 'JSFiddle', domain: 'jsfiddle.net', url: 'https://jsfiddle.net', description: '经典的轻量 HTML/CSS/JS 代码片段在线调试工具', tags: ['代码调试', '片段'] },
  ],
  'vercel.com': [
    { title: 'Cloudflare Pages', domain: 'pages.cloudflare.com', url: 'https://pages.cloudflare.com', description: '依托全球边缘网络的极速静态网页与函数托管', tags: ['边缘计算', '免备案'] },
    { title: 'Netlify', domain: 'netlify.com', url: 'https://www.netlify.com', description: '成熟的 Jamstack 现代前端部署与工作流平台', tags: ['自动化构建', '部署'] },
    { title: 'Railway', domain: 'railway.app', url: 'https://railway.app', description: '开箱即用的全栈容器与数据库部署平台', tags: ['容器', '后端托管'] },
  ],

  // ── 设计与视觉 ──
  'figma.com': [
    { title: 'Penpot', domain: 'penpot.app', url: 'https://penpot.app', description: '基于 Web 与 SVG 标准的开源协作 UI/UX 设计工具', tags: ['开源设计', '协作'] },
    { title: 'Framer', domain: 'framer.com', url: 'https://www.framer.com', description: '将设计直通高保真交互与自适应网站构建的工具', tags: ['交互设计', '建站'] },
    { title: 'MasterGo', domain: 'mastergo.com', url: 'https://mastergo.com', description: '国产协同 UI 设计与团队设计系统交付平台', tags: ['协作设计', '国内优化'] },
  ],
  'dribbble.com': [
    { title: 'Behance', domain: 'behance.net', url: 'https://www.behance.net', description: 'Adobe 旗下全球顶尖创作者展示与作品集社区', tags: ['设计社区', '作品集'] },
    { title: 'Mobbin', domain: 'mobbin.com', url: 'https://mobbin.com', description: '收录全球顶尖移动端与网页 UI/UX 截图灵感库', tags: ['UI参考', '灵感'] },
    { title: 'Awwwards', domain: 'awwwards.com', url: 'https://www.awwwards.com', description: '表彰全球最具创意、前沿 Web 设计与交互作品', tags: ['网页设计', '创意'] },
  ],
  'coolors.co': [
    { title: 'Color Hunt', domain: 'colorhunt.co', url: 'https://colorhunt.co', description: '精选千款高质量设计师配色方案灵感库', tags: ['配色', '灵感'] },
    { title: 'Realtime Colors', domain: 'realtimecolors.com', url: 'https://realtimecolors.com', description: '在真实网页组件中实时预览配色与对比度', tags: ['实时配色', '无障碍'] },
    { title: 'Adobe Color', domain: 'color.adobe.com', url: 'https://color.adobe.com', description: '专业色轮与基于色彩理论的调色板提取工具', tags: ['色轮', '调色板'] },
  ],

  // ── 笔记、知识与白板 ──
  'notion.so': [
    { title: 'Obsidian', domain: 'obsidian.md', url: 'https://obsidian.md', description: '基于本地 Markdown 与双向链接的个人知识库', tags: ['卡片笔记', '本地优先'] },
    { title: 'Craft', domain: 'craft.do', url: 'https://www.craft.do', description: '排版精美、原生体验极佳的文档与结构化笔记', tags: ['原生质感', '文档'] },
    { title: 'Anytype', domain: 'anytype.io', url: 'https://anytype.io', description: '本地优先、端到端加密的下一代去中心化知识库', tags: ['去中心化', '加密'] },
  ],
  'excalidraw.com': [
    { title: 'tldraw', domain: 'tldraw.com', url: 'https://www.tldraw.com', description: '极简流畅、可自由嵌入扩展的在线虚拟白板', tags: ['开源白板', '草图'] },
    { title: 'Eraser.io', domain: 'eraser.io', url: 'https://www.eraser.io', description: '专为工程团队打造的文档与架构图绘制工作台', tags: ['架构图', '开发者'] },
    { title: 'Diagrams.net', domain: 'app.diagrams.net', url: 'https://app.diagrams.net', description: '功能全面且完全免费的开源流程图与 UML 绘制工具', tags: ['流程图', '开源'] },
  ],

  // ── 图标与字体 ──
  'iconify.design': [
    { title: 'Lucide Icons', domain: 'lucide.dev', url: 'https://lucide.dev', description: '优雅、轻量且活跃维护的现代化通用图标库', tags: ['图标库', '开源'] },
    { title: 'Tabler Icons', domain: 'tabler.io', url: 'https://tabler.io/icons', description: '超过 5000+ 高度一致像素级完美的矢量图标', tags: ['矢量图标', '自由定制'] },
    { title: 'Simple Icons', domain: 'simpleicons.org', url: 'https://simpleicons.org', description: '各大流行品牌与流行开源项目的矢量 Logo 库', tags: ['品牌Logo', 'SVG'] },
  ],
}

/** 针对分类通用的备选推荐池（当具体域名未直接命中时兜底） */
const CATEGORY_FALLBACK_SIMILAR: Record<string, ExternalSimilarItem[]> = {
  '开发': [
    { title: 'GitHub', domain: 'github.com', url: 'https://github.com', description: '全球最大的开源软件开发与协作托管平台', tags: ['代码', '开发'] },
    { title: 'Stack Overflow', domain: 'stackoverflow.com', url: 'https://stackoverflow.com', description: '开发者疑难问答与技术经验互助社区', tags: ['技术问答', '调试'] },
    { title: 'Can I Use', domain: 'caniuse.com', url: 'https://caniuse.com', description: 'Web 前端特性与浏览器兼容性权威查询表', tags: ['浏览器兼容', '标准'] },
  ],
  'AI': [
    { title: 'Claude', domain: 'claude.ai', url: 'https://claude.ai', description: '擅长复杂推理、代码生成与长文逻辑的 AI 助手', tags: ['AI', '推理'] },
    { title: 'DeepSeek', domain: 'deepseek.com', url: 'https://chat.deepseek.com', description: '开源高智力密度推理大模型', tags: ['AI', '开源'] },
    { title: 'Hugging Face', domain: 'huggingface.co', url: 'https://huggingface.co', description: '开源 AI 模型、数据集与演示空间汇聚社区', tags: ['模型社区', 'AI'] },
  ],
  '设计': [
    { title: 'Figma', domain: 'figma.com', url: 'https://figma.com', description: '业界标杆级的在线协同界面设计与原型工具', tags: ['UI/UX', '设计'] },
    { title: 'Dribbble', domain: 'dribbble.com', url: 'https://dribbble.com', description: '全球知名设计师展示创意与灵感的视觉平台', tags: ['灵感', '设计'] },
    { title: 'Mobbin', domain: 'mobbin.com', url: 'https://mobbin.com', description: '前沿 App 与 Web 页面交互设计截图参考', tags: ['UI设计', '参考'] },
  ],
  '工具': [
    { title: 'Notion', domain: 'notion.so', url: 'https://notion.so', description: '一体化工作空间：笔记、知识库、任务管理', tags: ['生产力', '笔记'] },
    { title: 'tldraw', domain: 'tldraw.com', url: 'https://www.tldraw.com', description: '轻快直观的无限画布白板工具', tags: ['白板', '草图'] },
    { title: 'CyberChef', domain: 'gchq.github.io', url: 'https://gchq.github.io/CyberChef', description: '网络瑞士军刀：编解码、加密与数据提取工具箱', tags: ['实用工具', '安全'] },
  ],
}

/** 规范化域名匹配键 */
function normalizeDomain(urlOrDomain: string): string {
  try {
    const raw = urlOrDomain.startsWith('http') ? new URL(urlOrDomain).hostname : urlOrDomain
    return raw.replace(/^www\./, '').toLowerCase().trim()
  } catch {
    return (urlOrDomain || '').replace(/^www\./, '').toLowerCase().trim()
  }
}

/**
 * 获取与当前书签相关的外部优秀同类网站推荐
 * 优先按精确域名匹配；未命中时按包含匹配；仍未命中时按分类关键词兜底
 */
export function getSimilarExternalWebsites(
  url: string,
  categoryName?: string | null,
  limit = 4,
): ExternalSimilarItem[] {
  const norm = normalizeDomain(url)
  if (!norm) return []

  // 1. 精确匹配
  if (DOMAIN_SIMILAR_MAP[norm]) {
    return DOMAIN_SIMILAR_MAP[norm].slice(0, limit)
  }

  // 2. 泛域名或子串匹配（如 chat.openai.com 命中 chatgpt.com 等）
  if (norm.includes('openai.com')) return DOMAIN_SIMILAR_MAP['chatgpt.com'].slice(0, limit)
  if (norm.includes('claude')) return DOMAIN_SIMILAR_MAP['claude.ai'].slice(0, limit)
  if (norm.includes('deepseek')) return DOMAIN_SIMILAR_MAP['deepseek.com'].slice(0, limit)

  for (const [key, items] of Object.entries(DOMAIN_SIMILAR_MAP)) {
    if (norm.includes(key) || key.includes(norm)) {
      return items.slice(0, limit)
    }
  }

  // 3. 分类兜底匹配
  if (categoryName) {
    const matchedCategory = Object.keys(CATEGORY_FALLBACK_SIMILAR).find(cat =>
      categoryName.includes(cat) || cat.includes(categoryName),
    )
    if (matchedCategory && CATEGORY_FALLBACK_SIMILAR[matchedCategory]) {
      // 过滤掉自身已经对应的域名
      return CATEGORY_FALLBACK_SIMILAR[matchedCategory]
        .filter(it => it.domain !== norm)
        .slice(0, limit)
    }
  }

  return []
}
