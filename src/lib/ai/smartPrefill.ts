/**
 * smartPrefill.ts — 智能书签预填引擎
 * 添加书签时根据 URL 智能自动补全名称、备注、分类与属性（严格从已有分类/属性中预选）。
 * 中文用户推荐地道中文名称，英文用户推荐地道英文名称。
 * 纯本地优先，零网络延迟，零隐私泄漏。
 */

import type { Bookmark, Category, CustomAttribute } from '../../types.js'
import { domain, fixUrl } from '../../utils.js'
import { getLocale } from '../../i18n/index.js'

export interface SmartPrefillResult {
  title: string
  notes: string
  categoryId?: string
  suggestedAttrIds: string[]
  suggestedUsername?: string
  confidence: 'high' | 'medium' | 'fallback'
}

export interface CuratedSiteInfo {
  titleZh: string
  titleEn: string
  notesZh: string
  notesEn: string
  categoryKeyword?: string
  tags?: string[]
}

/**
 * 常见无业务含义的子域名前缀
 */
const GENERIC_SUBDOMAINS = new Set([
  'www', 'docs', 'doc', 'api', 'apis', 'blog', 'blogs', 'developer', 'developers', 'dev',
  'help', 'support', 'app', 'web', 'm', 'wap', 'portal', 'admin', 'dashboard', 'status',
  'mail', 'news', 'community', 'forum', 'bbs', 'wiki', 'learn', 'static', 'assets', 'cdn'
])

/**
 * 常见两段式国别后缀
 */
const SECOND_LEVEL_DOMAINS = new Set([
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
 * 从 hostname 提取核心品牌主名（如 docs.docker.com -> brand='docker', rootDomain='docker.com'）
 */
export function extractBrandFromHostname(rawHost: string): { brand: string; sub: string; rootDomain: string } {
  const host = rawHost.toLowerCase().trim().replace(/^www\./i, '')
  const parts = host.split('.')
  if (parts.length <= 1) {
    return { brand: host, sub: '', rootDomain: host }
  }

  // 检查两段式后缀（如 example.com.cn）
  const lastTwo = parts.slice(-2).join('.')
  let sld = ''
  let subParts: string[] = []
  let rootDomain = ''

  if (SECOND_LEVEL_DOMAINS.has(lastTwo) && parts.length >= 3) {
    sld = parts[parts.length - 3]
    subParts = parts.slice(0, parts.length - 3)
    rootDomain = `${sld}.${lastTwo}`
  } else {
    sld = parts[parts.length - 2]
    subParts = parts.slice(0, parts.length - 2)
    rootDomain = `${sld}.${parts[parts.length - 1]}`
  }

  // 过滤通用子域名
  const meaningfulSub = subParts.find(s => !GENERIC_SUBDOMAINS.has(s)) || ''
  return { brand: sld, sub: meaningfulSub, rootDomain }
}

/**
 * 解析文章或页面的语义 Slug
 */
function parseArticleSlug(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '')
  const parts = clean.split('/').filter(Boolean)
  if (!parts.length) return null
  const lastPart = parts[parts.length - 1]
  if (/^[a-zA-Z0-9_\-]+$/.test(lastPart) && (lastPart.includes('-') || lastPart.includes('_')) && lastPart.length > 5) {
    const words = lastPart.split(/[-_]+/).filter(w => !/^\d+$/.test(w))
    if (words.length >= 2) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }
  }
  return null
}

/**
 * 结构化解析 URL 路径生成语义化标题与描述（支持中英文）
 */
function parsePathSemantics(urlObj: URL, isZh: boolean): { title?: string; notes?: string } {
  const host = urlObj.hostname.replace(/^www\./i, '').toLowerCase()
  const path = urlObj.pathname.replace(/\/+$/, '')

  // 1. GitHub 深度路径解析
  if (host === 'github.com') {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 2) {
      const [owner, repo] = parts
      return {
        title: `${repo} (${owner}/${repo})`,
        notes: isZh
          ? `GitHub 开源项目仓库：${owner}/${repo}`
          : `GitHub open-source repository: ${owner}/${repo}`,
      }
    } else if (parts.length > 2) {
      const [owner, repo, sub, ...rest] = parts
      if (sub === 'issues') {
        const issueNum = rest[0] ? `#${rest[0]}` : 'Issues'
        return {
          title: `${repo} ${issueNum} · Issue`,
          notes: isZh
            ? `GitHub 项目 ${owner}/${repo} 的 Issue 讨论跟踪。`
            : `Issue discussion and bug tracking for ${owner}/${repo}.`,
        }
      } else if (sub === 'pull' || sub === 'pulls') {
        const prNum = rest[0] ? `#${rest[0]}` : 'PR'
        return {
          title: `${repo} ${prNum} · Pull Request`,
          notes: isZh
            ? `GitHub 项目 ${owner}/${repo} 的代码合入请求。`
            : `Code pull request for ${owner}/${repo}.`,
        }
      }
      return {
        title: `${repo} · ${sub}`,
        notes: isZh
          ? `GitHub 项目 ${owner}/${repo} 的 ${sub} 模块。`
          : `${sub} section of ${owner}/${repo} on GitHub.`,
      }
    }
  }

  // 2. 技术文档子域 (docs.*, *.org/docs)
  if (host.startsWith('docs.') || path.startsWith('/docs') || path.startsWith('/guide')) {
    const { brand } = extractBrandFromHostname(host)
    const formattedBrand = brand.charAt(0).toUpperCase() + brand.slice(1)
    return {
      title: isZh ? `${formattedBrand} 官方开发文档` : `${formattedBrand} Official Docs`,
      notes: isZh
        ? `${formattedBrand} 官方指南、架构概念与 API 接口参考。`
        : `Official guides, architecture, and API references for ${formattedBrand}.`,
    }
  }

  // 3. V2EX 帖子
  if (host === 'v2ex.com' && path.startsWith('/t/')) {
    return {
      title: isZh ? 'V2EX 讨论帖' : 'V2EX Discussion Post',
      notes: isZh
        ? 'V2EX 社区技术或生活交流主题帖。'
        : 'Topic discussion thread on V2EX tech community.',
    }
  }

  // 4. Bilibili 视频
  if (host === 'bilibili.com' && path.startsWith('/video/')) {
    return {
      title: isZh ? 'Bilibili 视频教程与精选' : 'Bilibili Video',
      notes: isZh ? '哔哩哔哩视频播放页面。' : 'Video stream on Bilibili.',
    }
  }

  // 5. 掘金文章
  if (host === 'juejin.cn' && path.startsWith('/post/')) {
    return {
      title: isZh ? '掘金技术博客文章' : 'Juejin Technical Article',
      notes: isZh
        ? '稀土掘金开发者技术沉淀与分享文章。'
        : 'Developer knowledge sharing post on Juejin.',
    }
  }

  // 6. 文章 Slug 提炼
  const articleTitle = parseArticleSlug(urlObj.pathname)
  if (articleTitle) {
    const { brand } = extractBrandFromHostname(host)
    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1)
    return {
      title: `${articleTitle} · ${brandName}`,
      notes: isZh ? `来自 ${brandName} 的文章与精选内容。` : `Article and reading from ${brandName}.`,
    }
  }

  return {}
}

/**
 * 分类概念映射（将站点意图连接到用户已有的多样化分类名称）
 */
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  'AI': ['ai', '人工智能', '大模型', '智能', '模型', '算法', 'gpt', 'chatgpt'],
  '开发': ['开发', '技术', '代码', '编程', '工程', '前端', '后端', 'dev', 'code', 'develop'],
  '设计': ['设计', '美工', 'ui', 'ux', '原型', '灵感', '视觉', 'design'],
  '工具': ['工具', '效率', '实用', '白板', '生产力', 'tool', 'tools', 'utility'],
  '社区': ['社区', '讨论', '社交', '极客', '论坛', '问答', 'community', 'forum'],
  '资讯': ['资讯', '阅读', '文章', '博客', '新闻', '信息', 'news', 'read'],
  '娱乐': ['娱乐', '影音', '视频', '音乐', '生活', '休闲', 'media', 'video', 'music'],
  '生活': ['生活', '日常', '备忘', '购物', 'life'],
}

/**
 * 智能根据 URL 提炼预填信息
 * @param rawUrl 待预填的网址
 * @param existingBookmarks 用户现有书签库（用于同源历史偏好继承）
 * @param categories 用户现有分类（严格从中预选最匹配分类）
 * @param customAttributes 用户现有属性（严格从中预选最匹配属性）
 * @param lang 语言偏好，默认取当前界面语言（中文用户推荐中文名，英文用户推荐英文名）
 */
export function getSmartPrefill(
  rawUrl: string,
  existingBookmarks: Bookmark[] = [],
  categories: Category[] = [],
  customAttributes: CustomAttribute[] = [],
  lang?: string,
): SmartPrefillResult {
  const url = fixUrl(rawUrl)
  let urlObj: URL | null = null
  try {
    urlObj = new URL(url)
  } catch {
    return {
      title: rawUrl,
      notes: '',
      suggestedAttrIds: [],
      confidence: 'fallback',
    }
  }

  const effectiveLang = lang || (typeof getLocale === 'function' ? getLocale() : 'zh-CN')
  const isZh = effectiveLang.toLowerCase().startsWith('zh')

  const fullHost = urlObj.hostname.replace(/^www\./i, '').toLowerCase()
  const { brand, rootDomain } = extractBrandFromHostname(fullHost)

  let matchedTitle = ''
  let matchedNotes = ''
  let matchedCatKeyword = ''
  const tagList: string[] = []
  let confidence: 'high' | 'medium' | 'fallback' = 'fallback'

  // 1. 精选站点匹配（最高优先级）
  // 先找全 host，再找 rootDomain
  const curated = CURATED_SITES[fullHost] || CURATED_SITES[rootDomain]
  if (curated) {
    matchedTitle = isZh ? curated.titleZh : curated.titleEn
    matchedNotes = isZh ? curated.notesZh : curated.notesEn
    matchedCatKeyword = curated.categoryKeyword || ''
    if (curated.tags) tagList.push(...curated.tags)
    confidence = 'high'
  }

  // 2. 路径语义识别覆盖（如 GitHub 仓库、PR、Issue、文档、博客等）
  const pathSemantics = parsePathSemantics(urlObj, isZh)
  if (pathSemantics.title) {
    matchedTitle = pathSemantics.title
    confidence = 'high'
  }
  if (pathSemantics.notes) {
    matchedNotes = pathSemantics.notes
  }

  // 3. 兜底标题生成（去除子域噪音，精准品牌大写）
  if (!matchedTitle) {
    const firstPart = fullHost.split('.')[0]
    const chosen = GENERIC_SUBDOMAINS.has(firstPart) ? brand : firstPart
    const formatted = chosen.charAt(0).toUpperCase() + chosen.slice(1)
    matchedTitle = formatted
    confidence = 'medium'
  }

  // 4. 同源继承：从用户已有的同域历史书签中继承分类、常用账号与标签偏好
  let inheritedCatId: string | undefined = undefined
  let inheritedUsername: string | undefined = undefined
  const activeExistingBms = existingBookmarks.filter(b => !b.deletedAt && b.url)
  const sameDomainBms = activeExistingBms.filter(b => {
    const bHost = domain(b.url).toLowerCase().replace(/^www\./i, '')
    return bHost === fullHost || bHost === rootDomain
  })

  if (sameDomainBms.length > 0) {
    // 统计同域名下最常用的已有分类
    const catFrequency = new Map<string, number>()
    for (const b of sameDomainBms) {
      if (b.categoryId && b.categoryId !== 'uncategorized' && b.categoryId !== 'all') {
        catFrequency.set(b.categoryId, (catFrequency.get(b.categoryId) || 0) + 1)
      }
      if (!inheritedUsername && b.username) {
        inheritedUsername = b.username
      }
      if (b.attributes) {
        for (const [aid, val] of Object.entries(b.attributes)) {
          if (val && !tagList.includes(aid)) tagList.push(aid)
        }
      }
    }
    let maxCnt = 0
    for (const [cid, cnt] of catFrequency.entries()) {
      if (cnt > maxCnt) {
        maxCnt = cnt
        inheritedCatId = cid
      }
    }
  }

  // 5. 分类匹配定位（严格从用户已有分类中预选）
  let finalCatId = inheritedCatId
  const activeCats = categories.filter(c => !c.deletedAt && c.id !== 'all' && c.id !== 'uncategorized')

  if (!finalCatId && matchedCatKeyword && activeCats.length > 0) {
    const kwLower = matchedCatKeyword.toLowerCase()
    const synonyms = CATEGORY_SYNONYMS[matchedCatKeyword] || [kwLower]

    // A. 尝试直接名称包含
    for (const cat of activeCats) {
      const cname = cat.name.toLowerCase()
      if (synonyms.some(s => cname.includes(s) || s.includes(cname))) {
        finalCatId = cat.id
        break
      }
    }

    // B. 若还未匹配到，尝试与品牌词/标签碰撞
    if (!finalCatId) {
      for (const cat of activeCats) {
        const cname = cat.name.toLowerCase()
        if (tagList.some(tag => cname.includes(tag.toLowerCase()) || tag.toLowerCase().includes(cname))) {
          finalCatId = cat.id
          break
        }
      }
    }
  }

  // 6. 属性标签匹配（严格从用户已有的属性中预选）
  const suggestedAttrIds: string[] = []
  const activeAttrs = customAttributes.filter(a => !a.deletedAt)
  for (const attr of activeAttrs) {
    const attrLower = attr.name.toLowerCase()
    const isMatched = tagList.some(t => {
      const tLower = t.toLowerCase()
      return t === attr.id || tLower === attrLower || attrLower.includes(tLower) || tLower.includes(attrLower)
    })
    if (isMatched && !suggestedAttrIds.includes(attr.id)) {
      suggestedAttrIds.push(attr.id)
    }
  }

  return {
    title: matchedTitle,
    notes: matchedNotes,
    categoryId: finalCatId,
    suggestedAttrIds,
    suggestedUsername: inheritedUsername,
    confidence,
  }
}
