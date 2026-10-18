/**
 * knowledge.ts — AI 模块域名/关键词知识的单一事实源（纯数据模块，零业务逻辑）
 * 只存放知识数据定义，匹配/解析等业务逻辑留在各自逻辑文件中；新增或修订知识请只改本文件。
 *
 * 各表语义区分（结构互异，勿揉合成一张表）：
 * - 分类映射（供 ai-classify）：DOMAIN_KEYWORDS 域名→分类关键词、TITLE_KEYWORDS 标题关键词→分类、ATTR_KEYWORDS 属性标签触发词
 * - 站点元数据（供 smartPrefill）：CURATED_SITES 精选站点双语知识库、GENERIC_SUBDOMAINS / SECOND_LEVEL_DOMAINS 域名解析辅助集合、CATEGORY_SYNONYMS 分类概念同义词
 * - 概念本体（供 semanticSearch）：CONCEPT_ONTOLOGY 语义概念网络拓扑
 * - 竞品图谱（供 similarWebsites）：DOMAIN_SIMILAR_MAP 域名→外部同类站点、CATEGORY_FALLBACK_SIMILAR 分类兜底推荐池
 */

// ── 类型定义 ──

export interface CuratedSiteInfo {
  titleZh: string
  titleEn: string
  notesZh: string
  notesEn: string
  categoryKeyword?: string
  tags?: string[]
}

export interface ConceptCluster {
  name: string
  keywords: string[]
  relatedTerms: string[]
  domains: string[]
}

export interface ExternalSimilarItem {
  title: string
  domain: string
  url: string
  description: string
  tags: string[]
}

// ── 分类映射（ai-classify）──

// ── 域名 → 分类关键词映射 ──
export const DOMAIN_KEYWORDS: Record<string, string[]> = {
  '开发': ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'dev.to', 'npmjs.com', 'pypi.org', 'crates.io', 'hub.docker.com', 'vercel.com', 'netlify.com', 'heroku.com', 'railway.app', 'digitalocean.com', 'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com', 'developer.mozilla.org', 'w3schools.com', 'freecodecamp.org', 'codepen.io', 'jsfiddle.net', 'replit.com', 'codesandbox.io'],
  '设计': ['figma.com', 'dribbble.com', 'behance.net', 'canva.com', 'adobe.com', 'sketch.com', 'invisionapp.com', 'zeplin.io', 'coolors.co', 'colorhunt.co'],
  '娱乐': ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'discord.com', 'telegram.org', 'web.telegram.org', 'mastodon.social', 'threads.net', 'xiaohongshu.com', 'weibo.com', 'douban.com', 'zhihu.com'],
  '视频': ['youtube.com', 'youtu.be', 'bilibili.com', 'vimeo.com', 'twitch.tv', 'netflix.com', 'disneyplus.com', 'iqiyi.com', 'youku.com'],
  '音乐': ['spotify.com', 'music.apple.com', 'soundcloud.com', 'music.163.com', 'y.qq.com', 'bandcamp.com'],
  '新闻': ['news.ycombinator.com', 'medium.com', 'bbc.com', 'cnn.com', 'reuters.com', 'theverge.com', 'techcrunch.com', 'arstechnica.com', 'wired.com', '36kr.com', 'sspai.com'],
  '购物': ['amazon.com', 'amazon.cn', 'taobao.com', 'jd.com', 'pinduoduo.com', 'ebay.com', 'walmart.com', 'target.com', 'suning.com'],
  '工具': ['notion.so', 'trello.com', 'asana.com', 'slack.com', 'zoom.us', 'docs.google.com', 'airtable.com', 'miro.com', 'excalidraw.com', 'whimsical.com', 'grammarly.com', 'deepl.com', 'translate.google.com', 'ilovepdf.com'],
  '文档': ['docs.', 'wiki.', 'readthedocs.io', 'gitbook.io', 'confluence.', 'atlassian.com'],
  'AI': ['openai.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'doubao.com', 'workbuddy.ai', 'huggingface.co', 'midjourney.com', 'stability.ai', 'bard.google.com', 'gemini.google.com', 'poe.com', 'perplexity.ai', 'deepseek.com'],
  '邮箱': ['mail.qq.com', 'mail.163.com', 'mail.google.com', 'gmail.com', 'outlook.com', 'mail.126.com'],
}

// ── 标题关键词 → 分类映射 ──
// M9：短英文词（ai/ui/git/api/code 等）用词边界匹配，避免 email/digital/capital 误命中
export const TITLE_KEYWORDS: Record<string, string[]> = {
  '开发': ['github', 'gitlab', 'stackoverflow', '代码', '编程', '开发', 'api', 'sdk', '文档', 'developer', 'code', 'programming', 'frontend', 'backend', 'react', 'vue', 'angular', 'node', 'python', 'java', 'rust', 'golang', 'typescript', 'javascript', 'css', 'html', 'webpack', 'vite', 'docker', 'kubernetes', 'linux', 'git', 'npm', 'yarn', 'pnpm'],
  '设计': ['设计', 'design', 'figma', 'sketch', 'ui', 'ux', '图标', 'icon', 'illustration', '插画', '配色', '字体', 'font'],
  '娱乐': ['微博', '推特', 'twitter', 'facebook', 'instagram', 'linkedin', 'reddit', '社交', '社区', '论坛', 'forum'],
  '视频': ['视频', 'video', 'youtube', 'bilibili', '哔哩哔哩', '电影', 'movie', '剧集', '直播', 'live'],
  '音乐': ['音乐', 'music', '歌单', 'playlist', '播客', 'podcast'],
  '新闻': ['新闻', 'news', '资讯', '头条', '日报', 'daily', '周报', 'weekly'],
  '购物': ['购物', 'shopping', '商城', '商店', 'store', '优惠', '折扣', 'coupon'],
  '工具': ['工具', 'tool', '效率', 'productivity', '笔记', 'note', 'todo', '待办', '日程', 'calendar', '协作', 'collaborate', 'pdf'],
  'AI': ['ai', '人工智能', '机器学习', 'machine learning', '深度学习', 'deep learning', '大模型', 'llm', 'chatgpt', 'gpt', 'claude', 'gemini', '豆包', 'workbuddy', 'deepseek', 'transformer', 'diffusion', 'stable diffusion', 'midjourney'],
  '邮箱': ['邮箱', 'mail', 'email', 'gmail', '163邮', '网易邮', 'qq邮', '收件箱'],
  '学习': ['教程', 'tutorial', '课程', 'course', '学习', 'learn', '入门', '指南', 'guide', 'book', '书', '电子书'],
  '游戏': ['游戏', 'game', 'steam', 'epic', 'playstation', 'xbox', 'nintendo', 'switch'],
}

// ── 属性关键词映射 ──
export const ATTR_KEYWORDS: Record<string, { domains: string[]; titles: string[] }> = {
  '常用': {
    domains: ['github.com', 'google.com', 'stackoverflow.com', 'youtube.com', 'chat.openai.com', 'chatgpt.com', 'claude.ai'],
    titles: ['常用', '每日', 'daily', '必读'],
  },
  '工作': {
    domains: ['slack.com', 'zoom.us', 'notion.so', 'trello.com', 'asana.com', 'jira.', 'confluence.', 'docs.google.com', 'airtable.com'],
    titles: ['工作', 'work', '项目', 'project', '会议', 'meeting', '日报', '周报'],
  },
  '学习': {
    domains: ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'freecodecamp.org', 'codecademy.com', 'leetcode.com', 'duolingo.com'],
    titles: ['学习', 'learn', '教程', 'tutorial', '课程', 'course', '入门', '指南'],
  },
  '临时': {
    domains: ['pastebin.com', 'gist.github.com', 'hastebin.com', 'rentry.co'],
    titles: ['临时', 'temp', '草稿', 'draft', '测试', 'test'],
  },
}

// ── 站点元数据（smartPrefill）──

/**
 * 常见无业务含义的子域名前缀
 */
export const GENERIC_SUBDOMAINS = new Set([
  'www', 'docs', 'doc', 'api', 'apis', 'blog', 'blogs', 'developer', 'developers', 'dev',
  'help', 'support', 'app', 'web', 'm', 'wap', 'portal', 'admin', 'dashboard', 'status',
  'mail', 'news', 'community', 'forum', 'bbs', 'wiki', 'learn', 'static', 'assets', 'cdn'
])

/**
 * 常见两段式国别后缀
 */
export const SECOND_LEVEL_DOMAINS = new Set([
  'com.cn', 'org.cn', 'net.cn', 'gov.cn', 'edu.cn',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'co.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.kr', 'ne.kr', 're.kr',
  'com.tw', 'org.tw', 'idv.tw',
  'com.hk', 'org.hk', 'edu.hk',
  'com.au', 'net.au', 'org.au'
])

/**
 * 精选高频优质站点双语知识库
 */
export const CURATED_SITES: Record<string, CuratedSiteInfo> = {
  // ── AI 对话与工具 ──
  'chatgpt.com': {
    titleZh: 'ChatGPT',
    titleEn: 'ChatGPT',
    notesZh: 'OpenAI 旗下旗舰通用人工智能对话与推理平台。',
    notesEn: 'Flagship AI conversational and reasoning platform by OpenAI.',
    categoryKeyword: 'AI',
    tags: ['AI', '对话'],
  },
  'chat.openai.com': {
    titleZh: 'ChatGPT',
    titleEn: 'ChatGPT',
    notesZh: 'OpenAI 旗下旗舰通用人工智能对话与推理平台。',
    notesEn: 'Flagship AI conversational and reasoning platform by OpenAI.',
    categoryKeyword: 'AI',
    tags: ['AI', '对话'],
  },
  'claude.ai': {
    titleZh: 'Claude',
    titleEn: 'Claude',
    notesZh: 'Anthropic 出品，擅长长文深度分析、逻辑推理与高质量代码生成。',
    notesEn: 'Advanced AI assistant by Anthropic with strong reasoning and code generation.',
    categoryKeyword: 'AI',
    tags: ['AI', '代码'],
  },
  'deepseek.com': {
    titleZh: 'DeepSeek 深度求索',
    titleEn: 'DeepSeek',
    notesZh: '国产高性能开源推理大模型，代码编写与数学推理能力出众。',
    notesEn: 'High-performance open-source AI reasoning model with remarkable coding and math abilities.',
    categoryKeyword: 'AI',
    tags: ['AI', '开源'],
  },
  'kimi.moonshot.cn': {
    titleZh: 'Kimi 智能助手',
    titleEn: 'Kimi',
    notesZh: '月之暗面超长上下文无损文本分析助手，支持长文档与学术研读。',
    notesEn: 'Long-context conversational AI assistant by Moonshot AI for document analysis.',
    categoryKeyword: 'AI',
    tags: ['AI', '文档'],
  },
  'perplexity.ai': {
    titleZh: 'Perplexity AI 搜索',
    titleEn: 'Perplexity AI',
    notesZh: '结合实时网络检索与引文索引的 AI 交互式搜索引擎。',
    notesEn: 'Interactive AI-powered conversational search engine with real-time citations.',
    categoryKeyword: 'AI',
    tags: ['AI', '搜索'],
  },
  'gemini.google.com': {
    titleZh: 'Google Gemini',
    titleEn: 'Google Gemini',
    notesZh: 'Google 原生多模态大模型，长上下文理解与跨模态交互强劲。',
    notesEn: 'Native multimodal AI model by Google with rich contextual comprehension.',
    categoryKeyword: 'AI',
    tags: ['AI', '多模态'],
  },
  'doubao.com': {
    titleZh: '豆包',
    titleEn: 'Doubao',
    notesZh: '字节跳动推出的敏捷多功能中文 AI 对话与创作伴侣。',
    notesEn: 'Conversational AI companion by ByteDance for daily writing and dialogue.',
    categoryKeyword: 'AI',
    tags: ['AI', '写作'],
  },
  'cursor.com': {
    titleZh: 'Cursor 代码编辑器',
    titleEn: 'Cursor',
    notesZh: '面向未来的 AI 代码编辑器，深度融合大模型与开发工作流。',
    notesEn: 'Next-generation AI code editor deeply integrating LLMs with workflows.',
    categoryKeyword: '开发',
    tags: ['AI', 'IDE', '开发'],
  },
  'v0.dev': {
    titleZh: 'v0 前端生成工具',
    titleEn: 'v0 by Vercel',
    notesZh: '基于自然语言生成现代 React、Tailwind CSS 前端组件界面的生成工具。',
    notesEn: 'Generative UI system by Vercel producing modern React and Tailwind CSS components.',
    categoryKeyword: '开发',
    tags: ['AI', '前端'],
  },
  'huggingface.co': {
    titleZh: 'Hugging Face 开源社区',
    titleEn: 'Hugging Face',
    notesZh: '全球开源 AI 模型、数据集与开源 Demo 聚集的机器学习社区枢纽。',
    notesEn: 'The leading open-source hub for AI models, datasets, and machine learning demos.',
    categoryKeyword: '开发',
    tags: ['AI', '开源', '模型'],
  },
  'midjourney.com': {
    titleZh: 'Midjourney 创意生图',
    titleEn: 'Midjourney',
    notesZh: '领先的高审美与艺术水准 AI 图像生成工具。',
    notesEn: 'High-fidelity text-to-image AI tool renowned for exceptional artistic aesthetics.',
    categoryKeyword: '设计',
    tags: ['AI绘图', '设计'],
  },
  'civitai.com': {
    titleZh: 'Civitai 模型社区',
    titleEn: 'Civitai',
    notesZh: '开源 AI 绘画模型、LoRA 与创意提示词分享交流平台。',
    notesEn: 'Community platform sharing open-source AI art models, LoRAs, and prompts.',
    categoryKeyword: '设计',
    tags: ['AI绘图', '模型'],
  },

  // ── 设计、白板与原型 ──
  'figma.com': {
    titleZh: 'Figma 协作设计',
    titleEn: 'Figma',
    notesZh: '全球主流的云端协作 UI/UX 界面设计与交互原型系统平台。',
    notesEn: 'Collaborative cloud-based UI/UX design and interactive prototyping platform.',
    categoryKeyword: '设计',
    tags: ['设计', '协作', 'UI'],
  },
  'excalidraw.com': {
    titleZh: 'Excalidraw 手绘白板',
    titleEn: 'Excalidraw',
    notesZh: '开源手绘风格在线虚拟白板，适合绘制架构图、流程图与团队头脑风暴。',
    notesEn: 'Virtual collaborative whiteboard with hand-drawn feel for diagrams and sketches.',
    categoryKeyword: '工具',
    tags: ['白板', '流程图', '工具'],
  },
  'tldraw.com': {
    titleZh: 'tldraw 极简白板',
    titleEn: 'tldraw',
    notesZh: '轻量优雅的在线矢量白板工具，响应流畅且开箱即用。',
    notesEn: 'Tiny, elegant collaborative canvas and vector whiteboard.',
    categoryKeyword: '工具',
    tags: ['白板', '草图'],
  },
  'framer.com': {
    titleZh: 'Framer 交互建站',
    titleEn: 'Framer',
    notesZh: '将设计直达生产级交互体验的高保真自适应网站构建平台。',
    notesEn: 'High-fidelity interactive website builder bridging design and production.',
    categoryKeyword: '设计',
    tags: ['设计', '建站'],
  },
  'canva.com': {
    titleZh: 'Canva 可画',
    titleEn: 'Canva',
    notesZh: '多功能在线平面设计平台，海量海报、幻灯片与社交媒体模板。',
    notesEn: 'Online visual design platform with abundant graphic, slide, and poster templates.',
    categoryKeyword: '设计',
    tags: ['设计', '排版'],
  },
  'mastergo.com': {
    titleZh: 'MasterGo 协同设计',
    titleEn: 'MasterGo',
    notesZh: '国产团队协作 UI 界面设计与设计资产交付工作台。',
    notesEn: 'Collaborative UI design and component delivery workbench.',
    categoryKeyword: '设计',
    tags: ['设计', '协作'],
  },
  'dribbble.com': {
    titleZh: 'Dribbble 灵感社区',
    titleEn: 'Dribbble',
    notesZh: '全球知名设计师展示创意设计作品与获取灵感的视觉社区。',
    notesEn: 'Global community for designers to showcase visual creativity and discover inspiration.',
    categoryKeyword: '设计',
    tags: ['设计', '灵感'],
  },
  'behance.net': {
    titleZh: 'Behance 作品集',
    titleEn: 'Behance',
    notesZh: 'Adobe 旗下创意作品集展示平台，涵盖工业、平面与数字设计。',
    notesEn: 'Adobe network showcase for creative portfolios spanning multiple disciplines.',
    categoryKeyword: '设计',
    tags: ['作品集', '设计'],
  },
  'coolors.co': {
    titleZh: 'Coolors 配色工具',
    titleEn: 'Coolors',
    notesZh: '广受赞誉的在线配色方案生成器与调色板灵感库。',
    notesEn: 'Fast and intuitive color palettes generator and design exploration library.',
    categoryKeyword: '设计',
    tags: ['配色', '工具'],
  },
  'iconify.design': {
    titleZh: 'Iconify 图标聚合',
    titleEn: 'Iconify',
    notesZh: '收录超过 15 万个统一格式矢量图标的开源图标聚合框架。',
    notesEn: 'Universal icon framework indexing over 150k open-source vector icons.',
    categoryKeyword: '设计',
    tags: ['图标', '前端'],
  },

  // ── 知识管理与笔记 ──
  'notion.so': {
    titleZh: 'Notion 笔记空间',
    titleEn: 'Notion',
    notesZh: '集文档、笔记、数据库与项目管理于一体的一体化数字工作空间。',
    notesEn: 'All-in-one workspace uniting documents, notes, databases, and project management.',
    categoryKeyword: '工具',
    tags: ['笔记', '知识库'],
  },
  'obsidian.md': {
    titleZh: 'Obsidian 知识管理',
    titleEn: 'Obsidian',
    notesZh: '本地优先、双向链接与纯 Markdown 文本的个人思维与知识管理系统。',
    notesEn: 'Local-first, extensible Markdown knowledge base utilizing bidirectional links.',
    categoryKeyword: '工具',
    tags: ['笔记', 'Markdown'],
  },
  'feishu.cn': {
    titleZh: '飞书',
    titleEn: 'Feishu (Lark)',
    notesZh: '先进的企业协作与协同办公平台，含飞书文档、多维表格与云空间。',
    notesEn: 'Next-generation enterprise collaboration platform featuring docs and sheets.',
    categoryKeyword: '工具',
    tags: ['协作', '文档'],
  },
  'larksuite.com': {
    titleZh: 'Lark 飞书海外版',
    titleEn: 'Lark',
    notesZh: '面向全球团队的高效协作套件，整合即时通讯、文档与日历。',
    notesEn: 'Enterprise collaboration suite for global teams integrating chats, docs, and calendar.',
    categoryKeyword: '工具',
    tags: ['协作', '文档'],
  },
  'yuque.com': {
    titleZh: '语雀知识库',
    titleEn: 'Yuque',
    notesZh: '阿里巴巴旗下专业的结构化知识库与团队文档写作平台。',
    notesEn: 'Professional cloud knowledge base and structured documentation platform by Alibaba.',
    categoryKeyword: '工具',
    tags: ['知识库', '文档'],
  },
  'flomoapp.com': {
    titleZh: 'flomo 浮墨笔记',
    titleEn: 'flomo',
    notesZh: '无压力的短文字卡片笔记工具，适合记录稍纵即逝的灵感碎念。',
    notesEn: 'Minimalist note-taking tool designed for capturing fleeting thoughts and micro-notes.',
    categoryKeyword: '工具',
    tags: ['笔记', '灵感'],
  },
  'docs.qq.com': {
    titleZh: '腾讯文档',
    titleEn: 'Tencent Docs',
    notesZh: '腾讯旗下多人在线协同编辑的文档、表格与幻灯片办公工具。',
    notesEn: 'Cloud collaborative office suite by Tencent supporting real-time editing.',
    categoryKeyword: '工具',
    tags: ['协作', '文档'],
  },
  'wolai.com': {
    titleZh: '我来 wolai 笔记',
    titleEn: 'wolai',
    notesZh: '双向链接块级网状结构个人与团队知识库平台。',
    notesEn: 'Block-based networked knowledge management platform with bidirectional links.',
    categoryKeyword: '工具',
    tags: ['笔记', '知识库'],
  },

  // ── 代码托管与技术社区 ──
  'github.com': {
    titleZh: 'Github', // 保持测试硬契约精确匹配
    titleEn: 'Github',
    notesZh: '全球知名的开源代码托管与全球开发者协作社区。',
    notesEn: 'The world\'s leading open-source code hosting and developer collaboration platform.',
    categoryKeyword: '开发',
    tags: ['代码', '开源', '开发'],
  },
  'gitlab.com': {
    titleZh: 'GitLab 研发协同',
    titleEn: 'GitLab',
    notesZh: '功能完备的企业级 Git 仓库、CI/CD 自动化流水线与 DevSecOps 平台。',
    notesEn: 'Comprehensive enterprise Git repository, CI/CD pipelines, and DevSecOps platform.',
    categoryKeyword: '开发',
    tags: ['代码', 'CI/CD'],
  },
  'gitee.com': {
    titleZh: 'Gitee 码云',
    titleEn: 'Gitee',
    notesZh: '开源中国推出的本土代码托管与研发协作平台。',
    notesEn: 'Chinese open-source code hosting and DevOps collaboration platform.',
    categoryKeyword: '开发',
    tags: ['代码', '开源'],
  },
  'stackoverflow.com': {
    titleZh: 'Stack Overflow 技术问答',
    titleEn: 'Stack Overflow',
    notesZh: '全球规模最大的计算机技术问答与开发者互助社区。',
    notesEn: 'The largest online developer knowledge community for programming Q&A.',
    categoryKeyword: '开发',
    tags: ['问答', '技术'],
  },
  'v2ex.com': {
    titleZh: 'V2EX 程序员社区',
    titleEn: 'V2EX',
    notesZh: '创意工作者与极客技术爱好者的讨论社区。',
    notesEn: 'Community for designers, programmers, and technology enthusiasts.',
    categoryKeyword: '社区',
    tags: ['社区', '讨论', '极客'],
  },
  'juejin.cn': {
    titleZh: '稀土掘金',
    titleEn: 'Juejin',
    notesZh: '面向中文开发者的技术交流平台与前端后端博客社区。',
    notesEn: 'Technical content platform and developer community for modern engineers.',
    categoryKeyword: '开发',
    tags: ['技术', '博客', '前端'],
  },
  'zhihu.com': {
    titleZh: '知乎',
    titleEn: 'Zhihu',
    notesZh: '综合性中文问答社区与各专业领域讨论平台。',
    notesEn: 'Comprehensive Chinese Q&A and knowledge sharing community.',
    categoryKeyword: '社区',
    tags: ['问答', '社区'],
  },
  'weibo.com': {
    titleZh: '微博',
    titleEn: 'Weibo',
    notesZh: '中国主流即时社交媒体平台与实时热点资讯中心。',
    notesEn: 'Major Chinese social media platform for real-time news and microblogging.',
    categoryKeyword: '社区',
    tags: ['社交', '资讯'],
  },
  'douban.com': {
    titleZh: '豆瓣',
    titleEn: 'Douban',
    notesZh: '提供图书、电影、音乐评分与书影音兴趣小组交流的文化社区。',
    notesEn: 'Cultural discovery community for rating books, movies, music, and lifestyle.',
    categoryKeyword: '社区',
    tags: ['书影音', '社区'],
  },
  'xiaohongshu.com': {
    titleZh: '小红书',
    titleEn: 'Xiaohongshu',
    notesZh: '年轻人的生活方式分享平台与消费决策灵感社区。',
    notesEn: 'Lifestyle discovery and visual shopping inspiration platform.',
    categoryKeyword: '生活',
    tags: ['生活', '灵感'],
  },
  'sspai.com': {
    titleZh: '少数派',
    titleEn: 'SSPAI',
    notesZh: '高效工作与数字生活方式指南，优质科技与软硬件内容媒体。',
    notesEn: 'Productivity and digital lifestyle guides and hardware reviews media.',
    categoryKeyword: '资讯',
    tags: ['数码', '效率'],
  },
  'bilibili.com': {
    titleZh: '哔哩哔哩 (B站)',
    titleEn: 'Bilibili',
    notesZh: '国内知名年轻人文化与弹幕视频分享平台，含丰富优质学习教程。',
    notesEn: 'Iconic video sharing and live streaming platform popular among youth in China.',
    categoryKeyword: '娱乐',
    tags: ['视频', '学习', '娱乐'],
  },
  'youtube.com': {
    titleZh: 'YouTube 视频',
    titleEn: 'YouTube',
    notesZh: '全球最大的流媒体视频内容创作与观看平台。',
    notesEn: 'The world\'s premier video sharing and video hosting platform.',
    categoryKeyword: '娱乐',
    tags: ['视频', '流媒体'],
  },
  'spotify.com': {
    titleZh: 'Spotify 音乐',
    titleEn: 'Spotify',
    notesZh: '全球知名的数字音乐、播客与流媒体点播服务平台。',
    notesEn: 'Global digital music, podcast, and media streaming service provider.',
    categoryKeyword: '娱乐',
    tags: ['音乐', '播客'],
  },
  'music.163.com': {
    titleZh: '网易云音乐',
    titleEn: 'NetEase Cloud Music',
    notesZh: '以乐评、歌单与社区氛围著称的主流在线音乐平台。',
    notesEn: 'Popular Chinese online music streaming and social playlist platform.',
    categoryKeyword: '娱乐',
    tags: ['音乐', '评论'],
  },
  'y.qq.com': {
    titleZh: 'QQ 音乐',
    titleEn: 'QQ Music',
    notesZh: '腾讯旗下海量正版曲库与高品质音乐流媒体播放平台。',
    notesEn: 'Leading music streaming platform in China by Tencent Music Entertainment.',
    categoryKeyword: '娱乐',
    tags: ['音乐'],
  },

  // ── 开发架构与云服务 ──
  'cloudflare.com': {
    titleZh: 'Cloudflare',
    titleEn: 'Cloudflare',
    notesZh: '全球领先的 CDN、DNS 解析、Web 安全防御与边缘无服务器计算平台。',
    notesEn: 'Global CDN, DNS, cybersecurity defense, and edge computing service.',
    categoryKeyword: '开发',
    tags: ['运维', '安全', 'CDN'],
  },
  'vercel.com': {
    titleZh: 'Vercel 部署平台',
    titleEn: 'Vercel',
    notesZh: '现代前端与全栈 Web 应用的一键持续部署与无服务器托管平台。',
    notesEn: 'Hosting platform providing rapid deployment and serverless architecture for web apps.',
    categoryKeyword: '开发',
    tags: ['部署', '前端', '云服务'],
  },
  'netlify.com': {
    titleZh: 'Netlify',
    titleEn: 'Netlify',
    notesZh: '领先的 Jamstack 静态站点与现代 Web 应用自动化托管平台。',
    notesEn: 'Cloud platform for hosting automated web projects and serverless backend functions.',
    categoryKeyword: '开发',
    tags: ['部署', '前端'],
  },
  'supabase.com': {
    titleZh: 'Supabase 云数据库',
    titleEn: 'Supabase',
    notesZh: '开源的 Firebase 替代品，提供 Postgres 数据库、认证与即时存储服务。',
    notesEn: 'Open-source Firebase alternative featuring Postgres, authentication, and instant APIs.',
    categoryKeyword: '开发',
    tags: ['后端', '数据库'],
  },
  'docker.com': {
    titleZh: 'Docker 容器',
    titleEn: 'Docker',
    notesZh: '业界标准的轻量级应用容器化打包与运行环境平台。',
    notesEn: 'Enterprise software containerization platform for building and shipping applications.',
    categoryKeyword: '开发',
    tags: ['容器', '运维', '开发'],
  },
  'developer.mozilla.org': {
    titleZh: 'MDN Web 开发者文档',
    titleEn: 'MDN Web Docs',
    notesZh: '权威的 Web 标准开放文档，涵盖 HTML、CSS 与 JavaScript 规范。',
    notesEn: 'The most authoritative open documentation for standard Web platform technologies.',
    categoryKeyword: '开发',
    tags: ['文档', '前端'],
  },
  'vuejs.org': {
    titleZh: 'Vue.js 渐进式框架',
    titleEn: 'Vue.js',
    notesZh: '易学易用、性能出色且应用广泛的渐进式 JavaScript 前端框架。',
    notesEn: 'An approachable, performant, and versatile progressive JavaScript framework.',
    categoryKeyword: '开发',
    tags: ['前端', '框架'],
  },
  'react.dev': {
    titleZh: 'React 官方网站',
    titleEn: 'React',
    notesZh: '用于构建 Web 和原生用户界面的组件化前端库。',
    notesEn: 'The official library for web and native user interfaces by Meta.',
    categoryKeyword: '开发',
    tags: ['前端', '框架'],
  },
  'vite.dev': {
    titleZh: 'Vite 构建工具',
    titleEn: 'Vite',
    notesZh: '下一代极速前端开发与打包构建工具。',
    notesEn: 'Next-generation frontend tooling offering fast development server and bundling.',
    categoryKeyword: '开发',
    tags: ['前端', '工具'],
  },
  'tailwindcss.com': {
    titleZh: 'Tailwind CSS 原子样式',
    titleEn: 'Tailwind CSS',
    notesZh: '现代高效的实用优先（Utility-First）原子化 CSS 框架。',
    notesEn: 'Utility-first modern CSS framework packed with classes that can be composed directly.',
    categoryKeyword: '开发',
    tags: ['前端', 'CSS'],
  },
  'pinia.vuejs.org': {
    titleZh: 'Pinia 状态管理',
    titleEn: 'Pinia',
    notesZh: 'Vue.js 官方推荐的直观、类型安全的状态管理库。',
    notesEn: 'Intuitive, type-safe, and lightweight store library for Vue applications.',
    categoryKeyword: '开发',
    tags: ['前端', '状态管理'],
  },
  'reddit.com': {
    titleZh: 'Reddit 讨论社区',
    titleEn: 'Reddit',
    notesZh: '全球知名的多圈层社交新闻与主题论坛聚合平台。',
    notesEn: 'The front page of the internet, covering diverse subreddits and communities.',
    categoryKeyword: '社区',
    tags: ['社区', '讨论'],
  },
  'x.com': {
    titleZh: 'X (Twitter)',
    titleEn: 'X (Twitter)',
    notesZh: '全球即时短消息与行业前沿资讯传播社交网络。',
    notesEn: 'Global social network for real-time news and public conversations.',
    categoryKeyword: '社区',
    tags: ['社交', '资讯'],
  },
  'twitter.com': {
    titleZh: 'X (Twitter)',
    titleEn: 'X (Twitter)',
    notesZh: '全球即时短消息与行业前沿资讯传播社交网络。',
    notesEn: 'Global social network for real-time news and public conversations.',
    categoryKeyword: '社区',
    tags: ['社交', '资讯'],
  },
  'producthunt.com': {
    titleZh: 'Product Hunt 创新产品',
    titleEn: 'Product Hunt',
    notesZh: '发掘与分享全球最新科技工具、移动应用与创意产品的平台。',
    notesEn: 'Curation of the best new tech products and digital services launched daily.',
    categoryKeyword: '资讯',
    tags: ['产品', '灵感'],
  },
}

/**
 * 分类概念映射（将站点意图连接到用户已有的多样化分类名称）
 */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  'AI': ['ai', '人工智能', '大模型', '智能', '模型', '算法', 'gpt', 'chatgpt'],
  '开发': ['开发', '技术', '代码', '编程', '工程', '前端', '后端', 'dev', 'code', 'develop'],
  '设计': ['设计', '美工', 'ui', 'ux', '原型', '灵感', '视觉', 'design'],
  '工具': ['工具', '效率', '实用', '白板', '生产力', 'tool', 'tools', 'utility'],
  '社区': ['社区', '讨论', '社交', '极客', '论坛', '问答', 'community', 'forum'],
  '资讯': ['资讯', '阅读', '文章', '博客', '新闻', '信息', 'news', 'read'],
  '娱乐': ['娱乐', '影音', '视频', '音乐', '生活', '休闲', 'media', 'video', 'music'],
  '生活': ['生活', '日常', '备忘', '购物', 'life'],
}

// ── 概念本体（semanticSearch）──

/**
 * 语义概念网络拓扑
 */
export const CONCEPT_ONTOLOGY: ConceptCluster[] = [
  {
    name: '流程图与架构白板',
    keywords: ['流程图', '架构图', '白板', '思维导图', '拓扑图', '关系图', 'uml', '时序图', '画图', '制图', '草图'],
    relatedTerms: ['flowchart', 'diagram', 'whiteboard', 'mindmap', 'draw', 'sketch', 'graph'],
    domains: ['excalidraw.com', 'tldraw.com', 'processon.com', 'draw.io', 'diagrams.net', 'eraser.io', 'gitmind.cn', 'xmind.app'],
  },
  {
    name: 'AI 图像与创意生成',
    keywords: ['ai生图', 'ai绘图', '文生图', '图生图', '绘画模型', '图像生成', '画画', '插画生成', 'lora'],
    relatedTerms: ['midjourney', 'stable diffusion', 'diffusion', 'civitai', 'dalle', 'flux', 'comfyu', 'leonardo', 'liblib', 'image generation'],
    domains: ['midjourney.com', 'civitai.com', 'stability.ai', 'leonardo.ai', 'liblib.art'],
  },
  {
    name: 'AI 语言模型与对话',
    keywords: ['ai对话', '大模型', '语言模型', '智能助手', '问答机器人', '提示词', 'ai搜索', '长文本分析'],
    relatedTerms: ['chatgpt', 'claude', 'deepseek', 'gemini', 'kimi', 'perplexity', 'doubao', 'openai', 'anthropic', 'ollama', 'llm'],
    domains: ['chatgpt.com', 'claude.ai', 'deepseek.com', 'perplexity.ai', 'gemini.google.com', 'kimi.moonshot.cn', 'doubao.com'],
  },
  {
    name: 'AI 辅助编程',
    keywords: ['ai编程', '编程ai', '代码生成', 'ai补全', 'ai写代码', '写代码', '自动代码', '代码编辑器', '编程助手'],
    relatedTerms: ['cursor', 'copilot', 'v0', 'bolt', 'windsurf', 'cline', 'code generation'],
    domains: ['cursor.com', 'v0.dev', 'github.com/features/copilot', 'bolt.new'],
  },
  {
    name: '前端开发与状态管理',
    keywords: ['前端', '组件库', '状态管理', '界面开发', '打包构建', '单页应用'],
    relatedTerms: ['vue', 'react', 'pinia', 'redux', 'zustand', 'vite', 'tailwind', 'nextjs', 'nuxt', 'svelte', 'typescript', 'css'],
    domains: ['vuejs.org', 'react.dev', 'pinia.vuejs.org', 'tailwindcss.com', 'vite.dev', 'nextjs.org'],
  },
  {
    name: '后端、接口与数据库',
    keywords: ['后端', '接口', '数据库', '微服务', '服务端', 'orm', '缓存', 'api调试'],
    relatedTerms: ['api', 'postman', 'hoppscotch', 'apifox', 'supabase', 'prisma', 'docker', 'postgresql', 'mysql', 'redis', 'node', 'python', 'golang'],
    domains: ['supabase.com', 'postman.com', 'hoppscotch.io', 'apifox.com', 'docker.com'],
  },
  {
    name: 'UI/UX 界面原型设计',
    keywords: ['ui设计', '交互原型', '切图', '设计系统', '设计规范', '高保真原型', '配色', '图标库', '矢量图'],
    relatedTerms: ['figma', 'sketch', 'framer', 'mastergo', 'jsdesign', 'penpot', 'iconify', 'coolors', 'dribbble', 'behance', 'mobbin', 'design'],
    domains: ['figma.com', 'framer.com', 'mastergo.com', 'iconify.design', 'coolors.co', 'dribbble.com', 'behance.net', 'mobbin.com'],
  },
  {
    name: '笔记、文档与知识管理',
    keywords: ['笔记', '知识库', '双链笔记', '个人维基', '写作', '文档', '备忘', '闪念', '卡片盒'],
    relatedTerms: ['notion', 'obsidian', 'logseq', 'wolai', '语雀', '飞书', 'flomo', 'craft', 'flowus', 'markdown', 'wiki', 'notes'],
    domains: ['notion.so', 'obsidian.md', 'feishu.cn', 'yuque.com', 'flomoapp.com', 'craft.do'],
  },
  {
    name: '流媒体与视频娱乐',
    keywords: ['看视频', '看剧', '影视', '视频教程', '弹幕', '录屏', '剪辑', '追剧'],
    relatedTerms: ['bilibili', 'youtube', 'netflix', 'b站', '油管', 'capcut', '剪映', 'video'],
    domains: ['bilibili.com', 'youtube.com', 'netflix.com'],
  },
  {
    name: '音乐、音频与播客',
    keywords: ['听歌', '音乐', '播客', '音效', '背景音', '白噪音', '电台'],
    relatedTerms: ['music', 'podcast', 'audio', 'spotify', '网易云', 'qq音乐', '喜马拉雅', 'sound'],
    domains: ['spotify.com', 'music.163.com', 'y.qq.com', 'xiaoyuzhoufm.com'],
  },
  {
    name: '开发者社区与技术论坛',
    keywords: ['技术论坛', '开发者社区', '极客讨论', '问答', '博客', '技术分享'],
    relatedTerms: ['v2ex', 'zhihu', 'juejin', 'stackoverflow', 'reddit', 'github', '掘金', '知乎', 'community'],
    domains: ['v2ex.com', 'zhihu.com', 'juejin.cn', 'stackoverflow.com', 'reddit.com'],
  },
  {
    name: '部署、运维与云服务',
    keywords: ['部署', '云服务器', '域名解析', '反向代理', '边缘计算', '免备案建站', '自动化流水线'],
    relatedTerms: ['vercel', 'cloudflare', 'netlify', 'railway', 'aliyun', 'aws', 'docker', 'devops', 'hosting'],
    domains: ['vercel.com', 'cloudflare.com', 'netlify.com', 'railway.app'],
  },
  {
    name: '实用工具箱与在线转换',
    keywords: ['工具箱', '格式转换', '计算器', '压缩', '正则', 'base64', 'json格式化', 'pdf工具', '时间戳'],
    relatedTerms: ['tool', 'utility', 'converter', 'regex', 'json', 'pdf', 'calculator'],
    domains: ['tool.lu', 'caniuse.com', 'json.cn', 'transform.tools'],
  },
  {
    name: '动漫与番剧',
    keywords: ['看番', '追番', '番剧', '新番', '动漫', '动画', '漫画', '二次元', '字幕组', '国漫', '日本动漫', '在线看番'],
    relatedTerms: ['anime', 'omofun', 'dongman', '樱花动漫', '风车动漫', 'agefans', 'mikanani', 'nyaa', '番組'],
    domains: ['omofun.com', 'omofun.tv', 'omofun.org', 'mikanani.me', 'nyaa.si'],
  },
  {
    name: '影视追剧与观影',
    keywords: ['看电影', '看剧', '追剧', '电视剧', '美剧', '韩剧', '日剧', '纪录片', '影院', '在线观影', '高清电影', '免费看电影'],
    relatedTerms: ['movie', 'tvshow', 'drama', '人人影视', '低端影视', 'libvio', '在线影院', '影视'],
    domains: ['netflix.com', 'iqiyi.com', 'youku.com', 'v.qq.com', 'douban.com'],
  },
  {
    name: '资源下载与网盘搜索',
    keywords: ['找资源', '资源搜索', '下载资源', '磁力', '磁力链接', 'ed2k', '网盘', '网盘搜索', '软件下载', '免费资源', '破解', '绿色软件'],
    relatedTerms: ['download', 'torrent', 'magnet', '百度网盘', '夸克网盘', '阿里云盘', '资源站', 'downloadly'],
    domains: ['alipan.com', 'pan.baidu.com', 'pan.quark.cn', '115.com'],
  },
  {
    name: '格式转换与文件处理',
    keywords: ['转格式', '格式转换', '压缩文件', '文件压缩', 'pdf转换', '图片压缩', '视频转换', '音频转换', '去水印', '在线转换', '转pdf'],
    relatedTerms: ['convert', 'converter', 'compress', 'zip', '格式工厂', 'ilovepdf', 'tinypng', 'cloudconvert', 'convertio', 'smallpdf'],
    domains: ['ilovepdf.com', 'cloudconvert.com', 'convertio.co', 'tinypng.com', 'smallpdf.com'],
  },
  {
    name: '设计素材与灵感库',
    keywords: ['素材', '设计素材', '免费素材', '图片素材', '视频素材', '音效素材', '灵感', '配色灵感', '免版权'],
    relatedTerms: ['unsplash', 'pexels', 'pixabay', 'iconfont', '花瓣', '站酷', 'zcool', 'freepik', 'storyset', 'stock'],
    domains: ['unsplash.com', 'pexels.com', 'pixabay.com', 'iconfont.cn', 'zcool.com.cn', 'huaban.com', 'freepik.com'],
  },
]

// ── 竞品图谱（similarWebsites）──

/** 精选高质量外部同类站点知识图谱 */
export const DOMAIN_SIMILAR_MAP: Record<string, ExternalSimilarItem[]> = {
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
export const CATEGORY_FALLBACK_SIMILAR: Record<string, ExternalSimilarItem[]> = {
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
